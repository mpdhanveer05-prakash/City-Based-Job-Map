// The in-page recorder for the validation gate (docs/map-spec.md §10). `installGate` runs inside the browser
// (Playwright serialises it), so it cannot refer to anything outside its own body. The numbers are summarised
// in Node by `summariseFrames`, which is ordinary code and is unit-tested.
import type { GateFilter } from "@/map/fixtures/gate-filters";

export type RawRecording = {
  /** requestAnimationFrame timestamps, ms. */
  frames: number[];
  /** When the layer applied a new set of markers (a split, a merge, or a filter change), ms. */
  updates: number[];
  /** Durations of main-thread tasks over 50 ms, from the Long Tasks API. */
  longTasks: number[];
  /** When the script changed the filter, ms. */
  filterCalls: number[];
  /** Frames in which one key was drawn twice (only counted when `checkKeys` was on). */
  duplicateKeyFrames: number;
  /** The first few frames that drew a key twice: which keys, what the layer was doing, and how long after a filter change. */
  duplicateExamples: Array<{ at: number; sinceFilterMs: number | null; mode: string; keys: Array<{ key: string; kind: string; opacity: number; count: number }> }>;
  framesChecked: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
};

export type HitTotals = { total: number; exact: number; overlap: number; unexplainedMisses: number; examples: Array<{ key: string; kind: string; hit: string | null }> };

declare global {
  interface Window {
    __gate?: {
      start(checkKeys: boolean): void;
      stop(): RawRecording;
      zoomCycles(o: {
        centre: { lng: number; lat: number };
        low: number;
        high: number;
        cycles: number;
        cycleMs: number;
        filters: Record<number, GateFilter>;
        checkKeys: boolean;
      }): Promise<RawRecording>;
      filterLatency(filter: GateFilter): Promise<number>;
      hitAccuracy(): HitTotals;
      hitAccuracyWhileZooming(from: number, to: number, durationMs: number): Promise<HitTotals>;
    };
  }
}

