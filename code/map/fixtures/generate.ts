// Synthetic office points for the Phase 2 map prototype and validation gate (P2-01).
// Pure and deterministic: the same options give the same dataset, byte for byte.
// Every record is synthetic (`synthetic: true`) and must never be shown as real data.
import { CITY_SHAPES, type CitySlug, type Hotspot } from "./hotspots.ts";

export type { CitySlug } from "./hotspots.ts";

export type CompanyType = "startup" | "mnc" | "product";
export type StartupStage =
  | "pre_seed"
  | "seed"
  | "bootstrapped"
  | "series_a"
  | "series_b"
  | "series_c"
  | "series_c_plus"
  | "public"
  | "acquired";

export type SyntheticCompany = {
  id: number;
  name: string;
  /** Overlapping tags (ADR-0004): a company can be a Startup and a Product company. */
  types: CompanyType[];
  /** Set only for startups. */
  stage: StartupStage | null;
  synthetic: true;
};

export type SyntheticOffice = {
  id: number;
  companyId: number;
  lng: number;
  lat: number;
  synthetic: true;
};

/** A deliberate co-location case for the hit-test and spider scenarios (map-spec §7). */
export type CoLocationGroup = {
  id: string;
  /** identical = same coordinates; near = within 5 m; building = 30 companies at one address. */
  kind: "identical" | "near" | "building";
  lng: number;
  lat: number;
  officeIds: number[];
};

export type SyntheticDataset = {
  meta: {
    generator: "p2-01";
    version: 1;
    seed: number;
    city: CitySlug;
    officeCount: number;
    companyCount: number;
    synthetic: true;
  };
  companies: SyntheticCompany[];
  offices: SyntheticOffice[];
  groups: CoLocationGroup[];
};

export type GenerateOptions = {
  city: CitySlug;
  /** Number of offices. A preset name or an exact count. */
  size: SizePreset | number;
  seed?: number;
};

export const SIZE_PRESETS = { S: 1_500, M: 5_000, L: 15_000 } as const;
export type SizePreset = keyof typeof SIZE_PRESETS;

/** The fixed seed behind the gate datasets, so reports can cite a dataset hash. */
export const GATE_SEED = 20_260_930;

const IDENTICAL_GROUPS = 50;
const NEAR_GROUPS = 10;
const BUILDING_COMPANIES = 30;
const NEAR_RADIUS_M = 2.3; // any two offices stay under the 5 m co-location rule, with room for rounding
const CHAIN_SHARE = 0.1; // scattered offices that belong to an existing multi-office company

const ADJECTIVES = [
  "Alder", "Birch", "Cedar", "Delta", "Ember", "Fjord", "Garnet", "Harbor",
  "Indigo", "Juniper", "Kestrel", "Lumen", "Maple", "Nimbus", "Onyx", "Pebble",
  "Quartz", "Raven", "Sable", "Tundra", "Umber", "Vector", "Willow", "Zephyr",
] as const;
const NOUNS = [
  "Labs", "Systems", "Works", "Logic", "Cloud", "Dynamics", "Networks", "Analytics",
  "Robotics", "Health", "Pay", "Mobility", "Foods", "Learning", "Energy", "Retail",
  "Security", "Media", "Studio", "Software", "Data", "Commerce", "Devices", "Ventures",
] as const;

const STAGE_WEIGHTS: ReadonlyArray<readonly [StartupStage, number]> = [
  ["pre_seed", 10], ["seed", 20], ["bootstrapped", 10], ["series_a", 18],
  ["series_b", 14], ["series_c", 8], ["series_c_plus", 6], ["public", 8], ["acquired", 6],
];

type Rng = () => number;

/** mulberry32: small, fast, and identical on every JS engine (integer arithmetic only). */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const KM_PER_DEG_LAT = 111.32;

function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function pickWeighted<T>(rng: Rng, items: ReadonlyArray<readonly [T, number]>): T {
  const total = items.reduce((sum, [, w]) => sum + w, 0);
  let r = rng() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r < 0) return item;
  }
  return items[items.length - 1][0];
}

function gaussian(rng: Rng): number {
  const u1 = Math.max(rng(), Number.MIN_VALUE);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng());
}

type Point = { lng: number; lat: number };

function makePointSampler(city: CitySlug, rng: Rng) {
  const shape = CITY_SHAPES[city];
  const { bounds } = shape;
  const inBounds = (p: Point) =>
    p.lat >= bounds.south && p.lat <= bounds.north && p.lng >= bounds.west && p.lng <= bounds.east;
  const hotspotWeights = shape.hotspots.map((h) => [h, h.weight] as const);

  const aroundHotspot = (h: Hotspot): Point => {
    const kmPerDegLng = KM_PER_DEG_LAT * Math.cos((h.lat * Math.PI) / 180);
    for (;;) {
      const p = {
        lat: h.lat + (gaussian(rng) * h.sigmaKm) / KM_PER_DEG_LAT,
        lng: h.lng + (gaussian(rng) * h.sigmaKm) / kmPerDegLng,
      };
      if (inBounds(p)) return { lng: round6(p.lng), lat: round6(p.lat) };
    }
  };

  const uniform = (): Point => ({
    lat: round6(bounds.south + rng() * (bounds.north - bounds.south)),
    lng: round6(bounds.west + rng() * (bounds.east - bounds.west)),
  });

  return {
    /** A point with the city's density: hotspot clumps plus a uniform background. */
    any: (): Point =>
      rng() < shape.backgroundShare ? uniform() : aroundHotspot(pickWeighted(rng, hotspotWeights)),
    /** A point near one named hotspot's centre. */
    at: (name: string): Point => {
      const h = shape.hotspots.find((x) => x.name === name);
      if (!h) throw new Error(`Unknown hotspot ${name} for ${city}`);
      return { lng: round6(h.lng), lat: round6(h.lat) };
    },
  };
}

