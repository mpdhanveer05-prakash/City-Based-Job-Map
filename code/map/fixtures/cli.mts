// Writes the synthetic datasets (P2-01) to map/fixtures/out/ (git-ignored) and, with
// --manifest, refreshes map/fixtures/manifest.json, the committed record of each dataset's hash.
// Node 24 runs this file directly: `npm run fixtures` or `npm run fixtures -- --manifest`.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GATE_SEED,
  SIZE_PRESETS,
  generateSyntheticDataset,
  serializeDataset,
  type CitySlug,
  type SizePreset,
} from "./generate.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Every dataset the gate uses: S, M, and L for Bengaluru, and S for Chennai. */
export const GATE_DATASETS: ReadonlyArray<{ city: CitySlug; size: SizePreset }> = [
  { city: "bengaluru", size: "S" },
  { city: "bengaluru", size: "M" },
  { city: "bengaluru", size: "L" },
  { city: "chennai", size: "S" },
];

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export function buildManifest() {
  const datasets: Record<string, { offices: number; companies: number; bytes: number; sha256: string }> = {};
  for (const { city, size } of GATE_DATASETS) {
    const dataset = generateSyntheticDataset({ city, size, seed: GATE_SEED });
    const text = serializeDataset(dataset);
    datasets[`${city}-${size}`] = {
      offices: dataset.meta.officeCount,
      companies: dataset.meta.companyCount,
      bytes: Buffer.byteLength(text),
      sha256: sha256(text),
    };
  }
  return { seed: GATE_SEED, sizes: SIZE_PRESETS, datasets };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = path.join(here, "out");
  mkdirSync(outDir, { recursive: true });
  for (const { city, size } of GATE_DATASETS) {
    const text = serializeDataset(generateSyntheticDataset({ city, size, seed: GATE_SEED }));
    const file = path.join(outDir, `${city}-${size}.json`);
    writeFileSync(file, text);
    console.log(`${city}-${size}: ${text.length} bytes, sha256 ${sha256(text)}`);
  }
  if (process.argv.includes("--manifest")) {
    writeFileSync(path.join(here, "manifest.json"), JSON.stringify(buildManifest(), null, 2) + "\n");
    console.log("Updated map/fixtures/manifest.json");
  }
}
