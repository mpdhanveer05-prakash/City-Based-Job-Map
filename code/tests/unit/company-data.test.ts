import { describe, expect, it } from "vitest";
import { buildCompanyPages } from "@/lib/data/company-data";
import type { CityFiles } from "@/lib/data/city-data";
import { citySnapshotSchema, splitSnapshot, type CitySnapshot } from "@/lib/filters/dataset";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const boundary = { type: "MultiPolygon", coordinates: [[[[77, 12], [78, 12], [78, 13], [77, 13], [77, 12]]]] };

type Spec = {
  slug: string;
  name: string;
  companies: Array<{ n: number; slug: string; name: string; website?: string; types?: string[]; stage?: string | null }>;
  offices: Array<{ n: number; company: number; address: string; hood: string | null }>;
  jobs: Array<{ n: number; company: number; title: string; url: string; status?: "active" | "suspect"; checked?: string | null }>;
};

function city(spec: Spec): CityFiles {
  const snapshot: CitySnapshot = citySnapshotSchema.parse({
    version: 1,
    city: { slug: spec.slug, name: spec.name, aliases: [], status: "beta", centre: [77.5, 12.5], default_zoom: 11, data_version: 1, boundary },
    synthetic_companies: spec.companies.length,
    slug_redirects: [],
    neighbourhoods: [{ slug: "indiranagar", name: "Indiranagar" }, { slug: "adyar", name: "Adyar" }],
    tech_parks: [],
    sectors: [{ slug: "fintech", name: "Fintech" }],
    companies: spec.companies.map((c) => ({
      id: id(c.n), slug: c.slug, name: c.name, logo_key: null, description: `About ${c.name}`,
      website_url: c.website ?? `https://${c.slug}.example`, careers_url: `https://${c.slug}.example/careers`,
      startup_stage: c.stage ?? null, ownership_status: null, last_verified_at: null, types: c.types ?? ["startup"], sectors: ["fintech"], founders: [],
    })),
    offices: spec.offices.map((o) => ({
      id: id(o.n), company_id: id(o.company), lng: 77.5, lat: 12.5, accuracy: "building", address: o.address, neighbourhood: o.hood, tech_park: null,
    })),
    jobs: spec.jobs.map((j) => ({ id: id(j.n), company_id: id(j.company), title: j.title, apply_url: j.url, status: j.status ?? "active", last_checked_at: j.checked ?? null })),
  });
  const files = splitSnapshot(snapshot);
  return { slug: spec.slug as CityFiles["slug"], dataVersion: 1, synthetic: true, ...files };
}

const bangalore = city({
  slug: "bangalore",
  name: "Bengaluru",
  companies: [
    { n: 1, slug: "alpha", name: "Alpha", types: ["startup", "product"], stage: "series_a" },
    { n: 2, slug: "beta", name: "Beta", types: ["mnc"] },
  ],
  offices: [
    { n: 11, company: 1, address: "1 Alpha Road", hood: "indiranagar" },
    { n: 12, company: 2, address: "2 Beta Road", hood: null },
  ],
  jobs: [
    { n: 21, company: 1, title: "Zeta Engineer", url: "https://alpha.example/careers/z", checked: "2026-10-01T00:00:00Z" },
    { n: 22, company: 1, title: "Alpha Engineer", url: "https://boards.greenhouse.io/alpha/1", status: "suspect" },
  ],
});
const chennai = city({
  slug: "chennai",
  name: "Chennai",
  companies: [{ n: 1, slug: "alpha", name: "Alpha", types: ["startup", "product"], stage: "series_a" }],
  offices: [{ n: 13, company: 1, address: "3 Alpha Marg", hood: "adyar" }],
  jobs: [{ n: 21, company: 1, title: "Zeta Engineer", url: "https://alpha.example/careers/z", checked: "2026-10-01T00:00:00Z" }],
});

describe("buildCompanyPages", () => {
  const pages = buildCompanyPages([bangalore, chennai]);

  it("makes one page per company, merging a company that is in two cities", () => {
    expect([...pages.keys()].sort()).toEqual(["alpha", "beta"]);
    const alpha = pages.get("alpha")!;
    expect(alpha.cities.map((c) => c.slug)).toEqual(["bangalore", "chennai"]);
    expect(alpha.offices.map((o) => [o.citySlug, o.area, o.address])).toEqual([
      ["bangalore", "Indiranagar", "1 Alpha Road"],
      ["chennai", "Adyar", "3 Alpha Marg"],
    ]);
  });

  it("lists each job once, in title order, whichever city listed it", () => {
    expect(pages.get("alpha")!.jobs.map((j) => j.title)).toEqual(["Alpha Engineer", "Zeta Engineer"]);
    expect(pages.get("beta")!.jobs).toEqual([]);
  });

  it("keeps the facts of the data and nothing else", () => {
    const alpha = pages.get("alpha")!;
    expect(alpha).toMatchObject({ name: "Alpha", types: ["startup", "product"], stage: "series_a", sectors: ["Fintech"], lastVerifiedAt: null, websiteUrl: "https://alpha.example", synthetic: true });
    expect(alpha.jobs.find((j) => j.title === "Alpha Engineer")).toMatchObject({ status: "suspect", lastCheckedAt: null });
    expect(pages.get("beta")!.offices[0].area).toBeNull();
  });

  it("fails the build, naming each problem, when an outbound link is not the company's or an ATS host", () => {
    const bad = city({
      slug: "bangalore",
      name: "Bengaluru",
      companies: [{ n: 1, slug: "alpha", name: "Alpha" }, { n: 2, slug: "beta", name: "Beta", website: "https://203.0.113.9/" }],
      offices: [],
      jobs: [{ n: 21, company: 1, title: "Phish", url: "https://phish.test/apply" }],
    });
    expect(() => buildCompanyPages([bad])).toThrow(/3 outbound link\(s\) failed the check/);
    expect(() => buildCompanyPages([bad])).toThrow(/alpha: apply link of job .* phish\.test/);
    // (An http URL never gets this far: the snapshot schema already refuses it.)
    expect(() => buildCompanyPages([bad])).toThrow(/beta: website must be a named host/);
  });

  it("fails when a company has no entry in details.json", () => {
    const broken = structuredClone(bangalore);
    delete broken.details.companies[id(1)];
    expect(() => buildCompanyPages([broken])).toThrow(/alpha has no entry in details.json/);
  });
});
