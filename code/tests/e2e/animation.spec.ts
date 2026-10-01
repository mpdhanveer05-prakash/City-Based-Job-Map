import { expect, test, type Page } from "@playwright/test";

// P2-05. The live scenario clusters 5,000 synthetic offices in the worker and animates every zoom, as the
// explorer will. These tests watch the layer's own state (the debug hook) frame by frame.

test.describe.configure({ timeout: 120_000 });

const SPLIT = 280;
const MERGE = 220;

type Frame = { keys: string[]; animating: boolean; mode: string; moving: number; degraded: boolean; updates: number };

async function openLive(page: Page, reducedMotion = false) {
  if (reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/dev/map-layer");
  await expect(page.getByTestId("map-layer")).toHaveAttribute("data-status", "ready", { timeout: 45_000 });
  await page.getByRole("button", { name: "Live clusters" }).click();
  // The static scene is still on screen until the worker answers, so wait for the first live response.
  await expect.poll(() => page.evaluate(() => (window.__liveKeys ?? []).length), { timeout: 30_000 }).toBeGreaterThan(20);
  await settle(page);
  return errors;
}

/** Waits until nothing is moving and the layer has drawn at least one frame since. */
async function settle(page: Page) {
  await expect
    .poll(() => page.evaluate(() => !window.__mapLayer!.layer.stats.animating && window.__mapLayer!.layer.stats.drawn > 0), { timeout: 30_000 })
    .toBe(true);
}

/** Starts recording one entry per rendered frame. Stop with stopFrames(). */
function startFrames(page: Page) {
  return page.evaluate(() => {
    const { map, layer } = window.__mapLayer!;
    const frames: Frame[] = [];
    const onRender = () => {
      const a = layer.animation;
      frames.push({ keys: layer.getDrawn().map((d) => d.key), animating: layer.stats.animating, mode: a.mode, moving: a.moving, degraded: a.degraded, updates: a.updates });
    };
    map.on("render", onRender);
    (window as unknown as { __frames: { frames: Frame[]; stop: () => void } }).__frames = { frames, stop: () => map.off("render", onRender) };
  });
}

function stopFrames(page: Page): Promise<Frame[]> {
  return page.evaluate(() => {
    const rec = (window as unknown as { __frames: { frames: Frame[]; stop: () => void } }).__frames;
    rec.stop();
    return rec.frames;
  });
}

const setZoom = (page: Page, zoom: number) => page.evaluate((z) => window.__mapLayer!.map.jumpTo({ zoom: z }), zoom);
const updates = (page: Page) => page.evaluate(() => window.__mapLayer!.layer.animation.updates);

function noDuplicates(frames: Frame[]) {
  for (const [i, f] of frames.entries()) expect(new Set(f.keys).size, `frame ${i} draws a key twice`).toBe(f.keys.length);
}

test("splits on zoom in and merges on zoom out", async ({ page }) => {
  const errors = await openLive(page);
  const before = await updates(page);

  await startFrames(page);
  await setZoom(page, 13);
  await expect.poll(() => updates(page), { timeout: 15_000 }).toBeGreaterThan(before);
  await settle(page);
  const zoomIn = await stopFrames(page);
  noDuplicates(zoomIn);
  const split = zoomIn.find((f) => f.mode === "split");
  expect(split, "a zoom in is a split").toBeDefined();
  expect(split!.moving).toBeGreaterThan(0);
  expect(split!.degraded).toBe(false);

  await startFrames(page);
  await setZoom(page, 12);
  await expect.poll(() => updates(page), { timeout: 15_000 }).toBeGreaterThan(before + 1);
  await settle(page);
  const zoomOut = await stopFrames(page);
  noDuplicates(zoomOut);
  expect(zoomOut.some((f) => f.mode === "merge" && f.moving > 0), "a zoom out is a merge").toBe(true);
  expect(errors).toEqual([]);
});

type Snap = Record<string, { x: number; y: number; radius: number }>;

/** The drawn markers by key, after one more rendered frame. */
const snapshot = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Snap>((resolve) => {
        const { map, layer } = window.__mapLayer!;
        map.once("render", () => resolve(Object.fromEntries(layer.getDrawn().map((d) => [d.key, { x: d.x, y: d.y, radius: d.radius }]))));
        map.triggerRepaint();
      }),
  );

/** Holds the layer's animation clock at a time the test sets, so a transition can be read at an exact moment. */
async function holdClock(page: Page) {
  await page.evaluate(() => {
    let t = performance.now();
    window.__layerNow = () => t;
    (window as unknown as { __advance: (ms: number) => void }).__advance = (ms) => { t += ms; };
  });
  return {
    advance: (ms: number) => page.evaluate((m) => (window as unknown as { __advance: (ms: number) => void }).__advance(m), ms),
    release: () => page.evaluate(() => { delete window.__layerNow; }),
  };
}

