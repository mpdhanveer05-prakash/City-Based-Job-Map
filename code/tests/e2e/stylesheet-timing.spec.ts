// DEF-1 (a 17 px Apply in full e2e runs): the demonstrated cause, kept as a regression check on the test harness.
// 1. Layout read while the page's stylesheet is pending is unstyled: Apply measures 17 px, then 44 px once it loads.
// 2. A context with a route (phone.spec's fakeEmployerSites) has no HTTP cache, so every page fetches its stylesheet.
// 3. A tap on View jobs before hydration is a full page load, not a client navigation.
// Under load all three line up. The browser never paints the unstyled layout (a linked stylesheet blocks rendering),
// so the fix is in the tests: measure after stylesheetsLoaded().
import { expect, test } from "@playwright/test";
import { loadCityData, stylesheetsLoaded } from "./explorer-helpers";

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the phone journey taps; desktop has nothing to add");
});

test("a pending stylesheet gives an unstyled Apply, and stylesheetsLoaded waits for it", async ({ page, context, request }) => {
  const data = await loadCityData(request, "chennai");
  const company = data.companies.find((c) => data.details.jobs.some((j) => j.company_id === c.id))!;
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await context.route(/\.css$/, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(`/companies/${company.slug}/jobs`, { waitUntil: "commit" });
  const apply = page.getByTestId("job-row").first().getByRole("link");
  await expect(apply).toBeAttached();
  const before = (await apply.boundingBox())!.height;
  expect(before, "unstyled layout while the stylesheet is pending").toBeLessThan(44);
  await expect(stylesheetsLoaded(page, 1_000)).rejects.toThrow(/stylesheet/);
  release();
  await stylesheetsLoaded(page);
  expect((await apply.boundingBox())!.height, "measured after stylesheetsLoaded").toBeGreaterThanOrEqual(44);
});

test("context.route turns off the HTTP cache, so every page fetches its stylesheet again", async ({ browser }) => {
  for (const routed of [false, true]) {
    const context = await browser.newContext();
    if (routed) await context.route(/^https:\/\/[^/]*\.example\//, (r) => r.fulfill({ body: "" }));
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    const seen: string[] = [];
    cdp.on("Network.responseReceived", (e) => {
      if (e.response.url.endsWith(".css")) seen.push(e.response.fromDiskCache || e.response.fromPrefetchCache ? "cache" : "network");
    });
    cdp.on("Network.requestServedFromCache", () => seen.push("memory"));
    await page.goto("/", { waitUntil: "load" });
    await page.goto("/companies", { waitUntil: "load" }).catch(() => {});
    await page.goto("/", { waitUntil: "load" });
    const cached = seen.filter((x) => x !== "network").length;
    if (routed) expect({ cached, network: seen.length }, "with a route, every load fetches the stylesheet").toEqual({ cached: 0, network: 3 });
    else expect(cached, "without one, later loads use the cache").toBeGreaterThan(0);
    await context.close();
  }
});

test("View jobs tapped before hydration is a full page load", async ({ page, context, request }) => {
  const data = await loadCityData(request, "chennai");
  const company = data.companies.find((c) => data.details.jobs.some((j) => j.company_id === c.id))!;
  await context.route(/\/_next\/static\/chunks\/.*\.js$/, () => new Promise(() => {}));
  const documents: string[] = [];
  page.on("request", (r) => {
    if (r.isNavigationRequest()) documents.push(new URL(r.url()).pathname);
  });
  await page.goto(`/companies/${company.slug}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("view-jobs").tap();
  await expect(page).toHaveURL(/\/jobs$/);
  expect(documents.at(-1)).toMatch(/\/jobs$/);
});
