import { appendFileSync, mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";

/**
 * DEF-2: one line per map load in gate-results/map-load-times.jsonl (kept across runs; Playwright wipes test-results), so
 * the time each step takes under load can be compared between runs and worker counts. Set MAP_LOAD_LOG=off to skip.
 */
export function logMapTiming(entry: Record<string, unknown>) {
  if (process.env.MAP_LOAD_LOG === "off") return;
  mkdirSync("gate-results", { recursive: true });
  appendFileSync("gate-results/map-load-times.jsonl", JSON.stringify({ at: new Date().toISOString(), run: process.env.MAP_RUN, worker: process.env.TEST_WORKER_INDEX, ...entry }) + "\n");
}

/**
 * Waits for /dev/map-layer to report `ready`. If the page reports `error` instead, fails at once with the page's
 * own message, so a CI log says what went wrong (for example "Failed to initialize WebGL") instead of timing out.
 */
export async function waitForMapReady(page: Page, timeoutMs = 90_000): Promise<void> {
  const map = page.getByTestId("map-layer");
  const started = Date.now();
  const deadline = started + timeoutMs;
  for (;;) {
    const status = await map.getAttribute("data-status", { timeout: 5_000 }).catch(() => null);
    if (status === "ready") {
      const steps = await page.evaluate(() => window.__mapLoadSteps ?? null).catch(() => null);
      logMapTiming({ event: "ready", waitedMs: Date.now() - started, steps });
      return;
    }
    if (status === "error") {
      const alerts = (await page.locator('[role="alert"]').allTextContents()).map((t) => t.trim()).filter(Boolean);
      throw new Error(`The map page reported an error: ${alerts.join(" | ") || "(no message)"}`);
    }
    if (Date.now() > deadline) {
      // Which loading step it reached, and when (ms since navigation), so a timeout says where it stopped.
      const steps = await page.evaluate(() => window.__mapLoadSteps ?? null).catch(() => null);
      const visible = await page.evaluate(() => document.visibilityState).catch(() => "unknown");
      logMapTiming({ event: "timeout", waitedMs: Date.now() - started, steps, visible });
      throw new Error(`The map page was still "${status ?? "missing"}" after ${timeoutMs} ms. Steps: ${JSON.stringify(steps)}; page ${visible}.`);
    }
    await page.waitForTimeout(250);
  }
}
