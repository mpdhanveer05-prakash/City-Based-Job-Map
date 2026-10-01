import { expect, test, type Page } from "@playwright/test";

// P2-04. Synthetic logos (Ink tiles drawn in the page, served as blob: URLs) go through the real fetch, decode,
// upload, and shader path. The page can slow every load (?delay=ms) and shrink the atlas (?pagePx=, ?pages=).

// Software WebGL on the Pixel 7 project (2.6× DPR) is slow, and the slow-network test waits on purpose.
test.describe.configure({ timeout: 120_000 });

const LOGOS = 60;
/** Mirrors logo-fixtures.ts: logos whose index is a multiple of 7 have a revoked URL, so they fail to load. */
const missing = (i: number) => i % 7 === 0;
const MISSING_COUNT = Array.from({ length: LOGOS }, (_, i) => i).filter(missing).length; // 9

type Rgb = [number, number, number];
type Drawn = { key: string; kind: string; x: number; y: number; radius: number };
type AtlasStats = {
  pages: number; maxPages: number; bytes: number; budgetBytes: number; slotsUsed: number; slotsCapacity: number;
  queued: number; loading: number; ready: number; failed: number; evictions: number; uploads: number; blending: number;
};

async function openLogos(page: Page, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/dev/map-layer${query}`);
  await expect(page.getByTestId("map-layer")).toHaveAttribute("data-status", "ready", { timeout: 90_000 });
  await page.getByRole("button", { name: "Logos" }).click();
  await expect.poll(() => page.evaluate(() => window.__mapLayer!.layer.stats.items), { timeout: 15_000 }).toBe(LOGOS);
  return errors;
}

const atlas = (page: Page) => page.evaluate(() => ({ ...window.__mapLayer!.atlas.stats }) as AtlasStats);
const drawn = (page: Page) => page.evaluate(() => window.__mapLayer!.layer.getDrawn() as Drawn[]);

/** Reads each logo's colour just left of its centre (clear of the letter), in the frame being rendered. */
async function logoColours(page: Page): Promise<Array<{ index: number; rgb: Rgb }>> {
  return page.evaluate(
    () =>
      new Promise<Array<{ index: number; rgb: Rgb }>>((resolve) => {
        const { map, layer } = window.__mapLayer!;
        map.once("render", () => {
          const source = map.getCanvas();
          const copy = document.createElement("canvas");
          copy.width = source.width;
          copy.height = source.height;
          const ctx = copy.getContext("2d")!;
          ctx.drawImage(source, 0, 0);
          const scale = source.width / source.clientWidth;
          resolve(
            layer.getDrawn().map((d) => {
              const px = ctx.getImageData(Math.round((d.x - 10) * scale), Math.round(d.y * scale), 1, 1).data;
              return { index: Number(d.key.split(":").pop()), rgb: [px[0], px[1], px[2]] as Rgb };
            }),
          );
        });
        map.triggerRepaint();
      }),
  );
}

async function tokens(page: Page, names: string[]): Promise<Rgb[]> {
  return page.evaluate(
    (names) =>
      names.map((n) => {
        const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
        return [0, 2, 4].map((i) => parseInt(v.slice(1 + i, 3 + i), 16)) as Rgb;
      }),
    names,
  );
}

const near = (a: Rgb, b: Rgb, tol = 4) => a.every((c, i) => Math.abs(c - b[i]) <= tol);
const SWATCHES = ["--swatch-sand", "--swatch-sky", "--swatch-rose", "--swatch-lilac", "--swatch-stone"];

test("shows the letter fallback while images are pending, then swaps in each logo", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/dev/map-layer");
  await expect(page.getByTestId("map-layer")).toHaveAttribute("data-status", "ready", { timeout: 90_000 });
  // Every image stays pending until released, however slow this machine is.
  await page.evaluate(() => { window.__logoControl!.hold = true; });
  await page.getByRole("button", { name: "Logos" }).click();
  await expect.poll(() => page.evaluate(() => window.__mapLayer!.layer.stats.items), { timeout: 15_000 }).toBe(LOGOS);
  await expect.poll(async () => (await atlas(page)).loading, { timeout: 15_000 }).toBeGreaterThan(0);

  const [ink, ...swatches] = await tokens(page, ["--ink", ...SWATCHES]);
  const isSwatch = (rgb: Rgb) => swatches.some((s) => near(rgb, s));

  // The scene is up and nothing has arrived: every marker is a letter on its swatch.
  expect((await atlas(page)).ready).toBe(0);
  expect(await drawn(page)).toHaveLength(LOGOS);
  expect((await logoColours(page)).every((c) => isSwatch(c.rgb))).toBe(true);

  // Frames keep completing while every load is pending: the render is never held up by an image.
  for (const zoom of [12.001, 12.002, 12.003]) {
    await page.evaluate(
      (zoom) => new Promise<void>((resolve) => { window.__mapLayer!.map.once("render", () => resolve()); window.__mapLayer!.map.jumpTo({ zoom }); }),
      zoom,
    );
  }
  expect((await atlas(page)).ready).toBe(0);
  expect((await page.evaluate(() => window.__mapLayer!.layer.stats)).drawCalls).toBe(1);

  // Then the images arrive and replace the letters.
  await page.evaluate(() => { window.__logoControl!.hold = false; });
  await expect.poll(async () => (await atlas(page)).ready, { timeout: 60_000 }).toBe(LOGOS - MISSING_COUNT);
  await expect.poll(async () => (await atlas(page)).blending, { timeout: 10_000 }).toBe(0);
  for (const { index, rgb } of await logoColours(page)) {
    if (missing(index)) expect(isSwatch(rgb), `logo ${index} failed to load, so it keeps its letter`).toBe(true);
    else expect(near(rgb, ink), `logo ${index} shows its image (got ${rgb})`).toBe(true);
  }
  const finalStats = await atlas(page);
  expect(finalStats.failed).toBe(MISSING_COUNT);
  expect(finalStats.pages).toBe(1);
  expect(errors).toEqual([]);

  await testInfo.attach("logos", { body: await page.screenshot(), contentType: "image/png" });
});

test("stays inside a small memory budget, adds a second page, and shows letters for the overflow", async ({ page }) => {
  // Two 256 px pages: 16 cells each at 64 px (4 at 128 px on a high-DPI phone).
  await openLogos(page, "?pagePx=256&pages=2");
  const [ink, ...swatches] = await tokens(page, ["--ink", ...SWATCHES]);

  await expect.poll(async () => (await atlas(page)).uploads, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const s = await atlas(page);
      return s.ready === s.slotsCapacity && s.blending === 0;
    }, { timeout: 30_000 })
    .toBe(true);

  const s = await atlas(page);
  expect(s.pages).toBe(2);
  expect(s.maxPages).toBe(2);
  expect(s.bytes).toBe(2 * 256 * 256 * 4);
  expect(s.bytes).toBeLessThanOrEqual(s.budgetBytes);
  expect(s.slotsUsed).toBe(s.slotsCapacity);
  expect(s.evictions).toBe(0); // everything is on screen, so nothing may be evicted

  // Exactly as many markers show a logo as the budget holds; the rest keep their letters.
  const colours = await logoColours(page);
  const withLogo = colours.filter((c) => near(c.rgb, ink));
  const withLetter = colours.filter((c) => swatches.some((sw) => near(c.rgb, sw)));
  expect(withLogo).toHaveLength(s.slotsCapacity);
  expect(withLogo.length + withLetter.length).toBe(LOGOS);
  expect(withLetter.length).toBeGreaterThanOrEqual(MISSING_COUNT);
});

test("keeps drawing in one call when more logos are visible than one page holds", async ({ page }) => {
  await openLogos(page, "?pagePx=256&pages=1");
  await expect
    .poll(async () => {
      const s = await atlas(page);
      return s.ready === s.slotsCapacity && s.blending === 0;
    }, { timeout: 30_000 })
    .toBe(true);
  const s = await atlas(page);
  expect(s.pages).toBe(1);
  expect(s.bytes).toBe(256 * 256 * 4);
  // A frame still renders, with the overflow as letters.
  await page.evaluate(
    () => new Promise<void>((resolve) => { window.__mapLayer!.map.once("render", () => resolve()); window.__mapLayer!.map.jumpTo({ zoom: 12.002 }); }),
  );
  expect(await page.evaluate(() => window.__mapLayer!.layer.stats)).toMatchObject({ drawn: LOGOS, drawCalls: 1 });
});

test("recovers its logos after the WebGL context is lost and restored", async ({ page }) => {
  await openLogos(page, "?delay=50");
  await expect.poll(async () => (await atlas(page)).ready, { timeout: 30_000 }).toBe(LOGOS - MISSING_COUNT);
  const supported = await page.evaluate(() => !!window.__mapLayer!.map.getCanvas().getContext("webgl2")?.getExtension("WEBGL_lose_context"));
  test.skip(!supported, "WEBGL_lose_context is not available here");

  await page.evaluate(async () => {
    const lose = window.__mapLayer!.map.getCanvas().getContext("webgl2")!.getExtension("WEBGL_lose_context")!;
    lose.loseContext();
    await new Promise((r) => setTimeout(r, 200));
    lose.restoreContext();
  });
  // The layer is re-added with a fresh atlas state, and the visible markers ask for their logos again.
  await expect.poll(() => page.evaluate(() => window.__mapLayer!.layer.stats.contextRestores), { timeout: 15_000 }).toBe(1);
  await expect.poll(async () => (await atlas(page)).ready, { timeout: 30_000 }).toBe(LOGOS - MISSING_COUNT);
  const [ink] = await tokens(page, ["--ink"]);
  await expect.poll(async () => (await atlas(page)).blending, { timeout: 5_000 }).toBe(0);
  const colours = await logoColours(page);
  expect(colours.filter((c) => !missing(c.index)).every((c) => near(c.rgb, ink))).toBe(true);
});
