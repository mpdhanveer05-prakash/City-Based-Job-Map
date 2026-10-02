// Spider layout for a co-location stack (map-spec §7). Pure and DOM-free.
//
// Up to 8 companies open on a circle, 9 to 20 on a spiral, and more than 20 open the side list instead. Offsets
// are screen pixels from the stack. They are turned into longitude and latitude once, at the zoom where the spider
// opened, and the spider closes when the zoom changes, so the layout never has to be re-scaled.
import { screenToLngLat, screenX, screenY, latToMercatorY, lngToMercatorX, type View } from "./geometry.ts";
import type { LayerItem } from "./instances.ts";

/** Centre-to-centre distance between neighbouring spider markers, px: the 40 px logo plus a gap. */
export const SPIDER_SPACING = 48;
export const CIRCLE_MAX = 8;
export const SPIRAL_MAX = 20;
/** The smallest circle radius, px: keeps two or three markers clear of the stack at the centre. */
const CIRCLE_MIN_RADIUS = 56;
/** The spiral starts just outside the largest circle and grows by this much per turn (more than a marker). */
const SPIRAL_START_RADIUS = 64;
const SPIRAL_GROWTH_PER_TURN = 52;

export type SpiderMode = "circle" | "spiral" | "list";

export type SpiderOffset = { dx: number; dy: number };

export type SpiderLayout =
  | { mode: "circle" | "spiral"; offsets: SpiderOffset[] }
  | { mode: "list"; offsets: [] };

/** Which layout `count` companies get. Fewer than 2 is not a stack. */
export function spiderMode(count: number): SpiderMode {
  if (!Number.isInteger(count) || count < 2) throw new RangeError(`A stack holds at least 2 companies, got ${count}.`);
  return count <= CIRCLE_MAX ? "circle" : count <= SPIRAL_MAX ? "spiral" : "list";
}

/** Marker offsets from the stack centre, px (x right, y down). The first marker is straight up, then clockwise. */
export function layoutSpider(count: number): SpiderLayout {
  const mode = spiderMode(count);
  if (mode === "list") return { mode, offsets: [] };

  const start = -Math.PI / 2;
  const offsets: SpiderOffset[] = [];
  if (mode === "circle") {
    // The radius that puts neighbours exactly SPIDER_SPACING apart (chord), but never inside the minimum.
    const radius = Math.max(CIRCLE_MIN_RADIUS, SPIDER_SPACING / (2 * Math.sin(Math.PI / count)));
    for (let i = 0; i < count; i++) {
      const angle = start + (2 * Math.PI * i) / count;
      offsets.push({ dx: radius * Math.cos(angle), dy: radius * Math.sin(angle) });
    }
    return { mode, offsets };
  }

  // Archimedean spiral: the radius grows steadily with the angle, and each step advances about one spacing along
  // the curve, so neighbours along the spiral and across turns both stay a marker apart.
  let angle = start;
  for (let i = 0; i < count; i++) {
    const radius = SPIRAL_START_RADIUS + (SPIRAL_GROWTH_PER_TURN * (angle - start)) / (2 * Math.PI);
    offsets.push({ dx: radius * Math.cos(angle), dy: radius * Math.sin(angle) });
    angle += SPIDER_SPACING / radius;
  }
  return { mode, offsets };
}

export type SpiderMember = Omit<LayerItem, "lng" | "lat">;

export type OpenSpider = {
  stackKey: string;
  mode: SpiderMode;
  /** The map zoom it opened at. A different zoom closes it. */
  zoom: number;
  /** The stack's true position. Empty `items` and `legs` for the list. */
  origin: { lng: number; lat: number };
  /** The members, placed around the origin. Their keys are the offices' own keys. */
  items: LayerItem[];
  /** Leg lines from the true position to each member, as `[lng, lat]` pairs. */
  legs: Array<[[number, number], [number, number]]>;
  /** The member keys in the order they were given, for the list. */
  memberKeys: string[];
};

/**
 * Opens a stack: places each member around the stack at the current view. More than 20 members give the list
 * (no items, no legs). The members keep the order they are given in.
 */
export function openSpider(input: {
  stack: { key: string; lng: number; lat: number };
  members: readonly SpiderMember[];
  view: View;
  zoom: number;
}): OpenSpider {
  const { stack, members, view, zoom } = input;
  const layout = layoutSpider(members.length);
  const origin = { lng: stack.lng, lat: stack.lat };
  const base = {
    stackKey: stack.key,
    mode: layout.mode,
    zoom,
    origin,
    memberKeys: members.map((m) => m.key),
  };
  if (layout.mode === "list") return { ...base, items: [], legs: [] };

  const cx = screenX(view, lngToMercatorX(stack.lng));
  const cy = screenY(view, latToMercatorY(stack.lat));
  const items: LayerItem[] = [];
  const legs: OpenSpider["legs"] = [];
  members.forEach((member, i) => {
    const { dx, dy } = layout.offsets[i];
    const at = screenToLngLat(view, cx + dx, cy + dy);
    items.push({ ...member, lng: at.lng, lat: at.lat });
    legs.push([[origin.lng, origin.lat], [at.lng, at.lat]]);
  });
  return { ...base, items, legs };
}

/** The legs as GeoJSON for a MapLibre line layer. */
export function legsGeoJson(spider: OpenSpider | null): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: "FeatureCollection",
    features: (spider?.legs ?? []).map((coordinates, i) => ({
      type: "Feature",
      properties: { member: spider!.memberKeys[i] },
      geometry: { type: "LineString", coordinates },
    })),
  };
}
