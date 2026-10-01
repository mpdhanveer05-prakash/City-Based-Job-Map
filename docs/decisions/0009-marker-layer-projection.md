# ADR-0009: The marker layer projects on the CPU, and the explorer camera is north-up

- **Status:** Accepted for the implementation. **Proposed: turning rotation and tilt off in the explorer (needs the owner's agreement).**
- **Date:** 2026-10-01
- **Related tasks / decisions:** P2-03, ADR-0005 (map rendering), map-spec §1, §6, §9

## Context

The custom WebGL layer draws every cluster, logo, and stack. MapLibre hands a custom layer a model-view-projection matrix in float32. At zoom 17 one pixel is about 1.5e-8 of the world, below what a float32 Mercator coordinate can hold, so a layer that uploads world coordinates and multiplies in the shader jitters at street zoom. The layer also needs each item's current screen position for hit testing (P2-06) and for animation (P2-05), so the CPU has to know it anyway.

## Decision

1. **Project on the CPU, in float64.** `map/layer/geometry.ts` converts longitude and latitude to Mercator once per scene (`Float64Array`), and each frame computes `(mercator - centre) × 512 × 2^zoom + canvas/2` in CSS px. Only screen-space numbers reach the GPU, and the vertex shader maps them straight to clip space. The same pass culls to the viewport plus a 20% margin, so only visible items are uploaded.
2. **One draw call.** Every item is one instance of one quad. The fragment shader draws the disc, halo, rings, and glyphs from signed distance fields, so the layer needs no per-kind pipeline. Counts and initials come from a glyph sheet rasterised from Overpass 800 (`map/atlas/`).
3. **North-up and top-down only.** The projection assumes bearing 0 and pitch 0. `createBasemap({ lockNorthUp: true })` turns off drag-rotate, pitch, and two-finger rotation. If something rotates the map anyway, the layer draws nothing and sets `stats.unsupportedCamera`, instead of drawing markers in the wrong place.
4. **Re-add on context restore.** MapLibre removes custom layers when the WebGL context is lost and does not bring them back (it logs "cannot be restored… re-add it manually"). `attachCompanyLayer` re-adds the layer on `webglcontextrestored`; the layer keeps its items, so the scene returns without a further call.

## Consequences

- Verified in Chromium: positions match `map.project()` to within 0.02 px at zoom 12, 13.37, and 15.8; the context-loss path recovers.
- **The product loses map rotation and tilt.** The brief does not ask for either, and a company explorer gains little from them, but this is a user-visible change. It can be reversed later by adding a rotation term to `projectToScreen` and to hit testing. **Please confirm or reject.**
- Per-frame cost is O(items) on the CPU for projection and culling. Measured only as far as the fixtures go (worker: 15,000 offices in 23 ms); the gate (P2-09) measures the real frame cost on the reference devices.
- Anything that wants to draw in the same space (spider legs, hit areas) uses the same `View`, so there is one definition of "where is this item on screen".
