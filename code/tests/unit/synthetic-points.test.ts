import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GATE_DATASETS, buildManifest, sha256 } from "@/map/fixtures/cli.mts";
import {
  GATE_SEED,
  SIZE_PRESETS,
  generateSyntheticDataset,
  officeKey,
  serializeDataset,
  type CitySlug,
  type SyntheticDataset,
} from "@/map/fixtures/generate";
import { CITY_SHAPES, densestHotspot } from "@/map/fixtures/hotspots";

const metres = (a: { lng: number; lat: number }, b: { lng: number; lat: number }) => {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
};

const bengaluruS = generateSyntheticDataset({ city: "bengaluru", size: "S" });

describe("determinism", () => {
  it("gives the same hash for the same seed", () => {
    const again = generateSyntheticDataset({ city: "bengaluru", size: "S", seed: GATE_SEED });
    expect(sha256(serializeDataset(again))).toBe(sha256(serializeDataset(bengaluruS)));
  });

  it("gives a different hash for a different seed or city", () => {
    const hash = (d: SyntheticDataset) => sha256(serializeDataset(d));
    expect(hash(generateSyntheticDataset({ city: "bengaluru", size: "S", seed: 1 }))).not.toBe(hash(bengaluruS));
    expect(hash(generateSyntheticDataset({ city: "chennai", size: "S" }))).not.toBe(hash(bengaluruS));
  });

  it("matches the committed manifest for every gate dataset", () => {
    const committed = JSON.parse(readFileSync("map/fixtures/manifest.json", "utf8"));
    // If this fails after an intentional generator change, run `npm run fixtures -- --manifest`
    // and record the new hashes: the gate report cites them.
    expect(buildManifest()).toEqual(committed);
  });
});

