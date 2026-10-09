import { readFileSync } from "node:fs";
import { expect, test } from "../device-test";
import { GATE_FILTERS } from "@/map/fixtures/gate-filters";

// P2-09b: the in-page gate runner (/dev/map-layer?runner=1), the tool for phones Playwright cannot drive. This checks the
// tool, not a device: a short run (?cycles=2) in the test browser must produce a complete result in the shape the gate
// report reads, with every scenario present, and the download must hold exactly what the page shows. It judges no number.
test.use({ mapHeavy: true });
test.skip(({ isMobile }) => isMobile, "The runner is checked once; the gate itself runs on the real devices");
test.describe.configure({ timeout: 300_000 });

async function openRunner(page: import("@playwright/test").Page, query: string) {
  await page.goto(`/dev/map-layer?size=S&runner=1&${query}`);
  await expect(page.getByTestId("gate-runner")).toBeVisible({ timeout: 90_000 });
}

test("refuses to start before the live scenario is running", async ({ page }) => {
  await openRunner(page, "cycles=1");
  await page.getByTestId("run-gate").click();
  await expect(page.getByTestId("gate-step")).toHaveText(/Stopped: Tap "Live clusters" first/);
  await expect(page.getByTestId("gate-result")).toHaveCount(0);
});

test("a short run gives a complete result in the gate's shape, and the download is that result", async ({ page }) => {
  await openRunner(page, "cycles=2");
  await page.getByRole("button", { name: "Live clusters" }).click();
  await expect.poll(() => page.evaluate(() => (window.__liveKeys ?? []).length), { timeout: 60_000 }).toBeGreaterThan(0);
  await page.getByTestId("run-gate").click();
  await expect(page.getByTestId("gate-step")).toHaveText("Done. Copy or download the result.", { timeout: 240_000 });

  const shown = JSON.parse((await page.getByTestId("gate-result").textContent()) ?? "{}");
  expect(shown).toMatchObject({ runner: "in-page", size: "S", cycles: 2 });
  expect(typeof shown.environment.renderer).toBe("string");
  expect(shown.environment.dpr).toBeGreaterThan(0);
  for (const scenario of ["scenario1", "scenario2"]) {
    expect(shown[scenario].performance, `${scenario} performance`).toBeTruthy();
    expect(shown[scenario].correctness, `${scenario} correctness`).toMatchObject({ duplicateKeyFrames: 0 });
    expect(shown[scenario].correctness.framesChecked, `${scenario} checked frames`).toBeGreaterThan(0);
  }
  expect(shown.scenario2.filterPlan).toBeTruthy();
  expect(shown.filterLatency.samples).toHaveLength(4 * GATE_FILTERS.length);
  expect(shown.filterLatency.warmMedian).toBeGreaterThanOrEqual(0);
  for (const key of ["settledZ17", "settledZ12", "duringZoom"]) expect(shown.hitAccuracy[key], key).toBeTruthy();
  expect(Date.parse(shown.finishedAt)).toBeGreaterThanOrEqual(Date.parse(shown.startedAt));

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^in-page-S-\d+\.json$/);
  expect(JSON.parse(readFileSync((await download.path())!, "utf8"))).toEqual(shown);
});
