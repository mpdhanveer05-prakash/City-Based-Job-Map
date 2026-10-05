# Map Specification

Map quality is a **release requirement**. Every colour on the map (the basemap, clusters, logo rings, stacks, selection, focus, and fallbacks) follows [design-system.md §2](design-system.md#2-map-colours). Items are tagged **[Confirmed]** when they come from the project owner's brief, **[Plan]** when they come from the architecture plan, and **[Proposal]** when they're suggested here and still need agreement.

## 1. Stack [Confirmed]
- MapLibre GL JS renders the basemap and hosts a **custom WebGL layer** (`CustomLayerInterface`, WebGL2 with a WebGL1 check) that draws every cluster bubble and logo.
- **Supercluster is the only clustering engine.** MapLibre source clustering stays off for company points.
- Supercluster runs in a **Web Worker** that talks to the main thread through **Comlink**.
- No DOM markers for clusters or logos. The popup/selection card is the only map-anchored DOM element.
- **As built (P2-03):** the layer projects on the CPU and assumes a north-up, top-down camera. See [ADR-0009](decisions/0009-marker-layer-projection.md). [Proposal: rotation and tilt are off in the explorer]

## 2. Identity and lineage
- **Office points** have a stable key `o:<office_id>`, and each carries its `company_id`. A company with several offices has several points. Counts shown to users are **unique companies** ("38 companies in 41 offices"). [Plan]
- **Cluster keys** must stay stable for a given dataset and zoom. Supercluster's numeric `cluster_id` is deterministic for the same input, so key = `c:<data_version>:<filter_hash>:<cluster_id>`. [Proposal]
- For each response, the worker returns `parentKey(z-1)` and `childKeys(z+1)` for the visible items, using `getParentId`-style arithmetic or `getChildren`. This lineage drives the split and merge animations. [Plan]
  - **As built (P2-02):** an item that is not merged or split at the next level is carried over unchanged, with the same key. Its parent (and its only child) is therefore **its own key**; the animator treats "same key" as no transition. Only a cluster formed at level z lists real children, via `getChildren`. A parent can lie outside the viewport, so parents are looked up in a bbox padded by the cluster radius. The formation level comes from Supercluster's cluster-ID encoding, an internal detail, so `tests/unit/cluster-worker.test.ts` checks it against a brute-force leaf comparison. `level` is the integer zoom clamped to 0…18 (maxZoom 17 + 1).
- Rebuilding the index after a filter change creates a new `filter_hash` namespace. Matching an old cluster to a new one is **not** attempted: old items fade out and new items fade in from their positions (a cross-fade). [Proposal]

## 3. Worker protocol and staleness
- Each request carries a `generation` (a monotonic integer bumped on every zoom-integer change, filter change, or data load). The client **drops any response whose generation is older than the latest one issued**. [Plan + Proposal]
- Filter changes during a zoom: bump the generation, run the shared TypeScript filter over the in-memory city dataset (ADR-0006), call `load()` with the resulting points, then request clusters for the current view. `data_version` is the build snapshot ID. Any in-flight animation retargets toward the new result (see §4).
- The worker is transferable-friendly. Points are sent as a `Float64Array` plus an ID table. Responses are compact arrays, not GeoJSON objects. [Proposal]

## 4. Animation
- The animator interpolates **position, scale, and opacity together** for each item every frame and calls `map.triggerRepaint()` until it settles. [Plan]
- Split (zoom in): a child starts at its parent's position, scale, and opacity 0, and eases to its own position at full size over **280 ms, ease-out cubic**. The parent shrinks and fades out. [Plan, timings are proposals]
- Merge (zoom out): the exact reverse, over **220 ms, ease-in**. [Plan]
- **Reversible and retargetable:** when a new generation arrives mid-transition, each item's *current interpolated state* becomes its new start state. Nothing snaps back to an old start state. Items that are no longer present fade out from wherever they are. **This replaces the plan's "snap older animations to end state."** Snapping creates a visible jump, so it is used only when more than N items are in flight (N is a proposal, see below). [Proposal, a deviation from the plan that needs agreement]
- The same key is never drawn twice. The render list is a `Map<key, item>`.
- Degradation above **250 moving items**: cross-fade instead of moving. [Plan, a Proposal threshold]. This is a disclosed degradation, not a silent replacement of the animation.
- `prefers-reduced-motion: reduce`: items swap instantly (no movement) with at most a 100 ms opacity change, and the counts are identical. The city-entry camera move becomes a jump. [Plan]
- **As built (P2-05):** `map/animation/`. Each key has one transition segment; an update starts every segment from the item's *current* interpolated state, so a reversal, a second zoom, or a filter change never snaps (a randomized unit test checks that no item's position, scale, or opacity jumps when an update lands at any moment). Which transition runs follows the worker lineage and the level change: one level in is a **split** (280 ms ease-out), one level out a **merge** (220 ms ease-in), the same level a **pan** (120 ms fade), a new `dataVersion:filterHash` or a jump of several levels a **cross-fade** (200 ms), and an item that is in both result sets (an office has the same key in every filter) stays put. Above 250 markers moving at once the update cross-fades and `animation.degraded` is set. Under reduced motion every update is a 100 ms fade with no movement. An update older than the latest applied generation is ignored. Fully faded items stay on the render list until the next update, drawn as nothing. The layer asks for another frame only while something is animating *and* its clock has moved, so a clock held by a test cannot spin the render loop.

