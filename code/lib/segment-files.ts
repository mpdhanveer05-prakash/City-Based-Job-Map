// The router's prefetch files in a static export (P9-17). Next 16 writes each page segment's payload as
// `<page>/__next<segment path with "/" replaced by ".">.txt` and the client asks for exactly that name. On Windows the
// segment path it collects uses "\" (path.relative), which the "/" replacement misses, so the file lands in nested
// folders (`__next.admin\companies\__PAGE__.txt`) and every prefetch of it answers 404. A Linux build is correct.
//
// fixSegmentFiles moves such files to the flat name and removes the folders it emptied. It touches nothing else:
//   * only folders whose name starts with "__next" are entered, and only the files inside them move;
//   * a correct (Linux) export has no such folders, so nothing changes;
//   * after one run there are none left, so a second run changes nothing;
//   * it never overwrites: if the flat name already exists, it stops with an error rather than guess which is right.
import { existsSync, readdirSync, renameSync, rmdirSync, statSync } from "node:fs";
import path from "node:path";

/** The flat file name for a file found at `parts` (folders, then the file) under a page directory. */
export function flatSegmentName(parts: readonly string[]): string {
  if (parts.length < 2 || !parts[0].startsWith("__next")) throw new Error(`not a nested segment file: ${parts.join("/")}`);
  return parts.join(".");
}

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

/** Repairs an export in place. Returns the moves made, as [from, to] paths relative to `root`. */
export function fixSegmentFiles(root: string): Array<[string, string]> {
  const moves: Array<[string, string]> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (!statSync(full).isDirectory()) continue;
      if (!name.startsWith("__next")) {
        walk(full);
        continue;
      }
      for (const rest of filesUnder(full)) {
        const from = path.join(full, ...rest);
        const to = path.join(dir, flatSegmentName([name, ...rest]));
        if (existsSync(to)) throw new Error(`fix-segment-files: ${path.relative(root, to)} already exists; refusing to overwrite it`);
        renameSync(from, to);
        moves.push([path.relative(root, from), path.relative(root, to)]);
      }
      removeEmpty(full);
    }
  };
  walk(root);
  return moves;
}
