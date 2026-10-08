// ADR-0025: an open explorer tab learns that newer data exists from /data/<city>/current.json when it becomes visible
// again (at most every five minutes), and offers a reload; a failed check changes nothing. The page's clock is
// controlled so the five-minute throttle passes without waiting, and the List view keeps the map out of the way.
import { expect, test, type Page, type Route } from "@playwright/test";

const CITY = "bangalore";
const NEW_VERSION = "9999-ffffffffffff";

/** The tab is hidden, then shown again, as when a visitor comes back to it. */
async function comeBack(page: Page) {
  await page.evaluate(() => {
    const set = (v: string) => Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
    set("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    set("visible");
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

async function openList(page: Page) {
  await page.clock.install();
  await page.goto(`/${CITY}/?view=list`);
  await expect(page.getByTestId("company-row").first()).toBeVisible();
}

async function currentVersion(page: Page): Promise<string> {
  const response = await page.request.get(`/data/${CITY}/current.json`);
  return ((await response.json()) as { dataset_version: string }).dataset_version;
}

test.describe("an open explorer tab and newer data", () => {
  test("unchanged content: coming back to the tab shows no notice", async ({ page }) => {
    await openList(page);
    await page.clock.fastForward("06:00");
    const checked = page.waitForResponse((r) => r.url().endsWith(`/data/${CITY}/current.json`));
    await comeBack(page);
    expect((await checked).status()).toBe(200);
    await page.waitForTimeout(300);
    await expect(page.getByTestId("explorer-newer-data")).toHaveCount(0);
  });

  test("before five minutes it does not check at all", async ({ page }) => {
    let checks = 0;
    await page.route(`**/data/${CITY}/current.json`, (route) => (checks++, route.continue()));
    await openList(page);
    await page.clock.fastForward("01:00");
    await comeBack(page);
    await page.waitForTimeout(300);
    expect(checks).toBe(0);
  });

  test("changed content: a notice offers a reload, and the reload uses the new snapshot", async ({ page }) => {
    const oldVersion = await currentVersion(page);
    const companies = await (await page.request.get(`/data/${CITY}/${oldVersion}/companies.json`)).json();
    const firstName: string = companies.companies[0].name;
    const renamed = { ...companies, companies: companies.companies.map((c: { name: string }, i: number) => (i === 0 ? { ...c, name: `${c.name} (updated)` } : c)) };

    await openList(page);
    await expect(page.getByTestId("company-rows")).toContainText(firstName);
    // A deployment published newer data: the pointer moves...
    await page.route(`**/data/${CITY}/current.json`, (route) => route.fulfill({ json: { version: 1, dataset_version: NEW_VERSION } }));
    await page.clock.fastForward("06:00");
    await comeBack(page);
    const notice = page.getByTestId("explorer-newer-data");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("have been updated since this page loaded");
    await expect(page.getByTestId("company-rows"), "nothing is replaced under the visitor").toContainText(firstName);

    // ...and the new HTML names the new folder (as a real deployment's would). The test rewrites the page to the new
    // version; it drops the page's CSP meta tag because rewriting the inline data changes the script hashes.
    await page.route((url) => url.pathname.replace(/\/$/, "") === `/${CITY}`, async (route: Route) => {
      if (route.request().resourceType() !== "document") return route.fallback();
      const original = await route.fetch();
      const html = (await original.text())
        .replaceAll(oldVersion, NEW_VERSION)
        .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "");
      return route.fulfill({ response: original, body: html, headers: { ...original.headers(), "content-type": "text/html; charset=utf-8" } });
    });
    await page.route(`**/data/${CITY}/${NEW_VERSION}/companies.json`, (route) => route.fulfill({ json: renamed }));
    await page.route(`**/data/${CITY}/${NEW_VERSION}/offices.json`, async (route) =>
      route.fulfill({ response: await page.request.get(`/data/${CITY}/${oldVersion}/offices.json`) }),
    );
    await notice.getByRole("button", { name: "Reload for the latest" }).click();
    await expect(page.getByTestId("company-rows")).toContainText(`${firstName} (updated)`, { timeout: 30_000 });
    await expect(page.getByTestId("explorer-newer-data"), "the reloaded page is current").toHaveCount(0);
  });

  test("a failed check says nothing and browsing keeps working", async ({ page }) => {
    await page.route(`**/data/${CITY}/current.json`, (route) => route.abort("internetdisconnected"));
    await openList(page);
    await page.clock.fastForward("06:00");
    await comeBack(page);
    await page.waitForTimeout(300);
    await expect(page.getByTestId("explorer-newer-data")).toHaveCount(0);
    // Still browsable: switch to the grid, then open a company.
    await page.getByRole("button", { name: "Grid" }).click();
    await expect(page.getByTestId("grid-view")).toBeVisible();
    const first = page.getByTestId("view-company").first();
    const href = (await first.getAttribute("href"))!;
    await first.click();
    await expect(page).toHaveURL(new RegExp(`${href.replace(/\/$/, "")}/?$`));
    await expect(page.getByTestId("company-name")).toBeVisible();
  });
});