## 5. Logo atlas
- Logos are fetched once, decoded with `createImageBitmap`, and packed into **2048×2048 atlas pages** at 64 px (DPR < 1.5) or 128 px (DPR ≥ 1.5). A page holds 256 logos at 128 px, or 1,024 at 64 px. [Plan]
- **Multiple pages** are used when one is full. The draw call is batched per page. [Proposal]
- GPU budget [Proposal]: at most 4 pages on mobile (about 64 MB RGBA) and 8 on desktop. Beyond the budget, least-recently-used logos are evicted and redrawn with letter fallbacks until they're reloaded.
- **Letter fallback:** the company's initial on a colour derived from a hash of its name, drawn on an OffscreenCanvas into the same atlas. Used when a logo is missing, fails, or is still loading. [Plan] The hash picks one of the five non-green swatches in design-system.md §2, with an Ink initial, so a fallback never looks like a Mantis cluster. [Proposal]
- Slow networks: render the fallback immediately and swap in the logo when it arrives (an opacity blend). Never block a frame on an image.
  - **As built (P2-04):** `map/atlas/`. A 2048 px page is one texture; cells are 64 or 128 px by DPR (1,024 or 256 per page). The page cap comes from a byte budget (default 64 MB with a coarse pointer, 128 MB otherwise; never more than 8 pages, one texture unit each), and one draw call still draws everything: the fragment shader picks the page with a `switch`. Logos are keyed by **company**, not office, are requested only for markers that are drawn (so only visible companies load), start at most 6 at a time (newest first), and are uploaded at most 4 a frame. A logo cross-fades over its letter in 150 ms (instant under `prefers-reduced-motion`). Eviction takes the least recently used cell that no marker used in the current frame, and an item that is loaded but not yet uploaded counts as used while its marker is visible. If every cell is in use on screen, the extra logos keep their letter and are retried after 1 s, 2 s, 4 s … up to 30 s. A failed load retries after 30 s, doubling to 5 min. Logos are raster images (PNG, JPEG, WebP, GIF, AVIF) up to 1 MB, fetched with no credentials and no referrer, from `https:` URLs (restricted to given hosts when `allowedHosts` is set), contain-fitted into the cell and stored premultiplied. After a lost context the atlas empties and visible markers ask again.
- Cluster counts are drawn from a digit atlas in the same pass. [Plan] The digits are Overpass 800 in Ink on the Mantis disc (5.77:1). [Proposal]
  - **As built (P2-03):** one glyph sheet holds digits, `k . +`, and A–Z (for fallback initials), rasterised from Overpass 800 as an alpha mask and tinted in the shader. Digits take the widest digit's advance (Overpass has no default tabular digits). A cluster label is the **unique-company count**, at most four glyphs: `7`, `999`, `1.2k`, `12k`, `99k+`. A stack badge reads `2`…`99`, then `99+`.

