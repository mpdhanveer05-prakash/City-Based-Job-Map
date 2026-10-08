// The data refresh's last check before it deploys (ADR-0025 option C; rules in lib/release.ts evaluateRefresh):
//
//   node scripts/refresh-guard.mts --deployed <site URL> --release-tag <tag> --release-commit <sha> --release-run <id>
//                                  [--allow-shrink <run id> --by <who>] [--max-drop 0.2] [--out out]
//
// Reads what production serves (manifest.json, approved-baseline.json, build-info.json's commit) and compares the build just
// made (public/data/manifest.json) with it. Stops (exit 1) unless the site is a build of this release with this release's
// baseline, and no city is synthetic, missing, new, or shrunk by more than the limit since the last deployment or since a
// person last approved. When it may deploy, it writes the baseline to deploy with (<out>/data/approved-baseline.json):
// unchanged, or the new counts when a person allowed a shrink. Writes changed=true|false to $GITHUB_OUTPUT and a summary to
// $GITHUB_STEP_SUMMARY.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BASELINE_PATH, DEFAULT_MAX_DROP, evaluateRefresh, type ApprovedBaseline } from "../lib/release.ts";
import type { Manifest } from "../lib/filters/dataset-files.ts";

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const site = option("--deployed");
const release = { tag: option("--release-tag") ?? "", commit: option("--release-commit") ?? "", runId: option("--release-run") ?? "" };
if (!site || !release.tag || !release.commit || !release.runId) {
  console.error("usage: node scripts/refresh-guard.mts --deployed <site URL> --release-tag <tag> --release-commit <sha> --release-run <id> [--allow-shrink <run id> --by <who>] [--max-drop 0.2] [--out out]");
  process.exit(2);
}
const shrinkRun = option("--allow-shrink");
const allowShrink = shrinkRun ? { runId: shrinkRun, by: option("--by") ?? "unknown", at: new Date().toISOString() } : undefined;
const maxDrop = Number(option("--max-drop") ?? DEFAULT_MAX_DROP);
const next = JSON.parse(readFileSync(path.resolve("public/data/manifest.json"), "utf8")) as Manifest;

async function read<T>(file: string): Promise<T | null> {
  try {
    const response = await fetch(`${site!.replace(/\/+$/, "")}/${file}?refresh=${Date.now()}`, { cache: "no-store" });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}
const [manifest, baseline, info] = await Promise.all([
  read<Manifest>("data/manifest.json"),
  read<ApprovedBaseline>(BASELINE_PATH),
  read<{ commit?: string }>("build-info.json"),
]);

const decision = evaluateRefresh(next, { manifest, baseline, commit: info?.commit ?? null }, release, { maxDrop, allowShrink });
const rows = Object.entries(next.cities).map(([city, entry]) => {
  const before = manifest?.cities[city];
  const approved = baseline?.cities[city];
  return `| ${city} | ${before?.dataset_version ?? "–"} → ${entry.dataset_version} | ${approved?.companies ?? "–"} / ${before?.counts.companies ?? "–"} → ${entry.counts.companies} | ${approved?.jobs ?? "–"} / ${before?.counts.jobs ?? "–"} → ${entry.counts.jobs} |`;
});
const summary = [
  `### Production data refresh of ${release.tag}`,
  "| City | Dataset | Companies (approved / deployed → new) | Jobs (approved / deployed → new) |",
  "| --- | --- | --- | --- |",
  ...rows,
  "",
  decision.problems.length ? `**Stopped:**\n${decision.problems.map((p) => `- ${p}`).join("\n")}` : decision.changed.length ? `Changed: ${decision.changed.join(", ")}` : "Nothing changed: no deployment.",
  ...(decision.allowed.length ? [`**Allowed by ${allowShrink?.by} (run ${allowShrink?.runId}); the approved baseline is now these counts:**\n${decision.allowed.map((p) => `- ${p}`).join("\n")}`] : []),
  "",
].join("\n");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
const deploy = decision.problems.length === 0 && decision.changed.length > 0;
if (deploy && decision.baseline) writeFileSync(path.resolve(option("--out") ?? "out", BASELINE_PATH), `${JSON.stringify(decision.baseline, null, 2)}\n`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${deploy}\n`);
// exitCode, not exit(): exiting while fetch keeps its sockets open crashes Node on Windows (0xC0000409).
process.exitCode = decision.problems.length ? 1 : 0;
