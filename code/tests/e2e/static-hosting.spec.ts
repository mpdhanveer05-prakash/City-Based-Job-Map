import { expect, test } from "@playwright/test";

// Behaviour the static export relies on from Cloudflare Pages (ADR-0006).
// Runs against `wrangler pages dev out` locally, or the staging URL via PLAYWRIGHT_BASE_URL.

test("an unknown path returns a real 404 with the branded page", async ({ page }) => {
  const response = await page.goto("/companies/does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page doesn't exist.");
});

test("pages carry the security headers from public/_headers", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
});

test("hashed build assets are cached as immutable", async ({ page, request }) => {
  await page.goto("/");
  const src = await page.locator('script[src^="/_next/static/"]').first().getAttribute("src");
  expect(src).toBeTruthy();
  const response = await request.get(src!);
  expect(response.headers()["cache-control"]).toContain("immutable");
});

test("robots.txt and sitemap.xml are served", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toMatch(/User-Agent: \*/i);
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).toContain("<urlset");
});
