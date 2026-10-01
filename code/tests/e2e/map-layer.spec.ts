import { expect, test, type Page } from "@playwright/test";
import { waitForMapReady } from "./map-ready";

// P2-03. The marker layer needs WebGL2 but no Geoapify key: with no key the page draws on a blank Milky
// background. With a key the basemap sits underneath; nothing below depends on it.

// Software WebGL is slow on a laptop and slower on a CI runner.
test.describe.configure({ timeout: 120_000 });

async function openLayer(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/dev/map-layer");
  const map = page.getByTestId("map-layer");
  await waitForMapReady(page);
  await expect(map).toHaveAttribute("data-drawn", /\d+/);
  return errors;
}

type Drawn = { key: string; kind: string; x: number; y: number; radius: number };

const drawn = (page: Page) => page.evaluate(() => window.__mapLayer!.layer.getDrawn() as Drawn[]);
const stats = (page: Page) => page.evaluate(() => ({ ...window.__mapLayer!.layer.stats }));

/** Replaces the scene, repaints, and waits for the frame. */
async function showItems(page: Page, items: unknown[], camera?: { center?: [number, number]; zoom?: number }) {
  await page.evaluate(
    ({ items, camera }) =>
      new Promise<void>((resolve) => {
        const { map, layer } = window.__mapLayer!;
        if (camera) map.jumpTo(camera);
        layer.setItems(items as never);
        map.once("render", () => resolve());
        map.triggerRepaint();
      }),
    { items, camera },
  );
}

type Rgb = [number, number, number];

/** Reads the colour at CSS-pixel positions from the frame that is being rendered. */
async function pixelsAt(page: Page, points: Array<[number, number]>): Promise<Rgb[]> {
  return page.evaluate(
    (points) =>
      new Promise<Rgb[]>((resolve) => {
        const map = window.__mapLayer!.map;
        map.once("render", () => {
          const source = map.getCanvas();
          const copy = document.createElement("canvas");
          copy.width = source.width;
          copy.height = source.height;
          const ctx = copy.getContext("2d")!;
          ctx.drawImage(source, 0, 0);
          const scale = source.width / source.clientWidth;
          resolve(
            points.map(([x, y]) => {
              const d = ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
              return [d[0], d[1], d[2]] as Rgb;
            }),
          );
        });
        map.triggerRepaint();
      }),
    points,
  );
}

