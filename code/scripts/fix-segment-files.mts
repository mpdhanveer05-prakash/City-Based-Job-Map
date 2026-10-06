// postbuild (P9-17): moves the router's prefetch files that a Windows export nests in folders to the flat names the
// client requests (lib/segment-files.ts). It moves, never copies, so the file count is unchanged; a correct export is
// left untouched; running it twice is safe. Usage: node scripts/fix-segment-files.mts out
import path from "node:path";
import { fixSegmentFiles } from "../lib/segment-files.ts";

const moves = fixSegmentFiles(path.resolve(process.argv[2] ?? "out"));
console.log(
  moves.length === 0
    ? "fix-segment-files: nothing to move (the export wrote the flat names)"
    : `fix-segment-files: moved ${moves.length} prefetch files to their flat names`,
);