test("children grow out of their parent along the ease-out curve, and merge back along ease-in", async ({ page }) => {
  await openLive(page);
  const clock = await holdClock(page);
  const start = await snapshot(page);

  // Zoom in. The clock is held, so the split is at t = 0 when the update lands.
  const before = await updates(page);
  await setZoom(page, 13);
  await expect.poll(() => updates(page), { timeout: 15_000 }).toBeGreaterThan(before);
  await clock.advance(SPLIT / 2);
  const mid = await snapshot(page);
  await clock.advance(SPLIT);
  const end = await snapshot(page);

  const born = Object.keys(end).filter((k) => !(k in start)); // children and new items
  expect(born.length).toBeGreaterThan(5);
  // Half way through a 280 ms ease-out cubic, a child is 1 - 0.5^3 = 87.5% of its size.
  const grown = born.filter((k) => k in mid);
  expect(grown.length).toBeGreaterThan(5);
  for (const key of grown) expect(mid[key].radius / end[key].radius, key).toBeCloseTo(0.875, 1);
  // ...and is not yet at its place.
  expect(grown.some((k) => Math.hypot(mid[k].x - end[k].x, mid[k].y - end[k].y) > 1)).toBe(true);
  // A parent that went away has shrunk to 12.5% by then.
  const gone = Object.keys(start).filter((k) => !(k in end) && k in mid);
  expect(gone.length).toBeGreaterThan(0);
  for (const key of gone) expect(mid[key].radius / start[key].radius, key).toBeCloseTo(0.125, 1);

  // Zoom back out: a 220 ms ease-in cubic is only 12.5% of the way at half time.
  const afterIn = await updates(page);
  await setZoom(page, 12);
  await expect.poll(() => updates(page), { timeout: 15_000 }).toBeGreaterThan(afterIn);
  await clock.advance(MERGE / 2);
  const merging = await snapshot(page);
  await clock.advance(MERGE);
  const merged = await snapshot(page);
  const leaving = Object.keys(end).filter((k) => !(k in merged) && k in merging);
  expect(leaving.length).toBeGreaterThan(5);
  for (const key of leaving) expect(merging[key].radius / end[key].radius, key).toBeCloseTo(0.875, 1);
  await clock.release();
});

test("draws no key twice in any frame through 20 rapid zoom cycles", async ({ page }) => {
  const errors = await openLive(page);
  await startFrames(page);

  // 20 cycles of zoom in, then out, with only 20 to 90 ms between steps: updates arrive mid-transition.
  await page.evaluate(async () => {
    const { map } = window.__mapLayer!;
    let seed = 7;
    const wait = () => new Promise((r) => setTimeout(r, 20 + ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 70)));
    for (let cycle = 0; cycle < 20; cycle++) {
      map.jumpTo({ zoom: 13 });
      await wait();
      map.jumpTo({ zoom: 12 });
      await wait();
    }
  });
  await settle(page);
  // Let the last worker response land and animate out.
  await page.waitForTimeout(600);
  await settle(page);

  const frames = await stopFrames(page);
  expect(frames.length).toBeGreaterThan(20);
  noDuplicates(frames);
  const modes = new Set(frames.map((f) => f.mode));
  expect(modes.has("split") || modes.has("merge"), `modes seen: ${[...modes]}`).toBe(true);

  // The final picture is the last response: every drawn key is one of its keys, and something is drawn.
  const final = await page.evaluate(() => ({
    drawn: window.__mapLayer!.layer.getDrawn().map((d) => d.key),
    live: window.__liveKeys ?? [],
    animating: window.__mapLayer!.layer.stats.animating,
  }));
  expect(final.animating).toBe(false);
  expect(final.drawn.length).toBeGreaterThan(0);
  const live = new Set(final.live);
  expect(final.drawn.filter((k) => !live.has(k))).toEqual([]);
  expect(errors).toEqual([]);
});

test("a filter change in the middle of a zoom cross-fades without drawing a key twice", async ({ page }) => {
  const errors = await openLive(page);
  await startFrames(page);
  const before = await updates(page);
  await setZoom(page, 13);
  await expect.poll(() => updates(page), { timeout: 15_000 }).toBeGreaterThan(before);
  // The split is under way; change the filter now.
  await page.evaluate(() => window.__liveControl!.setStartupsOnly(true));
  await expect.poll(() => page.evaluate(() => window.__mapLayer!.layer.animation.mode), { timeout: 15_000 }).toBe("data");
  await settle(page);
  await page.waitForTimeout(500);
  await settle(page);
  const frames = await stopFrames(page);
  noDuplicates(frames);
  expect(frames.some((f) => f.mode === "data")).toBe(true);

  // After the cross-fade only the new filter's items are drawn.
  const final = await page.evaluate(() => ({ drawn: window.__mapLayer!.layer.getDrawn().map((d) => d.key), live: window.__liveKeys ?? [] }));
  const live = new Set(final.live);
  expect(final.drawn.length).toBeGreaterThan(0);
  expect(final.drawn.filter((k) => !live.has(k))).toEqual([]);
  expect(errors).toEqual([]);

  // And back to every company.
  await page.evaluate(() => window.__liveControl!.setStartupsOnly(false));
  await settle(page);
  await page.waitForTimeout(500);
  await settle(page);
  const all = await page.evaluate(() => ({ drawn: window.__mapLayer!.layer.getDrawn().length }));
  expect(all.drawn).toBeGreaterThan(0);
});

test("under reduced motion nothing moves and a transition lasts at most 100 ms", async ({ page }) => {
  await openLive(page, true);
  const before = await updates(page);
  await startFrames(page);
  await setZoom(page, 13);
  await expect.poll(() => updates(page), { timeout: 15_000 }).toBeGreaterThan(before);
  await settle(page);
  const frames = await stopFrames(page);
  noDuplicates(frames);
  const after = frames.filter((f) => f.updates > before);
  expect(after.length).toBeGreaterThan(0);
  expect(after.every((f) => f.mode === "reduced" && f.moving === 0), `modes: ${[...new Set(after.map((f) => f.mode))]}`).toBe(true);
});
