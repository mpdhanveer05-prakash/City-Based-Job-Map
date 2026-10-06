// The router's prefetch files in a static export (P9-17). Next 16 writes each page segment's payload as
// `<page>/__next<segment path with "/" replaced by ".">.txt` and the client asks for exactly that name. On Windows the
// segment path it collects uses "\" (path.relative), which the "/" replacement misses, so the file lands in nested
// folders (`__next.admin\companies\__PAGE__.txt`) and every prefetch of it answers 404. A Linux build is correct.
// scripts/fix-segment-files.mts moves such files to the flat name; on a correct build it finds nothing to move.

/** The flat file name for a file found at `parts` (folders, then the file) under a page directory. */
export function flatSegmentName(parts: readonly string[]): string {
  if (parts.length < 2 || !parts[0].startsWith("__next")) throw new Error(`not a nested segment file: ${parts.join("/")}`);
  return parts.join(".");
}
