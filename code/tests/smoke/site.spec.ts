// The deployment smoke suite (DEP-3/4; playwright.smoke.config.ts). It asks the site what it holds (manifest.json, the
// dataset files, build-info.json) and checks that the pages show exactly that, and that the build is the one the deployment
// policy expects. Nothing here depends on the synthetic sample, so it suits a real-data staging or production site.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { Manifest } from "@/lib/filters/dataset-files";
import { REQUIRED, type BuildTarget } from "@/lib/build-features";

const target = process.env.EXPECT_DEPLOY_TARGET as BuildTarget | undefined;
if (!target || !(target in REQUIRED) || target === "local") {
  throw new Error("The smoke suite needs EXPECT_DEPLOY_TARGET: production, staging or staging-synthetic");
}
const synthetic = target === "staging-synthetic";
const desktopOnly = (isMobile: boolean) => test.skip(isMobile, "HTTP-level checks: one project is enough");

type CityFiles = {
  companies: { companies: Array<{ id: string; slug: string; name: string; open_jobs: number }> };
  offices: { offices: unknown[] };
  details: { companies: Record<string, { website_url: string }>; jobs: Array<{ id: string; company_id: string; apply_url: string }> };
};

async function manifest(request: APIRequestContext): Promise<Manifest> {
  const r = await request.get("/data/manifest.json");
  expect(r.status(), "manifest.json is served").toBe(200);
  return (await r.json()) as Manifest;
}

async function cityFiles(request: APIRequestContext, m: Manifest, city: string): Promise<CityFiles> {
  const entry = m.cities[city];
  const get = async (name: "companies" | "offices" | "details") => (await request.get(entry.files[name].path)).json();
  return { companies: await get("companies"), offices: await get("offices"), details: await get("details") };
}

/** Up to three companies spread over the list: the first, the middle and the last by slug. */
const sample = <T extends { slug: string }>(list: T[]): T[] => {
  const sorted = [...list].sort((a, b) => a.slug.localeCompare(b.slug));
  return [...new Set([sorted[0], sorted[Math.floor(sorted.length / 2)], sorted[sorted.length - 1]])].filter(Boolean);
};

// What a visitor sees. The raw HTML is not used: a real-data page's serialised props say `"synthetic": false`.
const visibleText = async (page: Page) => (await page.locator("body").innerText()).toLowerCase();
const sampleMarkers = (page: Page) => page.locator('[data-testid="sample-data-notice"], [data-testid="synthetic-note"]').count();

test("the build is the one the deployment policy expects", async ({ request, isMobile }) => {
  desktopOnly(isMobile);
  const r = await request.get("/build-info.json");
  expect(r.status(), "build-info.json is served").toBe(200);
  const info = (await r.json()) as { target: string; commit?: string; features: Record<string, boolean> };
  expect(info.target, "the build's target").toBe(target);
  for (const feature of REQUIRED[target]) expect(info.features[feature], `${feature} is required for ${target}`).toBe(true);
  if (process.env.EXPECT_COMMIT) expect(info.commit, "built from the expected commit").toBe(process.env.EXPECT_COMMIT);
});

test("every city's data is complete, consistent, and of the right kind for this deployment", async ({ request, isMobile }) => {
  desktopOnly(isMobile);
  const m = await manifest(request);
  expect(m.pilot_preview, "never a pilot preview build (simulated reviews)").toBeUndefined();
  expect(Object.keys(m.cities).length, "at least one city").toBeGreaterThan(0);
  for (const [city, entry] of Object.entries(m.cities)) {
    expect(entry.synthetic, `${city}: synthetic data ${synthetic ? "expected" : "refused"} for ${target}`).toBe(synthetic);
    if (target === "production") expect(entry.evidence_incomplete, `${city}: nothing published without its evidence`).toEqual({ companies: 0, jobs: 0 });
    const pointer = await request.get(`/data/${city}/current.json`);
    expect((await pointer.json()).dataset_version, `${city}: current.json names the manifest's folder`).toBe(entry.dataset_version);
    expect(pointer.headers()["cache-control"] ?? "", `${city}: current.json is always revalidated`).toContain("no-cache");
    for (const [name, file] of Object.entries(entry.files)) {
      const r = await request.get(file.path);
      expect(r.status(), `${city} ${name} is served`).toBe(200);
      expect((await r.body()).length, `${city} ${name} has the size the manifest says`).toBe(file.bytes);
      expect(r.headers()["cache-control"] ?? "", `${city} ${name} is immutable`).toContain("immutable");
    }
    const files = await cityFiles(request, m, city);
    expect(files.companies.companies.length, `${city}: companies`).toBe(entry.counts.companies);
    expect(files.offices.offices.length, `${city}: offices`).toBe(entry.counts.offices);
  }
});

