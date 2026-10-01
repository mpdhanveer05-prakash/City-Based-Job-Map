import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
// Set to test an already-running server instead, e.g. `npm run preview` or the staging URL.
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests",
  testMatch: ["e2e/**/*.spec.ts", "a11y/**/*.spec.ts"],
  fullyParallel: true,
  // Every map page runs WebGL in software on a laptop or CI runner, so a few workers share the CPU fairly
  // and a test gets 60 s before it counts as hung.
  workers: process.env.CI ? 2 : 3,
  timeout: 60_000,
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
  // By default: build the static export (with /dev pages) and serve out/ the way
  // Cloudflare does (_headers, _redirects, 404.html) via `wrangler dev` (assets-only Worker).
  webServer: externalBaseURL
    ? undefined
    : {
        command: `npm run build && npx wrangler dev --port ${PORT}`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        env: { DEV_ROUTES: "on" },
      },
});
