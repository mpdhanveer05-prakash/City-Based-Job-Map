# Map Specification

Map quality is a **release requirement**. Items are tagged **[Confirmed]** when they come from the project owner's brief, **[Plan]** when they come from the architecture plan, and **[Proposal]** when they're suggested here and still need agreement.

## 1. Stack [Confirmed]
- MapLibre GL JS renders the basemap and hosts a **custom WebGL layer** (`CustomLayerInterface`, WebGL2 with a WebGL1 check) that draws every cluster bubble and logo.
- **Supercluster is the only clustering engine.** MapLibre source clustering stays off for company points.
- Supercluster runs in a **Web Worker** that talks to the main thread through **Comlink**.
- No DOM markers for clusters or logos. The popup/selection card is the only map-anchored DOM element.

## 2. Identity and lineage
- **Office points** have a stable key `o:<office_id>`, and each carries its `company_id`. A company with several offices has several points. Counts shown to users are **unique companies** ("38 companies · 41 offices"). [Plan]
- **Cluster keys** must stay stable for a given dataset and zoom. Supercluster's numeric `cluster_id` is deterministic for the same input, so key = `c:<data_version>:<filter_hash>:<cluster_id>`. [Proposal]
- For each response, the worker returns `parentKey(z-1)` and `childKeys(z+1)` for the visible items, using `getParentId`-style arithmetic or `getChildren`. This lineage drives the split and merge animations. [Plan]
- Rebuilding the index after a filter change creates a new `filter_hash` namespace. Matching an old cluster to a new one is **not** attempted: old items fade out and new items fade in from their positions (a cross-fade). [Proposal]

## 3. Worker protocol and staleness
- Each request carries a `generation` (a monotonic integer bumped on every zoom-integer change, filter change, or data load). The client **drops any response whose generation is older than the latest one issued**. [Plan + Proposal]
- Filter changes during a zoom: bump the generation, call `load()` with the new points, then request clusters for the current view. Any in-flight animation retargets toward the new result (see §4).
- The worker is transferable-friendly. Points are sent as a `Float64Array` plus an ID table. Responses are compact arrays, not GeoJSON objects. [Proposal]

## 4. Animation
- The animator interpolates **position, scale, and opacity together** for each item every frame and calls `map.triggerRepaint()` until it settles. [Plan]
- Split (zoom in): a child starts at its parent's position, scale, and opacity 0, and eases to its own position at full size over **280 ms, ease-out cubic**. The parent shrinks and fades out. [Plan, timings are proposals]
- Merge (zoom out): the exact reverse, over **220 ms, ease-in**. [Plan]
- **Reversible and retargetable:** when a new generation arrives mid-transition, each item's *current interpolated state* becomes its new start state. Nothing snaps back to an old start state. Items that are no longer present fade out from wherever they are. **This replaces the plan's "snap older animations to end state."** Snapping creates a visible jump, so it is used only when more than N items are in flight (N is a proposal, see below). [Proposal, a deviation from the plan that needs agreement]
- The same key is never drawn twice. The render list is a `Map<key, item>`.
- Degradation above **250 moving items**: cross-fade instead of moving. [Plan, a Proposal threshold]. This is a disclosed degradation, not a silent replacement of the animation.
- `prefers-reduced-motion: reduce`: items swap instantly (no movement) with at most a 100 ms opacity change, and the counts are identical. The city-entry camera move becomes a jump. [Plan]

## 5. Logo atlas
- Logos are fetched once, decoded with `createImageBitmap`, and packed into **2048×2048 atlas pages** at 64 px (DPR < 1.5) or 128 px (DPR ≥ 1.5). A page holds 256 logos at 128 px, or 1,024 at 64 px. [Plan]
- **Multiple pages** are used when one is full. The draw call is batched per page. [Proposal]
- GPU budget [Proposal]: at most 4 pages on mobile (about 64 MB RGBA) and 8 on desktop. Beyond the budget, least-recently-used logos are evicted and redrawn with letter fallbacks until they're reloaded.
- **Letter fallback:** the company's initial on a colour derived from a hash of its name, drawn on an OffscreenCanvas into the same atlas. Used when a logo is missing, fails, or is still loading. [Plan]
- Slow networks: render the fallback immediately and swap in the logo when it arrives (an opacity blend). Never block a frame on an image.
- Cluster counts are drawn from a digit atlas in the same pass. [Plan]

## 6. Hit testing and touch
- Hit test against **current animated screen positions**. The plan's "KDBush rebuilt when the view settles" would be wrong during animation. Instead [Proposal]: while animating, scan the visible items linearly (at most a few hundred); when settled, use the KDBush index.
- Hit radius: **at least 44 px** for touch and 24 px for a mouse pointer (at least the drawn radius). [Plan / WCAG]
- **Deterministic overlap resolution** [Proposal], in order: (1) the selected item; (2) the item drawn on top (a higher z-order: clusters above logos, selected above all); (3) the smallest distance to the centre; (4) the lowest key, compared lexically.
- Tapping a cluster flies to its expansion zoom. Pinch and double-tap trigger the same split and merge. [Plan]

