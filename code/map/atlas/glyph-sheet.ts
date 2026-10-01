// Rasterises the glyph sheet (digits, count suffixes, fallback initials) from Overpass 800 into one canvas.
// Browser only. The sheet holds white glyphs in the alpha channel; the shader tints them with Ink or Milky.
import { GLYPH_CHARS, GLYPH_COLUMNS, GLYPH_ROWS, type GlyphMetrics } from "./glyphs.ts";

export type GlyphSheet = {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  cellPx: number;
  columns: number;
  rows: number;
  metrics: GlyphMetrics;
  /** False when the requested face did not load and the browser substituted another. */
  fontLoaded: boolean;
};

/** 64 px cells below DPR 1.5 and 128 px cells at or above it (map-spec §5). */
export const cellSizeForDpr = (dpr: number): 64 | 128 => (dpr >= 1.5 ? 128 : 64);

/** Glyph ink is drawn at this fraction of the cell, so it never touches a neighbouring cell when mip-mapped. */
const FONT_FRACTION = 0.7;
const DIGITS = "0123456789";

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export async function buildGlyphSheet(fontFamily: string, cellPx: number): Promise<GlyphSheet> {
  const fontSize = cellPx * FONT_FRACTION;
  const font = `800 ${fontSize}px ${fontFamily}`;
  await document.fonts.load(font, GLYPH_CHARS);
  const fontLoaded = document.fonts.check(font, GLYPH_CHARS);

  const canvas = createCanvas(GLYPH_COLUMNS * cellPx, GLYPH_ROWS * cellPx);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error("A 2D canvas is not available to build the glyph sheet.");
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "white"; // a mask: the shader supplies the colour, so no theme colour is baked in

  // One baseline for every glyph, set from the digit height, so "." and "k" sit with the numerals.
  const capHeight = ctx.measureText("0").actualBoundingBoxAscent;
  const widths = [...GLYPH_CHARS].map((ch) => ctx.measureText(ch).width / cellPx);
  // Overpass's digits are proportional; counts need fixed-width cells, so every digit takes the widest advance.
  const digitAdvance = Math.max(...[...DIGITS].map((d) => widths[GLYPH_CHARS.indexOf(d)]));
  const advances = widths.map((w, i) => (DIGITS.includes(GLYPH_CHARS[i]) ? digitAdvance : w));

  [...GLYPH_CHARS].forEach((ch, i) => {
    const col = i % GLYPH_COLUMNS;
    const row = Math.floor(i / GLYPH_COLUMNS);
    ctx.fillText(ch, col * cellPx + cellPx / 2, row * cellPx + cellPx / 2 + capHeight / 2);
  });

  return { canvas, cellPx, columns: GLYPH_COLUMNS, rows: GLYPH_ROWS, metrics: { advances }, fontLoaded };
}
