// postbuild (P9-17): moves the router's prefetch files that a Windows export nests in folders to the flat names the
// client requests (see lib/segment-files.ts). It moves, never copies, so the file count is unchanged. Usage:
// node scripts/fix-segment-files.mts out
import { readdirSync, renameSync, rmdirSync, statSync } from "node:fs";
import path from "node:path";
import { flatSegmentName } from "../lib/segment-files.ts";

const root = path.resolve(process.argv[2] ?? "out");
let moved = 0;

function filesUnder(dir: string, prefix: string[] = []): string[][] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full, [...prefix, name]) : [[...prefix, name]];
  });
}

function removeEmpty(dir: string) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) removeEmpty(full);
  }
  if (readdirSync(dir).length === 0) rmdirSync(dir);
}

function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    if (name.startsWith("__next")) {
      for (const rest of filesUnder(full)) {
        renameSync(path.join(full, ...rest), path.join(dir, flatSegmentName([name, ...rest])));
        moved++;
      }
      removeEmpty(full);
    } else {
      walk(full);
    }
  }
}

walk(root);
console.log(moved === 0 ? "fix-segment-files: nothing to move (the export wrote the flat names)" : `fix-segment-files: moved ${moved} prefetch files to their flat names`);
