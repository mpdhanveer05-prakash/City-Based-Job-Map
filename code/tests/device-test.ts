// The `test` used by the map specs and the map gate (P2-09a, DEF-2). Normally it is Playwright's own. With GATE_ANDROID_CDP set, every test
// runs in Chrome on an Android phone attached over USB instead of a browser launched on the laptop:
//
//   adb forward tcp:9222 localabstract:chrome_devtools_remote   # the phone's Chrome DevTools, on the laptop's port 9222
//   adb reverse tcp:3100 tcp:3100                               # the laptop's test server, on the phone's localhost:3100
//   GATE_ANDROID_CDP=http://127.0.0.1:9222 npm run gate
//
// (docs/real-device-test-procedure.md). The phone keeps its own screen size and pixel ratio: the config's viewport does not
// apply, and each result file records the device's renderer and user agent. Each test opens a new tab and closes it after.
import { test as playwrightTest, chromium, type Browser } from "@playwright/test";
import { takeMapSlot } from "./map-slot";

export const ANDROID_CDP = process.env.GATE_ANDROID_CDP;

/**
 * Map-heavy specs call `test.use({ mapHeavy: true })`: each of their tests first waits for a map slot (tests/map-slot.ts,
 * DEF-2), and the time it waited does not count against its timeout.
 */
const base = playwrightTest.extend<{ mapHeavy: boolean; mapSlot: void }>({
  mapHeavy: [false, { option: true }],
  mapSlot: [
    async ({ mapHeavy }, provide, testInfo) => {
      if (!mapHeavy || ANDROID_CDP) return provide();
      // No timeout while waiting (the wait can be longer than the test's own timeout), then the test's own plus the wait.
      const timeout = testInfo.timeout;
      const started = Date.now();
      testInfo.setTimeout(0);
      const release = await takeMapSlot();
      testInfo.setTimeout(timeout + (Date.now() - started));
      try {
        await provide();
      } finally {
        release();
      }
    },
    { auto: true },
  ],
});


export const test = ANDROID_CDP
  ? base.extend<object, { androidBrowser: Browser }>({
      androidBrowser: [
        async ({}, provide) => {
          const browser = await chromium.connectOverCDP(ANDROID_CDP);
          await provide(browser);
          // Disconnects; the phone's Chrome keeps running.
          await browser.close();
        },
        { scope: "worker" },
      ],
      // Chrome on Android has one browser context (it cannot make more over CDP): use it.
      context: async ({ androidBrowser }, provide) => {
        const context = androidBrowser.contexts()[0];
        if (!context) throw new Error("No browser context on the phone. Open Chrome on the phone first.");
        await provide(context);
      },
      page: async ({ context, baseURL }, provide) => {
        const page = await context.newPage();
        // A context reached over CDP has no baseURL option, so resolve the specs' relative paths here.
        const goto = page.goto.bind(page);
        page.goto = (url, options) => goto(new URL(url, baseURL).toString(), options);
        await provide(page);
        await page.close();
      },
    })
  : base;

export { expect } from "@playwright/test";
