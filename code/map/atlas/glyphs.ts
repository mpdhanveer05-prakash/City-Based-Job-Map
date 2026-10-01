// The glyph sheet's character set and text layout (map-spec §5: cluster counts come from a digit atlas).
// Pure, so layout is testable in Node. The browser-side rasteriser is glyph-sheet.ts.

/** Cell order in the sheet: digits, count suffixes, then the letters used for fallback initials. */
export const GLYPH_CHARS = "0123456789k.+ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const GLYPH_COUNT = GLYPH_CHARS.length;
export const GLYPH_COLUMNS = 8;
export const GLYPH_ROWS = Math.ceil(GLYPH_COUNT / GLYPH_COLUMNS);

/** Slots per text run in the shader. */
export const MAX_GLYPHS = 4;

export function glyphCell(char: string): number {
  return GLYPH_CHARS.indexOf(char);
}

/** Horizontal advance of each cell, as a fraction of the cell width (which is the text's em size). */
export type GlyphMetrics = { advances: number[] };

export type TextLayout = {
  /** Cell indices, -1 for an empty slot. */
  cells: [number, number, number, number];
  /** Each glyph's centre, in em units from the middle of the run. */
  xs: [number, number, number, number];
  /** Total width of the run in em units. */
  width: number;
};

/** Lays out up to `max` glyphs (default four) centred on 0. Characters outside the sheet are skipped; letters are upper-cased. */
export function layoutText(text: string, metrics: GlyphMetrics, max: number = MAX_GLYPHS): TextLayout {
  const cells = [-1, -1, -1, -1] as TextLayout["cells"];
  const xs = [0, 0, 0, 0] as TextLayout["xs"];
  const chosen: number[] = [];
  for (const ch of text) {
    const cell = glyphCell(ch === "k" ? ch : ch.toUpperCase());
    if (cell >= 0) chosen.push(cell);
    if (chosen.length === max) break;
  }
  const width = chosen.reduce((sum, cell) => sum + metrics.advances[cell], 0);
  let cursor = -width / 2;
  chosen.forEach((cell, i) => {
    cells[i] = cell;
    xs[i] = cursor + metrics.advances[cell] / 2;
    cursor += metrics.advances[cell];
  });
  return { cells, xs, width };
}
