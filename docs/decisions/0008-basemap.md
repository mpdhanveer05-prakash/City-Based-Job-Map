# ADR-0008: Basemap: Geoapify Positron, re-coloured in MapLibre

- **Status:** Accepted for the style, the customisation method, and how MapLibre is loaded. **Open: the free allowance against launch traffic (D-11).**
- **Date:** 2026-10-01
- **Related tasks / decisions:** P1-05, ADR-0005 (map rendering), ADR-0006 (free tiers only), design-system.md §2, D-11

## Context

The map needs a basemap that carries no green (so Mantis only ever means companies), uses Milky as land, and shows Geoapify and OpenStreetMap attribution. The owner supplied a Geoapify key. ADR-0006 rules out paid plans, and the architecture plan names Protomaps PMTiles on R2 as the later, free-to-run alternative.

## What was built and measured (P1-05, 1 Oct 2026)

- **Style: Geoapify `positron`.** It's the quietest of the vector styles (47 layers, no POI icons), so nothing competes with company markers. `osm-bright` has 111 layers, with POI symbols and many land-use fills.
- **Customisation:** `map/basemap.ts` fetches `style.json` and rewrites its colours (`applyBasemapTheme`) before the map is created, so there is no flash of the original colours. Every colour comes from the CSS tokens through `map/theme.ts`; no hex lives in the map code. Result: Milky land, stone parks (`--map-park`), blue water, Milky Shade buildings, white roads with Rule casing, Moss labels with a 1.5 px Milky halo. The pink state/country borders and Positron's greys are replaced, and unknown fills fall back to land, so no stray hue survives.
- **Attribution:** the TileJSON supplies "Powered by Geoapify | © OpenMapTiles © OpenStreetMap contributors". `AttributionControl({ compact: false })` keeps it visible without a click. All three credits are required (Geoapify on the Free plan; OSM and OpenMapTiles on every plan).
- **Verified in Chromium (desktop and Pixel 7 projects):** attribution links visible; the canvas fills the viewport; the most common pixel is exactly Milky and no pixel is green-dominant; every `*-color` paint in the live style equals a token; switching Bengaluru ↔ Chennai produces no HTTP error.
- **MapLibre is not bundled.** MapLibre 6.11.2 locates its web worker by file name (`maplibre-gl-worker.mjs`), and the worker imports `./maplibre-gl-shared.mjs`. Turbopack renames both with content hashes, and the map stopped with "Worker failed to load". `scripts/copy-maplibre.mts` (run before `dev` and `build`) copies three files to `public/maplibre/<version>/`, and `loadMapLibre()` imports them at run time with `turbopackIgnore`. The version in the path makes them immutable (`_headers`). This also keeps the 1.2 MB `-dev` variants that Turbopack otherwise emitted out of `out/`. The CSS still goes through the bundler.

### Tile use per session (browser-measured, cold cache, headless Chromium)

Session: load Bengaluru at zoom 11, zoom to 13, pan twice, zoom to 15, switch to Chennai, zoom to 13.

| Viewport | Tile responses | MapLibre-counted tile requests | Tile bytes | Glyph requests |
| --- | --- | --- | --- | --- |
| 412 × 915 @2.6× (Pixel 7) | 25 | 31 | 0.8 MB | 5 |
| 1280 × 800 | 48 | 60 | 1.4 MB | 6 |
| 1920 × 1080 | 75 | 87 | 0.9 MB | 7 |

Every session also makes 1 style, 1 TileJSON, and 2 sprite requests. Tiles are served with `cache-control: public, max-age=86400`, so a repeat visit within a day mostly hits the browser cache; this wasn't measured.

**Credits.** Geoapify bills a map tile request at 0.25 credits, and the Free plan gives 3,000 credits a day (about 12,000 tile requests). At roughly 50 tile requests per session (25 to 75 above), that's 12.5 credits a session, or **about 240 sessions a day (160 to 480)**. Geoapify's pages don't say whether style, TileJSON, sprite, or glyph requests are billed. If each cost a full credit, a session would cost about 22 credits and the allowance would drop to about 140 sessions a day. **That uncertainty is unresolved.**

## Decision

1. Use the Geoapify `positron` vector style, re-coloured at load time from the design tokens, as the launch basemap for staging and development.
2. Load MapLibre unbundled from `public/maplibre/<version>/`.
3. **Don't treat the Free allowance as a launch plan.** About 100 to 500 map-using sessions a day is probably below real launch traffic, and the plan has no traffic estimate. The owner decides before P9 (D-11): (a) stay on Geoapify Free and watch credit use, (b) move to Protomaps PMTiles on R2 (the planned free path; it needs its own glyphs and sprites, which would also allow Overpass labels), or (c) a paid Geoapify plan, which ADR-0006 excludes unless the owner lifts it.

## Consequences

- **The key is public and currently unrestricted.** A request with a foreign `Referer`, and one with none, both returned HTTP 200. Geoapify supports allowed referrers, IPs, origins and CORS per key in MyProjects → API Keys. The owner must allow at least `localhost:3000`, `localhost:3100`, `localhost:8788`, the staging host, and later the production host. Referrer rules deter casual reuse but are not strong security: any non-browser client can set the header. The key is baked into `out/` for any build that includes the map. The `postbuild` secret scan doesn't flag it, which is correct for a public key.
- **Labels aren't Overpass.** The style's glyphs are Metropolis and Noto Sans, served by Geoapify. Using Overpass needs self-hosted glyph files, which the PMTiles route would bring. The designer should decide whether that matters (design-system.md says "one family").
- **Buildings read busy at zoom 13 and above.** Milky Shade buildings on Milky land are faint but dense. The designer should review them in the running UI; a layer `minzoom` or lighter fill is a one-line change in `applyBasemapTheme`.
- **Thin roads use the Rule colour, not white.** Positron has no casing for minor roads and paths, and white on Milky would vanish.
- The CSP (P9-02) must allow `https://maps.geoapify.com` for `connect-src` and `img-src`, plus `worker-src 'self'`; MapLibre's files are same-origin, so `blob:` isn't needed for them.
- The city boundary line (1.5 px Moss, dashed) belongs to P4-02, not to the basemap style.
- The dev route `/dev/basemap` shows the result; `tests/e2e/basemap.spec.ts` checks it and skips itself when the build has no key.

## Sources (with date checked)

- Geoapify map tiles docs: https://apidocs.geoapify.com/docs/maps/map-tiles/ (1 Oct 2026). 0.25 credits per tile; styles list; vector styles can be customised in MapLibre GL with `setPaintProperty` or the Map Tiles Playground; three attributions required.
- Geoapify pricing: https://www.geoapify.com/pricing/ and https://www.geoapify.com/pricing-details/ (1 Oct 2026). 3,000 credits a day on the Free plan; commercial use allowed on Free; "Powered by Geoapify" link required; 4 map tiles = 1 credit.
- Geoapify terms: https://www.geoapify.com/terms-and-conditions/ (1 Oct 2026). OSM attribution always required, Geoapify attribution mandatory on Free, and production use of Free is allowed "with some limitations". **The terms don't mention style modification either way; only the API docs above permit it.** A short written confirmation from Geoapify would close that gap.
- Geoapify API-key restrictions (allowed IPs, referrers, origins, CORS): described in the API docs and set in https://myprojects.geoapify.com (1 Oct 2026; the exact setting wasn't opened, because that needs the owner's login).
- Measurements: this repository, `map/basemap.ts` and `tests/e2e/basemap.spec.ts`, run 1 Oct 2026 on Windows 11 with Chromium from Playwright 1.63.0.
