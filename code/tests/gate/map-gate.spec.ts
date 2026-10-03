import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { GATE_FILTERS, type GateFilter } from "@/map/fixtures/gate-filters";
import { CITY_SHAPES } from "@/map/fixtures/hotspots";
import { drawnNow, events, goTo, mapSize, openLiveSized, settle } from "./gate-helpers";
import { installGate, percentile, summariseFrames, type RawRecording } from "./gate-recorder";

// The map validation gate, scenarios 1 to 3 plus filter latency and hit accuracy (docs/map-spec.md §10).
// It records raw numbers to gate-results/dpr<ratio>-<size>.json; it asserts only what must
// hold whatever the machine (no duplicate keys, a correct final picture, no hit errors, a clean run).
// The frame-time and latency thresholds are judged in docs/map-gate-report.md, not here, because they
// depend on the device the gate owner names (D-06).

test.describe.configure({ mode: "serial" });

const SIZES = (process.env.GATE_SIZES ?? "S,M,L").split(",") as Array<"S" | "M" | "L">;
const MANYATA = CITY_SHAPES.bengaluru.hotspots.find((h) => h.name === "Manyata")!; // the densest hotspot (weight / sigma^2)
const CENTRE = { lng: MANYATA.lng, lat: MANYATA.lat };
const CYCLES = 20;
const CYCLE_MS = 1500;

type Environment = {
  chrome: string;
  renderer: string;
  dpr: number;
  viewport: { w: number; h: number };
  userAgent: string;
  hardwareConcurrency: number;
};

async function environment(page: Page): Promise<Environment> {
  return page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2")!;
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? "unknown",
      renderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : "unknown",
      dpr: window.devicePixelRatio,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
    };
  });
}

