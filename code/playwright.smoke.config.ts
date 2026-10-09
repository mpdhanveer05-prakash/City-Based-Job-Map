import { defineConfig, devices } from "@playwright/test";

// The deployment smoke suite (DEP-3/4): tests/smoke/*.spec.ts. Every expectation comes from the site under test (its
// manifest, data files and build-info.json) and from the deployment policy, never from the synthetic fixtures, so the same
// suite checks a real-data site and the synthetic sample. It never builds or serves anything itself:
//   PLAYWRIGHT_BASE_URL   the site: a deployed URL, or the local server scripts/smoke-local.mts starts for the exact build
//   EXPECT_DEPLOY_TARGET  production | staging | staging-synthetic (from the deploy environment, not from the build)
//   EXPECT_COMMIT         optional: the commit the build must have been made from
const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL) throw new Error("The smoke suite needs PLAYWRIGHT_BASE_URL (a deployed site, or run it through scripts/smoke-local.mts)");

export default defineConfig({
  testDir: "./tests/smoke",
  fullyParallel: true,
  workers: 2,
  // A deployed site is reached over the network: one retry absorbs a dropped connection, never a wrong answer.
  retries: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
