import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = ["/", "/dev/tokens", "/bangalore", "/bangalore?view=list", "/bangalore?view=grid", "/chennai?view=list"];

for (const path of PAGES) {
  test(`${path} has no serious or critical axe violations`, async ({ page }) => {
    await page.goto(path);
    // The explorer fetches its data after load: audit the page that shows companies, not the loading state.
    if (path.includes("bangalore") || path.includes("chennai")) await expect(page.getByTestId("explorer")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const blocking = violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(
      blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    ).toEqual([]);
  });
}

test("the explorer with a filter panel open has no serious or critical axe violations", async ({ page }, testInfo) => {
  await page.goto("/bangalore?view=list");
  await expect(page.getByTestId("explorer")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  // Desktop: the Type panel. Phone: the filter sheet.
  if (testInfo.project.name === "mobile") {
    await page.getByTestId("filters-sheet-open").click();
    await expect(page.getByTestId("filters-sheet")).toBeVisible();
  } else {
    await page.getByTestId("filter-types").click();
    await expect(page.getByTestId("filter-panel-types")).toBeVisible();
  }
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

test("the map view with a popup open has no serious or critical axe violations", async ({ page }) => {
  await page.goto("/bangalore?company=amber-forge-synthetic");
  await expect(page.getByTestId("map-popup")).toBeVisible({ timeout: 90_000 });
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    // The basemap's own canvas is not our markup.
    .exclude(".maplibregl-canvas-container")
    .analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});
