// Runs the city launch gate (P9-04) on the datasets in public/data, the same files the site is built from:
//
//   node scripts/launch-gate.mts [--city bangalore] [--out docs/launch-gate-report.md]
//
// Exit code 1 when any city fails. A build from the synthetic sample always fails, by design.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_THRESHOLDS, evaluateLaunchGate, renderGate } from "../lib/launch-gate.ts";
import type { Manifest } from "../lib/filters/dataset-files.ts";

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = option("--city");
const out = option("--out");
const root = path.resolve("public/data");
const read = <T,>(rel: string): T => JSON.parse(readFileSync(path.join(root, rel.replace(/^\/data\//, "")), "utf8")) as T;

const manifest = read<Manifest>("manifest.json");
const results = Object.entries(manifest.cities)
  .filter(([slug]) => !only || slug === only)
  .map(([slug, entry]) => {
    const thresholds = DEFAULT_THRESHOLDS[slug];
    if (!thresholds) throw new Error(`No launch thresholds for ${slug}`);
    return evaluateLaunchGate(
      {
        synthetic: entry.synthetic,
        companies: read(entry.files.companies.path),
        offices: read(entry.files.offices.path),
        details: read(entry.files.details.path),
      },
      thresholds,
    );
  });

const report = renderGate(results);
console.log(report);
if (out) writeFileSync(path.resolve(out), report);
process.exit(results.every((r) => r.pass) ? 0 : 1);
