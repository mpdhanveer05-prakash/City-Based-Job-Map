import { expect, type Page } from "@playwright/test";
import { waitForMapReady } from "../e2e/map-ready";
import { settle } from "../e2e/live-helpers";

export { drawnNow, events, goTo, mapSize, settle } from "../e2e/live-helpers";

/** Opens the live scenario of /dev/map-layer on one of the gate datasets (S, M, or L) and waits until it has drawn. */
export async function openLiveSized(page: Page, size: "S" | "M" | "L") {
  await page.goto(`/dev/map-layer?size=${size}`);
  await waitForMapReady(page);
  await page.getByRole("button", { name: "Live clusters" }).click();
  await expect.poll(() => page.evaluate(() => (window.__liveKeys ?? []).length), { timeout: 60_000 }).toBeGreaterThan(20);
  await settle(page);
}
