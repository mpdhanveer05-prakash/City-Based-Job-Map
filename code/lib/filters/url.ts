// URL state for the explorer (P4-04). The one place that reads or writes the explorer's query
// parameters: components never touch `searchParams` themselves (CLAUDE.md, Conventions).
//
//   /bangalore?view=list&type=startup,mnc&stage=seed&hood=indiranagar&park=etv&sector=fintech
//             &q=backend%20engineer&company=amber-forge-synthetic&map=12.97160,77.59460,11.50
//
// Parsing is lenient (a bad value is dropped, never an error, because anyone can edit a URL) and the
// result is always normalised. Serialising is canonical: the same state always gives the same
// string, in a fixed parameter order with sorted lists and no defaults, so Back and Forward compare
// URLs by value and a shared link looks the same however it was reached.
import "../zod-config.ts";
import { z } from "zod";
import {
  CITY_SLUGS,
  COMPANY_TYPES,
  EMPTY_FILTERS,
  STARTUP_STAGES,
  VIEWS,
  normalizeFilters,
  normalizeQuery,
  slugSchema,
  type CitySlug,
  type Filters,
  type View,
} from "./schema.ts";

export type Camera = { lat: number; lng: number; zoom: number };

export type ExplorerState = {
  city: CitySlug;
  view: View;
  filters: Filters;
  /** The selected company's slug, or null. */
  company: string | null;
  /** The map camera, or null for "the city's default view". */
  camera: Camera | null;
};

export const DEFAULT_VIEW: View = "map";

/** Zoom range the camera accepts. */
export const MIN_ZOOM = 0;
export const MAX_ZOOM = 22;

/** The values a URL's search part can come as: the browser's, or a plain record. */
export type SearchInput = URLSearchParams | Record<string, string | readonly string[] | undefined>;

/** Parameter names in the order they are written. */
export const PARAM_ORDER = ["view", "q", "type", "stage", "hood", "park", "sector", "company", "map"] as const;

export function parseCity(slug: string | null | undefined): CitySlug | null {
  return (CITY_SLUGS as readonly string[]).includes(slug ?? "") ? (slug as CitySlug) : null;
}

/** Rounds a camera to the precision the URL keeps (about a metre, and a hundredth of a zoom). */
export function roundCamera(camera: Camera): Camera {
  return {
    lat: Math.round(camera.lat * 1e5) / 1e5,
    lng: Math.round(camera.lng * 1e5) / 1e5,
    zoom: Math.round(camera.zoom * 100) / 100,
  };
}

function parseCamera(value: string | undefined): Camera | null {
  if (!value) return null;
  const parts = value.split(",");
  if (parts.length !== 3) return null;
  // Number("") is 0, so an empty part must be rejected before converting.
  if (parts.some((p) => p.trim() === "")) return null;
  const [lat, lng, zoom] = parts.map(Number);
  if (![lat, lng, zoom].every(Number.isFinite)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || zoom < MIN_ZOOM || zoom > MAX_ZOOM) return null;
  return roundCamera({ lat, lng, zoom });
}

/** First value of each parameter, as a plain record. */
function firstValues(input: SearchInput): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  if (input instanceof URLSearchParams) {
    for (const key of PARAM_ORDER) {
      const v = input.get(key);
      if (v !== null) out[key] = v;
    }
    return out;
  }
  for (const key of PARAM_ORDER) {
    const v = input[key];
    out[key] = Array.isArray(v) ? v[0] : (v as string | undefined);
  }
  return out;
}

const csv = (valid: (v: string) => boolean) =>
  z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s !== "" && valid(s)),
    );

