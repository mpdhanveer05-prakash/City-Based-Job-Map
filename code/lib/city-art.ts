// The artwork on the city selection tiles (design-system.md §5): a city's boundary with its office
// points inside it. Pure geometry, so it is unit-tested; the tile only draws what this returns.
import type { CityBoundary } from "./filters/dataset.ts";

export type ArtBox = {
  width: number;
  height: number;
  padding: number;
  /** Where the shape sits when the box is wider than it needs: the page is left-aligned, so tiles use "start". Default "center". */
  align?: "start" | "center";
};

export type CityArt = {
  /** SVG path data for the boundary: one closed sub-path per ring. */
  path: string;
  /** Office points in the same coordinates, rounded to a tenth of a unit. */
  dots: Array<[number, number]>;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Fits the boundary into the box with a single scale (never stretched) and centres it (or starts it at the left padding). Longitude is
 * scaled by cos(latitude of the centre) so a city keeps its real shape. Points outside the boundary's
 * box are dropped: the tile shows the city, not a stray point.
 */
export function projectCity(boundary: CityBoundary, points: ReadonlyArray<readonly [number, number]>, box: ArtBox): CityArt {
  const rings = boundary.coordinates.flatMap((polygon) => polygon);
  const all = rings.flat();
  if (all.length === 0) return { path: "", dots: [] };

  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of all) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max((maxLng - minLng) * k, 1e-9);
  const spanY = Math.max(maxLat - minLat, 1e-9);
  const scale = Math.min((box.width - 2 * box.padding) / spanX, (box.height - 2 * box.padding) / spanY);
  const offsetX = box.align === "start" ? box.padding : (box.width - spanX * scale) / 2;
  const offsetY = (box.height - spanY * scale) / 2;

  const toX = (lng: number) => round1(offsetX + (lng - minLng) * k * scale);
  const toY = (lat: number) => round1(offsetY + (maxLat - lat) * scale);

  const path = rings
    .map((ring) => ring.map(([lng, lat], i) => `${i === 0 ? "M" : "L"}${toX(lng)} ${toY(lat)}`).join("") + "Z")
    .join("");
  const dots = points
    .filter(([lng, lat]) => lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat)
    .map(([lng, lat]): [number, number] => [toX(lng), toY(lat)]);
  return { path, dots };
}
