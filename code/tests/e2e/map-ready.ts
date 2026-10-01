import type { Page } from "@playwright/test";

/**
 * Waits for /dev/map-layer to report `ready`. If the page reports `error` instead, fails at once with the page's
 * own message, so a CI log says what went wrong (for example "Failed to initialize WebGL") instead of timing out.
 */
export async function waitForMapReady(page: Page, timeoutMs = 90_000): Promise<void> {
  const map = page.getByTestId("map-layer");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await map.getAttribute("data-status", { timeout: 5_000 }).catch(() => null);
    if (status === "ready") return;
    if (status === "error") {
      const alerts = (await page.locator('[role="alert"]').allTextContents()).map((t) => t.trim()).filter(Boolean);
      throw new Error(`The map page reported an error: ${alerts.join(" | ") || "(no message)"}`);
    }
    if (Date.now() > deadline) throw new Error(`The map page was still "${status ?? "missing"}" after ${timeoutMs} ms.`);
    await page.waitForTimeout(250);
  }
}