/** The single schema for the explorer's query string. Every field falls back to its default. */
export const explorerSearchSchema = z
  .object({
    view: z.enum(VIEWS).catch(DEFAULT_VIEW),
    q: z.string().optional().transform(normalizeQuery),
    type: csv((v) => (COMPANY_TYPES as readonly string[]).includes(v)),
    stage: csv((v) => (STARTUP_STAGES as readonly string[]).includes(v)),
    hood: csv((v) => slugSchema.safeParse(v).success),
    park: csv((v) => slugSchema.safeParse(v).success),
    sector: csv((v) => slugSchema.safeParse(v).success),
    company: z
      .string()
      .optional()
      .transform((v) => (v && slugSchema.safeParse(v.trim()).success ? v.trim() : null)),
    map: z.string().optional().transform(parseCamera),
  })
  .transform((p) => ({
    view: p.view,
    // normalizeFilters clears stages unless Startup is selected, so a URL such as ?stage=seed alone
    // or ?type=mnc&stage=seed is corrected on load.
    filters: normalizeFilters({
      q: p.q,
      types: p.type as Filters["types"],
      stages: p.stage as Filters["stages"],
      neighbourhoods: p.hood,
      tech_parks: p.park,
      sectors: p.sector,
    }),
    company: p.company,
    camera: p.map,
  }));

/** Parses the query string of an explorer URL. Never throws. */
export function parseExplorerSearch(input: SearchInput): Omit<ExplorerState, "city"> {
  return explorerSearchSchema.parse(firstValues(input));
}

/** The full state for a city and a query string, or null when the city is not a launch city. */
export function parseExplorerState(city: string | null | undefined, input: SearchInput): ExplorerState | null {
  const parsed = parseCity(city);
  if (!parsed) return null;
  return { city: parsed, ...parseExplorerSearch(input) };
}

export function defaultExplorerState(city: CitySlug): ExplorerState {
  return { city, view: DEFAULT_VIEW, filters: { ...EMPTY_FILTERS }, company: null, camera: null };
}

/** The canonical query string for a state (no leading "?"; empty for the default state). */
export function serializeExplorerSearch(state: Omit<ExplorerState, "city">): string {
  const filters = normalizeFilters(state.filters);
  const params = new URLSearchParams();
  if (state.view !== DEFAULT_VIEW) params.set("view", state.view);
  if (filters.q !== "") params.set("q", filters.q);
  if (filters.types.length) params.set("type", filters.types.join(","));
  if (filters.stages.length) params.set("stage", filters.stages.join(","));
  if (filters.neighbourhoods.length) params.set("hood", filters.neighbourhoods.join(","));
  if (filters.tech_parks.length) params.set("park", filters.tech_parks.join(","));
  if (filters.sectors.length) params.set("sector", filters.sectors.join(","));
  if (state.company && slugSchema.safeParse(state.company).success) params.set("company", state.company);
  if (state.camera) {
    const c = roundCamera(state.camera);
    params.set("map", `${c.lat.toFixed(5)},${c.lng.toFixed(5)},${c.zoom.toFixed(2)}`);
  }
  return params.toString();
}

/** `/bangalore` or `/bangalore?view=list&type=startup`. */
export function explorerHref(state: ExplorerState): string {
  const search = serializeExplorerSearch(state);
  return search ? `/${state.city}?${search}` : `/${state.city}`;
}

/** What a state change should do to the browser's history. */
export type HistoryMode = "push" | "replace" | "none";

/**
 * Back and Forward should step through what the visitor chose, not through every pixel of a pan:
 * a change to the camera alone replaces the current entry; any other change adds one; no change
 * does nothing. The comparison is by canonical URL, so a state that normalises to the same URL
 * is "no change".
 */
export function historyMode(previous: ExplorerState, next: ExplorerState): HistoryMode {
  if (previous.city !== next.city) return "push";
  const a = serializeExplorerSearch(previous);
  const b = serializeExplorerSearch(next);
  if (a === b) return "none";
  const withoutCamera = (s: ExplorerState) => serializeExplorerSearch({ ...s, camera: null });
  return withoutCamera(previous) === withoutCamera(next) ? "replace" : "push";
}
