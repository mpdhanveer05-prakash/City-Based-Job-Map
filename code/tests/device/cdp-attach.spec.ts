// The Android attachment mode of tests/device-test.ts (P2-09a), against a stand-in for the phone's Chrome
// (playwright.cdp.config.ts). Run in order: the last test checks what the first two left behind.
import { ANDROID_CDP, expect, test } from "../device-test";

test.describe.configure({ mode: "serial" });
// Map-heavy specs use this; in attachment mode the laptop's map slot must not be taken (the phone runs one test at a time).
test.use({ mapHeavy: true });

test("attaches to the running browser over CDP instead of launching one", async ({ page }) => {
  expect(ANDROID_CDP).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  const browser = page.context().browser();
  expect(browser?.isConnected(), "connected to the phone's Chrome").toBe(true);
  // Chrome on Android has one browser context and cannot make another over CDP: the test must use that one.
  expect(browser!.contexts()).toHaveLength(1);
  expect(page.context()).toBe(browser!.contexts()[0]);
});

test("resolves the specs' relative paths against the base URL", async ({ page, baseURL }) => {
  await page.goto("/bangalore?view=list");
  expect(page.url()).toBe(new URL("/bangalore?view=list", baseURL).toString());
  await expect(page.locator("h1")).toHaveText("hello from the stand-in server");
  await expect(page.locator("[data-path]")).toHaveAttribute("data-path", "/bangalore?view=list");
});

test("gives each test a new tab, and closes it afterwards", async ({ page }) => {
  // The previous test's tab, which went to /bangalore, is gone; this test's tab is new and has not been anywhere.
  const pages = page.context().pages();
  expect(pages).toContain(page);
  expect(page.url()).toBe("about:blank");
  expect(pages.filter((p) => p.url().includes("/bangalore")), "the earlier test's tab was closed").toHaveLength(0);
});
