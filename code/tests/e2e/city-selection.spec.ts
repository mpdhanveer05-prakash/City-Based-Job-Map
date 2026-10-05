// P4-02 / AC01: the visitor sees both cities and enters one. The page is prerendered from the
// build's dataset, so these checks read what the static export holds.
import { expect, test } from "@playwright/test";

test.describe("city selection", () => {
  test("shows Bengaluru and Chennai as links to their explorers", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Find companies by where they work.");
    const list = page.getByRole("list", { name: "Cities" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(page.getByTestId("city-tile-bangalore")).toHaveAttribute("href", "/bangalore");
    await expect(page.getByTestId("city-tile-chennai")).toHaveAttribute("href", "/chennai");
    await expect(page.getByRole("heading", { level: 2, name: "Bengaluru" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Chennai" })).toBeVisible();
  });

  test("states the number of companies and offices from the dataset", async ({ page, request }) => {
    await page.goto("/");
    const manifest = await (await request.get("/data/manifest.json")).json();
    for (const slug of ["bangalore", "chennai"]) {
      const { companies, offices } = manifest.cities[slug].counts;
      const label = manifest.cities[slug].synthetic ? "sample companies" : "companies";
      await expect(page.getByTestId(`city-tile-${slug}`)).toContainText(`${companies} ${label} in ${offices} offices`);
    }
  });

  test("lists the cities that are coming soon as plain text, not links", async ({ page }) => {
    await page.goto("/");
    const soon = page.getByTestId("coming-soon");
    await expect(soon).toHaveText("Coming soon: Hyderabad, Pune, Mumbai");
    await expect(soon.getByRole("link")).toHaveCount(0);
  });

  test("draws the boundary, and draws no office dots while the data is synthetic", async ({ page, request }) => {
    await page.goto("/");
    const manifest = await (await request.get("/data/manifest.json")).json();
    for (const slug of ["bangalore", "chennai"]) {
      const art = page.getByTestId(`city-art-${slug}`);
      await expect(art).toHaveAttribute("aria-hidden", "true");
      await expect(art.locator("path")).toHaveAttribute("d", /^M[\d. -]+L/);
      const dots = await art.locator("circle").count();
      if (manifest.cities[slug].synthetic) expect(dots).toBe(0);
      else expect(dots).toBeGreaterThan(0);
    }
  });

  test("labels synthetic sample data on the page", async ({ page, request }) => {
    const manifest = await (await request.get("/data/manifest.json")).json();
    const synthetic = Object.values<{ synthetic: boolean }>(manifest.cities).some((c) => c.synthetic);
    await page.goto("/");
    await expect(page.getByTestId("sample-data-notice")).toHaveCount(synthetic ? 1 : 0);
  });

  test("redirects /bengaluru to /bangalore", async ({ page }) => {
    const response = await page.request.get("/bengaluru", { maxRedirects: 0 });
    expect(response.status()).toBe(301);
    expect(response.headers()["location"]).toMatch(/\/bangalore$/);
  });

  test("works on a phone: no horizontal scroll and tiles that can be tapped", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await page.getByTestId("city-tile-bangalore").boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});
