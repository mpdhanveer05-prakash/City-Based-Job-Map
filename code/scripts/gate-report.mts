// Turns the gate's raw numbers (test-results/map-gate/dpr<ratio>-<size>.json) into the Markdown tables of
// docs/map-gate-report.md, with a pass or fail against the proposed thresholds (docs/map-spec.md §10).
//   node scripts/gate-report.mts > gate-results/results.md
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const DIR = path.resolve("gate-results");

type Perf = {
  durationMs: number;
  frames: number;
  fps: number;
  frameMs: { p50: number; p95: number; p99: number; max: number };
  droppedFrames: number;
  droppedPercent: number;
  longTasks: { count: number; maxMs: number };
  steps: {
    count: number;
    passing: number;
    worstP95Ms: number;
    worstDroppedPercent: number;
    p95OfStepP95Ms: number;
    pooledFrameMs: { p50: number; p95: number; p99: number; max: number };
    pooledDroppedPercent: number;
  };
};
type Hits = { total: number; exact: number; overlap: number; unexplainedMisses: number };
type Run = {
  size: string;
  environment: { chrome: string; renderer: string; dpr: number; viewport: { w: number; h: number } };
  dataset: { offices: number; total: number; companies: number };
  scenario1: { performance: Perf; correctness: { framesChecked: number; duplicateKeyFrames: number; longTasks: number } };
  scenario2: { performance: Perf; correctness: { framesChecked: number; duplicateKeyFrames: number; longTasks: number } };
  scenario2Final: { drawn: number; listed: number; staleItems: number; missingFromList: number; extraInList: number; ok: boolean };
  scenario3: { performance: Perf };
  filterLatency: { warmMedian: number; warmP95: number; warmMax: number; cold: Array<{ filter: string; ms: number }> };
  hitAccuracy: {
    settledZ17: Hits;
    settledZ12: Hits;
    duringZoom: Hits;
    realClicks: { logoClicks: number; logoCorrect: number; clusterClicks: number; clusterCorrect: number } | { error: string };
  };
  pageErrors: string[];
};

const FRAME_P95_DESKTOP = 18;
const DROPPED_STEP_MAX = 5;
const FILTER_LATENCY_S = 1000;

const mark = (ok: boolean) => (ok ? "pass" : "**FAIL**");
const runs: Run[] = readdirSync(DIR)
  .filter((f) => /^dpr\d+-[SML]\.json$/.test(f))
  .sort((a, b) => (a < b ? -1 : 1))
  .map((f) => JSON.parse(readFileSync(path.join(DIR, f), "utf8")) as Run);

if (runs.length === 0) {
  console.error("no results in gate-results");
  process.exit(1);
}

const out: string[] = [];
const byDpr = new Map<number, Run[]>();
for (const r of runs) byDpr.set(r.environment.dpr, [...(byDpr.get(r.environment.dpr) ?? []), r]);

const frameVerdict = (p: Perf) => p.steps.pooledFrameMs.p95 <= FRAME_P95_DESKTOP && p.steps.passing === p.steps.count;

