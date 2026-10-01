import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// P2-02. Runs the real clustering Web Worker (bundled by Turbopack, served from the static export) in a browser.

test("clusters in a real Web Worker, with the offices conserved at every level", async ({ page }) => {
  const workerStarted = page.waitForEvent("worker");
  await page.goto("/dev/cluster-worker");
  const worker = await workerStarted;
  expect(worker.url()).toContain("/_next/static/");

  const root = page.getByTestId("cluster-worker");
  await expect(root).toHaveAttribute("data-status", "ready", { timeout: 30_000 });

  const cell = (level: number, name: string) => root.locator(`tr[data-level="${level}"] [data-cell="${name}"]`);
  // 1,500 offices at every level; one city-wide cluster at the lowest, every office on its own at the highest.
  for (const level of [0, 9, 12, 15, 18]) await expect(cell(level, "offices")).toHaveText("1500");
  await expect(cell(0, "items")).toHaveText("1");
  await expect(cell(18, "items")).toHaveText("1500");
  const mid = Number(await cell(12, "items").textContent());
  expect(mid).toBeGreaterThan(1);
  expect(mid).toBeLessThan(1500);
});

test("drops the stale response and keeps the newer one", async ({ page }) => {
  await page.goto("/dev/cluster-worker");
  const report = page.getByTestId("stale-report");
  await expect(report).toBeVisible({ timeout: 30_000 });
  await expect(report).toContainText("Stale responses dropped: 1.");
  await expect(report).toContainText("The newer response was kept: yes.");
});

test("has no serious or critical axe violations", async ({ page }) => {
  await page.goto("/dev/cluster-worker");
  await expect(page.getByTestId("cluster-worker")).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});
