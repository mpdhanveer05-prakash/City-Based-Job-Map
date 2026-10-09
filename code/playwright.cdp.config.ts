import { defineConfig } from "@playwright/test";

// Tests the Android attachment mode of tests/device-test.ts (P2-09a) without a phone: the global setup starts a local
// Chromium that exposes a DevTools endpoint, as a phone's Chrome does through `adb forward`, plus a tiny page server, and
// sets GATE_ANDROID_CDP to it. The specs then run through the same attach path the map gate uses on a real phone.
//   npx playwright test --config playwright.cdp.config.ts
// Not part of `npm run test:e2e` (it is a check of the tooling, not of the site).
export const CDP_PORT = 9333;
export const PAGE_PORT = 9334;

export default defineConfig({
  testDir: "./tests/device",
  globalSetup: "./tests/device/cdp-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PAGE_PORT}` },
});