async function tokenColour(page: Page, name: string): Promise<Rgb> {
  const value = await page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  const m = /^#([0-9a-f]{6})$/i.exec(value);
  if (!m) throw new Error(`${name} is "${value}", expected #rrggbb`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as Rgb;
}

const near = (actual: Rgb, expected: Rgb, tolerance = 3) =>
  actual.every((channel, i) => Math.abs(channel - expected[i]) <= tolerance);

test("draws 60 clusters and 400 logos in one call and culls the far items", async ({ page }, testInfo) => {
  const errors = await openLayer(page);
  const s = await stats(page);
  expect(s).toMatchObject({ items: 663, drawn: 463, culled: 200, drawCalls: 1, unsupportedCamera: false });

  const items = await drawn(page);
  const count = (kind: string) => items.filter((i) => i.kind === kind).length;
  expect([count("cluster"), count("logo"), count("stack")]).toEqual([60, 400, 3]);
  expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  expect(items.some((i) => i.key.startsWith("syn:far"))).toBe(false);
  expect(errors).toEqual([]);

  await testInfo.attach("static-scene", { body: await page.screenshot(), contentType: "image/png" });
});

test("projects exactly where MapLibre does, at whole and fractional zoom", async ({ page }) => {
  await openLayer(page);
  // Close to the centre, so every one is in view even at zoom 15.8 (about 80,000 px per degree).
  const lngLats: Array<[number, number]> = [
    [77.6004, 12.9805],
    [77.5992, 12.9811],
    [77.6011, 12.9793],
    [77.5985, 12.9798],
  ];
  const items = lngLats.map(([lng, lat], i) => ({ key: `p${i}`, kind: "logo", lng, lat, letter: "A", swatch: 0 }));
  for (const zoom of [12, 13.37, 15.8]) {
    await showItems(page, items, { center: [77.6, 12.98], zoom });
    const comparison = await page.evaluate(
      (lngLats) => {
        const { map, layer } = window.__mapLayer!;
        return layer.getDrawn().map((d) => {
          const p = map.project(lngLats[Number(d.key.slice(1))]);
          return { dx: d.x - p.x, dy: d.y - p.y };
        });
      },
      lngLats,
    );
    expect(comparison.length).toBeGreaterThan(0);
    for (const { dx, dy } of comparison) {
      expect(Math.abs(dx)).toBeLessThan(0.02);
      expect(Math.abs(dy)).toBeLessThan(0.02);
    }
  }
});

test("takes marker, cluster, selection, and focus colours from the design tokens", async ({ page }) => {
  await openLayer(page);
  const centre: [number, number] = [77.5946, 12.9716];
  // Spaced well apart so no marker touches another.
  const at = (dx: number, dy: number): [number, number] => [centre[0] + dx, centre[1] + dy];
  const place = [at(-0.02, 0), at(0, 0), at(0.02, 0), at(0, 0.02)];
  const items = [
    { key: "cluster", kind: "cluster", count: 50, lng: place[0][0], lat: place[0][1] },
    { key: "logo", kind: "logo", letter: "M", swatch: 0, lng: place[1][0], lat: place[1][1], focused: true },
    { key: "selected", kind: "logo", letter: "M", swatch: 3, selected: true, lng: place[2][0], lat: place[2][1] },
    { key: "plain", kind: "logo", letter: "M", swatch: null, lng: place[3][0], lat: place[3][1] },
  ];
  await showItems(page, items, { center: centre, zoom: 12 });
  const byKey = new Map((await drawn(page)).map((d) => [d.key, d]));
  expect(byKey.size).toBe(4);

  const c = byKey.get("cluster")!;
  const l = byKey.get("logo")!;
  const s = byKey.get("selected")!;
  const p = byKey.get("plain")!;
  const [mantis, milky, ink, moss, mantisDeep, sand, lilac] = await Promise.all(
    ["--mantis", "--milky", "--ink", "--moss", "--mantis-deep", "--swatch-sand", "--swatch-lilac"].map((n) => tokenColour(page, n)),
  );

  // Rings are only 2 or 3 px wide and anti-aliased, so scan across each band for a pixel that is exactly
  // the token colour. Fills are sampled at a single point well inside the shape.
  const scan = (cx: number, cy: number, from: number, to: number): Array<[number, number]> =>
    Array.from({ length: Math.round((to - from) / 0.25) + 1 }, (_, i) => [cx + from + i * 0.25, cy] as [number, number]);
  const ringScans = {
    moss: scan(l.x, l.y, l.radius - 2.5, l.radius + 0.5), // 2 px ring inside the edge
    focus: scan(l.x, l.y, l.radius + 2.5, l.radius + 5.5), // 2 px ring, offset 3 px
    selection: scan(s.x, s.y, s.radius - 0.5, s.radius + 3.5), // 3 px ring outside the edge
    halo: scan(c.x, c.y, c.radius - 2.5, c.radius + 0.5), // 2 px halo inside the cluster edge
  };
  const points: Array<[number, number]> = [
    [c.x, c.y - 0.78 * c.radius], // cluster disc, above the digits
    [l.x - 10, l.y + 10], // logo fill, clear of the letter
    [s.x - 10, s.y + 10], // selected logo fill
    [p.x - 10, p.y + 10], // plain logo: Milky fill
    ...Object.values(ringScans).flat(),
  ];
  const got = await pixelsAt(page, points);
  const expectColour = (label: string, actual: Rgb, expected: Rgb) =>
    expect(near(actual, expected), `${label}: got ${actual}, expected ${expected}`).toBe(true);
  expectColour("cluster disc is Mantis", got[0], mantis);
  expectColour("logo fill is the sand swatch", got[1], sand);
  expectColour("selected logo fill is the lilac swatch", got[2], lilac);
  expectColour("a logo without a swatch is Milky", got[3], milky);
  let offset = 4;
  const band = (name: keyof typeof ringScans) => {
    const pixels = got.slice(offset, offset + ringScans[name].length);
    offset += ringScans[name].length;
    return pixels;
  };
  const mossBand = band("moss");
  const focusBand = band("focus");
  const selectionBand = band("selection");
  const haloBand = band("halo");
  expect(mossBand.some((px) => near(px, moss)), "logo ring has a Moss pixel").toBe(true);
  expect(focusBand.some((px) => near(px, ink)), "focus ring has an Ink pixel").toBe(true);
  expect(selectionBand.some((px) => near(px, mantisDeep)), "selection ring has a Mantis Deep pixel").toBe(true);
  expect(haloBand.some((px) => near(px, milky)), "cluster halo has a Milky pixel").toBe(true);
  // Mantis is a fill: the ring around a plain logo must not be green.
  expect(mossBand.some((px) => near(px, mantis, 10))).toBe(false);
  expect(s.radius).toBeCloseTo(25, 3); // 20 px × 1.25
});

test("draws the count and the initial in Ink", async ({ page }) => {
  await openLayer(page);
  const centre: [number, number] = [77.5946, 12.9716];
  await showItems(
    page,
    [
      { key: "cluster", kind: "cluster", count: 50, lng: centre[0] - 0.02, lat: centre[1] },
      { key: "logo", kind: "logo", letter: "M", swatch: 0, lng: centre[0] + 0.02, lat: centre[1] },
    ],
    { center: centre, zoom: 12 },
  );
  const [cluster, logo] = await drawn(page);
  const ink = await tokenColour(page, "--ink");
  const inkPixels = await page.evaluate(
    async ({ boxes, ink }) =>
      new Promise<number[]>((resolve) => {
        const map = window.__mapLayer!.map;
        map.once("render", () => {
          const source = map.getCanvas();
          const copy = document.createElement("canvas");
          copy.width = source.width;
          copy.height = source.height;
          const ctx = copy.getContext("2d")!;
          ctx.drawImage(source, 0, 0);
          const scale = source.width / source.clientWidth;
          resolve(
            boxes.map(([cx, cy, half]) => {
              const x0 = Math.round((cx - half) * scale);
              const y0 = Math.round((cy - half) * scale);
              const size = Math.round(2 * half * scale);
              const { data } = ctx.getImageData(x0, y0, size, size);
              let n = 0;
              for (let i = 0; i < data.length; i += 4) {
                if (Math.abs(data[i] - ink[0]) < 25 && Math.abs(data[i + 1] - ink[1]) < 25 && Math.abs(data[i + 2] - ink[2]) < 25) n++;
              }
              return n;
            }),
          );
        });
        map.triggerRepaint();
      }),
    { boxes: [[cluster.x, cluster.y, cluster.radius * 0.7], [logo.x, logo.y, logo.radius * 0.7]], ink },
  );
  // "50" and "M" each cover a few dozen device pixels in Ink.
  expect(inkPixels[0]).toBeGreaterThan(30);
  expect(inkPixels[1]).toBeGreaterThan(20);
});

test("keeps drawing in the same call as the camera moves, and culls and restores items", async ({ page }) => {
  await openLayer(page);
  const before = await stats(page);
  // Move two screen-widths east: the original scene leaves the margin, a few far items may enter it.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const { map } = window.__mapLayer!;
        const canvas = map.getCanvas();
        map.jumpTo({ center: map.unproject([canvas.clientWidth * 3.5, canvas.clientHeight / 2]) });
        map.once("render", () => resolve());
        map.triggerRepaint();
      }),
  );
  const away = await stats(page);
  expect(away.drawn).toBeLessThan(before.drawn);
  expect(away.drawn + away.culled).toBe(before.items);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const { map } = window.__mapLayer!;
        map.jumpTo({ center: [77.5946, 12.9716], zoom: 12 });
        map.once("render", () => resolve());
        map.triggerRepaint();
      }),
  );
  expect((await stats(page)).drawn).toBe(before.drawn);
  expect((await stats(page)).drawCalls).toBe(1);
});

