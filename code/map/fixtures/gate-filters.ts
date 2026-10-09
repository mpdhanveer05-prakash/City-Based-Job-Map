// The filters the validation gate scripts (docs/map-spec.md §10, scenario 2). Each is a type group, as in
// ADR-0004: Startup, Startup at Seed, MNC, or everything. Shared by the dev page and the gate spec.
export const GATE_FILTERS = ["none", "startups", "startup-seed", "mnc"] as const;
export type GateFilter = (typeof GATE_FILTERS)[number];

/** The zoom cycles a gate run makes (map-spec §10). The in-page runner may be asked for fewer, only to test the runner. */
export const GATE_CYCLES = 20;

/** `?cycles=` on the in-page runner: a whole number from 1 to GATE_CYCLES; anything else is the gate's own 20. */
export function runnerCycles(param: string | null): number {
  const n = Number(param);
  return param !== null && Number.isInteger(n) && n >= 1 && n <= GATE_CYCLES ? n : GATE_CYCLES;
}