## 6. Hit testing and touch
- Hit test against **current animated screen positions**. The plan's "KDBush rebuilt when the view settles" would be wrong during animation. Instead [Proposal]: while animating, scan the visible items linearly (at most a few hundred); when settled, use the KDBush index.
- Hit radius: **at least 44 px** for touch and 24 px for a mouse pointer (at least the drawn radius). [Plan / WCAG]
- **Deterministic overlap resolution** [Proposal], in order: (1) the selected item; (2) the item drawn on top (a higher z-order: clusters above logos, selected above all); (3) the smallest distance to the centre; (4) the lowest key, compared lexically.
- Tapping a cluster flies to its expansion zoom. Pinch and double-tap trigger the same split and merge. [Plan]
- **As built (P2-06):** `map/hit-test/hit-test.ts` (pure), `interactions.ts` (the map's click events). Three refinements to the proposal above, all so that **a tap selects what is under the finger**:
  1. A marker whose *drawn* disc contains the point wins over one reached only through the extra radius (24 px mouse, 44 px touch). The rule order then applies inside that pool.
  2. "Z-order" means rank, not draw index: the selected marker, then clusters, then logos and stacks. Within a rank the nearest centre wins, then the lowest key (compared lexically). The answer therefore does not depend on the order the markers are listed in.
  3. When nothing is under the finger and the extra radius found several markers, the **nearest edge** wins, not the highest rank (a cluster 40 px away must not beat a logo 30 px away).
  A marker below 25% opacity (a fade in progress) is not a target. The method follows the proposal: a linear scan while anything is animating, and a KDBush index once settled, rebuilt at most once per drawn frame; a randomized test checks that both give the same answer on 3,000 taps. Positions and radii are the ones the layer drew in its last frame (`getDrawn()`), so they are the animated ones. Mouse versus touch comes from the `pointerdown` that precedes MapLibre's `click`.
- **Expansion zoom (P2-06):** the worker answers `getExpansionZoom(clusterKey)` from Supercluster (`null` for an office, a stack, a malformed key, or a key from an earlier load). A tap on a cluster eases to `min(zoom, 19)` centred on the cluster.

## 7. Identical coordinates and co-location [Plan]
- Offices within 5 m of each other, or in the same tech-park building, form a co-location group. They render as a stacked marker with a count badge at any zoom where they would still overlap, including above maxZoom 17.
- Click to spider: up to 8 on a circle, 9–20 on a spiral, each with a leg line to the true point. More than 20 opens the side list (a bottom sheet on mobile). Esc, a click on the map, or zooming out collapses it.
- **As built (P2-06):**
  - **Grouping** (`map/layer/colocation.ts`): single linkage within 5 m (a chain of close offices is one group), or the same `buildingId` when the data has one (it does not yet). Deterministic and independent of input order. The stack key is `s:<lowest member office key>`, its position is that member's, and its badge is the number of **unique companies**. A group whose offices all belong to one company is not a stack: it is drawn as that office's single logo.
  - **Where stacks appear:** Supercluster already clusters anything that overlaps up to zoom 17, so stacks are made from the worker's deepest level (18, where every office is its own item) by `colocateResponse`. Each stack's parent is the cluster that held its first member. A cluster's `childKeys` are rewritten through the stacks seen at the deepest level, so a zoom out merges a stack into its cluster instead of fading it in place (a unit test fails without the rewrite).
  - **Layout** (`map/layer/spider.ts`): neighbours are 48 px apart (the 40 px logo plus 8 px). Circle: first marker straight up, then clockwise, radius at least 56 px. Spiral: Archimedean, starts at 64 px and grows 52 px a turn; the closest pair for 9 to 20 members is 48.3 px apart and the farthest marker is under 140 px out. More than 20 gives the list, with no markers or legs. Offsets are turned into longitude and latitude at the zoom where the spider opens.
  - **Closing:** Esc, a tap on the map (not on a marker), any zoom change, or a second tap on the same stack. The list is closed the same way. A spider near the edge of the map is not nudged back into view (open for the explorer shell).
  - **Legs:** a thin MapLibre line layer (1.5 px, the `spiderLeg` token) just below the marker layer. Legs are not company markers, so markers are still all drawn in one pass.
  - `map/layer/marker-controller.ts` keeps the latest worker update, the selected key, and the open spider, and re-composes them whenever one changes. The selected marker is drawn at 1.25× with the selection ring. A cluster that swallows the selected marker does not inherit the ring yet (P4-03).
  - The members of a spider fade in over 120 ms in place (the animator treats the change as a pan), not out of the stack.

## 8. Popup, selection, and accessibility
- Clicking or tapping a logo opens a popup showing logo, name, type(s), neighbourhood, location accuracy, open-job count, and **View company** [Confirmed]. Placement rules follow the plan (desktop tries four positions; mobile uses a bottom sheet).
- Selection lives in `?company=<slug>`. The selected marker is drawn at 1.25× with a 3 px ring. If a cluster swallows the selected marker, the cluster inherits the ring. [Plan] The ring is Mantis Deep `#2F7A24`. Keyboard focus is a separate 2 px Ink ring offset by 3 px, so selection and focus can show together. [Proposal]
- **Keyboard:** a visually hidden, focusable list mirrors the drawn markers. Arrow keys move focus, and the layer draws a visible focus ring. Enter opens the popup. [Plan]
- **Accessible List view** is always available and synchronized with the map (the same result set and the same selection). It is the primary non-visual route. [Confirmed]
- **As built (P2-07):**
  - **Popup** (`components/explorer/map-popup.tsx`, placement in `map/popup-placement.ts`): a non-modal `role="dialog"` named by the company. Logo disc, name, types, neighbourhood, location accuracy, open jobs, **View company** (a link), and a 44 px close button. A value the data does not have reads "Not stated", "Accuracy not stated", or "Not yet checked"; the popup never guesses. Fixtures say "Synthetic data". It opens in 160 ms ease-out (instant under reduced motion, through the global rule in `globals.css`).
  - **Desktop placement:** right, left, above, below, in that order; the first that lies fully inside the visible area with a 12 px gap and still points at the marker. The visible area excludes the control panel and the map controls. If none fits, the map eases (300 ms; instant under reduced motion) until the marker sits where the right-hand popup fits. The popup follows the marker while the map moves and is hidden while the selected marker is not on the map.
  - **Phone (width under 640 px):** a bottom sheet, 30% of the screen high (60% expanded is built in `placeSheet` but not wired), and the map eases so the marker is centred in the part above it. The map's bottom padding is **not** set yet (P4-03); only the pan is.
  - **Keyboard** (`map/a11y-mirror.ts`, `components/explorer/map-a11y-list.tsx`): a visually hidden list of the markers on the map (visible, inside the map, at least 50% opaque), in reading order (rows 40 px tall, left to right, ties by key). It is one tab stop (roving tabindex). Arrow keys move to the nearest marker in that direction as drawn (straight ahead is preferred; sideways distance counts double; null at an edge, so focus stays), Home and End go to the first and last, Enter or Space does what a tap does. The layer draws the 2 px Ink focus ring on the focused marker, separate from the selection ring. Opening a marker with Enter moves focus into the popup; Escape closes it and returns focus to that marker's entry. Leaving the list clears the ring. If the focused marker leaves the map (a zoom), focus stays in the list on the first entry.
  - **Not built:** a screen-reader pass (NVDA, TalkBack) was not done; see progress.md. The list is rebuilt when a frame settles and only if the set of markers changed, so a screen reader is not interrupted on every frame.

- **As built (P4-03)** (`map/explorer-map.ts`, `components/explorer/explorer-map-view.tsx`):
  - **One class owns the map** for a city: the basemap (blank Milky when there is no key or the style cannot load), the marker layer, the worker client, taps, the popup's position, the keyboard mirror, and the city boundary (a dashed 1.5 px Moss line, `city-boundary`, added under the markers and again after a style reload). It never filters: the shell hands it `setOffices(...)`, the offices of the companies the one TypeScript filter kept, so the map cannot disagree with the list. An office's id in the worker is its position in the city's offices array, a company's its position in the companies array (keys are `o:<n>`).
  - **Selection is `?company=<slug>`.** A tap on a logo selects that office and writes the slug (a history push); a link, Back, Forward, or "Show on map" selects the company's first office in the current set, flies to it at zoom 17 (the deepest clustering level, so its logo is drawn alone), and opens its popup. A company that sits in a stack of co-located offices gets the stack's spider opened so its marker shows. A selection the filters exclude, or a slug that is not in this city, is dropped from the URL.
  - **The camera is in the URL** (`map=lat,lng,zoom`): written 250 ms after the map settles, replacing the entry (a pan never adds history); a URL camera that differs from the map's (Back, a shared link) is applied with `jumpTo`. Zoom limits 8 to 19.
  - **The map is created the first time the Map view is shown and kept** while Grid or List is on top (it is hidden, then resized when it returns), so a view switch costs no new WebGL context. Without WebGL2 (or if the map fails to start) the page lands on List with the notice from section 9 and the Map button is off.
  - **Popup placement** uses the part of the map below the toolbar; a phone (under 640 px) gets the bottom sheet. More than 20 companies at one address open a list panel with a View company link each.
  - **Not built:** a cluster that swallows the selected marker does not inherit the ring (the popup is hidden while the selected marker is inside a cluster); the sheet's 60% expanded state; hovering a list row does not highlight its marker (selection does: `aria-current` on the row and the popup on the map).

## 9. Failure modes and cleanup
- **WebGL unavailable or context lost:** show a notice and switch to List view. On `webglcontextrestored`, rebuild the atlases and buffers. [Proposal]
  - **As built (P2-03):** MapLibre removes custom layers on context loss and does not restore them, so `attachCompanyLayer` re-adds the layer on `webglcontextrestored`; the layer keeps its items and rebuilds its GL objects. The "show a notice and switch to List view" part is not built yet (the explorer shell does it).
- Tile failure: a retry banner with a link to List view. Data failure: retry in place. [Plan]
- **As built (P2-07)** (`map/fallback.ts`):
  - **No WebGL2:** `checkWebGl2()` asks a throwaway canvas for a `webgl2` context (never `webgl`: the layer needs WebGL2) and gives it back. When it fails, the page lands on the list with the notice "The map can't run on this device or browser, so the companies are shown as a list instead. You can still search, filter, and open any company." No map object is created. (A context lost *after* start is handled by the layer, §9 above.)
  - **Tiles failing:** `watchTileFailures()` counts tile load errors; three inside 10 s raise the banner, and one tile loaded afterwards clears it. The banner has **Try again** and **Show the list**; the company markers keep working (the page no longer waits for the map's `load` event, which needs every tile and never comes when they fail).
  - **Retry:** MapLibre does not retry a failed tile, and `setTiles()` cannot revive one (it marks the tile "loading" and waits for a request that was never sent; read in 6.11.2). `retry()` therefore clears the source's tiles through the tile manager, which is **not public API**, then calls `map.resize()` to run the source update. If a MapLibre upgrade moves the tile manager, it falls back to `setTiles`/`setUrl`; the keyed e2e test ("when the basemap tiles keep failing…") will show it.
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

**How to run it (built 4 Oct 2026):** `npm run gate` runs scenarios 1 to 3, filter latency, and hit accuracy on the datasets named in `GATE_SIZES` (default `S,M,L`) in the installed Google Chrome on the machine's own GPU (`tests/gate/`, `playwright.gate.config.ts`); `GATE_DPR=2` repeats it at a device pixel ratio of 2; `GATE_HEADED=1` shows the window; the default build uses the blank background so no Geoapify credits are spent (`GATE_BASEMAP=on` uses the key from `.env.local`). Scenarios 4 and 5 are `tests/e2e/hit-test.spec.ts` and `tests/e2e/map-lifecycle.spec.ts`, which the same config also runs. Raw numbers go to `gate-results/` (git-ignored); `node scripts/gate-report.mts` turns them into the report's tables. The run needs about 4 GB of free memory (a Next.js build, Chrome, and Wrangler).

**Output:** `docs/map-gate-report.md`, with raw numbers, device and browser versions, dataset hashes, and pass or fail for each metric.

**If the gate fails:** don't switch to ordinary markers silently. Record which metric failed, the options (optimise; reduce the dataset or LOD; cross-fade at a lower threshold; DOM markers with `transform` at high zoom only), each option's effect on UX, accessibility, and schedule, and ask for a decision in an ADR.
