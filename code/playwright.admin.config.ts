import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

// The admin workspace needs a real Supabase (sign-in, row-level security, the import and publish functions), so its
// specs run against the DISPOSABLE test stack, never the main local database (owner, 7 Oct 2026: it holds the pilot
// drafts; these specs delete admin_user rows and add companies):
//
//   node scripts/test-stack.mts start   (once: the full test stack, project company-map-test, database on :55322)
//   node scripts/test-stack.mts reset   (before each run: the specs change data)
//   npm run test:admin
//
// The site is built against the test stack's API (so `npm run data` also reads the snapshot through PostgREST, the path
// the sample-data builds skip), served by wrangler on :3100, and the global setup refuses any database without the test
// stack's marker, creates the admin accounts, starts the Edge Functions, and stands in for GitHub.
const PORT = 3100;

function testStackKeys(): { url: string; anonKey: string; serviceKey: string; jwtSecret: string } {
  try {
    const out = execFileSync("npx", ["supabase", "status", "-o", "json", "--workdir", ".test-stack"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: true });
    const json = JSON.parse(out.slice(out.indexOf("{")));
    return { url: json.API_URL, anonKey: json.ANON_KEY, serviceKey: json.SERVICE_ROLE_KEY, jwtSecret: json.JWT_SECRET };
  } catch {
    throw new Error("The disposable test stack is not running. Start it with `node scripts/test-stack.mts start`.");
  }
}

const keys = testStackKeys();
if (!keys.url.includes(":55321")) throw new Error(`refusing ${keys.url}: the admin specs run only against the test stack's API on :55321`);
// The global setup and the specs read these.
process.env.ADMIN_E2E_SUPABASE_URL = keys.url;
process.env.ADMIN_E2E_DB_URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
process.env.ADMIN_E2E_SERVICE_KEY = keys.serviceKey;
process.env.ADMIN_E2E_ANON_KEY = keys.anonKey;
// The test stack's published development secret: the MFA spec signs an expired copy of a real token with it.
process.env.ADMIN_E2E_JWT_SECRET = keys.jwtSecret;

export default defineConfig({
  testDir: "./tests/admin",
  testMatch: ["**/*.spec.ts"],
  globalSetup: "./tests/admin/global-setup.ts",
  // One browser: the specs share one database and the order of their steps is part of the story.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  retries: 0,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npx wrangler dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      DEV_ROUTES: "on",
      NEXT_PUBLIC_SUPABASE_URL: keys.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: keys.anonKey,
      // No basemap: these specs spend no Geoapify credits.
      NEXT_PUBLIC_GEOAPIFY_KEY: "",
      // Cloudflare's published always-pass test site key; the specs also stub the script and the verification.
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      DATA_SOURCE: "",
    },
  },
});
