import { describe, expect, it } from "vitest";
import { assertReleaseData, chooseDataSource, describeDataSource } from "@/lib/api/data-source";
import { citySnapshotSchema, snapshotIsSynthetic, splitSnapshot, type CitySnapshot } from "@/lib/filters/dataset";

describe("chooseDataSource", () => {
  const rest = { NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" };

  it("prefers a Supabase project over a local database", () => {
    const source = chooseDataSource({ ...rest, LOCAL_DATABASE_URL: "postgresql://x" });
    expect(source).toEqual({ kind: "rest", url: "https://abc.supabase.co", anonKey: "anon" });
  });

  it("falls to the local database, then to nothing", () => {
    expect(chooseDataSource({ LOCAL_DATABASE_URL: "postgresql://x" })).toEqual({ kind: "local", connectionString: "postgresql://x" });
    expect(chooseDataSource({})).toEqual({ kind: "none" });
  });

  it("treats the .env.example placeholders as unset", () => {
    expect(chooseDataSource({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "replace-with-anon-or-publishable-key" })).toEqual({
      kind: "none",
    });
    expect(chooseDataSource({ LOCAL_DATABASE_URL: "  " })).toEqual({ kind: "none" });
  });

  it("uses the synthetic snapshot only when asked, never by itself", () => {
    expect(chooseDataSource({})).toEqual({ kind: "none" });
    expect(chooseDataSource({ DATA_SOURCE: "seed" })).toEqual({ kind: "seed" });
    expect(chooseDataSource({}, { seedFallback: true })).toEqual({ kind: "seed" });
    // A real source still wins when the fallback is allowed.
    expect(chooseDataSource(rest, { seedFallback: true }).kind).toBe("rest");
  });

  it("names the source without a key in it", () => {
    expect(describeDataSource(chooseDataSource(rest))).toBe("Supabase REST (abc.supabase.co)");
    expect(describeDataSource(chooseDataSource(rest))).not.toContain("anon");
  });
});

describe("assertReleaseData", () => {
  const sets = [
    { city: "bangalore", synthetic: true },
    { city: "chennai", synthetic: false },
  ];

  it("lets an ordinary build use synthetic data", () => {
    expect(assertReleaseData({}, sets)).toBeNull();
  });

  it("refuses synthetic data in a release build and names the cities", () => {
    expect(assertReleaseData({ RELEASE_BUILD: "1" }, sets)).toMatch(/refuses synthetic.*bangalore/);
    expect(assertReleaseData({ RELEASE_BUILD: "1" }, [{ city: "chennai", synthetic: false }])).toBeNull();
  });
});

describe("snapshotIsSynthetic", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
  const company = (n: number) => ({
    id: id(n), slug: `c-${n}`, name: `C ${n}`, logo_key: null, description: null, website_url: `https://c${n}.example`,
    careers_url: null, startup_stage: null, ownership_status: null, last_verified_at: null, types: [], sectors: [], founders: [],
  });
  const make = (companies: number, synthetic: number): CitySnapshot =>
    citySnapshotSchema.parse({
      version: 1,
      city: {
        slug: "chennai", name: "Chennai", aliases: [], status: "beta", centre: [80.27, 13.08], default_zoom: 11, data_version: 1,
        boundary: { type: "MultiPolygon", coordinates: [[[[80, 12], [81, 12], [81, 13], [80, 13], [80, 12]]]] },
      },
      synthetic_companies: synthetic,
  slug_redirects: [],
      neighbourhoods: [], tech_parks: [], sectors: [],
      companies: Array.from({ length: companies }, (_, i) => company(i + 1)),
      offices: [], jobs: [],
    });

  it("is true only when every company is synthetic", () => {
    expect(snapshotIsSynthetic(make(3, 3))).toBe(true);
    expect(snapshotIsSynthetic(make(3, 0))).toBe(false);
    expect(snapshotIsSynthetic(make(0, 0))).toBe(false);
  });

  it("refuses a mix of real and synthetic companies", () => {
    expect(() => snapshotIsSynthetic(make(3, 1))).toThrow(/must not be mixed/);
    expect(() => splitSnapshot(make(3, 2))).toThrow(/must not be mixed/);
  });

  it("puts the flag in companies.json", () => {
    expect(splitSnapshot(make(2, 2)).companies.synthetic).toBe(true);
    expect(splitSnapshot(make(2, 0)).companies.synthetic).toBe(false);
  });

  it("rejects a boundary that is not a MultiPolygon with closed-looking rings", () => {
    const bad = structuredClone(make(1, 1)) as unknown as { city: { boundary: unknown } };
    bad.city.boundary = { type: "Point", coordinates: [80, 13] };
    expect(citySnapshotSchema.safeParse(bad).success).toBe(false);
  });
});
