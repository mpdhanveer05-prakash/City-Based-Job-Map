// Geoapify basemap: loads the vector style and re-colours it to the design-system palette
// (docs/design-system.md §2, ADR-0008). Pure functions plus one MapLibre factory; no React.
import type { LayerSpecification, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import type { BasemapTheme } from "./theme";

/** Positron is the quietest Geoapify vector style: no POI icons competing with company markers. */
export const BASEMAP_STYLE_ID = "positron";

export function basemapStyleUrl(apiKey: string, styleId: string = BASEMAP_STYLE_ID): string {
  return `https://maps.geoapify.com/v1/styles/${styleId}/style.json?apiKey=${encodeURIComponent(apiKey)}`;
}

type Paint = Record<string, unknown>;

const PARK = /park|wood|grass|forest|cemetery|golf|pitch|garden|reserve/;
const WATER = /water/;
const BUILDING = /^building/;
const BOUNDARY = /boundary/;
const CASING = /casing/;
// Roads that Positron draws with no casing layer. White on Milky would vanish, so they take the casing colour.
const THIN_ROAD = /minor|path|service|taxiway|track/;
const RAIL_DASH = /dash|hatching/;

/** Returns a copy of the style with every colour taken from the theme. Nothing off-palette survives
 *  (Positron's greys and the pink state/country borders are replaced), and the input is not mutated. */
export function applyBasemapTheme(style: StyleSpecification, theme: BasemapTheme): StyleSpecification {
  const themed = structuredClone(style);
  themed.layers = themed.layers.map((layer) => themeLayer(layer, theme));
  return themed;
}

function themeLayer(layer: LayerSpecification, theme: BasemapTheme): LayerSpecification {
  const id = layer.id.toLowerCase();
  // The paint objects are read and written by key, which the spec union types don't allow.
  const paint: Paint = { ...(layer.paint ?? {}) };

  switch (layer.type) {
    case "background":
      paint["background-color"] = theme.land;
      break;
    case "fill":
      if (BUILDING.test(id)) {
        paint["fill-color"] = theme.building;
        paint["fill-outline-color"] = theme.buildingEdge;
      } else if (WATER.test(id)) {
        paint["fill-color"] = theme.water;
      } else if (PARK.test(id)) {
        paint["fill-color"] = theme.park;
      } else if (id.startsWith("aeroway")) {
        paint["fill-color"] = theme.road;
      } else {
        // Land use, ice, glacier and anything unknown fall back to land, so no stray hue appears.
        paint["fill-color"] = theme.land;
      }
      break;
    case "line":
      paint["line-color"] = lineColour(id, theme);
      break;
    case "symbol":
      paint["text-color"] = theme.label;
      paint["text-halo-color"] = theme.labelHalo;
      paint["text-halo-width"] = 1.5;
      paint["text-halo-blur"] = 0;
      break;
    default:
      return layer;
  }
  return { ...layer, paint } as LayerSpecification;
}

function lineColour(id: string, theme: BasemapTheme): string {
  if (WATER.test(id)) return theme.water;
  if (BOUNDARY.test(id)) return theme.boundary;
  if (CASING.test(id)) return theme.roadCasing;
  if (id.startsWith("railway")) return RAIL_DASH.test(id) ? theme.road : theme.roadCasing;
  if (THIN_ROAD.test(id)) return theme.roadCasing;
  return theme.road;
}

export async function loadBasemapStyle(
  apiKey: string,
  theme: BasemapTheme,
  options: { styleId?: string; signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<StyleSpecification> {
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(basemapStyleUrl(apiKey, options.styleId), { signal: options.signal });
  if (!response.ok) {
    // Never echo the URL: it carries the key.
    throw new Error(`Basemap style request failed with HTTP ${response.status}`);
  }
  return applyBasemapTheme((await response.json()) as StyleSpecification, theme);
}

export type RequestKind = "style" | "tilejson" | "tile" | "glyphs" | "sprite" | "other";

export interface RequestStats {
  counts: Record<RequestKind, number>;
  /** Tile requests only; each costs 0.25 Geoapify credits (ADR-0008). */
  tileRequests: number;
}

const KIND_BY_RESOURCE: Record<string, RequestKind> = {
  Style: "style",
  Source: "tilejson",
  Tile: "tile",
  Glyphs: "glyphs",
  SpriteImage: "sprite",
  SpriteJSON: "sprite",
};

export function createRequestCounter(): {
  stats: RequestStats;
  transformRequest: (url: string, resourceType?: string) => { url: string };
} {
  const stats: RequestStats = {
    counts: { style: 0, tilejson: 0, tile: 0, glyphs: 0, sprite: 0, other: 0 },
    tileRequests: 0,
  };
  return {
    stats,
    transformRequest(url, resourceType) {
      const kind = KIND_BY_RESOURCE[resourceType ?? ""] ?? "other";
      stats.counts[kind] += 1;
      if (kind === "tile") stats.tileRequests += 1;
      return { url };
    },
  };
}

type MapLibreModule = typeof import("maplibre-gl");

/** MapLibre is loaded at run time from /maplibre/<version>/ (scripts/copy-maplibre.mts), not bundled:
 *  Turbopack's hashed file names stop MapLibre 6 from finding its worker. */
export function loadMapLibre(): Promise<MapLibreModule> {
  const version = process.env.NEXT_PUBLIC_MAPLIBRE_VERSION;
  if (!version) throw new Error("NEXT_PUBLIC_MAPLIBRE_VERSION is not set (see next.config.ts)");
  const url = `/maplibre/${version}/maplibre-gl.mjs`;
  return import(/* turbopackIgnore: true */ /* webpackIgnore: true */ url) as Promise<MapLibreModule>;
}

/** A style with only a background: no network, no tiles, no labels. For tests and local work without a key. */
export function blankStyle(theme: BasemapTheme): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: "background", type: "background", paint: { "background-color": theme.land } }],
  };
}

export interface BasemapOptions {
  container: HTMLElement;
  /** Empty means no basemap: the map draws the blank Milky style and makes no Geoapify request. */
  apiKey: string;
  theme: BasemapTheme;
  center: [number, number];
  zoom: number;
  signal?: AbortSignal;
  transformRequest?: (url: string, resourceType?: string) => { url: string };
  /** Turns rotation and tilt off. The company marker layer projects for a north-up, top-down camera only. */
  lockNorthUp?: boolean;
}

/** Creates the map with the themed Geoapify style and the attribution always expanded. */
export async function createBasemap(options: BasemapOptions): Promise<MapLibreMap> {
  const [maplibre, style] = await Promise.all([
    loadMapLibre(),
    options.apiKey
      ? loadBasemapStyle(options.apiKey, options.theme, { signal: options.signal })
      : Promise.resolve(blankStyle(options.theme)),
  ]);
  const map = new maplibre.Map({
    container: options.container,
    style,
    center: options.center,
    zoom: options.zoom,
    attributionControl: false,
    transformRequest: options.transformRequest,
    ...(options.lockNorthUp ? { dragRotate: false, pitchWithRotate: false, maxPitch: 0, bearing: 0, pitch: 0 } : {}),
  });
  if (options.lockNorthUp) map.touchZoomRotate.disableRotation();
  // Geoapify's free plan requires "Powered by Geoapify", plus OpenStreetMap and OpenMapTiles credits.
  // The TileJSON carries all three; compact: false keeps the text visible instead of behind a button.
  map.addControl(new maplibre.AttributionControl({ compact: false }));
  map.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
  return map;
}
