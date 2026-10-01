// Camera maths for the marker layer: Web Mercator, screen projection, culling, sizes, count labels.
// Pure and DOM-free. The layer projects in screen pixels on the CPU, so float32 never has to hold a
// world coordinate (at zoom 17 one pixel is 1.5e-8 of the world, below float32 precision).
// It assumes a north-up, top-down camera (bearing 0, pitch 0); the explorer disables rotation and tilt.

export const TILE_SIZE = 512; // MapLibre's world is 512 px wide at zoom 0
const MAX_LAT = 85.0511287798;

export const lngToMercatorX = (lng: number): number => lng / 360 + 0.5;

export function latToMercatorY(lat: number): number {
  const s = Math.sin((Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

export const mercatorXToLng = (x: number): number => (x - 0.5) * 360;

export const mercatorYToLat = (y: number): number =>
  (Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) * 360) / Math.PI - 90;

export type View = {
  /** The map centre in Mercator units (0…1). */
  centerX: number;
  centerY: number;
  /** World width in CSS px: 512 · 2^zoom. */
  worldSize: number;
  /** The canvas size in CSS px. */
  width: number;
  height: number;
};

export function viewFor(center: { lng: number; lat: number }, zoom: number, width: number, height: number): View {
  return {
    centerX: lngToMercatorX(center.lng),
    centerY: latToMercatorY(center.lat),
    worldSize: TILE_SIZE * 2 ** zoom,
    width,
    height,
  };
}

export const screenX = (view: View, mx: number): number => (mx - view.centerX) * view.worldSize + view.width / 2;
export const screenY = (view: View, my: number): number => (my - view.centerY) * view.worldSize + view.height / 2;

export function screenToLngLat(view: View, x: number, y: number): { lng: number; lat: number } {
  return {
    lng: mercatorXToLng(view.centerX + (x - view.width / 2) / view.worldSize),
    lat: mercatorYToLat(view.centerY + (y - view.height / 2) / view.worldSize),
  };
}

/** Items are drawn this far outside the viewport (a fraction of its width and height). */
export const CULL_MARGIN = 0.2;

/** True when a disc centred at (x, y) with `radius` touches the viewport grown by `margin` on every side. */
export function intersectsViewport(x: number, y: number, radius: number, view: View, margin = CULL_MARGIN): boolean {
  const mx = view.width * margin;
  const my = view.height * margin;
  return x + radius >= -mx && x - radius <= view.width + mx && y + radius >= -my && y - radius <= view.height + my;
}

export const CLUSTER_MIN_DIAMETER = 36;
export const CLUSTER_MAX_DIAMETER = 64;
/** The count at which a cluster reaches its largest size. */
const CLUSTER_FULL_SIZE_COUNT = 1000;

/** Cluster diameter in px, scaling with log(count) from 36 to 64 (design-system.md §2). The curve is a proposal. */
export function clusterDiameter(count: number): number {
  const t = Math.max(0, Math.min(1, Math.log(Math.max(count, 1)) / Math.log(CLUSTER_FULL_SIZE_COUNT)));
  return CLUSTER_MIN_DIAMETER + (CLUSTER_MAX_DIAMETER - CLUSTER_MIN_DIAMETER) * t;
}

export const LOGO_DIAMETER = 40;
export const SELECTED_SCALE = 1.25;

/** A count as at most four glyphs, so it fits the disc: 7, 999, 1.2k, 12k, 99k+. */
export function formatCount(count: number): string {
  const n = Math.max(0, Math.round(count));
  if (n < 1000) return String(n);
  // Whole tenths of a thousand, in integers: 1,950 / 100 is exactly 19.5, where 1.95.toFixed(1) gives "1.9".
  const tenths = Math.round(n / 100);
  if (tenths < 100) return tenths % 10 === 0 ? `${tenths / 10}k` : `${Math.floor(tenths / 10)}.${tenths % 10}k`;
  if (n < 99_500) return `${Math.round(n / 1000)}k`;
  return "99k+";
}
