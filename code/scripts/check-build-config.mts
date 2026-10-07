// prebuild: fails a hosted build (RELEASE_BUILD=1, or SITE_ENV=staging) that lacks a required visitor feature's public
// configuration (lib/build-features.ts), and writes public/build-info.json: the build kind and which features it has, so a
// test run against a deployed site can tell "off in this build" from "broken". Booleans only; never a key.
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
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "build-info.json");
writeFileSync(out, `${JSON.stringify({ version: 1, target, features: buildFeatures(process.env) }, null, 2)}\n`);
console.log(`check-build-config: ${target} build; features ${JSON.stringify(buildFeatures(process.env))}`);
