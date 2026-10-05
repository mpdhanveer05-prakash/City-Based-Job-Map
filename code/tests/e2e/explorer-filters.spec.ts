// P5-01 to P5-05: search, the type and stage filters, and the three views. The page is compared with an independent
// reading of the dataset (explorer-helpers.ts, `expectedSlugs`), and Map, Grid, and List must agree on every filter.
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  expectedSlugs,
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

const search = (page: Page) => page.getByTestId("explorer-search");

/** A checkbox by the start of its name ("Seed" must not match "Pre-seed"; the name also holds the count). */
const option = (scope: Locator, label: string) => scope.getByLabel(new RegExp("^" + label + "\\b"));

/** Types into the search box and waits for the URL (the search applies after a short pause). */
async function typeSearch(page: Page, text: string) {
  await search(page).fill(text);
  await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(text).replace(/%20/g, "(\\+|%20)")}`), { timeout: 10_000 });
}

async function expectList(page: Page, data: CityData, selection: Selection) {
  const expected = expectedSlugs(data, selection);
  await expect.poll(() => rowSlugs(page), { timeout: 10_000 }).toEqual(expected);
  expect(await shownCounts(page)).toEqual({ companies: expected.length, offices: officeCountFor(data, expected) });
}

test.describe("search", () => {
  test("by company name", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    await openExplorer(page, "/bangalore?view=list", { map: false });
    await typeSearch(page, "amber");
    await expectList(page, data, { q: "amber" });
    expect(expectedSlugs(data, { q: "amber" }).length).toBeGreaterThan(0);
  });

  test("by job title, once the job titles have loaded", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    await openExplorer(page, "/bangalore?view=list", { map: false });
    await typeSearch(page, "site reliability");
    await expectList(page, data, { q: "site reliability" });
    // A title nobody's name or address contains, so every hit comes from the job titles.
    expect(expectedSlugs(data, { q: "site reliability" }).length).toBeGreaterThan(0);
    for (const slug of expectedSlugs(data, { q: "site reliability" })) expect(slug).toBeTruthy();
  });

  test("by neighbourhood and by tech park", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    await openExplorer(page, "/bangalore?view=list", { map: false });
    await typeSearch(page, "koramangala");
    await expectList(page, data, { q: "koramangala" });
    await typeSearch(page, "tech village");
    await expectList(page, data, { q: "tech village" });
    expect(expectedSlugs(data, { q: "tech village" }).length).toBeGreaterThan(0);
  });

  test("every word must match: a title and a place together", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    await openExplorer(page, "/bangalore?view=list", { map: false });
    await typeSearch(page, "engineer koramangala");
    await expectList(page, data, { q: "engineer koramangala" });
    const both = expectedSlugs(data, { q: "engineer koramangala" }).length;
    expect(both).toBeLessThan(expectedSlugs(data, { q: "engineer" }).length);
  });

  test("an empty result says so and offers Clear filters", async ({ page }) => {
    await openExplorer(page, "/bangalore?view=list", { map: false });
    await typeSearch(page, "zzzzqq");
    await expect(page.getByTestId("no-results")).toContainText("No companies match these filters.");
    expect(await shownCounts(page)).toEqual({ companies: 0, offices: 0 });
    await page.getByTestId("no-results").getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByTestId("no-results")).toHaveCount(0);
    await expect(page).not.toHaveURL(/q=/);
    await expect(search(page)).toHaveValue("");
  });

  test("typing adds one history entry for the whole search, and Back leaves it", async ({ page }) => {
    await openExplorer(page, "/bangalore?view=list", { map: false });
    const before = await page.evaluate(() => history.length);
    await search(page).pressSequentially("amb", { delay: 60 });
    await expect(page).toHaveURL(/q=amb/);
    await page.waitForTimeout(400);
    await search(page).pressSequentially("er", { delay: 60 });
    await expect(page).toHaveURL(/q=amber/);
    expect(await page.evaluate(() => history.length)).toBe(before + 1);
    await page.goBack();
    await expect(page).not.toHaveURL(/q=/);
    await expect(search(page)).toHaveValue("");
  });

  test("suggestions: a neighbourhood becomes a filter, a company is selected", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    await openExplorer(page, "/bangalore?view=list", { map: false });
    await search(page).fill("koram");
    const listbox = page.getByRole("listbox", { name: "Suggestions" });
    await expect(listbox.getByRole("option", { name: /Koramangala/ })).toBeVisible();
    await search(page).press("ArrowDown");
    await search(page).press("Enter");
    await expect(page).toHaveURL(/hood=koramangala/);
    await expect(page).not.toHaveURL(/q=/);
    await expectList(page, data, { neighbourhoods: ["koramangala"] });

    const company = data.companies[0];
    await search(page).fill(company.name.slice(0, 8));
    await listbox.getByRole("option", { name: new RegExp(company.name.replace(/[()]/g, "\\$&")) }).first().click();
    await expect(page).toHaveURL(new RegExp(`company=${company.slug}`));
    // Choosing a company drops the filters that could hide it (the earlier neighbourhood).
    await expect(page).not.toHaveURL(/hood=/);
    await expect(page.locator(`[data-company="${company.slug}"]`)).toHaveAttribute("aria-current", "true");
  });
});

test.describe("company type and startup stage", () => {
  // These drive the filter panels of the desktop toolbar. On a phone the same filters are in a bottom sheet (see "phone").
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "the desktop filter panels");
  });

  test("Startup, MNC, and Product: OR within the group, a multi-tag company once", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    await openExplorer(page, "/bangalore?view=list", { map: false });

    await page.getByTestId("filter-types").click();
    const panel = page.getByTestId("filter-panel-types");
    await option(panel, "Startup").check();
    await expectList(page, data, { types: ["startup"] });
    await option(panel, "Product").check();
    await expectList(page, data, { types: ["startup", "product"] });
    await expect(page).toHaveURL(/type=product(,|%2C)startup|type=startup(,|%2C)product/);
    // Some company is both a Startup and a Product company; it is listed once.
    const both = data.companies.filter((c) => c.types.includes("startup") && c.types.includes("product"));
    expect(both.length).toBeGreaterThan(0);
    const slugs = await rowSlugs(page);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("the stage filter is off until Startup is selected, and deselecting Startup clears it from the state and the URL", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    await openExplorer(page, "/bangalore?view=list", { map: false });

    await page.getByTestId("filter-stages").click();
    const stagePanel = page.getByTestId("filter-panel-stages");
    await expect(stagePanel.getByText("Choose Startup to filter by stage.")).toBeVisible();
    await expect(option(stagePanel, "Seed")).toBeDisabled();
    await page.keyboard.press("Escape");

    await page.getByTestId("filter-types").click();
    await option(page.getByTestId("filter-panel-types"), "Startup").check();
    await page.keyboard.press("Escape");

    await page.getByTestId("filter-stages").click();
    await expect(option(stagePanel, "Seed")).toBeEnabled();
    await option(stagePanel, "Seed").check();
    await expectList(page, data, { types: ["startup"], stages: ["seed"] });
    await expect(page).toHaveURL(/stage=seed/);
    await page.keyboard.press("Escape");

    await page.getByTestId("filter-types").click();
    await option(page.getByTestId("filter-panel-types"), "Startup").uncheck();
    await expect(page).not.toHaveURL(/stage=/);
    await expect(page).not.toHaveURL(/type=/);
    await expectList(page, data, {});
    await page.keyboard.press("Escape");
    await page.getByTestId("filter-stages").click();
    await expect(option(stagePanel, "Seed")).not.toBeChecked();
  });

  test("a link with stages but no Startup is corrected when it loads", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    await openExplorer(page, "/bangalore?view=list&type=mnc&stage=seed", { map: false });
    await expect(page).not.toHaveURL(/stage=/);
    await expectList(page, data, { types: ["mnc"] });
    await openExplorer(page, "/bangalore?view=list&stage=seed&stage=acquired", { map: false });
    await expect(page).not.toHaveURL(/stage=/);
  });

  test("MNC + Startup + Seed shows every MNC company or the Seed startups", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    await openExplorer(page, "/bangalore?view=list&type=mnc,startup&stage=seed", { map: false });
    const selection = { types: ["mnc", "startup"], stages: ["seed"] };
    await expectList(page, data, selection);
    const slugs = await rowSlugs(page);
    const mnc = data.companies.filter((c) => c.types.includes("mnc")).map((c) => c.slug);
    for (const slug of mnc) expect(slugs).toContain(slug);
  });

  test("the option counts are what choosing that option alone would show", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    await openExplorer(page, "/bangalore?view=list", { map: false });
    await page.getByTestId("filter-types").click();
    for (const [value, label] of [["startup", "Startup"], ["mnc", "MNC"], ["product", "Product"]] as const) {
      const row = option(page.getByTestId("filter-panel-types"), label);
      const text = await row.locator("xpath=ancestor::label").textContent();
      expect(Number(/(\d+)\s*companies/.exec(text ?? "")?.[1])).toBe(expectedSlugs(data, { types: [value] }).length);
    }
  });

  test("filters work from the keyboard", async ({ page }) => {
    await openExplorer(page, "/bangalore?view=list", { map: false });
    await page.getByTestId("filter-types").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("filter-panel-types")).toBeVisible();
    // Radix puts focus on the first checkbox when the panel opens.
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/type=startup/);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("filter-panel-types")).toBeHidden();
  });

  test("Back and Forward step through filter changes", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    await openExplorer(page, "/bangalore?view=list", { map: false });
    await page.getByTestId("filter-types").click();
    await option(page.getByTestId("filter-panel-types"), "MNC").check();
    await expectList(page, data, { types: ["mnc"] });
    await page.keyboard.press("Escape");
    await page.goBack();
    await expectList(page, data, {});
    await page.goForward();
    await expectList(page, data, { types: ["mnc"] });
  });
});

test.describe("Map, Grid, and List agree", () => {
  const FILTERS: Array<{ name: string; url: string; selection: Selection }> = [
    { name: "no filter", url: "/bangalore", selection: {} },
    { name: "Startup", url: "/bangalore?type=startup", selection: { types: ["startup"] } },
    { name: "Startup + Seed", url: "/bangalore?type=startup&stage=seed", selection: { types: ["startup"], stages: ["seed"] } },
    { name: "MNC + Startup + Seed", url: "/bangalore?type=mnc,startup&stage=seed", selection: { types: ["mnc", "startup"], stages: ["seed"] } },
    { name: "Product", url: "/bangalore?type=product", selection: { types: ["product"] } },
    { name: "a neighbourhood", url: "/bangalore?hood=koramangala", selection: { neighbourhoods: ["koramangala"] } },
    { name: "a search", url: "/bangalore?q=engineer", selection: { q: "engineer" } },
    { name: "a search and a type", url: "/bangalore?q=engineer&type=startup", selection: { q: "engineer", types: ["startup"] } },
    { name: "nothing matches", url: "/bangalore?q=zzzzqq", selection: { q: "zzzzqq" } },
  ];

  test("the same companies and counts in every view, for a matrix of filters", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "the map is checked on desktop");
    test.setTimeout(240_000);
    const data = await loadCityData(request, "bangalore");
    await openExplorer(page, "/bangalore");
    for (const f of FILTERS) {
      await pushUrl(page, f.url);
      const expected = expectedSlugs(data, f.selection);
      const counts = { companies: expected.length, offices: officeCountFor(data, expected) };
      await expect.poll(() => shownCounts(page), { message: `${f.name}: toolbar`, timeout: 10_000 }).toEqual(counts);

      // Map: the worker was given exactly these offices and companies.
      await expect.poll(() => mapCounts(page), { message: `${f.name}: map`, timeout: 15_000 }).toEqual(counts);

      await page.getByTestId("view-grid").click();
      await expect.poll(() => rowSlugs(page), { message: `${f.name}: grid`, timeout: 10_000 }).toEqual(expected);
      await page.getByTestId("view-list").click();
      await expect.poll(() => rowSlugs(page), { message: `${f.name}: list`, timeout: 10_000 }).toEqual(expected);
      expect(await shownCounts(page)).toEqual(counts);
      await page.getByTestId("view-map").click();
      await expect(page.getByTestId("explorer")).toHaveAttribute("data-view", "map");
      // With no results nothing is drawn, so there is nothing to settle.
      if (expected.length > 0) await settle(page);
      expect(await shownCounts(page), `${f.name}: toolbar after the round trip`).toEqual(counts);
    }
  });

  test("Show on map selects the company and opens its popup", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name === "mobile");
    const data = await loadCityData(request, "bangalore");
    const company = data.companies[3];
    await openExplorer(page, "/bangalore?view=list", { map: false });
    await page.getByTestId("company-row").and(page.locator(`[data-company="${company.slug}"]`)).getByTestId("show-on-map").click();
    await expect(page).toHaveURL(new RegExp(`company=${company.slug}`));
    await expect(page.getByTestId("explorer")).toHaveAttribute("data-view", "map");
    await expect(page.getByTestId("map-popup")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("map-popup").getByRole("heading", { name: company.name })).toBeVisible();
  });

  test("the selected company is marked in the list and the grid", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    const company = data.companies[5];
    await openExplorer(page, `/bangalore?view=list&company=${company.slug}`, { map: false });
    await expect(page.locator(`[data-company="${company.slug}"]`)).toHaveAttribute("aria-current", "true");
    await page.getByTestId("view-grid").click();
    await expect(page.locator(`[data-company="${company.slug}"]`)).toHaveAttribute("aria-current", "true");
  });

  test("each row has View company; the row's DOM holds what the data says", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    await openExplorer(page, "/bangalore?view=list", { map: false });
    const company = data.companies[0];
    const row = page.locator(`[data-company="${company.slug}"]`);
    await expect(row.getByRole("heading", { name: company.name })).toBeVisible();
    await expect(row.getByRole("link", { name: /View company/ })).toHaveAttribute("href", `/companies/${company.slug}`);
    await expect(row).toContainText(`${company.open_jobs} open job`);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("filters open in a bottom sheet, and Show N companies closes it", async ({ page, request }) => {
    const data = await loadCityData(request, "bangalore");
    await openExplorer(page, "/bangalore?view=list", { map: false });
    await expect(page.getByTestId("filter-types")).toBeHidden();
    await page.getByTestId("filters-sheet-open").click();
    const sheet = page.getByTestId("filters-sheet");
    await expect(sheet).toBeVisible();
    await option(sheet, "Startup").check();
    const expected = expectedSlugs(data, { types: ["startup"] });
    await expect(sheet.getByRole("button", { name: `Show ${expected.length} companies` })).toBeVisible();
    await sheet.getByRole("button", { name: /^Show \d+ compan/ }).click();
    await expect(sheet).toBeHidden();
    await expectList(page, data, { types: ["startup"] });
    await expect(page.getByTestId("filters-sheet-open")).toHaveAccessibleName("Filters, 1 selected");
  });

  test("the page does not scroll sideways", async ({ page }) => {
    await openExplorer(page, "/bangalore?view=list", { map: false });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("when the map cannot run", () => {
  test("WebGL2 missing: the list opens with a notice, and the Map button is off", async ({ page, request }, testInfo) => {
    const data = await loadCityData(request, "bangalore");
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type === "webgl2" || type === "webgl" || type === "experimental-webgl") return null;
        return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    await openExplorer(page, "/bangalore", { map: false });
    await expect(page.getByTestId("explorer")).toHaveAttribute("data-view", "list");
    await expect(page.getByTestId("map-fallback-notice")).toContainText("The map can't run on this device or browser");
    await expect(page.getByTestId("view-map")).toBeDisabled();
    await expectList(page, data, {});
    // Filtering still works, and the list holds every company (the desktop panels; the phone's sheet has its own test).
    if (testInfo.project.name === "mobile") return;
    await page.getByTestId("filter-types").click();
    await option(page.getByTestId("filter-panel-types"), "MNC").check();
    await expectList(page, data, { types: ["mnc"] });
  });
});
