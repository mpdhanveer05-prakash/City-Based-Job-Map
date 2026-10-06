// Build-time company pages data (P6-01 to P6-03): one record per company, merged across the cities it has offices
// in, with every outbound link checked. Server Components call this while `next build` prerenders; nothing here
// runs for a visitor. Not for client code: it reads the datasets with node:fs.
import { checkCompanyLinks } from "../links.ts";
import type { Ref, SnapshotJob } from "../filters/dataset.ts";
import type { CompanyType, OwnershipStatus, StartupStage } from "../filters/schema.ts";
import { loadAllCities, type CityFiles } from "./city-data.ts";

export type CompanyOffice = {
  id: string;
  citySlug: string;
  cityName: string;
  address: string;
  /** The neighbourhood or tech park name, when the office has one. */
  area: string | null;
  accuracy: string;
};

export type CompanyPageData = {
  id: string;
  slug: string;
  name: string;
  logoKey: string | null;
  types: CompanyType[];
  stage: StartupStage | null;
  ownershipStatus: OwnershipStatus | null;
  sectors: string[];
  description: string | null;
  websiteUrl: string;
  careersUrl: string | null;
  lastVerifiedAt: string | null;
  /** The cities it has offices in, in launch order. */
  cities: Array<{ slug: string; name: string }>;
  offices: CompanyOffice[];
  /** Active and suspect jobs listed in any of its cities, each once, in title order. */
  jobs: Array<{ id: string; title: string; applyUrl: string; status: SnapshotJob["status"]; lastCheckedAt: string | null }>;
  synthetic: boolean;
};

const names = (refs: readonly Ref[]) => new Map(refs.map((r) => [r.slug, r.name]));

/** Builds every company page's data from the datasets, and throws if any outbound link fails the check (P6-03). */
export function buildCompanyPages(cities: readonly CityFiles[]): Map<string, CompanyPageData> {
  const pages = new Map<string, CompanyPageData>();

  for (const city of cities) {
    const file = city.companies;
    const cityRef = { slug: city.slug, name: file.city.name };
    const hoodNames = names(file.neighbourhoods);
    const parkNames = names(file.tech_parks);
    const sectorNames = names(file.sectors);
    const officesByCompany = new Map<string, typeof city.offices.offices>();
    for (const o of city.offices.offices) officesByCompany.set(o.company_id, [...(officesByCompany.get(o.company_id) ?? []), o]);

    for (const c of file.companies) {
      const details = city.details.companies[c.id];
      if (!details) throw new Error(`${city.slug}: company ${c.slug} has no entry in details.json`);
      let page = pages.get(c.slug);
      if (!page) {
        page = {
          id: c.id,
          slug: c.slug,
          name: c.name,
          logoKey: c.logo_key,
          types: c.types,
          stage: c.startup_stage,
          ownershipStatus: c.ownership_status,
          sectors: c.sectors.map((s) => sectorNames.get(s) ?? s),
          description: details.description,
          websiteUrl: details.website_url,
          careersUrl: details.careers_url,
          lastVerifiedAt: details.last_verified_at,
          cities: [],
          offices: [],
          jobs: [],
          synthetic: city.synthetic,
        };
        pages.set(c.slug, page);
      }
      if (!page.cities.some((x) => x.slug === city.slug)) page.cities.push(cityRef);
      for (const o of officesByCompany.get(c.id) ?? []) {
        page.offices.push({
          id: o.id,
          citySlug: city.slug,
          cityName: file.city.name,
          address: o.address,
          area: (o.neighbourhood && hoodNames.get(o.neighbourhood)) || (o.tech_park && parkNames.get(o.tech_park)) || null,
          accuracy: o.accuracy,
        });
      }
    }

    const companyById = new Map(file.companies.map((c) => [c.id, c]));
    for (const j of city.details.jobs) {
      const company = companyById.get(j.company_id);
      const page = company && pages.get(company.slug);
      if (!page || page.jobs.some((x) => x.id === j.id)) continue;
      page.jobs.push({ id: j.id, title: j.title, applyUrl: j.apply_url, status: j.status, lastCheckedAt: j.last_checked_at });
    }
  }

  const problems = [];
  for (const page of pages.values()) {
    page.jobs.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    page.offices.sort((a, b) => a.citySlug.localeCompare(b.citySlug) || a.id.localeCompare(b.id));
    problems.push(...checkCompanyLinks({ slug: page.slug, websiteUrl: page.websiteUrl, careersUrl: page.careersUrl, jobs: page.jobs.map((j) => ({ id: j.id, applyUrl: j.applyUrl })) }));
  }
  if (problems.length > 0) {
    const shown = problems.slice(0, 20).map((p) => `  ${p.reason} (${p.url})`);
    const more = problems.length > shown.length ? `\n  ...and ${problems.length - shown.length} more` : "";
    throw new Error(`${problems.length} outbound link(s) failed the check, so the build stops (docs/security.md):\n${shown.join("\n")}${more}`);
  }
  return pages;
}

let cache: Map<string, CompanyPageData> | undefined;

export function loadCompanyPages(): Map<string, CompanyPageData> {
  cache ??= buildCompanyPages(loadAllCities());
  return cache;
}
