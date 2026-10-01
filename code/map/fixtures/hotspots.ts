// Density shaping for the synthetic office points (P2-01). Centres are approximate
// and chosen only to give the map realistic clumping; they are not curated data.

export type CitySlug = "bengaluru" | "chennai";

export type Hotspot = {
  name: string;
  lat: number;
  lng: number;
  /** Relative share of the clustered points. */
  weight: number;
  /** Gaussian spread in km. */
  sigmaKm: number;
};

export type CityShape = {
  /** Rough rectangle that keeps every point inside the urban area. */
  bounds: { south: number; north: number; west: number; east: number };
  hotspots: readonly Hotspot[];
  /** Share of points spread uniformly over `bounds` instead of around a hotspot. */
  backgroundShare: number;
  /** Where the 30-company building goes. */
  buildingHotspot: string;
};

export const CITY_SHAPES: Readonly<Record<CitySlug, CityShape>> = {
  bengaluru: {
    bounds: { south: 12.83, north: 13.14, west: 77.46, east: 77.78 },
    backgroundShare: 0.15,
    buildingHotspot: "Manyata",
    hotspots: [
      { name: "Manyata", lat: 13.045, lng: 77.62, weight: 14, sigmaKm: 0.9 },
      { name: "Whitefield / ITPL", lat: 12.985, lng: 77.735, weight: 12, sigmaKm: 1.3 },
      { name: "ORR Bellandur-Marathahalli", lat: 12.93, lng: 77.68, weight: 14, sigmaKm: 1.6 },
      { name: "Koramangala", lat: 12.9352, lng: 77.6245, weight: 12, sigmaKm: 0.8 },
      { name: "Electronic City", lat: 12.845, lng: 77.66, weight: 8, sigmaKm: 1.2 },
      { name: "MG Road / CBD", lat: 12.975, lng: 77.607, weight: 8, sigmaKm: 0.9 },
      { name: "Indiranagar", lat: 12.9784, lng: 77.6408, weight: 6, sigmaKm: 0.7 },
      { name: "Hebbal", lat: 13.0358, lng: 77.597, weight: 5, sigmaKm: 1.0 },
      { name: "HSR Layout", lat: 12.9116, lng: 77.6389, weight: 6, sigmaKm: 0.8 },
    ],
  },
  chennai: {
    bounds: { south: 12.8, north: 13.2, west: 80.1, east: 80.32 },
    backgroundShare: 0.15,
    buildingHotspot: "OMR Sholinganallur",
    hotspots: [
      { name: "OMR Sholinganallur", lat: 12.901, lng: 80.2279, weight: 16, sigmaKm: 1.8 },
      { name: "Guindy", lat: 13.0067, lng: 80.2206, weight: 14, sigmaKm: 1.0 },
      { name: "Taramani / Tidel Park", lat: 12.987, lng: 80.246, weight: 10, sigmaKm: 0.9 },
      { name: "Perungudi", lat: 12.96, lng: 80.242, weight: 8, sigmaKm: 1.0 },
      { name: "Siruseri", lat: 12.823, lng: 80.226, weight: 6, sigmaKm: 1.4 },
      { name: "Ambattur", lat: 13.1143, lng: 80.1548, weight: 6, sigmaKm: 1.3 },
      { name: "Anna Salai / T Nagar", lat: 13.0418, lng: 80.2341, weight: 9, sigmaKm: 1.0 },
    ],
  },
};

/** The hotspot with the most points per unit area (weight over spread squared). */
export function densestHotspot(city: CitySlug): Hotspot {
  const [first, ...rest] = CITY_SHAPES[city].hotspots;
  let best = first;
  for (const h of rest) {
    if (h.weight / h.sigmaKm ** 2 > best.weight / best.sigmaKm ** 2) best = h;
  }
  return best;
}
