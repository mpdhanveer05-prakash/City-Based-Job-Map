import { describe, expect, it } from "vitest";
import { checkDeployEnv, NO_PRODUCTION_PROJECT_YET } from "../../scripts/check-deploy-env.mts";

const STAGING_REF = "abcdefghijklmnopqrst";
const PROD_REF = "zyxwvutsrqponmlkjihg";

const staging = {
  DEPLOY_ENV: "staging",
  NEXT_PUBLIC_SITE_URL: "https://company-map-staging.company-map.workers.dev",
  SUPABASE_PROJECT_REF: STAGING_REF,
  NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  OTHER_ENV_SUPABASE_PROJECT_REF: PROD_REF,
  NEXT_PUBLIC_GEOAPIFY_KEY: "geo-public-key",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "turnstile-site-key",
};
const production = {
  ...staging,
  DEPLOY_ENV: "production",
  NEXT_PUBLIC_SITE_URL: "https://officemap.tech",
  SUPABASE_PROJECT_REF: PROD_REF,
  NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
  OTHER_ENV_SUPABASE_PROJECT_REF: STAGING_REF,
  RELEASE_BUILD: "1",
  DATA_SOURCE: "",
};

describe("checkDeployEnv", () => {
  it("accepts a complete staging and production configuration", () => {
    expect(checkDeployEnv("staging", staging)).toEqual({ problems: [], dataSource: "" });
    expect(checkDeployEnv("production", production)).toEqual({ problems: [], dataSource: "" });
  });

  it("fails when everything is missing, as with no environment set up", () => {
    expect(checkDeployEnv("staging", {}).problems.length).toBeGreaterThanOrEqual(5);
    expect(checkDeployEnv("production", {}).problems.length).toBeGreaterThanOrEqual(5);
  });

  it("refuses the other environment's marker, so a repository-level value cannot serve both", () => {
    expect(checkDeployEnv("production", { ...production, DEPLOY_ENV: "staging" }).problems.join()).toMatch(/DEPLOY_ENV/);
  });

  it("refuses a pilot preview in any hosted build (unreviewed records are local only)", () => {
    expect(checkDeployEnv("staging", { ...staging, PILOT_PREVIEW: "1" }).problems.join()).toMatch(/PILOT_PREVIEW must not be set for a staging build/);
    expect(checkDeployEnv("production", { ...production, PILOT_PREVIEW: "1" }).problems.join()).toMatch(/PILOT_PREVIEW must not be set for a production build/);
  });

  it("refuses the same Supabase project for both environments", () => {
    expect(checkDeployEnv("production", { ...production, OTHER_ENV_SUPABASE_PROJECT_REF: PROD_REF }).problems.join()).toMatch(/separate projects/);
  });

  describe("the other environment's project ref", () => {
    const otherRef = (target: "staging" | "production", value: string) =>
      checkDeployEnv(target, { ...(target === "staging" ? staging : production), OTHER_ENV_SUPABASE_PROJECT_REF: value });

    it(`lets staging say "${NO_PRODUCTION_PROJECT_YET}" while no production project exists`, () => {
      expect(NO_PRODUCTION_PROJECT_YET).toBe("none-yet");
      expect(otherRef("staging", "none-yet")).toEqual({ problems: [], dataSource: "" });
    });

    it("never lets production use it: production must name staging's actual project", () => {
      expect(otherRef("production", "none-yet").problems.join()).toMatch(/production must name staging's actual project ref/);
    });

    it.each(["none", "NONE-YET", "None-yet", "none_yet", "none-yet-", "tbd", "placeholder", "production", "reserved-prod-ref", "-"])(
      "refuses the arbitrary placeholder %j in both environments",
      (value) => {
        for (const target of ["staging", "production"] as const) {
          expect(otherRef(target, value).problems.join()).toMatch(/OTHER_ENV_SUPABASE_PROJECT_REF is not a 20-character project ref/);
        }
      },
    );

    it.each([
      ["19 characters", "abcdefghijklmnopqrs"],
      ["21 characters", "abcdefghijklmnopqrstu"],
      ["upper case", "ZYXWVUTSRQPONMLKJIHG"],
      ["a URL instead of a ref", `https://${PROD_REF}.supabase.co`],
    ])("refuses a malformed ref (%s)", (_, value) => {
      expect(otherRef("staging", value).problems.join()).toMatch(/not a 20-character project ref/);
      expect(otherRef("production", value).problems.join()).toMatch(/not a 20-character project ref/);
    });

    it("still requires a value, and still refuses the environment's own project", () => {
      expect(otherRef("staging", "").problems.join()).toMatch(/OTHER_ENV_SUPABASE_PROJECT_REF is missing/);
      expect(otherRef("production", "").problems.join()).toMatch(/OTHER_ENV_SUPABASE_PROJECT_REF is missing/);
      expect(otherRef("staging", STAGING_REF).problems.join()).toMatch(/separate projects/);
    });

    it("ignores surrounding whitespace, as for every other value", () => {
      expect(otherRef("staging", "  none-yet \n")).toEqual({ problems: [], dataSource: "" });
      expect(otherRef("production", ` ${STAGING_REF} `)).toEqual({ problems: [], dataSource: "" });
    });

    it("is not read by an explicitly synthetic staging build, which has no Supabase project", () => {
      const opted = { DEPLOY_ENV: "staging", NEXT_PUBLIC_SITE_URL: staging.NEXT_PUBLIC_SITE_URL, ALLOW_SYNTHETIC_DATA: "true", NEXT_PUBLIC_GEOAPIFY_KEY: "geo" };
      expect(checkDeployEnv("staging", opted)).toEqual({ problems: [], dataSource: "seed" });
    });
  });

  it("refuses a URL from a different project than the ref", () => {
    expect(checkDeployEnv("staging", { ...staging, NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co` }).problems.join()).toMatch(/does not belong/);
  });

  it("never lets production use synthetic data or dev routes", () => {
    const bare = { ...production, NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_PROJECT_REF: "", OTHER_ENV_SUPABASE_PROJECT_REF: "" };
    const r = checkDeployEnv("production", { ...bare, ALLOW_SYNTHETIC_DATA: "true" });
    expect(r.dataSource).toBe("");
    expect(r.problems.join()).toMatch(/ALLOW_SYNTHETIC_DATA/);
    expect(checkDeployEnv("production", { ...production, DATA_SOURCE: "seed" }).problems.join()).toMatch(/DATA_SOURCE/);
    expect(checkDeployEnv("production", { ...production, DEV_ROUTES: "on" }).problems.join()).toMatch(/DEV_ROUTES/);
    expect(checkDeployEnv("production", { ...production, RELEASE_BUILD: "" }).problems.join()).toMatch(/RELEASE_BUILD/);
  });

  it("lets staging show the synthetic sample only when it opts in explicitly", () => {
    const opted = { DEPLOY_ENV: "staging", NEXT_PUBLIC_SITE_URL: staging.NEXT_PUBLIC_SITE_URL, ALLOW_SYNTHETIC_DATA: "true", NEXT_PUBLIC_GEOAPIFY_KEY: "geo" };
    expect(checkDeployEnv("staging", opted)).toEqual({ problems: [], dataSource: "seed" });
    expect(checkDeployEnv("staging", { ...staging, ALLOW_SYNTHETIC_DATA: "true" }).problems.join()).toMatch(/choose one/);
  });

  it("refuses a staging site URL on a production host, and the reverse", () => {
    expect(checkDeployEnv("staging", { ...staging, NEXT_PUBLIC_SITE_URL: "https://officemap.tech" }).problems.join()).toMatch(/production host/);
    expect(checkDeployEnv("production", { ...production, NEXT_PUBLIC_SITE_URL: staging.NEXT_PUBLIC_SITE_URL }).problems.join()).toMatch(/not a production host/);
  });

  it("fails clearly when a hosted build lacks a visitor feature's public configuration (DEP-1)", () => {
    const noMap = checkDeployEnv("production", { ...production, NEXT_PUBLIC_GEOAPIFY_KEY: "" }).problems.join();
    expect(noMap).toMatch(/basemap feature: set NEXT_PUBLIC_GEOAPIFY_KEY/);
    const noForms = checkDeployEnv("staging", { ...staging, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "replace-with-site-key" }).problems.join();
    expect(noForms).toMatch(/feedback feature/);
    const syntheticNoMap = checkDeployEnv("staging", { DEPLOY_ENV: "staging", NEXT_PUBLIC_SITE_URL: staging.NEXT_PUBLIC_SITE_URL, ALLOW_SYNTHETIC_DATA: "true" });
    expect(syntheticNoMap.problems.join()).toMatch(/staging-synthetic build needs the basemap/);
    expect(syntheticNoMap.dataSource).toBe("");
  });
});