function offsetMetres(origin: Point, rng: Rng, radiusM: number): Point {
  const r = radiusM * Math.sqrt(rng());
  const angle = rng() * 2 * Math.PI;
  const dLat = (r * Math.sin(angle)) / (KM_PER_DEG_LAT * 1000);
  const dLng = (r * Math.cos(angle)) / (KM_PER_DEG_LAT * 1000 * Math.cos((origin.lat * Math.PI) / 180));
  return { lng: round6(origin.lng + dLng), lat: round6(origin.lat + dLat) };
}

/** Group sizes cover every spider rule: 2-8 on a circle, 9-20 on a spiral, 21+ opens the list. */
function identicalGroupSizes(rng: Rng): number[] {
  // 38 small, 9 medium, 3 large; the boundary size of each rule is always present.
  const randoms = (n: number, min: number, max: number) =>
    Array.from({ length: n }, () => randInt(rng, min, max));
  const sizes = [
    2, 8, ...randoms(36, 2, 8),
    9, 20, ...randoms(7, 9, 20),
    21, ...randoms(2, 21, 25),
  ];
  if (sizes.length !== IDENTICAL_GROUPS) throw new Error("identical group count drifted");
  return sizes;
}

export function generateSyntheticDataset(options: GenerateOptions): SyntheticDataset {
  const { city } = options;
  const seed = options.seed ?? GATE_SEED;
  const officeCount = typeof options.size === "number" ? options.size : SIZE_PRESETS[options.size];
  const rng = mulberry32(seed);
  const sampler = makePointSampler(city, rng);

  const companies: SyntheticCompany[] = [];
  const offices: SyntheticOffice[] = [];
  const groups: CoLocationGroup[] = [];
  const chainPool: number[] = [];

  const newCompany = (): number => {
    const id = companies.length + 1;
    const primary = pickWeighted(rng, [["startup", 45], ["mnc", 25], ["product", 30]] as const);
    const types: CompanyType[] = [primary];
    if (primary !== "product" && rng() < (primary === "startup" ? 0.4 : 0.15)) types.push("product");
    companies.push({
      id,
      name: `${pick(rng, ADJECTIVES)} ${pick(rng, NOUNS)} ${id}`,
      types,
      stage: types.includes("startup") ? pickWeighted(rng, STAGE_WEIGHTS) : null,
      synthetic: true,
    });
    return id;
  };

  const addOffice = (companyId: number, p: Point): number => {
    const id = offices.length + 1;
    offices.push({ id, companyId, lng: p.lng, lat: p.lat, synthetic: true });
    return id;
  };

  // Deliberate co-location cases first, so they exist in every dataset size.
  const buildingPoint = sampler.at(CITY_SHAPES[city].buildingHotspot);
  groups.push({
    id: "building-30",
    kind: "building",
    ...buildingPoint,
    officeIds: Array.from({ length: BUILDING_COMPANIES }, () => addOffice(newCompany(), buildingPoint)),
  });

  identicalGroupSizes(rng).forEach((size, i) => {
    const p = sampler.any();
    groups.push({
      id: `identical-${String(i + 1).padStart(2, "0")}`,
      kind: "identical",
      ...p,
      officeIds: Array.from({ length: size }, () => addOffice(newCompany(), p)),
    });
  });

  for (let i = 0; i < NEAR_GROUPS; i++) {
    const base = sampler.any();
    const size = randInt(rng, 2, 3);
    groups.push({
      id: `near-${String(i + 1).padStart(2, "0")}`,
      kind: "near",
      ...base,
      officeIds: Array.from({ length: size }, () =>
        addOffice(newCompany(), offsetMetres(base, rng, NEAR_RADIUS_M)),
      ),
    });
  }

  if (offices.length > officeCount * 0.6) {
    throw new Error(`Size ${officeCount} is too small for the fixed co-location cases (${offices.length} offices)`);
  }

  // The rest are scattered; some belong to a company that already has an office.
  while (offices.length < officeCount) {
    const reuse = chainPool.length > 0 && rng() < CHAIN_SHARE;
    let companyId: number;
    if (reuse) {
      companyId = pick(rng, chainPool);
    } else {
      companyId = newCompany();
      if (rng() < 0.15) chainPool.push(companyId);
    }
    addOffice(companyId, sampler.any());
  }

  return {
    meta: { generator: "p2-01", version: 1, seed, city, officeCount, companyCount: companies.length, synthetic: true },
    companies,
    offices,
    groups,
  };
}

/** Canonical text for hashing and files. Key order is fixed by construction. */
export function serializeDataset(dataset: SyntheticDataset): string {
  return JSON.stringify(dataset);
}

/** The stable office key from map-spec §2. */
export const officeKey = (officeId: number): string => `o:${officeId}`;
