// ADR-0025: one build publishes one snapshot per city, and every surface reads that snapshot. The explorer page names the
// same content-versioned folder as current.json and the manifest; the company and jobs pages were prerendered from the
// same folder's files. (Map, Grid and List agreeing over a filter matrix is tests/e2e/explorer-filters.spec.ts.)
import { expect, test } from "@playwright/test";

const CITIES = ["bangalore", "chennai"] as const;

type Companies = { companies: Array<{ id: string; slug: string; name: string }> };
type Details = { companies: Record<string, unknown>; jobs: Array<{ id: string; company_id: string; status: string }> };

test.skip(({ isMobile }) => isMobile, "HTTP-only checks; one project is enough");

test("each city's explorer, pointer and manifest name the same content-versioned snapshot", async ({ request }) => {
  const manifest = (await (await request.get("/data/manifest.json")).json()) as { cities: Record<string, { dataset_version: string }> };
  for (const city of CITIES) {
    const pointer = (await (await request.get(`/data/${city}/current.json`)).json()) as { dataset_version: string };
    expect(pointer.dataset_version).toMatch(/^\d+-[0-9a-f]{12}$/);
    expect(manifest.cities[city].dataset_version).toBe(pointer.dataset_version);
    const html = await (await request.get(`/${city}/`)).text();
    expect(html, `the ${city} page loads that folder`).toContain(`/data/${city}/${pointer.dataset_version}/companies.json`);
    const otherVersions = [...html.matchAll(new RegExp(`/data/${city}/(\d+-[0-9a-f]{12})/`, "g"))].map((m) => m[1]).filter((v) => v !== pointer.dataset_version);
    expect(otherVersions, "and no other version").toEqual([]);
  }
});

test("company and jobs pages show what the published snapshot holds", async ({ request }) => {
  const byCity = new Map<string, { companies: Companies; details: Details }>();
  for (const city of CITIES) {
    const { dataset_version: v } = (await (await request.get(`/data/${city}/current.json`)).json()) as { dataset_version: string };
    byCity.set(city, {
      companies: (await (await request.get(`/data/${city}/${v}/companies.json`)).json()) as Companies,
      details: (await (await request.get(`/data/${city}/${v}/details.json`)).json()) as Details,
    });
  }
  const listedJobs = (companyId: string) =>
    new Set([...byCity.values()].flatMap((c) => c.details.jobs.filter((j) => j.company_id === companyId && (j.status === "active" || j.status === "suspect")).map((j) => j.id)));
  for (const [city, data] of byCity) {
    for (const company of data.companies.companies.slice(0, 6)) {
      const page = await (await request.get(`/companies/${company.slug}/`)).text();
      expect(page, `${city}: ${company.slug} page shows its name`).toContain(`data-testid="company-name"`);
      expect(page).toContain(company.name.replace(/&/g, "&amp;"));
      const jobsPage = await (await request.get(`/companies/${company.slug}/jobs/`)).text();
      const rows = (jobsPage.match(/data-testid="job-row"/g) ?? []).length;
      expect(rows, `${company.slug}: the jobs page lists the snapshot's open jobs`).toBe(listedJobs(company.id).size);
    }
  }
});
