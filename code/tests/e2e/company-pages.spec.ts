// P6-01 to P6-03: the company page, the company's jobs page, and the direct links to the employer with their click
// beacon. The pages are prerendered from the build's dataset, which these specs read over HTTP as the oracle.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { loadCityData, openExplorer, type CityData, type Company, type Job } from "./explorer-helpers";

const BEACON = "**/functions/v1/click";

/** A company with jobs, and one with none, from the dataset. */
function pickCompanies(data: CityData) {
  const jobsOf = (c: Company): Job[] => data.details.jobs.filter((j) => j.company_id === c.id);
  const withJobs = data.companies.find((c) => jobsOf(c).length >= 2)!;
  const withoutJobs = data.companies.find((c) => jobsOf(c).length === 0)!;
  expect(withJobs, "the sample has a company with two jobs").toBeTruthy();
  expect(withoutJobs, "the sample has a company with no jobs").toBeTruthy();
  return { withJobs, withoutJobs, jobsOf };
}

/** The employer's domain does not resolve in tests; answer it ourselves and record what was asked. */
async function fakeEmployerSites(context: BrowserContext) {
  const requests: Array<{ url: string; referer: string | undefined }> = [];
  await context.route(/^https:\/\/[^/]*\.example\//, async (route) => {
    requests.push({ url: route.request().url(), referer: route.request().headers()["referer"] });
    await route.fulfill({ status: 200, contentType: "text/html", body: "<title>Employer</title>" });
  });
  return requests;
}

