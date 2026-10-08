// Whether a test of a visitor feature runs, skips, or fails (lib/build-features.ts featureTestDecision). The REQUIRED
// features come from deployment policy, never from the build's own build-info.json:
//   * against a deployed site (PLAYWRIGHT_BASE_URL), EXPECT_DEPLOY_TARGET must name the target (the deploy workflow sets it
//     from its environment), and that target's required features must be present, or the test FAILS;
//   * against the local e2e server, the features playwright.config.ts configures (beacon, feedback) are required.
// Only a feature the target does not require (a synthetic staging build has no Supabase) may be skipped.
import { test, type APIRequestContext } from "@playwright/test";
import { REQUIRED, featureTestDecision, type BuildFeature, type BuildFeatures, type BuildTarget } from "@/lib/build-features";

/** The features the local e2e server is built with (playwright.config.ts webServer env). */
export const LOCAL_E2E_FEATURES: readonly BuildFeature[] = ["beacon", "feedback"];

export function requiredFeatures(env: Readonly<Record<string, string | undefined>> = process.env): readonly BuildFeature[] {
  if (!env.PLAYWRIGHT_BASE_URL) return LOCAL_E2E_FEATURES;
  const target = env.EXPECT_DEPLOY_TARGET as BuildTarget | undefined;
  if (!target || !(target in REQUIRED) || target === "local") {
    throw new Error("A run against a deployed site must set EXPECT_DEPLOY_TARGET (production, staging, or staging-synthetic)");
  }
  return REQUIRED[target];
}

let cached: Promise<{ target?: string; features?: Partial<BuildFeatures> } | null> | null = null;
export function buildInfo(request: APIRequestContext) {
  cached ??= request
    .get("/build-info.json")
    .then(async (r) => (r.ok() ? ((await r.json()) as { target?: string; features?: Partial<BuildFeatures> }) : null))
    .catch(() => null);
  return cached;
}

/** Call at the start of a test of `feature`: it skips only when policy allows, and fails when a required feature is off. */
export async function requireOrSkip(request: APIRequestContext, feature: BuildFeature): Promise<void> {
  const decision = featureTestDecision(feature, requiredFeatures(), (await buildInfo(request))?.features ?? null);
  if (decision.action === "fail") throw new Error(decision.reason);
  test.skip(decision.action === "skip", decision.action === "skip" ? decision.reason : "");
}
