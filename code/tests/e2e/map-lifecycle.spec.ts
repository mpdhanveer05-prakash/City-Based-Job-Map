import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { waitForMapReady } from "./map-ready";

// P2-08. Mounts the explorer 20 times and unmounts it each time, then checks that nothing is left behind: no worker of
// ours, no WebGL context, no canvas, no growth in event listeners, DOM nodes, or heap (map-spec §9 and §10).
// Chromium only (it reads the heap and listener counts through the DevTools protocol). The page draws on the blank
// background, so the run spends no Geoapify credits; the basemap's own cleanup is MapLibre's `map.remove()`.

test.describe.configure({ timeout: 480_000 });

const CYCLES = 20;
/**
 * The first cycles warm caches (fonts, shaders, JIT), and the heap climbs while they fill. In a run of 20 it rose
 * 6.2 to 7.3 MB over the first nine cycles and then moved about 20 KB a cycle. The baseline is taken after ten.
 */
const WARM_UP = 10;

type Sample = { cycle: number; heapMB: number; listeners: number; nodes: number; workers: string[]; liveContexts: number; canvases: number };

async function sample(cdp: CDPSession, page: Page, cycle: number): Promise<Sample> {
  // A few collections with a pause between: finalizers and worker teardown need a turn of the event loop.
  for (let i = 0; i < 3; i++) {
    await cdp.send("HeapProfiler.collectGarbage");
    await page.waitForTimeout(150);
  }
  const { metrics } = await cdp.send("Performance.getMetrics");
  const heap = metrics.find((m) => m.name === "JSHeapUsedSize")!.value;
  const counters = await cdp.send("Memory.getDOMCounters");
  const inPage = await page.evaluate(() => {
    const refs = (window as unknown as { __contexts: Array<WeakRef<WebGL2RenderingContext | WebGLRenderingContext>> }).__contexts;
    const live = refs.map((r) => r.deref()).filter((gl): gl is WebGL2RenderingContext => !!gl && !gl.isContextLost());
    return { liveContexts: live.length, canvases: document.querySelectorAll("canvas").length };
  });
  return {
    cycle,
    heapMB: Math.round((heap / 1024 / 1024) * 100) / 100,
    listeners: counters.jsEventListeners,
    nodes: counters.nodes,
    workers: page.workers().map((w) => w.url()),
    ...inPage,
  };
}

test("mounting and unmounting the explorer 20 times leaves no listeners, workers, contexts, or heap behind", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Chromium DevTools protocol, desktop profile");

  // Count WebGL contexts without keeping them alive: WeakRefs let a collected context disappear from the count.
  await page.addInitScript(() => {
    const refs: Array<WeakRef<WebGL2RenderingContext | WebGLRenderingContext>> = [];
    (window as unknown as { __contexts: typeof refs }).__contexts = refs;
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      const context = (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
      if (context && (type === "webgl2" || type === "webgl")) refs.push(new WeakRef(context as WebGL2RenderingContext));
      return context as never;
    } as typeof original;
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/dev/map-lifecycle");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.enable");

  const status = page.getByTestId("mount-count");
  const samples: Sample[] = [];

  for (let cycle = 1; cycle <= CYCLES; cycle++) {
    if ((await status.getAttribute("data-mounted")) === "no") await page.getByRole("button", { name: "Mount the map" }).click();
    await waitForMapReady(page);

    // Use everything the explorer creates: the worker, the layer, the controller, the popup, the keyboard list.
    await page.getByRole("button", { name: "Live clusters" }).click();
    await expect.poll(() => page.evaluate(() => (window.__liveKeys ?? []).length), { timeout: 30_000 }).toBeGreaterThan(20);
    await page.evaluate(() => {
      const { controller } = window.__markers!;
      const logo = window.__mapLayer!.layer.getDrawn().find((d) => d.kind === "logo");
      if (logo) {
        controller.setSelected(logo.key);
        controller.setFocused(logo.key);
      }
    });
    await page.evaluate(() => window.__mapLayer!.map.jumpTo({ zoom: 14 })); // a split, a new worker request
    await page.evaluate(() => new Promise<void>((resolve) => { window.__mapLayer!.map.once("render", () => resolve()); window.__mapLayer!.map.triggerRepaint(); }));

    await page.getByRole("button", { name: "Unmount the map" }).click();
    await expect(status).toHaveAttribute("data-mounted", "no");
    await expect.poll(() => page.evaluate(() => window.__mapLayer === undefined && window.__markers === undefined && window.__liveControl === undefined)).toBe(true);
    await page.waitForTimeout(1_500);

    samples.push(await sample(cdp, page, cycle));
  }

  // The series goes into the report; it is the evidence for progress.md.
  await testInfo.attach("lifecycle-samples.json", { body: JSON.stringify(samples, null, 2), contentType: "application/json" });
  console.log("lifecycle samples\n" + samples.map((s) => JSON.stringify(s)).join("\n"));

  for (const s of samples) {
    // Our clustering worker must be gone. MapLibre keeps one pooled tile worker of its own after map.remove(), even
    // with none of our code on the page (checked with a bare Map); it is reused, not added to, so it must stay at one.
    expect(s.workers.filter((url) => !url.includes("maplibre-gl-worker")), `cycle ${s.cycle}: our workers left`).toEqual([]);
    expect(s.workers.length, `cycle ${s.cycle}: MapLibre's pooled workers`).toBeLessThanOrEqual(1);
    expect(s.liveContexts, `cycle ${s.cycle}: WebGL contexts left alive`).toBe(0);
    expect(s.canvases, `cycle ${s.cycle}: canvases left in the page`).toBe(0);
  }
  const baseline = samples[WARM_UP - 1];
  const last = samples[CYCLES - 1];
  expect(last.listeners, "event listeners after 20 cycles vs the baseline").toBeLessThanOrEqual(baseline.listeners);
  expect(last.nodes, "DOM nodes after 20 cycles vs the baseline").toBeLessThanOrEqual(baseline.nodes);
  expect(last.heapMB, "heap after 20 cycles within 10% of the baseline").toBeLessThanOrEqual(baseline.heapMB * 1.1);
  expect(errors).toEqual([]);
});