test("the pages answer, carry their security policy, and are indexed only in production", async ({ page, request, isMobile }) => {
  desktopOnly(isMobile);
  const m = await manifest(request);
  const cities = Object.keys(m.cities);
  const first = cities.find((c) => m.cities[c].counts.companies > 0);
  const firstCompany = first ? (await cityFiles(request, m, first)).companies.companies[0] : undefined;
  const paths = ["/", ...cities.map((c) => `/${c}`), "/suggest", ...(firstCompany ? [`/companies/${firstCompany.slug}`, `/companies/${firstCompany.slug}/jobs`] : [])];
  for (const path of paths) {
    const response = await page.goto(path);
    expect(response?.status(), `${path} answers`).toBe(200);
    expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').count(), `${path} carries its CSP`).toBe(1);
    const robots = (await page.locator('meta[name="robots"]').getAttribute("content").catch(() => null)) ?? "";
    if (target === "production") expect(robots, `${path} may be indexed in production`).not.toContain("noindex");
    else expect(robots, `${path} is not indexed outside production`).toContain("noindex");
    expect(await page.getByTestId("pilot-preview-banner").count(), `${path} is not a pilot preview`).toBe(0);
    if (!synthetic) {
      expect(await sampleMarkers(page), `${path} shows no sample-data notice`).toBe(0);
      expect(await visibleText(page), `${path} says nothing about sample data`).not.toContain("synthetic");
    }
  }
  expect((await request.get("/this-page-does-not-exist")).status(), "an unknown path is a 404").toBe(404);
  expect((await request.get("/sitemap.xml")).status()).toBe(200);
  if (target === "production") expect((await request.get("/dev/tokens")).status(), "no /dev page in production").not.toBe(200);
});

test("each city's explorer shows every company and office the data holds", async ({ page, request }) => {
  const m = await manifest(request);
  for (const [city, entry] of Object.entries(m.cities)) {
    if (entry.counts.companies === 0) continue;
    await page.goto(`/${city}?view=list`);
    await expect(page.getByTestId("explorer")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    const text = (await page.getByTestId("result-count").textContent()) ?? "";
    const counts = /(\d+) compan(?:y|ies) in (\d+) offices?/.exec(text);
    expect(counts, `${city}: the toolbar shows counts ("${text}")`).not.toBeNull();
    expect(Number(counts![1]), `${city}: companies shown`).toBe(entry.counts.companies);
    expect(Number(counts![2]), `${city}: offices shown`).toBe(entry.counts.offices);
    if (synthetic) await expect(page.getByTestId("sample-data-notice")).toBeVisible();
  }
});

test("company and jobs pages show what the published data holds, with safe outbound links", async ({ page, request, isMobile }) => {
  desktopOnly(isMobile);
  const m = await manifest(request);
  for (const city of Object.keys(m.cities)) {
    const files = await cityFiles(request, m, city);
    for (const company of sample(files.companies.companies)) {
      await page.goto(`/companies/${company.slug}`);
      await expect(page.getByTestId("company-name")).toHaveText(company.name);
      const website = files.details.companies[company.id].website_url;
      const link = page.locator(`a[href="${website}"]`).first();
      await expect(link, `${company.slug}: Visit website goes to the published site`).toHaveCount(1);
      expect(website).toMatch(/^https:\/\//);
      expect(await link.getAttribute("rel")).toContain("noopener");
      const jobs = files.details.jobs.filter((j) => j.company_id === company.id);
      if (jobs.length === 0) continue;
      await page.goto(`/companies/${company.slug}/jobs`);
      await expect(page.getByTestId("job-row"), `${company.slug}: one row per published job`).toHaveCount(jobs.length);
      for (const job of jobs) {
        expect(job.apply_url).toMatch(/^https:\/\//);
        const apply = page.locator(`[data-job="${job.id}"] a`).first();
        expect(await apply.getAttribute("href")).toBe(job.apply_url);
        expect(await apply.getAttribute("rel")).toContain("noreferrer");
      }
    }
  }
});
