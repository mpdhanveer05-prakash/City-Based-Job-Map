// ADR-0025: the dataset folder is a pure function of the content. Two separate builds from the same data write the same
// folder names and the same bytes; the folder name is the hash of what is in it.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DATASET_FILE_NAMES, datasetVersion } from "@/lib/filters/dataset-files";

const CODE = path.resolve(__dirname, "../..");
const redirects = path.join(CODE, "public", "_redirects");
const savedRedirects = (() => {
  try {
    return readFileSync(redirects, "utf8");
  } catch {
    return null;
  }
})();
const dirs: string[] = [];

function build(): string {
  const out = mkdtempSync(path.join(tmpdir(), "datasets-"));
  dirs.push(out);
  execFileSync(process.execPath, ["scripts/build-datasets.mts", "--require", "--out", out], {
    cwd: CODE,
    env: { ...process.env, DATA_SOURCE: "seed", NEXT_PUBLIC_SUPABASE_URL: "", LOCAL_DATABASE_URL: "", RELEASE_BUILD: "", PILOT_PREVIEW: "" },
    stdio: "ignore",
  });
  return out;
}

function tree(dir: string, base = dir): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(files, tree(full, base));
    else files[path.relative(base, full).replaceAll("\\", "/")] = readFileSync(full, "utf8");
  }
  return files;
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  if (savedRedirects !== null) writeFileSync(redirects, savedRedirects); // the script also writes public/_redirects
});

describe("content-versioned datasets", () => {
  it("are byte-identical across two separate builds of the same data", () => {
    const a = tree(build());
    const b = tree(build());
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    for (const name of Object.keys(a)) expect(b[name], name).toBe(a[name]);
  }, 120_000);

  it("name each folder by the hash of its files", () => {
    const out = dirs[0];
    const manifest = JSON.parse(readFileSync(path.join(out, "manifest.json"), "utf8")) as { cities: Record<string, { data_version: number; dataset_version: string }> };
    for (const [city, entry] of Object.entries(manifest.cities)) {
      const files = Object.fromEntries(DATASET_FILE_NAMES.map((n) => [n, readFileSync(path.join(out, city, entry.dataset_version, `${n}.json`), "utf8")])) as Record<(typeof DATASET_FILE_NAMES)[number], string>;
      expect(datasetVersion(entry.data_version, files)).toBe(entry.dataset_version);
      expect(JSON.parse(readFileSync(path.join(out, city, "current.json"), "utf8")).dataset_version).toBe(entry.dataset_version);
      expect(readdirSync(path.join(out, city)).sort()).toEqual([entry.dataset_version, "current.json"].sort());
    }
  });
});
