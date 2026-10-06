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

// DEF-1, the user's side: the unstyled layout must never be seen or touched. While the jobs page's stylesheet is held back
// on a cold, full page load, the browser paints nothing (no paint entry, no rendering step), and a tap where the unstyled
// Apply sits reaches nothing. Once the stylesheet arrives, every painted frame has a 44 px Apply.
test("while the stylesheet is pending nothing is painted or tappable, and every painted frame has a 44 px Apply", async ({ page, context, request }) => {
  const data = await loadCityData(request, "chennai");
  const company = data.companies.find((c) => data.details.jobs.some((j) => j.company_id === c.id))!;
  await context.addInitScript(() => {
    const w = window as unknown as { __frames: Array<{ t: number; h: number | null; painted: boolean }>; __clicks: string[] };
    w.__frames = [];
    w.__clicks = [];
    document.addEventListener("click", (e) => w.__clicks.push((e.target as Element | null)?.tagName ?? "?"), true);
    const loop = (t: number) => {
      const a = document.querySelector('[data-testid="apply-link"]');
      w.__frames.push({ t, h: a ? a.getBoundingClientRect().height : null, painted: performance.getEntriesByType("paint").length > 0 });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 94_000 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await context.route(/\.css$/, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(`/companies/${company.slug}/jobs`, { waitUntil: "commit" });
  const apply = page.getByTestId("job-row").first().getByRole("link");
  await expect(apply).toBeAttached({ timeout: 30_000 });
  await page.waitForTimeout(2_000);
  const box = (await apply.boundingBox())!;
  expect(box.height, "the layout behind the blocked render is the unstyled one").toBeLessThan(44);
  const pending = await page.evaluate(() => {
    const w = window as unknown as { __frames: Array<{ painted: boolean }> };
    return { paints: performance.getEntriesByType("paint").length, frames: w.__frames.length };
  });
  expect(pending, "nothing is painted, and no rendering step runs, while the stylesheet is pending").toEqual({ paints: 0, frames: 0 });
  // A tap where the unstyled link sits. Chrome holds input until the first paint, so the tap does not complete and no
  // click reaches the page while the stylesheet is pending.
  let tapped = false;
  const tap = page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2).then(() => (tapped = true));
  await page.waitForTimeout(2_000);
  expect(tapped, "the tap is held, not delivered, while rendering is blocked").toBe(false);
  expect(await page.evaluate(() => (window as unknown as { __clicks: string[] }).__clicks), "no click reaches the page before it is painted").toEqual([]);

  release();
  await stylesheetsLoaded(page);
  await tap;
  await page.waitForTimeout(1_000);
  // Once painted, the held tap is delivered to the styled page: it never acted on the unstyled layout. (Where it lands
  // depends on the styled layout; the user aimed at nothing they could see.)
  const clicks = await page.evaluate(() => (window as unknown as { __clicks: string[] }).__clicks);
  console.log(`DEF-1: the held tap reached ${JSON.stringify(clicks)} after the first paint`);
  const frames = await page.evaluate(() => (window as unknown as { __frames: Array<{ h: number | null; painted: boolean }> }).__frames);
  const painted = frames.filter((f) => f.painted && f.h !== null);
  expect(painted.length, "frames were painted after the stylesheet arrived").toBeGreaterThan(0);
  expect(painted.filter((f) => f.h! < 44), "no painted frame has an Apply under 44 px").toEqual([]);
});
