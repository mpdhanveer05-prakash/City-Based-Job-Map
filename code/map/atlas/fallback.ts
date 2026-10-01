// Letter fallback for a company logo (map-spec §5): the initial on one of five non-green swatches,
// picked by a hash of the name. Pure. The swatch colours live in the tokens (map/theme.ts).

/** FNV-1a, 32-bit. Stable across engines, so a company keeps its swatch on every device and build. */
export function hashName(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const SWATCH_COUNT = 5;

export const swatchIndex = (name: string): number => hashName(name.trim().toLowerCase()) % SWATCH_COUNT;

/** The first letter A–Z of the name, or "?" when it has none. Accents fold to their base letter. */
export function initialOf(name: string): string {
  const folded = name.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const match = /[A-Za-z]/.exec(folded);
  return match ? match[0].toUpperCase() : "?";
}
