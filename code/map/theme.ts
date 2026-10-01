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
