// Writes the approved baseline a release deploys with (ADR-0025 option C; lib/release.ts):
//
//   node scripts/approved-baseline.mts --tag <release/...> --commit <sha> --run <run id> --by <who approved> [--out out]
//
// Run by deploy-production.yml after the build and before the deploy: the release's own counts per city become what every
// later data refresh is measured against (out/data/approved-baseline.json).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BASELINE_PATH, baselineFrom } from "../lib/release.ts";
import type { Manifest } from "../lib/filters/dataset-files.ts";

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const [tag, commit, runId, by] = [option("--tag"), option("--commit"), option("--run"), option("--by")];
if (!tag || !commit || !runId || !by) {
  console.error("usage: node scripts/approved-baseline.mts --tag <release/...> --commit <sha> --run <run id> --by <who approved> [--out out]");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(path.resolve("public/data/manifest.json"), "utf8")) as Manifest;
const baseline = baselineFrom(manifest, { tag, commit, runId }, { kind: "release", runId, by, at: new Date().toISOString() });
const out = path.resolve(option("--out") ?? "out", BASELINE_PATH);
writeFileSync(out, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`approved baseline for ${tag}: ${Object.entries(baseline.cities).map(([c, v]) => `${c} ${v.companies} companies, ${v.jobs} jobs`).join("; ")}`);
