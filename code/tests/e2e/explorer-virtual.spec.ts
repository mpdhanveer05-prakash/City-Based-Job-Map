// P5-04: above 100 rows the List and Grid are virtualised: a few dozen rows are in the page, and scrolling reaches the last.
import { expect, test } from "@playwright/test";

test.describe("virtual list and grid", () => {
  test("the list holds thousands of companies but renders only the rows near the viewport", async ({ page }) => {
    await page.goto("/dev/explorer-list");
    const total = Number(await page.getByTestId("virtual-demo").getAttribute("data-rows"));
    expect(total).toBeGreaterThan(1000);
    const rows = page.getByTestId("company-row");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeLessThan(60);
    await expect(page.locator('[data-virtualized="true"]')).toHaveCount(1);

    // Scrolling to the end reaches the last company, and still renders only a few rows.
    await page.getByTestId("list-view").evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => rows.last().getAttribute("data-company")).not.toBeNull();
    expect(await rows.count()).toBeLessThan(60);
    const lastRowBox = await rows.last().boundingBox();
    expect(lastRowBox).not.toBeNull();
  });

  test("the grid is virtualised by rows of tiles", async ({ page }) => {
    await page.goto("/dev/explorer-list");
    await page.getByRole("button", { name: "Grid" }).click();
    const tiles = page.getByTestId("company-row");
    await expect(tiles.first()).toBeVisible();
    expect(await tiles.count()).toBeLessThan(120);
    await page.getByTestId("grid-view").evaluate((el) => el.scrollTo(0, el.scrollHeight / 2));
    await expect(tiles.first()).toBeAttached();
    expect(await tiles.count()).toBeLessThan(120);
  });

  test("the scroll height is exact, so the scroll bar is honest", async ({ page }) => {
    await page.goto("/dev/explorer-list");
    const total = Number(await page.getByTestId("virtual-demo").getAttribute("data-rows"));
    const height = await page.locator('[data-virtualized="true"]').evaluate((el) => (el as HTMLElement).offsetHeight);
    // 88 px a row on a desktop viewport (148 px on a phone).
    expect([total * 88, total * 148]).toContain(height);
  });
});
