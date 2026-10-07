import { afterEach, describe, expect, it } from "vitest";
import { buildFeatures, buildTarget, missingFeatures } from "@/lib/build-features";
import { clickEndpoint } from "@/lib/beacon";
import { feedbackAvailable } from "@/lib/feedback";
import { supabaseConfigured } from "@/lib/supabase/browser";

const KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_TURNSTILE_SITE_KEY", "NEXT_PUBLIC_GEOAPIFY_KEY"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const CASES: Array<Partial<Record<(typeof KEYS)[number], string>>> = [
  {},
  { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" },
  { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA" },
  { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site", NEXT_PUBLIC_GEOAPIFY_KEY: "geo" },
  { NEXT_PUBLIC_SUPABASE_URL: "replace-with-url", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site" },
];

describe("buildFeatures", () => {
  it.each(CASES.map((c, i) => [i, c] as const))("agrees with the app's own checks (case %i)", (_i, env) => {
    for (const k of KEYS) delete process.env[k];
    Object.assign(process.env, env);
    const f = buildFeatures(process.env);
    expect(f.beacon).toBe(clickEndpoint() !== null);
    expect(f.feedback).toBe(feedbackAvailable());
    expect(f.admin).toBe(supabaseConfigured());
  });

  it("classifies builds and requires every feature for hosted real-data builds", () => {
    expect(buildTarget({ RELEASE_BUILD: "1" })).toBe("production");
    expect(buildTarget({ SITE_ENV: "staging" })).toBe("staging");
    expect(buildTarget({ SITE_ENV: "staging", DATA_SOURCE: "seed" })).toBe("staging-synthetic");
    expect(buildTarget({})).toBe("local");
    expect(missingFeatures("production", {})).toHaveLength(4);
    expect(missingFeatures("staging-synthetic", {})).toHaveLength(1);
    expect(missingFeatures("local", {})).toEqual([]);
  });
});