describe.each(GATE_DATASETS.map(({ city, size }) => [city, size] as const))("%s %s", (city, size) => {
  const dataset = generateSyntheticDataset({ city, size });
  const shape = CITY_SHAPES[city as CitySlug];

  it("has exactly the preset number of offices", () => {
    expect(dataset.offices).toHaveLength(SIZE_PRESETS[size]);
    expect(dataset.meta.officeCount).toBe(SIZE_PRESETS[size]);
  });

  it("marks every record synthetic", () => {
    expect(dataset.meta.synthetic).toBe(true);
    expect(dataset.companies.every((c) => c.synthetic === true)).toBe(true);
    expect(dataset.offices.every((o) => o.synthetic === true)).toBe(true);
  });

  it("uses unique, sequential ids, and every office points at a real company", () => {
    expect(dataset.offices.map((o) => o.id)).toEqual(dataset.offices.map((_, i) => i + 1));
    expect(dataset.companies.map((c) => c.id)).toEqual(dataset.companies.map((_, i) => i + 1));
    const companyIds = new Set(dataset.companies.map((c) => c.id));
    expect(dataset.offices.every((o) => companyIds.has(o.companyId))).toBe(true);
    expect(new Set(dataset.offices.map((o) => officeKey(o.id))).size).toBe(dataset.offices.length);
  });

  it("keeps every office inside the city bounds", () => {
    const { south, north, west, east } = shape.bounds;
    for (const o of dataset.offices) {
      expect(o.lat).toBeGreaterThanOrEqual(south);
      expect(o.lat).toBeLessThanOrEqual(north);
      expect(o.lng).toBeGreaterThanOrEqual(west);
      expect(o.lng).toBeLessThanOrEqual(east);
    }
  });

  it("has fewer companies than offices, because some companies have several offices", () => {
    expect(dataset.companies.length).toBeLessThan(dataset.offices.length);
    expect(dataset.companies.length).toBeGreaterThan(dataset.offices.length * 0.8);
    const counts = new Map<number, number>();
    for (const o of dataset.offices) counts.set(o.companyId, (counts.get(o.companyId) ?? 0) + 1);
    expect([...counts.values()].some((n) => n > 1)).toBe(true);
    expect(dataset.meta.companyCount).toBe(dataset.companies.length);
  });

  it("tags types as overlapping sets and gives stages only to startups", () => {
    const types = dataset.companies.map((c) => c.types);
    expect(types.every((t) => t.length >= 1 && new Set(t).size === t.length)).toBe(true);
    expect(types.some((t) => t.includes("startup") && t.includes("product"))).toBe(true);
    expect(types.some((t) => t.includes("mnc"))).toBe(true);
    for (const c of dataset.companies) {
      expect(c.stage !== null).toBe(c.types.includes("startup"));
    }
    const stages = new Set(dataset.companies.map((c) => c.stage).filter(Boolean));
    expect(stages.size).toBe(9);
  });

  it("has 50 identical-coordinate groups covering every spider rule", () => {
    const identical = dataset.groups.filter((g) => g.kind === "identical");
    expect(identical).toHaveLength(50);
    const sizes = identical.map((g) => g.officeIds.length);
    expect(sizes.every((n) => n >= 2)).toBe(true);
    // The boundaries of the circle (<=8), spiral (9-20), and list (>20) rules.
    for (const n of [8, 9, 20, 21]) expect(sizes).toContain(n);
    for (const g of identical) {
      const members = g.officeIds.map((id) => dataset.offices[id - 1]);
      expect(members.every((o) => o.lng === g.lng && o.lat === g.lat)).toBe(true);
      expect(new Set(members.map((o) => o.companyId)).size).toBe(members.length);
    }
  });

  it("has a building with 30 different companies at one point", () => {
    const [building, ...others] = dataset.groups.filter((g) => g.kind === "building");
    expect(others).toHaveLength(0);
    expect(building.officeIds).toHaveLength(30);
    const members = building.officeIds.map((id) => dataset.offices[id - 1]);
    expect(new Set(members.map((o) => o.companyId)).size).toBe(30);
    expect(members.every((o) => o.lng === building.lng && o.lat === building.lat)).toBe(true);
  });

  it("has near groups within the 5 m co-location rule", () => {
    const near = dataset.groups.filter((g) => g.kind === "near");
    expect(near).toHaveLength(10);
    for (const g of near) {
      const members = g.officeIds.map((id) => dataset.offices[id - 1]);
      for (const a of members) for (const b of members) expect(metres(a, b)).toBeLessThanOrEqual(5);
    }
  });

  it("references every grouped office exactly once", () => {
    const grouped = dataset.groups.flatMap((g) => g.officeIds);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(grouped.every((id) => id >= 1 && id <= dataset.offices.length)).toBe(true);
  });
});

describe("density", () => {
  it("concentrates points in the named hotspots, with the densest hotspot busiest per area", () => {
    const dataset = generateSyntheticDataset({ city: "bengaluru", size: "L" });
    const grouped = new Set(dataset.groups.flatMap((g) => g.officeIds));
    const scattered = dataset.offices.filter((o) => !grouped.has(o.id));
    const within = (name: string, km: number) => {
      const h = CITY_SHAPES.bengaluru.hotspots.find((x) => x.name === name)!;
      return scattered.filter((o) => metres(h, o) <= km * 1000).length;
    };
    // Within 2 km of the densest centre holds far more points than a uniform spread would
    // (the city rectangle is about 600 km2; a 2 km disc is about 12.6 km2, i.e. ~2%).
    const densest = densestHotspot("bengaluru");
    expect(densest.name).toBe("Koramangala");
    expect(within(densest.name, 2) / scattered.length).toBeGreaterThan(0.08);
    expect(within("Manyata", 2) / scattered.length).toBeGreaterThan(0.08);
  });

  it("puts the building in the configured hotspot for each city", () => {
    for (const city of ["bengaluru", "chennai"] as const) {
      const dataset = generateSyntheticDataset({ city, size: "S" });
      const building = dataset.groups.find((g) => g.kind === "building")!;
      const h = CITY_SHAPES[city].hotspots.find((x) => x.name === CITY_SHAPES[city].buildingHotspot)!;
      expect(metres(h, building)).toBeLessThan(1);
    }
  });

  it("refuses a size too small for the fixed co-location cases", () => {
    expect(() => generateSyntheticDataset({ city: "bengaluru", size: 300 })).toThrow(/too small/);
  });
});
