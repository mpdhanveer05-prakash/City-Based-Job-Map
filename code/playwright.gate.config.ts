import { defineConfig } from "@playwright/test";

// The map validation gate (docs/map-spec.md §10). Not part of `npm run test:e2e`.
//   npm run gate            runs the scenarios in the installed Google Chrome, on the machine's own GPU
//   GATE_DPR=2 npm run gate the second desktop run, at a device pixel ratio of 2
// It writes raw numbers to gate-results/*.json (not test-results/, which Playwright empties on every run);
// docs/map-gate-report.md is written from them by scripts/gate-report.mts.
// Chrome (not Playwright's bundled headless shell) is used so WebGL runs on the GPU instead of in software.
const PORT = 3100;
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const dpr = Number(process.env.GATE_DPR ?? 1);

export default defineConfig({
  // Scenarios 1 to 3 are tests/gate/map-gate.spec.ts. Scenario 4 (every co-location group) and 5 (20 mount
  // cycles) are the Phase 2 specs, run here on the GPU.
  testDir: "./tests",
  testMatch: ["gate/**/*.spec.ts", "e2e/hit-test.spec.ts", "e2e/map-lifecycle.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15 * 60_000,
  reporter: "list",
  use: {
    baseURL: externalBaseURL ?? `http://localhost:${PORT}`,
    channel: "chrome",
    headless: process.env.GATE_HEADED ? false : true,
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: dpr,
  },
  // Named "desktop" because the Phase 2 specs run here too and key on that name; the ratio is in the result file name.
  projects: [{ name: "desktop" }],
  webServer: externalBaseURL
    ? undefined
    : {
        command: `npm run build && npx wrangler dev --port ${PORT}`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: false,
        timeout: 300_000,
        // The blank background by default, so a gate run spends no Geoapify tile credits (the basemap is checked on
        // its own page). GATE_BASEMAP=on builds with the key from .env.local, to see the cost of the basemap too.
        env: process.env.GATE_BASEMAP === "on" ? { DEV_ROUTES: "on" } : { DEV_ROUTES: "on", NEXT_PUBLIC_GEOAPIFY_KEY: "" },
      },
});