## 7. Identical coordinates and co-location [Plan]
- Offices within 5 m of each other, or in the same tech-park building, form a co-location group. They render as a stacked marker with a count badge at any zoom where they would still overlap, including above maxZoom 17.
- Click to spider: up to 8 on a circle, 9–20 on a spiral, each with a leg line to the true point. More than 20 opens the side list (a bottom sheet on mobile). Esc, a click on the map, or zooming out collapses it.

## 8. Popup, selection, and accessibility
- Clicking or tapping a logo opens a popup showing logo, name, type(s), neighbourhood, location accuracy, open-job count, and **View company** [Confirmed]. Placement rules follow the plan (desktop tries four positions; mobile uses a bottom sheet).
- Selection lives in `?company=<slug>`. The selected marker is drawn at 1.25× with a 3 px ring. If a cluster swallows the selected marker, the cluster inherits the ring. [Plan]
- **Keyboard:** a visually hidden, focusable list mirrors the drawn markers. Arrow keys move focus, and the layer draws a visible focus ring. Enter opens the popup. [Plan]
- **Accessible List view** is always available and synchronized with the map (the same result set and the same selection). It is the primary non-visual route. [Confirmed]

## 9. Failure modes and cleanup
- **WebGL unavailable or context lost:** show a notice and switch to List view. On `webglcontextrestored`, rebuild the atlases and buffers. [Proposal]
- Tile failure: a retry banner with a link to List view. Data failure: retry in place. [Plan]
- **Cleanup** on unmount or city change: `worker.terminate()`, release the Comlink proxy, delete the GL textures, buffers, and programs, remove every map and DOM listener, and cancel the rAF loop. [Confirmed]

## 10. Validation gate (reproducible)

All thresholds are **proposals** until the gate owner (D-06) confirms them.

**Devices** (the names are proposals, confirm in D-06):
- Desktop: a mid-range laptop with integrated graphics (for example Intel Iris Xe), Chrome stable, 1920×1080 at DPR 1, and a second run at DPR 2.
- Mobile: a mid-range Android (for example Samsung Galaxy A34/A35 class or Redmi Note 12), Chrome stable, real device over USB remote debugging.
- Also run on a low-end Android (for example a Galaxy A14 class device) for information only; it doesn't block the gate.

**Datasets:** S = 1,500 offices (the Bengaluru launch estimate), M = 5,000, and L = 15,000 (headroom), from P2-01 with a fixed seed. They include dense hotspots, 50 identical-coordinate groups, and a 30-company building.

**Network:** fast 4G throttling (Chrome DevTools "Fast 4G" or an agreed custom profile) and a cold cache for the first load.

**Scenarios**
1. **20 rapid zoom cycles** (z11 ↔ z17) over the densest hotspot, scripted with a fixed timing (proposal: each cycle 1.5 s, including interrupts mid-transition).
2. **Filtering during zoom:** toggle Startup, then Startup+Seed, then MNC while the zoom scenario runs.
3. Pan across the city at z14 for 10 s.
4. Tap every stacked and spidered group in the co-location fixture.
5. Mount and unmount the explorer 20 times.

**Metrics and proposed thresholds**
| Metric | How measured | Proposed pass |
| --- | --- | --- |
| Frame time during zoom steps | rAF timestamps or a Chrome trace | p95 ≤ 18 ms desktop, ≤ 33 ms mobile; at most 5% dropped frames per step (plan) |
| Interaction correctness | Debug hook dumps the drawn keys each frame | 0 duplicate keys, 0 stale-generation items after settling, and counts equal to the list |
| Filter latency | Filter input → map and list settled | ≤ 1 s warm on S (plan, NFR01) |
| Hit accuracy | Scripted taps at the item positions reported by the debug hook | 100% on the target, including mid-animation |
| Memory | `performance.memory` / CDP heap, and the GPU texture count | Heap back within 10% of baseline after the 20 mount cycles; texture pages ≤ budget |
| Listener leak | CDP `getEventListeners` count | No growth across mount cycles |

**Output:** `docs/map-gate-report.md`, with raw numbers, device and browser versions, dataset hashes, and pass or fail for each metric.

**If the gate fails:** don't switch to ordinary markers silently. Record which metric failed, the options (optimise; reduce the dataset or LOD; cross-fade at a lower threshold; DOM markers with `transform` at high zoom only), each option's effect on UX, accessibility, and schedule, and ask for a decision in an ADR.
