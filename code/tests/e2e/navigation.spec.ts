// P9-17: client-side navigation of the static export. (1) The router's prefetch files exist under the names it asks
// for: no same-origin request fails along the public journey. (2) On a cold cache and a slow network, the Apply link
// is a 44 px target in every frame from the moment it appears, so no unstyled frame can be tapped.
import { expect, test, type Page } from "@playwright/test";
import { loadCityData } from "./explorer-helpers";

const ORIGIN = /^http:\/\/localhost:\d+\//;

function failedRequests(page: Page) {
  const failed: string[] = [];
  page.on("response", (r) => {
    if (ORIGIN.test(r.url()) && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  // The router cancels its own prefetches when the page moves on (net::ERR_ABORTED): that is not a failure.
  page.on("requestfailed", (r) => {
    const reason = r.failure()?.errorText ?? "";
    if (ORIGIN.test(r.url()) && !reason.includes("ERR_ABORTED")) failed.push(`failed ${r.url()} ${reason}`);
  });
  return failed;
}

/** Records, every animation frame from the first one, the smallest height any visible Apply link had. */
async function watchApply(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __apply: { firstSeenAt: number | null; minHeight: number; frames: number } };
    w.__apply = { firstSeenAt: null, minHeight: Infinity, frames: 0 };
    const tick = () => {
      for (const a of document.querySelectorAll<HTMLElement>('[data-testid="apply-link"]')) {
        const box = a.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue; // not rendered yet
        if (w.__apply.firstSeenAt === null) w.__apply.firstSeenAt = performance.now();
        w.__apply.minHeight = Math.min(w.__apply.minHeight, box.height);
        w.__apply.frames++;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const applyStats = (page: Page) => page.evaluate(() => (window as unknown as { __apply: { firstSeenAt: number | null; minHeight: number; frames: number } }).__apply);

test("the public journey makes no failing same-origin request, prefetch files included", async ({ page, request }) => {
  const data = await loadCityData(request, "bangalore");
  const company = data.companies.find((c) => data.details.jobs.some((j) => j.company_id === c.id))!;
  const failed = failedRequests(page);
  await page.goto("/");
  await page.getByTestId("city-tile-bangalore").click();
  await expect(page.getByTestId("explorer")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await page.goto(`/bangalore?view=list`);
  await expect(page.getByTestId("explorer")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  const row = page.locator(`[data-company="${company.slug}"]`);
  await row.scrollIntoViewIfNeeded();
  await row.getByRole("link", { name: /View company/ }).click();
  await expect(page).toHaveURL(new RegExp(`/companies/${company.slug}$`), { timeout: 30_000 });
  await page.getByRole("link", { name: "View jobs" }).click();
  await expect(page).toHaveURL(new RegExp(`/companies/${company.slug}/jobs$`), { timeout: 30_000 });
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/companies/${company.slug}$`));
  await page.waitForLoadState("networkidle");
  expect(failed).toEqual([]);
});

for (const how of ["a soft navigation from the company page", "a cold load of the jobs page"] as const) {
  test(`on a cold cache and a slow network, Apply is 44 px from its first frame (${how})`, async ({ page, request, browserName }) => {
    test.skip(browserName !== "chromium", "network emulation uses the Chromium DevTools protocol");
    test.setTimeout(180_000);
    const data = await loadCityData(request, "chennai");
    const company = data.companies.find((c) => data.details.jobs.some((j) => j.company_id === c.id))!;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    // About "Slow 4G": 150 ms round trip, 1.6 Mbit/s down, 750 kbit/s up.
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 94_000 });
    await watchApply(page);
    const failed = failedRequests(page);

    if (how === "a cold load of the jobs page") {
      await page.goto(`/companies/${company.slug}/jobs`, { waitUntil: "commit" });
    } else {
      await page.goto(`/companies/${company.slug}`);
      await page.getByRole("link", { name: "View jobs" }).click();
    }
    const apply = page.getByTestId("apply-link").first();
    await expect(apply).toBeVisible({ timeout: 60_000 });
    await page.waitForLoadState("load");
    await page.waitForTimeout(500);
    const stats = await applyStats(page);
    expect(stats.firstSeenAt, "Apply was seen").not.toBeNull();
    expect(stats.frames).toBeGreaterThan(0);
    expect(stats.minHeight, `the smallest height of a visible Apply link in any frame (${stats.frames} frames)`).toBeGreaterThanOrEqual(44);
    expect(failed).toEqual([]);
  });
}