for (const [dpr, list] of [...byDpr].sort((a, b) => a[0] - b[0])) {
  const first = list[0];
  out.push(`### Desktop, device pixel ratio ${dpr}`);
  out.push("");
  out.push(`Chrome ${first.environment.chrome}, ${first.environment.viewport.w} x ${first.environment.viewport.h} CSS px, WebGL renderer: \`${first.environment.renderer}\`.`);
  out.push("");

  out.push("**Frame time during zoom steps** (a step is the 300 ms after the layer applied a new set of markers; pass: pooled step p95 <= 18 ms and every step at most 5% dropped frames)");
  out.push("");
  out.push("| Dataset | Scenario | Frames | fps | Step frames p50 / p95 / p99 / max (ms) | Steps | Steps passing | Worst step p95 (ms) | Worst step dropped | Long tasks (>50 ms) | Verdict |");
  out.push("| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const r of list) {
    for (const [name, p] of [
      ["1: 20 zoom cycles z11-z17", r.scenario1.performance],
      ["2: zoom cycles + filter changes", r.scenario2.performance],
    ] as const) {
      const s = p.steps;
      out.push(
        `| ${r.size} (${r.dataset.offices.toLocaleString("en")} offices) | ${name} | ${p.frames} | ${p.fps} | ${s.pooledFrameMs.p50} / ${s.pooledFrameMs.p95} / ${s.pooledFrameMs.p99} / ${s.pooledFrameMs.max} | ${s.count} | ${s.passing} | ${s.worstP95Ms} | ${s.worstDroppedPercent}% | ${p.longTasks.count} | ${mark(frameVerdict(p))} |`,
      );
    }
  }
  out.push("");
  out.push("**Scenario 3: pan across the city at z14 for 10 s** (all frames of the pan; the layer applies few updates while panning, so steps are not used)");
  out.push("");
  out.push("| Dataset | Frames | fps | Frame p50 / p95 / p99 / max (ms) | Dropped frames | Long tasks | Verdict (p95 <= 18 ms, <= 5% dropped) |");
  out.push("| --- | ---: | ---: | --- | ---: | ---: | --- |");
  for (const r of list) {
    const p = r.scenario3.performance;
    out.push(
      `| ${r.size} | ${p.frames} | ${p.fps} | ${p.frameMs.p50} / ${p.frameMs.p95} / ${p.frameMs.p99} / ${p.frameMs.max} | ${p.droppedFrames} (${p.droppedPercent}%) | ${p.longTasks.count} | ${mark(p.frameMs.p95 <= FRAME_P95_DESKTOP && p.droppedPercent <= DROPPED_STEP_MAX)} |`,
    );
  }
  out.push("");
  out.push("**Interaction correctness** (pass: 0 duplicate keys in any frame, 0 stale items after settling, the keyboard list equals what is drawn)");
  out.push("");
  out.push("| Dataset | Frames checked (S1 + S2) | Frames with a duplicate key | Drawn after settling | In the keyboard list | Stale | Missing from list | Extra in list | Verdict |");
  out.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const r of list) {
    const f = r.scenario2Final;
    const dup = r.scenario1.correctness.duplicateKeyFrames + r.scenario2.correctness.duplicateKeyFrames;
    out.push(
      `| ${r.size} | ${r.scenario1.correctness.framesChecked + r.scenario2.correctness.framesChecked} | ${dup} | ${f.drawn} | ${f.listed} | ${f.staleItems} | ${f.missingFromList} | ${f.extraInList} | ${mark(dup === 0 && f.ok)} |`,
    );
  }
  out.push("");
  out.push("**Filter latency** (ms from calling the filter to the map settled on the new points, markers and list, after one cold pass; pass on S: <= 1000 ms warm)");
  out.push("");
  out.push("| Dataset | Cold, per filter | Warm median | Warm p95 | Warm max | Verdict |");
  out.push("| --- | --- | ---: | ---: | ---: | --- |");
  for (const r of list) {
    const l = r.filterLatency;
    const verdict = r.size === "S" ? mark(l.warmMax <= FILTER_LATENCY_S) : "informational (the threshold is for S)";
    out.push(`| ${r.size} | ${l.cold.map((c) => `${c.filter} ${c.ms}`).join(", ")} | ${l.warmMedian} | ${l.warmP95} | ${l.warmMax} | ${verdict} |`);
  }
  out.push("");
  out.push("**Hit accuracy** (a tap at each marker's reported position; \"overlap\" = another marker is drawn over that point, so the tap rule rightly picks it; pass: no unexplained miss, every real click correct)");
  out.push("");
  out.push("| Dataset | Settled z17 | Settled z12 | During a zoom, every frame | Real clicks: logos | Real clicks: clusters | Verdict |");
  out.push("| --- | --- | --- | --- | --- | --- | --- |");
  const hits = (h: Hits) => `${h.exact} exact + ${h.overlap} overlap of ${h.total}; ${h.unexplainedMisses} unexplained`;
  for (const r of list) {
    const real = r.hitAccuracy.realClicks;
    const realOk = "error" in real ? false : real.logoCorrect === real.logoClicks && real.clusterCorrect === real.clusterClicks;
    const noMiss = r.hitAccuracy.settledZ17.unexplainedMisses + r.hitAccuracy.settledZ12.unexplainedMisses + r.hitAccuracy.duringZoom.unexplainedMisses === 0;
    out.push(
      `| ${r.size} | ${hits(r.hitAccuracy.settledZ17)} | ${hits(r.hitAccuracy.settledZ12)} | ${hits(r.hitAccuracy.duringZoom)} | ${"error" in real ? real.error : `${real.logoCorrect} of ${real.logoClicks}`} | ${"error" in real ? "" : `${real.clusterCorrect} of ${real.clusterClicks}`} | ${mark(noMiss && realOk)} |`,
    );
  }
  out.push("");
  const errors = list.flatMap((r) => r.pageErrors);
  out.push(`Page errors during these runs: ${errors.length === 0 ? "none" : errors.join("; ")}.`);
  out.push("");
}
console.log(out.join("\n"));