/** Installs `window.__gate`. Runs in the page. */
export function installGate(): void {
  type Rec = RawRecording;
  let rec: Rec | null = null;
  let running = false;
  let checkKeys = false;
  let lastUpdates = 0;
  let observer: PerformanceObserver | null = null;

  const layerOf = () => window.__mapLayer!.layer;
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const loop = (t: number) => {
    if (!running || !rec) return;
    rec.frames.push(t);
    const layer = layerOf();
    const u = layer.animation.updates;
    if (u !== lastUpdates) {
      rec.updates.push(t);
      lastUpdates = u;
    }
    if (checkKeys) {
      const drawn = layer.getDrawn();
      const counts = new Map<string, number>();
      for (const d of drawn) counts.set(d.key, (counts.get(d.key) ?? 0) + 1);
      const repeated = [...counts].filter(([, n]) => n > 1);
      rec.framesChecked++;
      if (repeated.length > 0) {
        rec.duplicateKeyFrames++;
        if (rec.duplicateExamples.length < 5) {
          const lastFilter = rec.filterCalls.length ? rec.filterCalls[rec.filterCalls.length - 1] : null;
          rec.duplicateExamples.push({
            at: t,
            sinceFilterMs: lastFilter === null ? null : Math.round(t - lastFilter),
            mode: layer.animation.mode,
            keys: repeated.slice(0, 4).map(([key, n]) => ({ key, kind: drawn.find((d) => d.key === key)!.kind, opacity: Math.round(drawn.find((d) => d.key === key)!.opacity * 100) / 100, count: n })),
          });
        }
      }
    }
    requestAnimationFrame(loop);
  };

  const start = (check: boolean) => {
    rec = {
      frames: [], updates: [], longTasks: [], filterCalls: [],
      duplicateKeyFrames: 0, duplicateExamples: [], framesChecked: 0, startedAt: performance.now(), endedAt: 0, durationMs: 0,
    };
    running = true;
    checkKeys = check;
    lastUpdates = layerOf().animation.updates;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) rec?.longTasks.push(entry.duration);
      });
      observer.observe({ type: "longtask", buffered: false });
    } catch {
      observer = null;
    }
    requestAnimationFrame(loop);
  };

  const stop = (): Rec => {
    running = false;
    observer?.disconnect();
    rec!.endedAt = performance.now();
    rec!.durationMs = rec!.endedAt - rec!.startedAt;
    return rec!;
  };

  /** Nothing moving, something drawn, for a few frames in a row, and no new update for a moment. */
  const waitSettled = async (timeoutMs = 30_000) => {
    const layer = layerOf();
    const deadline = performance.now() + timeoutMs;
    let calm = 0;
    let lastU = layer.animation.updates;
    let lastChange = performance.now();
    while (performance.now() < deadline) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const u = layer.animation.updates;
      if (u !== lastU) {
        lastU = u;
        lastChange = performance.now();
      }
      calm = !layer.stats.animating && layer.stats.drawn > 0 ? calm + 1 : 0;
      if (calm >= 5 && performance.now() - lastChange > 150) return;
    }
    throw new Error("the map did not settle");
  };

  const hitTotals = (acc: { total: number; exact: number; overlap: number; unexplainedMisses: number; examples: Array<{ key: string; kind: string; hit: string | null }> }) => {
    const { map } = window.__mapLayer!;
    const canvas = map.getCanvas();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const hit = window.__markers!.interactions.hitTest;
    for (const d of layerOf().getDrawn()) {
      if (d.opacity < 0.5 || d.x < 0 || d.x > w || d.y < 0 || d.y > h) continue;
      acc.total++;
      const found = hit(d.x, d.y, "mouse");
      if (found && found.key === d.key) acc.exact++;
      else if (found && Math.hypot(found.x - d.x, found.y - d.y) <= found.radius) acc.overlap++; // another marker is drawn over this point
      else {
        acc.unexplainedMisses++;
        if (acc.examples.length < 5) acc.examples.push({ key: d.key, kind: d.kind, hit: found ? found.key : null });
      }
    }
  };

  window.__gate = {
    start,
    stop,
    async zoomCycles(o) {
      const { map } = window.__mapLayer!;
      const centre: [number, number] = [o.centre.lng, o.centre.lat];
      map.jumpTo({ center: centre, zoom: o.low });
      await sleep(300);
      start(o.checkKeys);
      const linear = (t: number) => t;
      for (let c = 0; c < o.cycles; c++) {
        const filter = o.filters[c];
        if (filter) {
          rec!.filterCalls.push(performance.now());
          void window.__liveControl!.setFilter(filter);
        }
        map.easeTo({ center: centre, zoom: o.high, duration: o.cycleMs / 2, easing: linear });
        await sleep(o.cycleMs / 2);
        map.easeTo({ center: centre, zoom: o.low, duration: o.cycleMs / 2, easing: linear });
        await sleep(o.cycleMs / 2);
      }
      const recording = stop();
      await waitSettled();
      return recording;
    },
    async filterLatency(filter) {
      const t0 = performance.now();
      await window.__liveControl!.setFilter(filter);
      await waitSettled();
      return performance.now() - t0;
    },
    hitAccuracy() {
      const acc = { total: 0, exact: 0, overlap: 0, unexplainedMisses: 0, examples: [] as Array<{ key: string; kind: string; hit: string | null }> };
      hitTotals(acc);
      return acc;
    },
    async hitAccuracyWhileZooming(from, to, durationMs) {
      const { map } = window.__mapLayer!;
      const acc = { total: 0, exact: 0, overlap: 0, unexplainedMisses: 0, examples: [] as Array<{ key: string; kind: string; hit: string | null }> };
      map.jumpTo({ zoom: from });
      await waitSettled();
      map.easeTo({ zoom: to, duration: durationMs, easing: (t: number) => t });
      const end = performance.now() + durationMs + 600;
      // At every frame while the zoom and the split animation run: tap each marker where it is drawn right now.
      await new Promise<void>((resolve) => {
        const tick = () => {
          hitTotals(acc);
          if (performance.now() < end) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      return acc;
    },
  };
}

// ---- Node side ---------------------------------------------------------------------------------------------------

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/** A frame later than this after the one before it is counted as dropped: 1.5 display refreshes at 60 Hz. */
export const DROPPED_FRAME_MS = 25;
/** How long after an update the markers are still moving (the longest transition is 280 ms). */
export const STEP_WINDOW_MS = 300;

export type FrameSummary = {
  durationMs: number;
  frames: number;
  fps: number;
  frameMs: { p50: number; p95: number; p99: number; max: number };
  droppedFrames: number;
  droppedPercent: number;
  longTasks: { count: number; maxMs: number };
  /** One step is the 300 ms after the layer applied a new set of markers (a zoom level crossed, a filter changed). */
  steps: {
    count: number;
    /** Steps whose own frames have p95 <= 18 ms and at most 5% dropped. */
    passing: number;
    worstP95Ms: number;
    worstDroppedPercent: number;
    p95OfStepP95Ms: number;
    pooledFrameMs: { p50: number; p95: number; p99: number; max: number };
    pooledDroppedPercent: number;
  };
};

const round = (n: number, digits = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** digits) / 10 ** digits : n);

function distribution(intervals: number[]) {
  return {
    p50: round(percentile(intervals, 50)),
    p95: round(percentile(intervals, 95)),
    p99: round(percentile(intervals, 99)),
    max: round(Math.max(...intervals)),
  };
}

export function summariseFrames(raw: RawRecording): FrameSummary {
  const intervals: number[] = [];
  for (let i = 1; i < raw.frames.length; i++) intervals.push(raw.frames[i] - raw.frames[i - 1]);
  const dropped = intervals.filter((d) => d > DROPPED_FRAME_MS).length;

  const stepStats: Array<{ p95: number; dropped: number; n: number; intervals: number[] }> = [];
  for (const start of raw.updates) {
    const inStep: number[] = [];
    for (let i = 1; i < raw.frames.length; i++) {
      if (raw.frames[i] >= start && raw.frames[i] <= start + STEP_WINDOW_MS) inStep.push(raw.frames[i] - raw.frames[i - 1]);
    }
    if (inStep.length < 3) continue;
    stepStats.push({
      p95: percentile(inStep, 95),
      dropped: inStep.filter((d) => d > DROPPED_FRAME_MS).length,
      n: inStep.length,
      intervals: inStep,
    });
  }
  const pooled = stepStats.flatMap((s) => s.intervals);
  const droppedPct = (s: { dropped: number; n: number }) => (100 * s.dropped) / s.n;

  return {
    durationMs: round(raw.durationMs, 0),
    frames: raw.frames.length,
    fps: round((1000 * Math.max(raw.frames.length - 1, 0)) / raw.durationMs, 1),
    frameMs: intervals.length ? distribution(intervals) : { p50: NaN, p95: NaN, p99: NaN, max: NaN },
    droppedFrames: dropped,
    droppedPercent: round(intervals.length ? (100 * dropped) / intervals.length : 0),
    longTasks: { count: raw.longTasks.length, maxMs: round(Math.max(0, ...raw.longTasks), 0) },
    steps: {
      count: stepStats.length,
      passing: stepStats.filter((s) => s.p95 <= 18 && droppedPct(s) <= 5).length,
      worstP95Ms: round(Math.max(0, ...stepStats.map((s) => s.p95))),
      worstDroppedPercent: round(Math.max(0, ...stepStats.map(droppedPct))),
      p95OfStepP95Ms: round(percentile(stepStats.map((s) => s.p95), 95)),
      pooledFrameMs: pooled.length ? distribution(pooled) : { p50: NaN, p95: NaN, p99: NaN, max: NaN },
      pooledDroppedPercent: round(pooled.length ? (100 * pooled.filter((d) => d > DROPPED_FRAME_MS).length) / pooled.length : 0),
    },
  };
}
