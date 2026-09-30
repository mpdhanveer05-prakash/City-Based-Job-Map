import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
// Set to test an already-running server instead, e.g. `wrangler dev` or a preview Worker URL.
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests",
  testMatch: ["e2e/**/*.spec.ts", "a11y/**/*.spec.ts"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // In CI: annotations on the PR, plus an HTML report uploaded when a test fails.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: externalBaseURL ?? `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  // By default, tests run against a production build, with the /dev pages enabled.
  webServer: externalBaseURL
    ? undefined
    : {
        command: `npm run build && npm run start -- --port ${PORT}`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        env: { DEV_ROUTES: "on" },
      },
});