test("locks the camera north-up, and refuses to draw a rotated map", async ({ page }) => {
  await openLayer(page);
  const state = await page.evaluate(() => {
    const { map } = window.__mapLayer!;
    return { rotate: map.dragRotate.isEnabled(), maxPitch: map.getMaxPitch(), bearing: map.getBearing(), pitch: map.getPitch() };
  });
  expect(state).toEqual({ rotate: false, maxPitch: 0, bearing: 0, pitch: 0 });

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const { map } = window.__mapLayer!;
        map.jumpTo({ bearing: 30 });
        map.once("render", () => resolve());
        map.triggerRepaint();
      }),
  );
  expect(await stats(page)).toMatchObject({ unsupportedCamera: true, drawn: 0, drawCalls: 0 });
});

test("draws live clusters from the worker", async ({ page }) => {
  await openLayer(page);
  await page.getByRole("button", { name: "Live clusters" }).click();
  await expect(page.getByTestId("map-layer")).toHaveAttribute("data-scenario", "live");
  await expect
    .poll(async () => (await stats(page)).items, { timeout: 30_000 })
    .toBeGreaterThan(20);
  const s = await stats(page);
  expect(s.items).toBeLessThan(5000); // clustered: far fewer items than the 5,000 offices
  await page.evaluate(() => new Promise<void>((resolve) => { window.__mapLayer!.map.once("render", () => resolve()); window.__mapLayer!.map.triggerRepaint(); }));
  expect((await stats(page)).drawCalls).toBe(1);
  const kinds = new Set((await drawn(page)).map((d) => d.kind));
  expect(kinds.has("cluster")).toBe(true);
});

test("recovers after the WebGL context is lost and restored", async ({ page }) => {
  await openLayer(page);
  const before = await stats(page);
  const supported = await page.evaluate(() => {
    const gl = window.__mapLayer!.map.getCanvas().getContext("webgl2");
    return !!gl?.getExtension("WEBGL_lose_context");
  });
  test.skip(!supported, "WEBGL_lose_context is not available here");

  await page.evaluate(async () => {
    const gl = window.__mapLayer!.map.getCanvas().getContext("webgl2")!;
    const lose = gl.getExtension("WEBGL_lose_context")!;
    lose.loseContext();
    await new Promise((r) => setTimeout(r, 200));
    lose.restoreContext();
  });
  await expect.poll(async () => (await stats(page)).contextRestores, { timeout: 10_000 }).toBe(1);
  await expect.poll(async () => (await stats(page)).drawn, { timeout: 10_000 }).toBe(before.drawn);
});
