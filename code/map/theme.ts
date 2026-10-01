// Map colours, read once from the CSS tokens in app/globals.css (docs/design-system.md §2).
// No colour is written here: a palette swap stays a token-only change. No React.

export interface BasemapTheme {
  land: string;
  park: string;
  water: string;
  building: string;
  buildingEdge: string;
  road: string;
  roadCasing: string;
  label: string;
  labelHalo: string;
  boundary: string;
}

/** Which token feeds each basemap role (design-system.md §2, basemap table). */
const BASEMAP_TOKENS: Record<keyof BasemapTheme, string> = {
  land: "--milky",
  park: "--map-park",
  water: "--map-water",
  building: "--milky-shade",
  buildingEdge: "--rule",
  road: "--map-road",
  roadCasing: "--rule",
  label: "--moss",
  labelHalo: "--milky",
  boundary: "--rule",
};

/** Resolves the basemap theme from any source of custom properties (testable without a DOM). */
export function resolveBasemapTheme(getVar: (name: string) => string): BasemapTheme {
  const theme = {} as BasemapTheme;
  for (const [role, token] of Object.entries(BASEMAP_TOKENS) as [keyof BasemapTheme, string][]) {
    const value = getVar(token).trim();
    if (!value) throw new Error(`Design token ${token} is not defined (needed for basemap ${role})`);
    theme[role] = value;
  }
  return theme;
}

export function readBasemapTheme(root: Element = document.documentElement): BasemapTheme {
  const styles = getComputedStyle(root);
  return resolveBasemapTheme((name) => styles.getPropertyValue(name));
}

/** Linear-free sRGB channels in 0…1, as the shaders take them. */
export type Rgb = [r: number, g: number, b: number];

/** Marker colours (design-system.md §2, Markers table). Each is a CSS colour string from a token. */
export interface MarkerTheme {
  clusterFill: string;
  clusterHalo: string;
  clusterText: string;
  logoFill: string;
  logoRing: string;
  stackBadge: string;
  stackBadgeText: string;
  selectionRing: string;
  focusRing: string;
  spiderLeg: string;
  /** The five non-green letter-fallback swatches, in the order the name hash picks them. */
  swatches: [string, string, string, string, string];
}

const MARKER_TOKENS: Record<Exclude<keyof MarkerTheme, "swatches">, string> = {
  clusterFill: "--mantis",
  clusterHalo: "--milky",
  clusterText: "--ink",
  logoFill: "--milky",
  logoRing: "--moss",
  stackBadge: "--ink",
  stackBadgeText: "--milky",
  selectionRing: "--mantis-deep",
  focusRing: "--ink",
  spiderLeg: "--moss",
};

export const SWATCH_TOKENS = ["--swatch-sand", "--swatch-sky", "--swatch-rose", "--swatch-lilac", "--swatch-stone"] as const;

export function resolveMarkerTheme(getVar: (name: string) => string): MarkerTheme {
  const read = (token: string, role: string) => {
    const value = getVar(token).trim();
    if (!value) throw new Error(`Design token ${token} is not defined (needed for marker ${role})`);
    return value;
  };
  const theme = {} as MarkerTheme;
  for (const [role, token] of Object.entries(MARKER_TOKENS) as [Exclude<keyof MarkerTheme, "swatches">, string][]) {
    theme[role] = read(token, role);
  }
  theme.swatches = SWATCH_TOKENS.map((token) => read(token, "letter swatch")) as MarkerTheme["swatches"];
  return theme;
}

export function readMarkerTheme(root: Element = document.documentElement): MarkerTheme {
  const styles = getComputedStyle(root);
  return resolveMarkerTheme((name) => styles.getPropertyValue(name));
}

/** Parses `#rgb`, `#rrggbb`, `rgb(r g b)` and `rgb(r, g, b)` (the forms a custom property can hold). */
export function parseCssColor(value: string): Rgb {
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
  }
  const fn = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/.exec(v);
  if (fn) return [Number(fn[1]) / 255, Number(fn[2]) / 255, Number(fn[3]) / 255];
  throw new Error(`Cannot parse the colour "${value}"`);
}
