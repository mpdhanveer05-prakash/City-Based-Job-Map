// The data refresh's last check before it deploys (ADR-0025 option C; rules in lib/release.ts):
//
//   node scripts/refresh-guard.mts --deployed <site URL> [--allow-shrink] [--max-drop 0.2]
//
// Compares public/data/manifest.json (the build just made) with the manifest the production site serves. Writes
// changed=true|false to $GITHUB_OUTPUT and a summary to $GITHUB_STEP_SUMMARY. Exit 1 on any problem (synthetic data, a
// missing or new city, a shrink over the limit, an unreadable deployed manifest), so nothing is deployed.
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_MAX_DROP, compareManifests } from "../lib/release.ts";
import type { Manifest } from "../lib/filters/dataset-files.ts";

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const site = option("--deployed");
if (!site) {
  console.error("usage: node scripts/refresh-guard.mts --deployed <site URL> [--allow-shrink] [--max-drop 0.2]");
  process.exit(2);
}
const maxDrop = Number(option("--max-drop") ?? DEFAULT_MAX_DROP);
const next = JSON.parse(readFileSync(path.resolve("public/data/manifest.json"), "utf8")) as Manifest;

let deployed: Manifest | null = null;
try {
  const response = await fetch(`${site.replace(/\/+$/, "")}/data/manifest.json?refresh=${Date.now()}`, { cache: "no-store" });
  if (response.ok) deployed = (await response.json()) as Manifest;
} catch {
  deployed = null;
}

const decision = compareManifests(deployed, next, { maxDrop, allowShrink: args.includes("--allow-shrink") });
const rows = Object.entries(next.cities).map(([city, entry]) => {
  const before = deployed?.cities[city];
  return `| ${city} | ${before?.dataset_version ?? "–"} → ${entry.dataset_version} | ${before?.counts.companies ?? "–"} → ${entry.counts.companies} | ${before?.counts.jobs ?? "–"} → ${entry.counts.jobs} |`;
});
const summary = [
  "### Production data refresh",
  "| City | Dataset | Companies | Jobs |",
  "| --- | --- | --- | --- |",
  ...rows,
  "",
  decision.problems.length ? `**Stopped:**\n${decision.problems.map((p) => `- ${p}`).join("\n")}` : decision.changed.length ? `Changed: ${decision.changed.join(", ")}` : "Nothing changed: no deployment.",
  ...(decision.allowed.length ? [`**Allowed by a person:**\n${decision.allowed.map((p) => `- ${p}`).join("\n")}`] : []),
  "",
].join("\n");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${decision.changed.length > 0 && decision.problems.length === 0}\n`);
process.exit(decision.problems.length ? 1 : 0);
