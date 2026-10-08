// The build under test has every feature its deployment policy requires (lib/build-features.ts). Against a deployed site
// the deploy workflow sets EXPECT_DEPLOY_TARGET from its environment; a mismatch fails here instead of skipping elsewhere.
import { expect, test } from "@playwright/test";
import { buildInfo, requiredFeatures } from "./build-info";

test("the build has every feature its deployment policy requires", async ({ request }) => {
  const info = await buildInfo(request);
  expect(info, "the build publishes build-info.json").not.toBeNull();
  if (process.env.PLAYWRIGHT_BASE_URL) expect(info!.target, "the deployed build is the target the workflow expects").toBe(process.env.EXPECT_DEPLOY_TARGET);
  for (const feature of requiredFeatures()) expect(info!.features?.[feature], `${feature} is required`).toBe(true);
});
