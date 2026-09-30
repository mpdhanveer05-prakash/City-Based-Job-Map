# ADR-0005: Custom WebGL layer with Supercluster in a worker

- **Status:** Accepted, subject to the validation gate (P2-09)
- **Date:** 2026-09-30

## Decision
MapLibre GL JS with a custom WebGL layer draws all clusters and logos. Supercluster in a Web Worker via Comlink is the only clustering engine. See [map-spec.md](../map-spec.md).

## Deviations from the architecture plan (proposed)
- Mid-transition retargeting starts from the current interpolated state, instead of snapping the old animation to its end state.
- Hit testing during animation uses the current positions (a linear scan), instead of a KDBush index built when the view settles.

## Fallback
The plan's fallback is DOM markers moved with `transform` at high zoom only. It is **not** adopted automatically. If the gate fails, a new ADR records the metrics and trade-offs, and the owner decides.
