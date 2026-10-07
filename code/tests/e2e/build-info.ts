// What the build under test says it has (public/build-info.json, written by scripts/check-build-config.mts). A test of a
// feature the build deliberately lacks (a synthetic staging build has no Supabase, so no beacon or forms) is skipped with
// that reason instead of failing; a build without the file (older deployments) is assumed to have everything.
import type { APIRequestContext } from "@playwright/test";
import type { BuildFeature, BuildFeatures } from "@/lib/build-features";

let cached: Promise<Partial<BuildFeatures> | null> | null = null;

export async function featureOff(request: APIRequestContext, feature: BuildFeature): Promise<boolean> {
  cached ??= request
    .get("/build-info.json")
    .then(async (r) => (r.ok() ? ((await r.json()) as { features?: Partial<BuildFeatures> }).features ?? null : null))
    .catch(() => null);
  const features = await cached;
  return features?.[feature] === false;
}

export const OFF_REASON = (feature: BuildFeature) => `this build has no ${feature} feature (build-info.json): it is configured off, not broken`;
