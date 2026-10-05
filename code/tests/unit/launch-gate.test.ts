import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, evaluateLaunchGate, inBoundary, inRing, renderGate, type GateThresholds } from "@/lib/launch-gate";
import type { CompaniesFile, DetailsFile, OfficesFile } from "@/lib/filters/dataset";

const SQUARE: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];

describe("inRing and inBoundary", () => {
  it("knows inside, outside, and the edge", () => {
    expect(inRing(5, 5, SQUARE)).toBe(true);
    expect(inRing(11, 5, SQUARE)).toBe(false);
    expect(inRing(-0.1, 5, SQUARE)).toBe(false);
    expect(inRing(0, 5, SQUARE)).toBe(true); // on the edge
    expect(inRing(10, 10, SQUARE)).toBe(true); // on a corner
  });
  it("respects holes and several polygons", () => {
    const boundary = { coordinates: [[SQUARE, [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]], [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]]] };
    expect(inBoundary(1, 1, boundary)).toBe(true);
    expect(inBoundary(5, 5, boundary)).toBe(false); // in the hole
    expect(inBoundary(25, 25, boundary)).toBe(true); // the second polygon
    expect(inBoundary(15, 15, boundary)).toBe(false);
  });
});

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const NOW = new Date("2026-10-05T12:00:00Z");
const strict: GateThresholds = { minCompanies: 2, minPreciseShare: 0.9, minFreshJobShare: 0.9, freshDays: 7, maxOutsideBoundary: 0 };

function files(over: { synthetic?: boolean; accuracies?: string[]; points?: Array<[number, number]>; jobChecked?: Array<string | null>; companies?: number } = {}) {
  const n = over.companies ?? 2;
  const companies = Array.from({ length: n }, (_, i) => ({ id: id(i + 1), slug: `c${i + 1}`, name: `C${i + 1}`, logo_key: null, startup_stage: null, types: [], sectors: [], open_jobs: 0 }));
  const accuracies = over.accuracies ?? Array(n).fill("building");
  const offices = accuracies.map((accuracy, i) => ({
    id: id(100 + i), company_id: id((i % n) + 1), lng: over.points?.[i]?.[0] ?? 5, lat: over.points?.[i]?.[1] ?? 5, accuracy, address: "x", neighbourhood: null, tech_park: null,
  }));
  const jobChecked = over.jobChecked ?? ["2026-10-04T00:00:00Z"];
  return {
    synthetic: over.synthetic ?? false,
    companies: { version: 1, synthetic: false, city: { slug: "bangalore", boundary: { type: "MultiPolygon", coordinates: [[SQUARE]] } }, neighbourhoods: [], tech_parks: [], sectors: [], companies } as unknown as CompaniesFile,
    offices: { version: 1, offices } as unknown as OfficesFile,
    details: { version: 1, companies: {}, jobs: jobChecked.map((t, i) => ({ id: id(200 + i), company_id: id(1), title: "J", apply_url: "https://x.example/j", status: "active", last_checked_at: t })) } as DetailsFile,
  };
}

const failed = (r: ReturnType<typeof evaluateLaunchGate>) => r.checks.filter((c) => !c.pass).map((c) => c.name);

describe("evaluateLaunchGate", () => {
  it("passes good real data", () => {
    const r = evaluateLaunchGate(files(), strict, NOW);
    expect(r.pass).toBe(true);
    expect(failed(r)).toEqual([]);
  });

  it("never passes the synthetic sample", () => {
    expect(failed(evaluateLaunchGate(files({ synthetic: true }), strict, NOW))).toEqual(["The data is real, not the synthetic sample"]);
  });

  it("fails with too few companies, and says how many", () => {
    const r = evaluateLaunchGate(files({ companies: 1, accuracies: ["building"] }), strict, NOW);
    expect(failed(r)).toEqual(["Enough companies"]);
    expect(r.checks.find((c) => c.name === "Enough companies")!.detail).toBe("1 published, 2 needed.");
  });

  it("measures how many offices are precise: building, campus, or rooftop", () => {
    const ten = [...Array(9).fill("campus"), "street"];
    expect(evaluateLaunchGate(files({ accuracies: ten }), strict, NOW).pass).toBe(true); // 90% is enough
    const eight = [...Array(8).fill("rooftop"), "street", "locality"];
    expect(failed(evaluateLaunchGate(files({ accuracies: eight }), strict, NOW))).toEqual(["Locations are precise"]);
  });

  it("counts offices outside the boundary against the allowance", () => {
    const r = evaluateLaunchGate(files({ accuracies: ["building", "building"], points: [[5, 5], [50, 50]] }), strict, NOW);
    expect(failed(r)).toEqual(["Offices are inside the city"]);
    expect(evaluateLaunchGate(files({ points: [[5, 5], [50, 50]] }), { ...strict, maxOutsideBoundary: 1 }, NOW).pass).toBe(true);
  });

  it("fails a company with no office, and old or missing job checks", () => {
    expect(failed(evaluateLaunchGate(files({ companies: 3, accuracies: ["building", "building"] }), strict, NOW))).toEqual(["Every company has an office"]);
    expect(failed(evaluateLaunchGate(files({ jobChecked: [null, "2026-08-01T00:00:00Z"] }), strict, NOW))).toEqual(["Job links are fresh"]);
    expect(evaluateLaunchGate(files({ jobChecked: [] }), strict, NOW).pass).toBe(true); // no jobs is not stale jobs
  });

  it("has thresholds for both launch cities, and prints a readable report", () => {
    expect(Object.keys(DEFAULT_THRESHOLDS).sort()).toEqual(["bangalore", "chennai"]);
    const report = renderGate([evaluateLaunchGate(files({ synthetic: true }), strict, NOW)]);
    expect(report).toContain("## bangalore: FAIL");
    expect(report).toContain("- FAIL: The data is real, not the synthetic sample.");
  });
});