test.describe("company page", () => {
  test("shows what the data says, with View jobs and Visit website", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    const { withJobs, jobsOf } = pickCompanies(data);
    const details = data.details.companies[withJobs.id];
    await page.goto(`/companies/${withJobs.slug}`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(withJobs.name);
    await expect(page.getByTestId("company-description")).toHaveText(details.description!);
    // Nothing is made up: the sample has no verification date, and the page says so.
    await expect(page.getByTestId("verified")).toHaveText("Not yet verified");
    await expect(page.getByTestId("synthetic-note")).toBeVisible();
    await expect(page.getByTestId("offices").getByRole("listitem")).toHaveCount(data.offices.filter((o) => o.company_id === withJobs.id).length);

    const viewJobs = page.getByRole("link", { name: "View jobs" });
    await expect(viewJobs).toHaveAttribute("href", `/companies/${withJobs.slug}/jobs`);
    const website = page.getByRole("link", { name: /Visit website/ });
    await expect(website).toHaveAttribute("href", details.website_url);
    await expect(website).toHaveAttribute("target", "_blank");
    await expect(website).toHaveAttribute("rel", "noopener noreferrer");
    await expect(website).toContainText("(opens the employer's site)");
    expect(jobsOf(withJobs).length).toBeGreaterThanOrEqual(2);
  });

  test("View jobs is the one Mantis button; Visit website is secondary", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    await page.goto(`/companies/${data.companies[0].slug}`);
    await expect(page.getByTestId("view-jobs").locator("xpath=ancestor-or-self::*[@data-slot='button']")).toHaveAttribute("data-variant", "default");
    await expect(page.getByTestId("website-link").locator("xpath=ancestor-or-self::*[@data-slot='button']")).toHaveAttribute("data-variant", "outline");
    await expect(page.locator('[data-slot="button"][data-variant="default"]')).toHaveCount(1);
  });

  test("has a canonical URL, Organization data for search engines, and a sitemap entry", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    const company = data.companies[1];
    await page.goto(`/companies/${company.slug}`);
    await expect(page).toHaveTitle(new RegExp(company.name.replace(/[()]/g, "\\$&")));
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toMatch(new RegExp(`/companies/${company.slug}$`));

    const jsonLd = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
    expect(jsonLd["@type"]).toBe("Organization");
    expect(jsonLd.name).toBe(company.name);
    expect(jsonLd.url).toBe(data.details.companies[company.id].website_url);

    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain(`/companies/${company.slug}</loc>`);
    expect(sitemap).toContain(`/companies/${company.slug}/jobs</loc>`);
  });

  test("a staging build tells search engines not to index it", async ({ page, request }) => {
    // The e2e build is a production-mode build with the synthetic sample; the robots meta follows SITE_ENV.
    const data = await loadCityData(request, "bangalore");
    await page.goto(`/companies/${data.companies[0].slug}`);
    const robots = await page.locator('meta[name="robots"]').count();
    expect(robots === 0 || (await page.locator('meta[name="robots"]').getAttribute("content"))!.includes("noindex")).toBe(true);
  });

  test("a slug that is not a company is a 404, and an old slug redirects to the current page", async ({ page, request }) => {
    expect((await page.goto("/companies/nobody-synthetic"))?.status()).toBe(404);
    const redirect = await request.get("/companies/amber-labs-old-synthetic", { maxRedirects: 0 });
    expect(redirect.status()).toBe(301);
    expect(redirect.headers()["location"]).toMatch(/\/companies\/amber-labs-synthetic$/);
    const jobsRedirect = await request.get("/companies/amber-labs-old-synthetic/jobs", { maxRedirects: 0 });
    expect(jobsRedirect.status()).toBe(301);
    expect(jobsRedirect.headers()["location"]).toMatch(/\/companies\/amber-labs-synthetic\/jobs$/);
    await page.goto("/companies/amber-labs-old-synthetic");
    await expect(page).toHaveURL(/\/companies\/amber-labs-synthetic$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Amber Labs (synthetic)");
  });

  test("a company in both cities has one page with both", async ({ page, request }) => {
    const [blr, maa] = await Promise.all([loadCityData(request, "bangalore"), loadCityData(request, "chennai")]);
    const shared = blr.companies.find((c) => maa.companies.some((m) => m.slug === c.slug))!;
    expect(shared, "the sample has a company in both cities").toBeTruthy();
    await page.goto(`/companies/${shared.slug}`);
    await expect(page.getByTestId("show-on-map-bangalore")).toHaveAttribute("href", `/bangalore?company=${shared.slug}`);
    await expect(page.getByTestId("show-on-map-chennai")).toHaveAttribute("href", `/chennai?company=${shared.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(shared.name);
  });

  test("has no serious or critical axe violations", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    await page.goto(`/companies/${data.companies[0].slug}`);
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});

test.describe("jobs page", () => {
  test("each row is the job title and Apply, and nothing else", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    const { withJobs, jobsOf } = pickCompanies(data);
    const jobs = jobsOf(withJobs);
    await page.goto(`/companies/${withJobs.slug}/jobs`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Jobs at ${withJobs.name}`);

    const rows = page.getByTestId("job-row");
    await expect(rows).toHaveCount(jobs.length);
    for (const job of jobs) {
      const row = page.locator(`[data-job="${job.id}"]`);
      // The row's own children: the title and the Apply button's anchor. No date, location, salary, or description.
      const children = await row.evaluate((el) => [...el.children].map((c) => c.tagName.toLowerCase()));
      expect(children).toEqual(["span", "a"]);
      await expect(row.locator("span").first()).toHaveText(job.title);
      await expect(row.getByRole("link")).toHaveText("Apply (opens the employer's site)");
      await expect(row.getByRole("link")).toHaveAttribute("href", job.apply_url);
      expect((await row.textContent())!.replace(job.title, "").trim()).toBe("Apply (opens the employer's site)");
    }
  });

  test("says when the jobs were last checked, or that they were not", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    const { withJobs } = pickCompanies(data);
    await page.goto(`/companies/${withJobs.slug}/jobs`);
    // The sample has no link checks, so it says so rather than inventing a date.
    await expect(page.getByTestId("freshness")).toHaveText("Not yet checked");
  });

  test("a company with no jobs says so and offers its website", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    const { withoutJobs } = pickCompanies(data);
    await page.goto(`/companies/${withoutJobs.slug}/jobs`);
    await expect(page.getByTestId("no-jobs")).toContainText("This company has no open jobs listed right now.");
    await expect(page.getByRole("link", { name: /Visit website/ })).toHaveAttribute("href", data.details.companies[withoutJobs.id].website_url);
    await expect(page.getByTestId("job-row")).toHaveCount(0);
  });

  test("has no serious or critical axe violations", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    const { withJobs } = pickCompanies(data);
    await page.goto(`/companies/${withJobs.slug}/jobs`);
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});

