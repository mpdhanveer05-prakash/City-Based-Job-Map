// prebuild: fails a hosted build (RELEASE_BUILD=1, or SITE_ENV=staging) that lacks a required visitor feature's public
// configuration (lib/build-features.ts), and writes public/build-info.json: the build kind and which features it has, so a
// test run against a deployed site can tell "off in this build" from "broken". Booleans only; never a key.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { buildFeatures, buildTarget, missingFeatures } from "../lib/build-features.ts";

// The same .env files `next build` reads (variables already set in the environment win), so this sees what the build sees.
nextEnv.loadEnvConfig(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), false, { info: () => {}, error: console.error });

const target = buildTarget(process.env);
const problems = missingFeatures(target, process.env);
if (problems.length > 0) {
  for (const p of problems) console.error(`check-build-config: ${p}`);
  process.exit(1);
}
// The commit this build is made from (ADR-0025 option C): a data refresh deploys only over a site built from the release it
// refreshes, so it can never put older code over a newer release. In a refresh checkout this is the release tag's commit.
let commit = "unknown";
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch {
  commit = "unknown";
}
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "build-info.json");
writeFileSync(out, `${JSON.stringify({ version: 1, target, commit, features: buildFeatures(process.env) }, null, 2)}\n`);
console.log(`check-build-config: ${target} build; features ${JSON.stringify(buildFeatures(process.env))}`);
