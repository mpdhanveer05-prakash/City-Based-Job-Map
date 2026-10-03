// The filters the validation gate scripts (docs/map-spec.md §10, scenario 2). Each is a type group, as in
// ADR-0004: Startup, Startup at Seed, MNC, or everything. Shared by the dev page and the gate spec.
export const GATE_FILTERS = ["none", "startups", "startup-seed", "mnc"] as const;
export type GateFilter = (typeof GATE_FILTERS)[number];
