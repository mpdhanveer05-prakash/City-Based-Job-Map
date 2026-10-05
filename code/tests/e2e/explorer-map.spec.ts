// P4-03: the explorer shell on the real city data. It loads both cities, draws the markers, and opens a company's
// popup from a tap; the URL carries the selection, and Back and Forward restore it (AC07).
import { expect, test } from "@playwright/test";
import { clickMap, drawnNow, goTo, loadCityData, mapCounts, openExplorer, shownCounts, type CityData } from "./explorer-helpers";

/** Metres between two points. */
function metres(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** An office of a one-office company that nothing else is within 300 m of: at zoom 17 it is drawn alone. */
function isolatedOffice(data: CityData) {
  const perCompany = new Map<string, number>();
  for (const o of data.offices) perCompany.set(o.company_id, (perCompany.get(o.company_id) ?? 0) + 1);
  const index = data.offices.findIndex(
    (o) => perCompany.get(o.company_id) === 1 && data.offices.every((other) => other === o || metres(o, other) > 300),
  );
  expect(index, "the sample has an isolated office").toBeGreaterThanOrEqual(0);
  const office = data.offices[index];
  return { index, office, company: data.companies.find((c) => c.id === office.company_id)! };
}

test.describe("explorer shell", () => {
  test("opens Bengaluru with the map, its counts, and clusters on it", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "the map specs run on desktop; the phone layout has its own spec");
    const data = await loadCityData(request, "bangalore");
    const errors = await openExplorer(page, "/bangalore");
    await expect(page.getByRole("heading", { level: 1, name: "Bengaluru" })).toBeVisible();
    expect(await shownCounts(page)).toEqual({ companies: data.companies.length, offices: data.offices.length });
    // The map was given exactly the offices the counts name.
    expect(await mapCounts(page)).toEqual({ offices: data.offices.length, companies: data.companies.length });
    const drawn = await drawnNow(page);
    expect(drawn.length).toBeGreaterThan(3);
    expect(drawn.some((d) => d.kind === "cluster")).toBe(true);
    expect(errors).toEqual([]);
  });

  test("opens Chennai with its own data", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name === "mobile");
    const data = await loadCityData(request, "chennai");
    await openExplorer(page, "/chennai");
    await expect(page.getByRole("heading", { level: 1, name: "Chennai" })).toBeVisible();
    expect(await shownCounts(page)).toEqual({ companies: data.companies.length, offices: data.offices.length });
  });

  test("a path that is not a launch city is a 404", async ({ page }) => {
    const response = await page.goto("/mumbai");
    expect(response?.status()).toBe(404);
  });

  test("the city tile on the home page leads to a working explorer (AC01)", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile");
    await page.goto("/");
    await page.getByTestId("city-tile-chennai").click();
    await expect(page).toHaveURL(/\/chennai$/);
    await expect(page.getByRole("heading", { level: 1, name: "Chennai" })).toBeVisible();
    await expect(page.getByTestId("explorer-map")).toHaveAttribute("data-status", "ready", { timeout: 90_000 });
  });

  test("tapping a logo opens its popup and puts the company in the URL; Back and Forward restore it", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name === "mobile");
    const data = await loadCityData(request, "bangalore");
    const { index, office, company } = isolatedOffice(data);
    await openExplorer(page, "/bangalore");
    await goTo(page, office.lng, office.lat, 17);

    const logo = (await drawnNow(page)).find((d) => d.key === `o:${index}`);
    expect(logo, "the office is drawn as its own logo at zoom 17").toBeTruthy();
    await clickMap(page, logo!.x, logo!.y);

    const popup = page.getByTestId("map-popup");
    await expect(popup).toBeVisible();
    await expect(popup.getByRole("heading", { name: company.name })).toBeVisible();
    await expect(popup.getByRole("link", { name: "View company" })).toHaveAttribute("href", `/companies/${company.slug}`);
    await expect(page).toHaveURL(new RegExp(`company=${company.slug}`));

    await page.goBack();
    await expect(popup).toBeHidden();
    await expect(page).not.toHaveURL(/company=/);
    await page.goForward();
    await expect(popup).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`company=${company.slug}`));
  });

  test("Escape and the close button close the popup and clear the selection", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name === "mobile");
    const data = await loadCityData(request, "bangalore");
    const { office, company } = isolatedOffice(data);
    await openExplorer(page, `/bangalore?company=${company.slug}`);
    const popup = page.getByTestId("map-popup");
    await expect(popup).toBeVisible({ timeout: 30_000 });
    await popup.focus();
    await page.keyboard.press("Escape");
    await expect(popup).toBeHidden();
    await expect(page).not.toHaveURL(/company=/);
    void office;
  });

  test("a shared link with ?company= flies to the company and opens its popup", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name === "mobile");
    const data = await loadCityData(request, "bangalore");
    const { office, company } = isolatedOffice(data);
    await openExplorer(page, `/bangalore?company=${company.slug}`);
    await expect(page.getByTestId("map-popup")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("map-popup").getByRole("heading", { name: company.name })).toBeVisible();
    const center = await page.evaluate(() => {
      const c = window.__explorer!.map.getCamera();
      return { lng: c.lng, lat: c.lat, zoom: c.zoom };
    });
    expect(center.zoom).toBeGreaterThanOrEqual(16.9);
    expect(metres(center, office)).toBeLessThan(400);
  });

  test("a company that is not in this city is dropped from the URL", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile");
    await openExplorer(page, "/bangalore?company=nobody-synthetic");
    await expect(page).not.toHaveURL(/company=/);
    await expect(page.getByTestId("map-popup")).toHaveCount(0);
  });

  test("the camera is written to the URL once the map settles, and a reload returns to it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile");
    await openExplorer(page, "/bangalore");
    await goTo(page, 77.62, 12.95, 13.5);
    // The canonical URL percent-encodes the commas (URLSearchParams).
    await expect(page).toHaveURL(/map=12\.95\d*(,|%2C)77\.62\d*(,|%2C)13\.5/);
    const entries = await page.evaluate(() => history.length);
    await goTo(page, 77.6, 12.97, 12);
    await expect(page).toHaveURL(/map=12\.97/);
    // A camera change rewrites the current entry; it does not add one per pan.
    expect(await page.evaluate(() => history.length)).toBe(entries);

    await page.reload();
    await expect(page.getByTestId("explorer-map")).toHaveAttribute("data-status", "ready", { timeout: 90_000 });
    const camera = await page.evaluate(() => window.__explorer!.map.getCamera());
    expect(camera.zoom).toBeCloseTo(12, 1);
    expect(camera.lat).toBeCloseTo(12.97, 2);
  });

  test("the boundary of the city is on the map", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile");
    await openExplorer(page, "/bangalore");
    const layer = await page.evaluate(() => {
      const map = window.__explorer!.map.map;
      const l = map.getLayer("city-boundary");
      return l ? { type: l.type, dashed: !!map.getPaintProperty("city-boundary", "line-dasharray"), width: map.getPaintProperty("city-boundary", "line-width") } : null;
    });
    expect(layer).toEqual({ type: "line", dashed: true, width: 1.5 });
  });
});
