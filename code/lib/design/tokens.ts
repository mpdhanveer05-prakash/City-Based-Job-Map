// Names and required contrast pairs for the tokens defined in app/globals.css.
// The values live only in the CSS; see docs/design-system.md §1.

export const PALETTE = [
  { token: "milky", role: "Brand. Page background, panels, basemap land" },
  { token: "mantis", role: "Brand. Fills only: primary buttons, clusters" },
  { token: "ink", role: "Text, text on Mantis, focus rings" },
  { token: "mantis-deep", role: "Green that has to be read: links, selected ring" },
  { token: "mantis-wash", role: "Selected rows and chips" },
  { token: "milky-shade", role: "Recessed surfaces" },
  { token: "moss", role: "Secondary text, marker outlines" },
  { token: "field", role: "Input and checkbox borders" },
  { token: "rule", role: "Decorative dividers only" },
  { token: "danger", role: "Errors and destructive actions" },
] as const;

export const FALLBACK_SWATCHES = [
  "swatch-sand",
  "swatch-sky",
  "swatch-rose",
  "swatch-lilac",
  "swatch-stone",
] as const;

export type TokenName =
  | (typeof PALETTE)[number]["token"]
  | (typeof FALLBACK_SWATCHES)[number];

/** A foreground/background pair and the minimum ratio its use requires. */
export type ContrastPair = {
  fg: TokenName | "white";
  bg: TokenName;
  min: 3 | 4.5;
  use: string;
};

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: "ink", bg: "milky", min: 4.5, use: "Any text" },
  { fg: "ink", bg: "mantis", min: 4.5, use: "Button labels, cluster counts" },
  { fg: "ink", bg: "mantis-wash", min: 4.5, use: "Any text" },
  { fg: "ink", bg: "milky-shade", min: 4.5, use: "Any text" },
  { fg: "mantis-deep", bg: "milky", min: 4.5, use: "Links, selected-marker ring" },
  { fg: "mantis-deep", bg: "milky-shade", min: 4.5, use: "Text" },
  { fg: "mantis-deep", bg: "mantis-wash", min: 4.5, use: "Text" },
  { fg: "moss", bg: "milky", min: 4.5, use: "Secondary text, marker rings" },
  { fg: "moss", bg: "milky-shade", min: 4.5, use: "Secondary text" },
  { fg: "field", bg: "milky", min: 3, use: "Control borders" },
  { fg: "danger", bg: "milky", min: 4.5, use: "Error text" },
  { fg: "white", bg: "danger", min: 4.5, use: "Destructive button labels" },
  { fg: "milky", bg: "ink", min: 4.5, use: "Co-location stack numerals" },
  ...FALLBACK_SWATCHES.map(
    (bg): ContrastPair => ({ fg: "ink", bg, min: 4.5, use: "Letter fallback initial" }),
  ),
];
