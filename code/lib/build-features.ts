// Which visitor-facing features a build has, from its public configuration, and which a hosted build must have
// (docs/deploy-environments.md). Used by scripts/check-build-config.mts (prebuild) and scripts/check-deploy-env.mts (the
// deploy workflows), so a hosted build fails with a clear message instead of quietly shipping a blank map or no forms.
// Reads only public values (NEXT_PUBLIC_*) and build flags; never a secret.

export type BuildFeature = "basemap" | "admin" | "beacon" | "feedback";

export interface BuildFeatures {
  /** The Geoapify basemap (without a key the map draws on a plain background). */
  basemap: boolean;
  /** Admin sign-in: the Supabase URL and anon key. */
  admin: boolean;
  /** The anonymous Apply / Visit website click counter (the `click` Edge Function). */
  beacon: boolean;
  /** Report and suggestion forms: the `submit-feedback` Edge Function and a Turnstile site key. */
  feedback: boolean;
}

export type BuildTarget = "production" | "staging" | "staging-synthetic" | "local";

type Env = Readonly<Record<string, string | undefined>>;

const present = (v: string | undefined): boolean => {
  const t = (v ?? "").trim();
  return t !== "" && !t.startsWith("replace-");
};

/** The same conditions the app itself uses: lib/beacon.ts (clickEndpoint), lib/feedback.ts (feedbackAvailable),
 * lib/supabase/browser.ts (supabaseConfigured), and the explorer's Geoapify key. tests/unit/build-features.test.ts keeps
 * them in step. */
export function buildFeatures(env: Env): BuildFeatures {
  const url = present(env.NEXT_PUBLIC_SUPABASE_URL);
  return {
    basemap: present(env.NEXT_PUBLIC_GEOAPIFY_KEY),
    admin: url && present(env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    beacon: url,
    feedback: url && present(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
  };
}

/** What kind of build this is, from its flags. */
export function buildTarget(env: Env): BuildTarget {
  if ((env.RELEASE_BUILD ?? "") === "1") return "production";
  if ((env.SITE_ENV ?? "") === "staging") return env.DATA_SOURCE === "seed" ? "staging-synthetic" : "staging";
  return "local";
}

/** The features each kind of hosted build must have. A synthetic staging build has no Supabase project, so only the map. */
export const REQUIRED: Record<BuildTarget, readonly BuildFeature[]> = {
  production: ["basemap", "admin", "beacon", "feedback"],
  staging: ["basemap", "admin", "beacon", "feedback"],
  "staging-synthetic": ["basemap"],
  local: [],
};

const NEEDS: Record<BuildFeature, string> = {
  basemap: "NEXT_PUBLIC_GEOAPIFY_KEY (GitHub environment variable GEOAPIFY_KEY)",
  admin: "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY",
  beacon: "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY",
  feedback: "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and NEXT_PUBLIC_TURNSTILE_SITE_KEY (variable TURNSTILE_SITE_KEY)",
};

/** One message per required feature the configuration lacks; empty when the build may proceed. */
export function missingFeatures(target: BuildTarget, env: Env): string[] {
  const have = buildFeatures(env);
  return REQUIRED[target].filter((f) => !have[f]).map((f) => `a ${target} build needs the ${f} feature: set ${NEEDS[f]}`);
}
