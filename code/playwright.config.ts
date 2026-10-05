import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
// Set to test an already-running server instead, e.g. `npm run preview` or the staging URL.
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
// A CI runner has no GPU. Recent Chromium only falls back to software WebGL (SwiftShader) when asked to, and the map
// pages need WebGL2. tests/e2e/webgl-environment.spec.ts reports what the browser really offers.
const softwareWebGl = process.env.CI ? ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] : [];

export default defineConfig({
  testDir: "./tests",
  testMatch: ["e2e/**/*.spec.ts", "a11y/**/*.spec.ts"],
  fullyParallel: true,
  // Every map page runs WebGL in software on a laptop or CI runner, so a few workers share the CPU fairly
  // and a test gets 60 s before it counts as hung.
  workers: process.env.CI ? 2 : 3,
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  // One retry in CI: each retry of a slow map test costs minutes, and a test that needs two is flaky.
  retries: process.env.CI ? 1 : 0,
  // In CI: annotations on the PR, plus an HTML report uploaded when a test fails.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: externalBaseURL ?? `http://localhost:${PORT}`,
    trace: "on-first-retry",
    launchOptions: { args: softwareWebGl },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      // The map specs repeat on the phone profile (2.6x DPR, 128 px logo cells) and are the slowest tests by far.
      // A 2-core CI runner drawing software WebGL cannot fit them in its time limit, so CI runs them on desktop
      // only. Run the whole suite locally before pushing: the phone profile found real bugs (P2-04 eviction).
      testIgnore: process.env.CI ? /(map-layer|logo-atlas|animation|hit-test|popup-a11y|explorer-map)\.spec\.ts/ : undefined,
    },
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
        // The build needs a data source (ADR-0010); the e2e suite runs on the committed synthetic sample.
        // NEXT_PUBLIC_SUPABASE_URL makes the build include the click beacon's endpoint; the specs intercept it, so no
        // Supabase project is needed. The anon key stays a placeholder, so the build still reads the committed sample.
        env: { DEV_ROUTES: "on", DATA_SOURCE: "seed", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" },
      },
});