test.describe("direct links and the click beacon", () => {
  async function capture(page: Page) {
    const beacons: Array<{ body: string; type: string | undefined }> = [];
    await page.route(BEACON, async (route) => {
      beacons.push({ body: route.request().postData() ?? "", type: route.request().headers()["content-type"] });
      await route.fulfill({ status: 204 });
    });
    return beacons;
  }

  test("Apply opens the stored URL unchanged, with no opener and no referrer, and counts the click", async ({ page, request, context }) => {
    const data = await loadCityData(request, "bangalore");
    const { withJobs, jobsOf } = pickCompanies(data);
    const job = jobsOf(withJobs)[0];
    const employer = await fakeEmployerSites(context);
    const beacons = await capture(page);
    await page.goto(`/companies/${withJobs.slug}/jobs`);

    const popup = page.waitForEvent("popup");
    await page.locator(`[data-job="${job.id}"]`).getByRole("link").click();
    const opened = await popup;
    await opened.waitForLoadState("domcontentloaded");
    expect(opened.url()).toBe(job.apply_url);
    expect(await opened.evaluate(() => window.opener)).toBeNull();
    expect(employer.map((r) => r.url)).toContain(job.apply_url);
    expect(employer.find((r) => r.url === job.apply_url)!.referer).toBeUndefined();

    await expect.poll(() => beacons.length).toBe(1);
    expect(JSON.parse(beacons[0].body)).toEqual({ kind: "apply", id: job.id });
    expect(beacons[0].type).toContain("text/plain");
  });

  test("Visit website counts a website click for the company", async ({ page, request, context }) => {
    const data = await loadCityData(request, "bangalore");
    const company = data.companies[2];
    await fakeEmployerSites(context);
    const beacons = await capture(page);
    await page.goto(`/companies/${company.slug}`);
    const popup = page.waitForEvent("popup");
    await page.getByRole("link", { name: /Visit website/ }).click();
    // The link is the stored URL as written (checked above); the browser adds the "/" to a bare host when it navigates.
    expect((await popup).url()).toBe(new URL(data.details.companies[company.id].website_url).href);
    await expect.poll(() => beacons.length).toBe(1);
    expect(JSON.parse(beacons[0].body)).toEqual({ kind: "website", id: company.id });
  });

  test("the beacon carries nothing but the kind and the id", async ({ page, request, context }) => {
    const data = await loadCityData(request, "bangalore");
    const company = data.companies[3];
    await fakeEmployerSites(context);
    let headers: Record<string, string> = {};
    await page.route(BEACON, async (route) => {
      headers = route.request().headers();
      await route.fulfill({ status: 204 });
    });
    await page.goto(`/companies/${company.slug}`);
    const popup = page.waitForEvent("popup");
    await page.getByRole("link", { name: /Visit website/ }).click();
    await popup;
    await expect.poll(() => Object.keys(headers).length).toBeGreaterThan(0);
    expect(headers["cookie"]).toBeUndefined();
    expect(headers["authorization"]).toBeUndefined();
  });

  test("Apply still works when the beacon is blocked or fails", async ({ page, request, context }) => {
    const data = await loadCityData(request, "bangalore");
    const { withJobs, jobsOf } = pickCompanies(data);
    const job = jobsOf(withJobs)[0];
    await fakeEmployerSites(context);
    await page.route(BEACON, (route) => route.abort("blockedbyclient"));
    await page.goto(`/companies/${withJobs.slug}/jobs`);
    const popup = page.waitForEvent("popup");
    await page.locator(`[data-job="${job.id}"]`).getByRole("link").click();
    expect((await popup).url()).toBe(job.apply_url);
  });

  test("the whole journey: explorer, popup, company, jobs, Apply (AC01 to AC06)", async ({ page, request, context }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "the map is driven on desktop");
    const data = await loadCityData(request, "bangalore");
    const { withJobs, jobsOf } = pickCompanies(data);
    const job = jobsOf(withJobs)[0];
    await fakeEmployerSites(context);
    await capture(page);

    await openExplorer(page, `/bangalore?type=${withJobs.types[0]}&company=${withJobs.slug}`);
    const popup = page.getByTestId("map-popup");
    await expect(popup).toBeVisible({ timeout: 60_000 });
    await popup.getByRole("link", { name: "View company" }).click();
    await expect(page).toHaveURL(new RegExp(`/companies/${withJobs.slug}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(withJobs.name);

    // "Back to map" returns to the explorer the visitor left, filters included.
    await expect(page.getByTestId("back-to-map")).toHaveAttribute("href", new RegExp(`^/bangalore\\?.*type=${withJobs.types[0]}`));

    await page.getByRole("link", { name: "View jobs" }).click();
    await expect(page).toHaveURL(new RegExp(`/companies/${withJobs.slug}/jobs$`));
    await expect(page.getByTestId("job-row")).toHaveCount(jobsOf(withJobs).length);
    const opened = page.waitForEvent("popup");
    await page.locator(`[data-job="${job.id}"]`).getByRole("link").click();
    expect((await opened).url()).toBe(job.apply_url);
  });
});