for (const size of SIZES) {
  test(`gate scenarios 1 to 3, filter latency, and hit accuracy: dataset ${size}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openLiveSized(page, size);
    await page.evaluate(installGate);
    const env = await environment(page);
    const counts = await page.evaluate(() => window.__liveControl!.counts());
    const result: Record<string, unknown> = { size, environment: env, dataset: counts, startedAt: new Date().toISOString() };
    console.log(`[gate ${size}] ${env.renderer} | Chrome ${env.chrome} | DPR ${env.dpr} | ${env.viewport.w}x${env.viewport.h} | ${counts.offices} offices`);
    expect(env.renderer, "WebGL must run on a GPU for this gate, not in software").not.toMatch(/swiftshader|software|llvmpipe/i);

    // ---- Scenario 1: 20 rapid zoom cycles over the densest hotspot, z11 <-> z17 ----------------------------
    await goTo(page, CENTRE.lng, CENTRE.lat, 11);
    const scenario1 = await runZoom(page, { filters: {}, checkKeys: false });
    const scenario1Check = await runZoom(page, { filters: {}, checkKeys: true });
    result.scenario1 = { performance: summarise(scenario1), correctness: correctness(scenario1Check) };

    // ---- Scenario 2: the same cycles while the filter changes: Startup, Startup + Seed, MNC, then all ------
    const filterPlan: Record<number, GateFilter> = { 4: "startups", 8: "startup-seed", 12: "mnc", 16: "none" };
    await page.evaluate(() => window.__liveControl!.setFilter("none"));
    await settle(page);
    const scenario2 = await runZoom(page, { filters: filterPlan, checkKeys: false });
    await page.evaluate(() => window.__liveControl!.setFilter("none"));
    await settle(page);
    const scenario2Check = await runZoom(page, { filters: filterPlan, checkKeys: true });
    result.scenario2 = { performance: summarise(scenario2), correctness: correctness(scenario2Check), filterPlan };
    await settle(page);
    // After the last filter ("none") the picture must equal the worker's latest answer, and the keyboard list must match it.
    result.scenario2Final = await finalPicture(page);

    // ---- Scenario 3: pan across the city at z14 for 10 s ------------------------------------------------------
    await page.evaluate(() => window.__liveControl!.setFilter("none"));
    await goTo(page, 77.5, 13.0, 14);
    const pan = await page.evaluate(
      async ([from, to]) => {
        const g = window.__gate!;
        g.start(false);
        const { map } = window.__mapLayer!;
        map.easeTo({ center: [from, 13.0], zoom: 14, duration: 0 });
        await new Promise((r) => setTimeout(r, 200));
        // 10 s west to east along the latitude of the dense belt, at constant speed.
        map.easeTo({ center: [to, 13.0], zoom: 14, duration: 10_000, easing: (t: number) => t });
        await new Promise((r) => setTimeout(r, 10_200));
        return g.stop();
      },
      [77.5, 77.74] as const,
    );
    result.scenario3 = { performance: summarise(pan) };

    // ---- Filter latency, warm: call the filter, wait until the map has settled on its answer --------------
    await goTo(page, CENTRE.lng, CENTRE.lat, 12);
    const latencies: Array<{ filter: GateFilter; pass: number; ms: number }> = [];
    for (let pass = 0; pass < 4; pass++) {
      for (const filter of GATE_FILTERS) {
        const ms = await page.evaluate(async (f) => window.__gate!.filterLatency(f), filter);
        latencies.push({ filter, pass, ms: Math.round(ms) });
      }
    }
    await page.evaluate(() => window.__liveControl!.setFilter("none"));
    const warm = latencies.filter((l) => l.pass > 0).map((l) => l.ms);
    result.filterLatency = {
      note: "ms from calling the filter to the map settled on the new points, after one cold pass",
      cold: latencies.filter((l) => l.pass === 0),
      warmMedian: percentile(warm, 50),
      warmP95: percentile(warm, 95),
      warmMax: Math.max(...warm),
      samples: latencies,
    };

    // ---- Hit accuracy ------------------------------------------------------------------------------------------
    await goTo(page, CENTRE.lng, CENTRE.lat, 17);
    const settledHits = await page.evaluate(() => window.__gate!.hitAccuracy());
    await goTo(page, CENTRE.lng, CENTRE.lat, 12);
    const clusterHits = await page.evaluate(() => window.__gate!.hitAccuracy());
    // During a zoom, at every frame: the tap rule must still answer for the markers as drawn at that moment.
    await goTo(page, CENTRE.lng, CENTRE.lat, 14);
    const movingHits = await page.evaluate(() => window.__gate!.hitAccuracyWhileZooming(14, 16.4, 700));
    // A failure in the real-click step is recorded, not allowed to throw away everything measured before it.
    let real: Awaited<ReturnType<typeof realClicks>> | { error: string };
    try {
      real = await realClicks(page);
    } catch (error) {
      real = { error: error instanceof Error ? (error.message.split(/\r?\n/)[0] ?? error.message) : String(error) };
    }
    result.hitAccuracy = { settledZ17: settledHits, settledZ12: clusterHits, duringZoom: movingHits, realClicks: real };

    result.finishedAt = new Date().toISOString();
    result.pageErrors = errors;
    // Not under test-results/: Playwright empties that folder at the start of every run.
    mkdirSync("gate-results", { recursive: true });
    const file = `gate-results/dpr${env.dpr}-${size}.json`;
    writeFileSync(file, JSON.stringify(result, null, 2));
    console.log(`[gate ${size}] wrote ${file}`);

    // What must hold on any machine.
    const s1 = result.scenario1 as { correctness: ReturnType<typeof correctness> };
    const s2 = result.scenario2 as { correctness: ReturnType<typeof correctness> };
    expect(s1.correctness.duplicateKeyFrames, "scenario 1: no frame draws a key twice").toBe(0);
    expect(s2.correctness.duplicateKeyFrames, "scenario 2: no frame draws a key twice").toBe(0);
    expect((result.scenario2Final as Awaited<ReturnType<typeof finalPicture>>).ok, "scenario 2: the final picture matches the worker and the list").toBe(true);
    expect(settledHits.unexplainedMisses + clusterHits.unexplainedMisses + movingHits.unexplainedMisses, "every tap lands on a marker or an explained overlap").toBe(0);
    expect("error" in real ? real.error : "", "the real clicks all landed").toBe("");
    if (!("error" in real)) {
      expect(real.logoCorrect, "every real click on a logo selected it").toBe(real.logoClicks);
      expect(real.clusterCorrect, "every real click on a cluster reached it").toBe(real.clusterClicks);
    }
    expect(errors, "no page errors").toEqual([]);
  });
}

// ---- helpers ---------------------------------------------------------------------------------------------------

async function runZoom(page: Page, opts: { filters: Record<number, GateFilter>; checkKeys: boolean }): Promise<RawRecording> {
  return page.evaluate(
    async ({ centre, cycles, cycleMs, filters, checkKeys }) => window.__gate!.zoomCycles({ centre, low: 11, high: 17, cycles, cycleMs, filters, checkKeys }),
    { centre: CENTRE, cycles: CYCLES, cycleMs: CYCLE_MS, filters: opts.filters, checkKeys: opts.checkKeys },
  );
}

function summarise(raw: RawRecording) {
  return summariseFrames(raw);
}

function correctness(raw: RawRecording) {
  return { framesChecked: raw.framesChecked, duplicateKeyFrames: raw.duplicateKeyFrames, duplicateExamples: raw.duplicateExamples, longTasks: raw.longTasks.length };
}

/** After everything has settled: nothing is stale, and the keyboard list lists exactly what is on the map. */
async function finalPicture(page: Page) {
  await settle(page);
  const { w, h } = await mapSize(page);
  const drawn = (await drawnNow(page)).filter((d) => d.opacity >= 0.5 && d.x >= 0 && d.x <= w && d.y >= 0 && d.y <= h);
  const live = new Set(await page.evaluate(() => window.__liveKeys ?? []));
  // Every drawn marker came from the latest response (a stack is built from several of its offices).
  const stale = drawn.filter((d) => d.kind !== "stack" && !live.has(d.key));
  const listed = await page.getByTestId("map-a11y-list").locator("button").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.key));
  const missingFromList = drawn.filter((d) => !listed.includes(d.key));
  const extraInList = listed.filter((k) => !drawn.some((d) => d.key === k));
  return {
    drawn: drawn.length,
    listed: listed.length,
    staleItems: stale.length,
    missingFromList: missingFromList.length,
    extraInList: extraInList.length,
    ok: stale.length === 0 && missingFromList.length === 0 && extraInList.length === 0 && listed.length === drawn.length,
  };
}

/** Back to the hotspot at a zoom, with nothing selected, and settled. Does not wait for a new worker answer: the view may not have changed. */
async function resetView(page: Page, zoom: number) {
  await page.keyboard.press("Escape");
  await page.evaluate(
    ([lng, lat, z]) => {
      window.__markers!.controller.setSelected(null);
      window.__mapLayer!.map.stop();
      window.__mapLayer!.map.jumpTo({ center: [lng, lat], zoom: z });
    },
    [CENTRE.lng, CENTRE.lat, zoom] as const,
  );
  await page.waitForTimeout(200);
  await settle(page);
}

/** Real mouse clicks (not synthetic events) at the positions the layer drew markers: 40 logos, then 12 clusters. */
async function realClicks(page: Page) {
  const box = (await page.getByTestId("map-layer").boundingBox())!;
  const out = { logoClicks: 0, logoCorrect: 0, clusterClicks: 0, clusterCorrect: 0 };

  await goTo(page, CENTRE.lng, CENTRE.lat, 17);
  const { w, h } = await mapSize(page);
  // Clear of the control panel (about 344 px on the left), the zoom buttons, and the attribution.
  const inClearArea = (d: { x: number; y: number }) => d.x > 400 && d.x < w - 120 && d.y > 80 && d.y < h - 80;
  const logos = (await drawnNow(page)).filter((d) => d.kind === "logo" && d.opacity >= 0.95 && inClearArea(d));
  for (const logo of logos.slice(0, 40)) {
    // A selection opens a popup and eases the map to fit it: put the view back and clear the selection first.
    await resetView(page, 17);
    const target = (await drawnNow(page)).find((d) => d.key === logo.key) ?? logo;
    const before = (await events(page)).length;
    await page.mouse.click(box.x + target.x, box.y + target.y);
    await expect.poll(async () => (await events(page)).length, { timeout: 5000 }).toBeGreaterThan(before);
    const last = (await events(page)).at(-1)!;
    out.logoClicks++;
    // A click on a marker overlapped by a nearer one may legitimately select that one: count the click as
    // correct if it selected the target or a drawn logo whose disc contains the click point.
    const hit = logos.find((l) => l.key === last.key);
    if (last.type === "logo" && (last.key === logo.key || (hit && Math.hypot(hit.x - target.x, hit.y - target.y) <= hit.radius))) out.logoCorrect++;
  }

  await resetView(page, 12);
  const clusters = (await drawnNow(page)).filter((d) => d.kind === "cluster" && d.opacity >= 0.95 && inClearArea(d));
  for (const cluster of clusters.slice(0, 12)) {
    await resetView(page, 12);
    const target = (await drawnNow(page)).find((d) => d.key === cluster.key) ?? cluster;
    const before = (await events(page)).length;
    await page.mouse.click(box.x + target.x, box.y + target.y);
    await expect.poll(async () => (await events(page)).length, { timeout: 8000 }).toBeGreaterThan(before);
    const last = (await events(page)).at(-1)!;
    out.clusterClicks++;
    const hit = clusters.find((c) => c.key === last.key);
    if (last.type === "cluster" && (last.key === cluster.key || (hit && Math.hypot(hit.x - target.x, hit.y - target.y) <= hit.radius))) out.clusterCorrect++;
  }
  return out;
}
