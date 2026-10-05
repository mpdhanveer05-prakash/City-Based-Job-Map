import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

// The admin workspace needs a real Supabase (sign-in, row-level security, the import and publish functions), so its
// specs run against the local stack instead of the synthetic sample:
//
//   npx supabase start                  (the full stack: Auth, REST, and the Edge Functions runtime)
//   npx supabase db reset               (the seed, no admin users)
//   npm run test:admin
//
// The site is built against the local API (so `npm run data` also reads the snapshot through PostgREST, the path
// the sample-data builds skip), served by wrangler on :3100, and the global setup creates the admin accounts, starts
// the two Edge Functions, and stands in for GitHub.
const PORT = 3100;

function localKeys(): { url: string; anonKey: string; serviceKey: string } {
  try {
    const out = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: true });
    const json = JSON.parse(out.slice(out.indexOf("{")));
    return { url: json.API_URL, anonKey: json.ANON_KEY, serviceKey: json.SERVICE_ROLE_KEY };
  } catch {
    throw new Error("The local Supabase stack is not running. Start it with `npx supabase start`, then `npx supabase db reset`.");
  }
}

const keys = localKeys();
// The global setup and the specs read these.
process.env.ADMIN_E2E_SUPABASE_URL = keys.url;
process.env.ADMIN_E2E_SERVICE_KEY = keys.serviceKey;
process.env.ADMIN_E2E_ANON_KEY = keys.anonKey;

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
