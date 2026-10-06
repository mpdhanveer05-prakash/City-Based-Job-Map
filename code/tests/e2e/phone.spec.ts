// The public journey on the phone profile (Pixel 7: touch, 2.6x DPR, 412 px wide), before release. The desktop specs
// drive the map with a mouse and the filters through the toolbar's panels; here everything is a tap, the popup is a
// bottom sheet, and the filters live in the Filters sheet. Emulated Chromium complements, and does not replace, the
// real-device map gate (P2-09, D-06).
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import {
  drawnNow,
  expectedSlugs,
  goTo,
  loadCityData,
  mapCounts,
  officeCountFor,
  openExplorer,
  pushUrl,
  rowSlugs,
  settle,
  shownCounts,
  type CityData,
  type Selection,
} from "./explorer-helpers";

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the phone journey; desktop has its own specs");
});

const CITIES = [
  { slug: "bangalore", name: "Bengaluru" },
  { slug: "chennai", name: "Chennai" },
] as const;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// An option's accessible name reads "Seed, 3 companies": the label ends at the first character that is not a letter.
const option = (scope: Locator, label: string) => scope.getByLabel(new RegExp(`^${escapeRe(label)}(\\W|$)`));

function metres(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** An office of a one-office company with nothing else within 300 m: at zoom 17 it is drawn as its own logo. */
function isolatedOffice(data: CityData) {
  const perCompany = new Map<string, number>();
  for (const o of data.offices) perCompany.set(o.company_id, (perCompany.get(o.company_id) ?? 0) + 1);
  const index = data.offices.findIndex((o) => perCompany.get(o.company_id) === 1 && data.offices.every((x) => x === o || metres(o, x) > 300));
  expect(index, "the sample has an isolated office").toBeGreaterThanOrEqual(0);
  const office = data.offices[index];
  return { index, office, company: data.companies.find((c) => c.id === office.company_id)! };
}

/** The employer's site does not resolve in tests: answer it, so Apply opens a real page. */
async function fakeEmployerSites(context: BrowserContext) {
  await context.route(/^https:\/\/[^/]*\.example\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Employer</title>" }));
}

async function tapOnMap(page: Page, x: number, y: number) {
  const box = (await page.getByTestId("explorer-map").boundingBox())!;
  await page.touchscreen.tap(box.x + x, box.y + y);
}

/** Polls a control's height: a soft navigation can paint a frame before the page's styles. */
const heightOf = (locator: Locator) => async () => (await locator.boundingBox())?.height ?? 0;

for (const city of CITIES) {
  test.describe(`${city.name} on a phone`, () => {
    test("opens with the map, its counts, and markers", async ({ page, request }) => {
      const data = await loadCityData(request, city.slug);
      const errors = await openExplorer(page, `/${city.slug}`);
      await expect(page.getByRole("heading", { level: 1, name: city.name })).toBeVisible();
      expect(await shownCounts(page)).toEqual({ companies: data.companies.length, offices: data.offices.length });
      expect(await mapCounts(page)).toEqual({ offices: data.offices.length, companies: data.companies.length });
      expect((await drawnNow(page)).length).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });

    test("tapping a logo opens its bottom sheet and puts the company in the URL; Back closes it", async ({ page, request }) => {
      const data = await loadCityData(request, city.slug);
      const { index, office, company } = isolatedOffice(data);
      await openExplorer(page, `/${city.slug}`);
      await goTo(page, office.lng, office.lat, 17);
      const logo = (await drawnNow(page)).find((d) => d.key === `o:${index}`);
      expect(logo, "the office is drawn as its own logo at zoom 17").toBeTruthy();
      await tapOnMap(page, logo!.x, logo!.y);
      const popup = page.getByTestId("map-popup");
      await expect(popup).toBeVisible();
      await expect(popup).toHaveAttribute("data-layout", "sheet");
      await expect(popup.getByRole("heading", { name: company.name })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`company=${company.slug}`));
      // The sheet's controls are touch-sized.
      await expect.poll(heightOf(popup.getByRole("link", { name: "View company" })), { message: "View company is a 44 px target", timeout: 10_000 }).toBeGreaterThanOrEqual(44);
      await page.goBack();
      await expect(popup).toBeHidden();
      await expect(page).not.toHaveURL(/company=/);
    });

    test("the whole journey from a shared ?company= link: sheet, company, jobs, Apply (AC01 to AC06)", async ({ page, request, context }) => {
      const data = await loadCityData(request, city.slug);
      const jobsOf = (id: string) => data.details.jobs.filter((j) => j.company_id === id);
      const company = data.companies.find((c) => jobsOf(c.id).length > 0);
      expect(company, `${city.name} has a company with an open job`).toBeTruthy();
      const job = jobsOf(company!.id)[0];
      await fakeEmployerSites(context);

      await openExplorer(page, `/${city.slug}?company=${company!.slug}`);
      const popup = page.getByTestId("map-popup");
      await expect(popup).toBeVisible({ timeout: 60_000 });
      await expect(popup).toHaveAttribute("data-layout", "sheet");
      await popup.getByRole("link", { name: "View company" }).tap();
      await expect(page).toHaveURL(new RegExp(`/companies/${company!.slug}$`), { timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(company!.name);
      await page.getByRole("link", { name: "View jobs" }).tap();
      await expect(page).toHaveURL(new RegExp(`/companies/${company!.slug}/jobs$`), { timeout: 30_000 });
      await expect(page.getByTestId("job-row")).toHaveCount(jobsOf(company!.id).length);
      const apply = page.locator(`[data-job="${job.id}"]`).getByRole("link");
      await expect.poll(heightOf(apply), { message: "Apply is a 44 px target", timeout: 10_000 }).toBeGreaterThanOrEqual(44);
      const opened = page.waitForEvent("popup");
      await apply.tap();
      expect((await opened).url()).toBe(job.apply_url);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  });
}

test.describe("filters on a phone", () => {
  const FILTERS: Array<{ name: string; query: string; selection: Selection }> = [
    { name: "no filter", query: "", selection: {} },
    { name: "Startup", query: "type=startup", selection: { types: ["startup"] } },
    { name: "Startup + Seed", query: "type=startup&stage=seed", selection: { types: ["startup"], stages: ["seed"] } },
    { name: "MNC + Public", query: "type=mnc&status=public", selection: { types: ["mnc"], statuses: ["public"] } },
    { name: "Acquired", query: "status=acquired", selection: { statuses: ["acquired"] } },
    { name: "a search", query: "q=engineer", selection: { q: "engineer" } },
  ];

  for (const city of CITIES) {
    test(`${city.name}: Map, Grid, and List show the same companies and counts`, async ({ page, request }) => {
      test.setTimeout(240_000);
      const data = await loadCityData(request, city.slug);
      await openExplorer(page, `/${city.slug}`);
      for (const f of FILTERS) {
        await pushUrl(page, `/${city.slug}${f.query ? `?${f.query}` : ""}`);
        const expected = expectedSlugs(data, f.selection);
        const counts = { companies: expected.length, offices: officeCountFor(data, expected) };
        await expect.poll(() => shownCounts(page), { message: `${f.name}: toolbar`, timeout: 10_000 }).toEqual(counts);
        await expect.poll(() => mapCounts(page), { message: `${f.name}: map`, timeout: 15_000 }).toEqual(counts);
        await page.getByTestId("view-grid").tap();
        await expect.poll(() => rowSlugs(page), { message: `${f.name}: grid`, timeout: 10_000 }).toEqual(expected);
        await page.getByTestId("view-list").tap();
        await expect.poll(() => rowSlugs(page), { message: `${f.name}: list`, timeout: 10_000 }).toEqual(expected);
        await page.getByTestId("view-map").tap();
        await expect(page.getByTestId("explorer")).toHaveAttribute("data-view", "map");
        if (expected.length > 0) await settle(page);
      }
    });
  }

  test("type, stage, and ownership in the Filters sheet: the stage needs Startup, ownership does not", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    await openExplorer(page, "/bangalore?view=list", { map: false });
    const openSheet = async () => {
      await page.getByTestId("filters-sheet-open").tap();
      await expect(page.getByTestId("filters-sheet")).toBeVisible();
      return page.getByTestId("filters-sheet");
    };
    const closeSheet = async (sheet: Locator) => {
      await sheet.getByRole("button", { name: /^Show \d+ compan/ }).tap();
      await expect(sheet).toBeHidden();
    };
    const listIs = (selection: Selection) => expect.poll(() => rowSlugs(page), { timeout: 10_000 }).toEqual(expectedSlugs(data, selection));
    const showLabel = (n: number) => `Show ${n} ${n === 1 ? "company" : "companies"}`;

    let sheet = await openSheet();
    await expect(sheet.getByText("Choose Startup to filter by stage.")).toBeVisible();
    await expect(option(sheet, "Seed")).toBeDisabled();
    await option(sheet, "Startup").tap();
    await option(sheet, "Product").tap();
    await expect(option(sheet, "Seed")).toBeEnabled();
    await option(sheet, "Seed").tap();
    const both = { types: ["product", "startup"], stages: ["seed"] };
    await expect(sheet.getByRole("button", { name: showLabel(expectedSlugs(data, both).length) })).toBeVisible();
    await closeSheet(sheet);
    await listIs(both);
    await expect(page).toHaveURL(/stage=seed/);

    // Ownership status is its own group and works with any type.
    sheet = await openSheet();
    await option(sheet, "Private").tap();
    await closeSheet(sheet);
    await listIs({ ...both, statuses: ["private"] });
    await expect(page).toHaveURL(/status=private/);

    // Deselecting Startup clears the stage from the state and the URL, and keeps the ownership status.
    sheet = await openSheet();
    await option(sheet, "Startup").tap();
    await expect(option(sheet, "Seed")).toBeDisabled();
    await closeSheet(sheet);
    await expect(page).not.toHaveURL(/stage=/);
    await expect(page).toHaveURL(/status=private/);
    await listIs({ types: ["product"], statuses: ["private"] });
    await expect(page.getByTestId("filters-sheet-open")).toHaveAccessibleName("Filters, 2 selected");
  });

  test("an old link with stage=acquired becomes the ownership status on a phone too", async ({ page, request }) => {
    const data = await loadCityData(request, "chennai");
    await openExplorer(page, "/chennai?view=list&type=startup&stage=acquired", { map: false });
    await expect(page).not.toHaveURL(/stage=/);
    await expect(page).toHaveURL(/status=acquired/);
    await expect.poll(() => rowSlugs(page)).toEqual(expectedSlugs(data, { types: ["startup"], statuses: ["acquired"] }));
  });
});
