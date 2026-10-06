import { expect, type Page, type TestInfo } from "@playwright/test";
import { logMapTiming, waitForMapReady } from "./map-ready";

// Helpers shared by the specs that drive the live scenario of /dev/map-layer (hit-test, popup and keyboard).
// Markers' positions are read from the layer's own last frame, so a tap lands exactly where a marker was drawn.

export type Drawn = { key: string; kind: string; x: number; y: number; radius: number; selected: boolean; opacity: number };
export type Group = { id: string; kind: string; lng: number; lat: number; size: number };

export async function openLive(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/dev/map-layer");
  await waitForMapReady(page);
  await page.getByRole("button", { name: "Live clusters" }).click();
  const started = Date.now();
  const keys = () => page.evaluate(() => (window.__liveKeys ?? []).length);
  try {
    await expect.poll(keys, { timeout: 30_000 }).toBeGreaterThan(20);
    logMapTiming({ event: "live", waitedMs: Date.now() - started });
  } catch (error) {
    logMapTiming({ event: "live-timeout", waitedMs: Date.now() - started, keys: await keys().catch(() => null) });
    throw error;
  }
  await settle(page);
  return errors;
}

/** Waits until nothing is moving and the layer has drawn at least one frame since. */
export async function settle(page: Page) {
  await expect
    .poll(() => page.evaluate(() => !window.__mapLayer!.layer.stats.animating && window.__mapLayer!.layer.stats.drawn > 0), { timeout: 30_000 })
    .toBe(true);
}

/**
 * DEF-3: waits until the worker has answered for where the camera is now, then for the animation to end. After a camera
 * move the map asks the worker for the new view on `moveend`; until that answer is applied the old markers are still drawn
 * and nothing is animating, so `settle` alone can return on that stale frame (about 100 to 300 ms after the camera stops,
 * longer under load). Use this after any camera move the test did not make with goTo.
 */
export async function settleOnView(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const { map } = window.__mapLayer!;
          if (map.isMoving()) return false;
          const trace = window.__liveTrace ?? [];
          // The latest request, and an applied answer to it (or to a later one) for this zoom.
          let lastRequest = -1;
          trace.forEach((e, i) => {
            if (e.what === "request") lastRequest = i;
          });
          return lastRequest >= 0 && trace.slice(lastRequest).some((e) => e.what === "response" && !!e.applied && Math.abs(e.zoom - map.getZoom()) < 1e-6);
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
  await settle(page);
}

export const updates = (page: Page) => page.evaluate(() => window.__mapLayer!.layer.animation.updates);

/** Jumps the camera, then waits for the worker's answer for the new view and for the animation to end. */
export async function goTo(page: Page, lng: number, lat: number, zoom: number) {
  const before = await updates(page);
  await page.evaluate(([lng, lat, zoom]) => window.__mapLayer!.map.jumpTo({ center: [lng, lat], zoom }), [lng, lat, zoom]);
  await expect.poll(() => updates(page), { timeout: 30_000 }).toBeGreaterThan(before);
  await settle(page);
}

/** The drawn markers after one more rendered frame. */
export const drawnNow = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Drawn[]>((resolve) => {
        const { map, layer } = window.__mapLayer!;
        map.once("render", () => resolve(layer.getDrawn()));
        map.triggerRepaint();
      }),
  );

export const groups = (page: Page) => page.evaluate(() => window.__markers!.groups as Group[]);
export const events = (page: Page) => page.evaluate(() => window.__markers!.events);
export const markerState = (page: Page) =>
  page.getByTestId("marker-state").evaluate((el) => ({ selected: el.getAttribute("data-selected"), spider: el.getAttribute("data-spider") }));

/** A mouse click on desktop, a touch tap on the phone profile. Coordinates are CSS px in the map. */
export async function tap(page: Page, testInfo: TestInfo, x: number, y: number) {
  const box = (await page.getByTestId("map-layer").boundingBox())!;
  if (testInfo.project.name === "mobile") await page.touchscreen.tap(box.x + x, box.y + y);
  else await page.mouse.click(box.x + x, box.y + y);
}

export const nearestTo = (items: Drawn[], x: number, y: number) =>
  items.reduce((best, d) => (Math.hypot(d.x - x, d.y - y) < Math.hypot(best.x - x, best.y - y) ? d : best));

export const mapSize = (page: Page) => page.evaluate(() => ({ w: window.__mapLayer!.map.getCanvas().clientWidth, h: window.__mapLayer!.map.getCanvas().clientHeight }));

