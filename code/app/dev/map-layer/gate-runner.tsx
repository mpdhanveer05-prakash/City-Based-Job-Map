"use client";
// The in-page gate runner (P2-09b), for phones Playwright cannot drive (iOS Safari). Open
// /dev/map-layer?size=S&runner=1 on the phone, tap "Live clusters", then "Run the gate". It runs the same recorder as
// `npm run gate` (tests/gate/gate-recorder.ts, installed in this page) through scenarios 1 and 2, warm filter latency,
// and hit accuracy, and shows the raw numbers to copy or download. It judges nothing: the report does
// (docs/real-device-test-procedure.md). Memory is not measured here: Safari's Web Inspector does that by hand.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { GATE_FILTERS, type GateFilter } from "@/map/fixtures/gate-filters";
import { CITY_SHAPES } from "@/map/fixtures/hotspots";
import { installGate, percentile, summariseFrames, type RawRecording } from "@/tests/gate/gate-recorder";

const MANYATA = CITY_SHAPES.bengaluru.hotspots.find((h) => h.name === "Manyata")!;
const CENTRE = { lng: MANYATA.lng, lat: MANYATA.lat };
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Moves the map and waits until the layer has applied the new markers and the animation has finished. */
async function goTo(zoom: number) {
  const { map, layer } = window.__mapLayer!;
  const before = layer.animation.updates;
  map.jumpTo({ center: [CENTRE.lng, CENTRE.lat], zoom });
  const deadline = performance.now() + 30_000;
  while (layer.animation.updates === before && performance.now() < deadline) await sleep(50);
  await sleep(1_000);
}

function environment() {
  const gl = document.createElement("canvas").getContext("webgl2");
  const debug = gl?.getExtension("WEBGL_debug_renderer_info");
  return {
    renderer: gl && debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : gl ? "unknown (no debug info)" : "no WebGL2",
    dpr: window.devicePixelRatio,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
  };
}

const correctness = (raw: RawRecording) => ({ framesChecked: raw.framesChecked, duplicateKeyFrames: raw.duplicateKeyFrames, longTasks: raw.longTasks.length });

export function GateRunner({ size }: { size: string }) {
  const [step, setStep] = useState("");
  const [result, setResult] = useState<string>("");

  const run = async () => {
    setResult("");
    try {
      if (!window.__liveControl || (window.__liveKeys ?? []).length === 0) throw new Error('Tap "Live clusters" first, and wait for the markers.');
      installGate();
      const gate = window.__gate!;
      const out: Record<string, unknown> = { runner: "in-page", size, environment: environment(), startedAt: new Date().toISOString() };
      const zoom = (filters: Record<number, GateFilter>, checkKeys: boolean) =>
        gate.zoomCycles({ centre: CENTRE, low: 11, high: 17, cycles: 20, cycleMs: 1500, filters, checkKeys });

      setStep("Scenario 1: 20 zoom cycles (twice)…");
      await goTo(11);
      const s1 = await zoom({}, false);
      const s1Check = await zoom({}, true);
      out.scenario1 = { performance: summariseFrames(s1), correctness: correctness(s1Check) };

      setStep("Scenario 2: zoom cycles while the filter changes (twice)…");
      const plan: Record<number, GateFilter> = { 4: "startups", 8: "startup-seed", 12: "mnc", 16: "none" };
      window.__liveControl.setFilter("none");
      const s2 = await zoom(plan, false);
      window.__liveControl.setFilter("none");
      const s2Check = await zoom(plan, true);
      out.scenario2 = { performance: summariseFrames(s2), correctness: correctness(s2Check), filterPlan: plan };

      setStep("Filter latency (4 passes)…");
      window.__liveControl.setFilter("none");
      await goTo(12);
      const samples: Array<{ filter: GateFilter; pass: number; ms: number }> = [];
      for (let pass = 0; pass < 4; pass++) for (const filter of GATE_FILTERS) samples.push({ filter, pass, ms: Math.round(await gate.filterLatency(filter)) });
      window.__liveControl.setFilter("none");
      const warm = samples.filter((s) => s.pass > 0).map((s) => s.ms);
      out.filterLatency = { warmMedian: percentile(warm, 50), warmP95: percentile(warm, 95), warmMax: Math.max(...warm), samples };

      setStep("Hit accuracy…");
      await goTo(17);
      const z17 = gate.hitAccuracy();
      await goTo(12);
      const z12 = gate.hitAccuracy();
      await goTo(14);
      const moving = await gate.hitAccuracyWhileZooming(14, 16.4, 700);
      out.hitAccuracy = { settledZ17: z17, settledZ12: z12, duringZoom: moving };
      out.finishedAt = new Date().toISOString();
      setResult(JSON.stringify(out, null, 2));
      setStep("Done. Copy or download the result.");
    } catch (error) {
      setStep(`Stopped: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([result], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `in-page-${size}-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <section className="flex flex-col gap-2 border-t border-rule pt-2" aria-label="Gate runner" data-testid="gate-runner">
      <p className="text-sm">In-page gate runner, dataset {size}. Keep the screen on and do not touch the map while it runs.</p>
      <Button onClick={() => void run()} data-testid="run-gate">
        Run the gate
      </Button>
      {step && (
        <p role="status" className="text-sm" data-testid="gate-step">
          {step}
        </p>
      )}
      {result && (
        <>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(result)}>
              Copy
            </Button>
            <Button variant="outline" onClick={download}>
              Download
            </Button>
          </div>
          <pre className="max-h-48 overflow-auto text-xs" data-testid="gate-result">
            {result}
          </pre>
        </>
      )}
    </section>
  );
}
