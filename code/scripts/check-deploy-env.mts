// Refuses a hosted build whose configuration is missing or belongs to the other environment (docs/deploy-environments.md).
// The first step of both deploy workflows, before checkout of anything that builds:
//
//   node scripts/check-deploy-env.mts staging|production
//
// It reads the job's environment (the GitHub `staging` or `production` environment's variables, mapped in the workflow)
// and prints one problem per line. On success it appends DATA_SOURCE to $GITHUB_ENV: "seed" only for a staging
// environment that opted in with ALLOW_SYNTHETIC_DATA=true, otherwise empty. Production never falls back to synthetic data.
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { missingFeatures } from "../lib/build-features.ts";

export type DeployTarget = "staging" | "production";

export const PRODUCTION_HOSTS = ["officemap.tech", "www.officemap.tech", "company-map.company-map.workers.dev"] as const;

export interface DeployEnvResult {
  problems: string[];
  dataSource: "" | "seed";
}

const supabaseUrl = (ref: string): string => `https://${ref}.supabase.co`;

function host(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.hostname : null;
  } catch {
    return null;
  }
}

export function checkDeployEnv(target: DeployTarget, env: Readonly<Record<string, string | undefined>>): DeployEnvResult {
  const problems: string[] = [];
  const v = (name: string): string => (env[name] ?? "").trim();

  // The marker is set only inside each GitHub environment, so a repository-level variable cannot satisfy both jobs.
  if (v("DEPLOY_ENV") !== target) {
    problems.push(`DEPLOY_ENV is "${v("DEPLOY_ENV")}", expected "${target}": set it in the ${target} environment, not at repository level.`);
  }

  const siteHost = host(v("NEXT_PUBLIC_SITE_URL"));
  if (!siteHost) problems.push("NEXT_PUBLIC_SITE_URL (environment variable SITE_URL) is missing or not https.");
  const productionHost = siteHost !== null && (PRODUCTION_HOSTS as readonly string[]).includes(siteHost);
  if (target === "staging" && productionHost) problems.push(`staging SITE_URL points at the production host ${siteHost}.`);
  if (target === "production" && siteHost && !productionHost) problems.push(`production SITE_URL host ${siteHost} is not a production host.`);

  // A pilot preview (unreviewed records, scripts/pilot/preview-db.mts) is built on this laptop only, never by a deploy.
  if (v("PILOT_PREVIEW") !== "") problems.push(`PILOT_PREVIEW must not be set for a ${target} build: pilot previews are local only.`);

  const synthetic = v("ALLOW_SYNTHETIC_DATA") === "true";
  if (target === "production") {
    if (synthetic) problems.push("ALLOW_SYNTHETIC_DATA must not be set for production.");
    if (v("DATA_SOURCE") !== "") problems.push(`DATA_SOURCE must be empty for production, got "${v("DATA_SOURCE")}".`);
    if (v("RELEASE_BUILD") !== "1") problems.push("RELEASE_BUILD must be 1 for production.");
    if (v("DEV_ROUTES") === "on") problems.push("DEV_ROUTES must be off for production.");
  }

  const ref = v("SUPABASE_PROJECT_REF");
  const url = v("NEXT_PUBLIC_SUPABASE_URL");
  const key = v("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const anySupabase = ref !== "" || url !== "" || key !== "";
  if (synthetic && !anySupabase) {
    // Explicitly synthetic staging: no Supabase project, so no admin, beacon or forms; the map still needs its key.
    problems.push(...missingFeatures("staging-synthetic", env));
    return { problems, dataSource: problems.length === 0 ? "seed" : "" };
  }
  if (synthetic) problems.push("ALLOW_SYNTHETIC_DATA=true and Supabase settings are both set: choose one.");
  if (!/^[a-z0-9]{20}$/.test(ref)) problems.push("SUPABASE_PROJECT_REF is missing or not a 20-character project ref.");
  if (!url) problems.push("SUPABASE_URL is missing.");
  else if (ref && url.replace(/\/+$/, "") !== supabaseUrl(ref)) problems.push(`SUPABASE_URL does not belong to project ${ref}.`);
  if (!key) problems.push("SUPABASE_ANON_KEY is missing.");
  const other = v("OTHER_ENV_SUPABASE_PROJECT_REF");
  if (!other) problems.push("OTHER_ENV_SUPABASE_PROJECT_REF is missing: set the other environment's project ref so the two cannot match.");
  else if (other === ref) problems.push("SUPABASE_PROJECT_REF equals the other environment's project: staging and production must use separate projects.");
  // Every visitor feature needs its public configuration (DEP-1): the basemap key, Supabase, and the Turnstile site key.
  problems.push(...missingFeatures(target, env));
  return { problems, dataSource: "" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2];
  if (target !== "staging" && target !== "production") {
    console.error("usage: node scripts/check-deploy-env.mts staging|production");
    process.exit(2);
  }
  const { problems, dataSource } = checkDeployEnv(target, process.env);
  if (problems.length > 0) {
    for (const p of problems) console.error(`check-deploy-env (${target}): ${p}`);
    process.exit(1);
  }
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `DATA_SOURCE=${dataSource}\n`);
  console.log(`check-deploy-env (${target}): configuration complete${dataSource === "seed" ? "; staging shows the synthetic sample (ALLOW_SYNTHETIC_DATA)" : ""}.`);
}
