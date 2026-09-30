# Design System

This covers the visual rules for the whole application: the public pages, the explorer and map layer, and the admin workspace. Items are tagged **[Confirmed]** when they come from the project owner and **[Proposal]** when they're suggested here and still need agreement (normally from the product designer).

**Brand colours [Confirmed, 30 Sep 2026]:** **Milky `#FFFDF1`** and **Mantis `#59C749`**.

> **The palette may change.** The owner will review the combination once it's visible in the running UI and may replace it. That's why every colour lives in the tokens in §8: a new palette means new token values, a re-run of the contrast table in §1, and the derived tokens re-derived. Components, shaders, and the basemap overrides stay untouched.

## 1. Palette

Only Milky and Mantis are brand colours. Every other value below is derived from them to make the pair usable and accessible. [Proposal]

| Token | Hex | Role |
| --- | --- | --- |
| `milky` | `#FFFDF1` | **Brand.** Page background, panels, popups, the land colour of the basemap |
| `mantis` | `#59C749` | **Brand.** Fills only: primary buttons, map cluster discs, the selected-filter check |
| `ink` | `#1F3A1A` | All body text and headings, text on Mantis, focus rings. A deep green-black, so the neutrals share Mantis's hue |
| `mantis-deep` | `#2F7A24` | Mantis wherever it has to read as text or a line: links, the selected-marker ring, active tab underline |
| `mantis-wash` | `#E1F3D3` | Milky mixed with 18% Mantis. Selected list rows, selected filter chips, hover on synced rows |
| `milky-shade` | `#F4F0DA` | Recessed surfaces: the search field, table header, skeletons, basemap buildings |
| `moss` | `#5A6655` | Secondary text, marker outlines, spider legs, basemap labels |
| `field` | `#7F8874` | Input and checkbox borders (the minimum 3:1 boundary) |
| `rule` | `#E2DDC6` | Decorative dividers and tile borders only, never the sole boundary of a control |
| `danger` | `#B3261E` | Errors and destructive admin actions. White text on it |

### Contrast (WCAG 2.2, computed 30 Sep 2026)

| Pair | Ratio | Allowed use |
| --- | --- | --- |
| Ink on Milky | 12.26 | Any text |
| Ink on Mantis | 5.77 | Button labels, cluster counts |
| Ink on Mantis Wash | 10.70 | Any text |
| Ink on Milky Shade | 10.92 | Any text |
| Mantis Deep on Milky | 5.23 | Links, text at any size, 3 px rings |
| Mantis Deep on Milky Shade | 4.66 | Text at any size |
| Mantis Deep on Mantis Wash | 4.57 | Text at any size |
| Moss on Milky | 5.93 | Secondary text |
| Field on Milky | 3.62 | Control borders (the 3:1 minimum for non-text) |
| Danger on Milky | 6.40 | Error text |
| White on Danger | 6.54 | Destructive button labels |
| **Mantis on Milky** | **2.12** | **Never for text, icons, or thin lines.** Filled shapes only, and every filled shape carries an Ink label or an Ink/Milky edge |
| **White on Mantis** | **2.17** | **Never.** Text on Mantis is always Ink |

### Colour rules [Proposal]
1. **Mantis means "go".** On the map, Mantis marks where companies are. Everywhere else it marks the one next step on each screen (View company, View jobs, Apply). Each view has at most one Mantis button. Secondary actions are Milky with a 1.5 px Ink border.
2. **Mantis is a fill, never a stroke or a text colour on Milky.** Use Mantis Deep when green has to be read.
3. **Colour is never the only signal.** A selected chip gets Mantis Wash *and* a check icon. An error gets Danger text *and* a message.
4. **No gradients, no tinted shadows used as decoration, no other accent hues.**

## 2. Map colours

The map is where the brand does most of its work. These rules extend [map-spec.md](map-spec.md). [Proposal]

**The basemap gives up green.** Default vector styles paint parks and forests green, which would compete with the Mantis clusters. The Geoapify style is loaded and its paint properties are overridden in MapLibre (P1-05 checks that the terms allow this):

| Basemap feature | Colour |
| --- | --- |
| Land | Milky `#FFFDF1` |
| Parks, forest, grass | `#ECE9D6` (a stone tint, deliberately not green) |
| Water | `#D6E4F0` |
| Buildings | Milky Shade `#F4F0DA` |
| Roads | `#FFFFFF` with a Rule `#E2DDC6` casing |
| Labels | Moss `#5A6655` with a 1.5 px Milky halo |
| City boundary | 1.5 px Moss, dashed |

**Markers**
| Element | Drawing |
| --- | --- |
| Cluster (nearby companies) | A Mantis disc with a 2 px Milky halo. Its count is Ink, Overpass 800. The diameter scales with log(count) from 36 to 64 px |
| Logo marker | A 40 px disc (per the plan) with the logo on Milky and a 2 px Moss ring. The ring gives the 3:1 edge against the pale basemap |
| Co-location stack (same place) | The top logo, plus an **Ink** count badge with Milky numerals. Ink rather than Mantis, so "same building" never reads as "nearby cluster" |
| Spider legs | 1.5 px Moss lines |
| Selected marker | 1.25× scale and a **3 px Mantis Deep ring** (map-spec §8). A cluster that swallows the selected marker inherits the ring |
| Keyboard focus on a marker | A 2 px Ink ring, offset 3 px. It stays distinct from selection, so both can show at once |
| Letter fallback | The Ink initial on one of five muted swatches chosen by a hash of the name: Sand `#F2E2B3`, Sky `#D6E4F0`, Rose `#F0D5CE`, Lilac `#E2DAEE`, Stone `#E6E1D3` (Ink reaches 9:1 or better on each). **No greens**, so a fallback can't be mistaken for a cluster. It keeps the 2 px Moss ring |

The WebGL layer reads these values once at init from the CSS custom properties (`getComputedStyle(document.documentElement)`) in `map/theme.ts`, so the colours are defined once. Map code stays free of React.

## 3. Typography [Proposal]

**One family: [Overpass](https://fonts.google.com/specimen/Overpass)** (variable, 100–900, SIL OFL). It is an open-source descendant of Highway Gothic, the lettering used on road signs. That makes it a wayfinding face for a product about finding where companies are, and it holds up at the small sizes of map popups. It loads through `next/font/google` (`subsets: ['latin']`, `display: 'swap'`), with `system-ui` as the fallback.

The scale is the classic typographic scale (Bringhurst):

| Size / line-height | Weight | Use |
| --- | --- | --- |
| 72 / 72 (48 / 52 on mobile) | 800, tracking −0.02em | City names on `/`, the only display size |
| 36 / 40 | 700 | Page titles (the company name) |
| 24 / 30 | 700 | Section headings |
| 18 / 26 | 600 | Job titles, the company name in a popup or tile |
| 16 / 24 | 400 | Body text, at most 72ch per line |
| 14 / 20 | 400, 600 for labels | Secondary text, filter labels, freshness lines |
| 12 / 16 | 400 | Map attribution and legal text only |

- Everything is sentence case. No all-caps labels, no letter-spaced eyebrows above headings, and no single highlighted word in a headline.
- Overpass has a `tnum` feature, but its default digits are proportional (checked with fontTools in P1-01). Every count in lists, filters, and tables uses `tabular-nums`. The cluster digit atlas uses fixed-width cells.
- Cluster numerals are rasterised from Overpass 800 into the digit atlas (map-spec §5).

## 4. Shape, space, and elevation [Proposal]

- **Round means a company.** Logo discs, clusters, and stacks are circles, in the map, popups, tiles, and admin tables alike. Everything else (buttons, inputs, chips, panels, popups, sheets) is a rectangle with a **4 px** radius. Chips are not pills.
- **Spacing:** a 4 px base with the steps 4, 8, 12, 16, 24, 32, 48, 72. Side gutters are 16 px on mobile and 24 px on desktop.
- **Elevation exists only over the map.** The toolbar, popup, and bottom sheet float on the map and get a 1 px Rule border plus `0 1px 0 rgb(31 58 26 / .08), 0 6px 16px rgb(31 58 26 / .14)`. Content on a Milky page has no shadows.
- **Grid view is ruled tiles, not floating cards.** Tiles sit on Milky, separated by 1 px Rule lines, with no shadow and no radius.
- **Touch targets** are at least 44 × 44 px (CLAUDE.md).
- **Focus** is a 2 px Ink outline with a 2 px offset on every interactive element (`--ring`). It stays visible against Milky (12.26) and next to Mantis (5.77).

## 5. Layout [Proposal]

Content is left-aligned everywhere. Numbers are right-aligned in tables. Nothing is centre-aligned except the digits inside a map disc.

**City selection `/`.** This is the page's one memorable moment. Each city is drawn as its real boundary filled with its real office points as Mantis dots, with the name set large. The artwork is decorative (`aria-hidden`); the name and count are the accessible content. Until real data exists, only the boundary outline is drawn. Synthetic dots are never shown as real (CLAUDE.md hard rules).

```
┌──────────────────────────────────────────────────┐
│ Company Map                                       │
│                                                   │
│ Find companies by where they work.                │  36/700
│                                                   │
│ ┌───────────────────────┐ ┌───────────────────────┐│
│ │   .  .:::. .          │ │     . .:.             ││  boundary: 1 px Moss
│ │  . .::::::::. .       │ │    .::::::.           ││  dots: Mantis, office points
│ │    ':::::::'          │ │     ':::::.           ││
│ │ Bengaluru             │ │ Chennai               ││  72/800
│ │ N companies           │ │ N companies           ││  14, from the API
│ └───────────────────────┘ └───────────────────────┘│
│ Coming soon: Hyderabad, Pune, Mumbai               │  Moss, not links
└──────────────────────────────────────────────────┘
```

**Explorer (desktop).** A full-screen map with one floating toolbar, 16 px from the top-left edge.

```
┌──────────────────────────────────────────────────────────────┐
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Bengaluru ▾  [ Search jobs, companies, areas, founders ] │ │  toolbar (Milky, elevated)
│ │ [Type ▾] [Stage ▾]  N companies in M offices  [Map|Grid|List] │
│ └──────────────────────────────────────────────────────────┘ │
│          (38)        ◯ ◯                                     │
│                 ◯  (112)          basemap: Milky, stone parks │
│     ◯                   ┌────────────────────┐               │
│                         │ ◯ Company name     │  popup        │
│                         │ Startup, Product   │               │
│                         │ Koramangala        │               │
│                         │ 12 open jobs       │               │
│                         │ [ View company ]   │  Mantis       │
│                         └────────────────────┘               │
│                                            © Geoapify © OSM  │
└──────────────────────────────────────────────────────────────┘
```

**Explorer (mobile).** The toolbar shrinks to the search field plus a Filters button. The popup, spider lists over 20, and the filter panel open as bottom sheets.

```
┌──────────────────────┐
│ [ Search…    ][⚙ 2]  │  ⚙ = Filters, with the active count
│ [Map|Grid|List]      │
│    (38)    ◯         │
│        ◯ (112)       │
│┌────────────────────┐│
││ ◯ Company name     ││  bottom sheet
││ Startup, Product   ││
││ [ View company   ] ││
│└────────────────────┘│
└──────────────────────┘
```

**Company page and jobs.** One column, at most 72ch wide. "View jobs" is the Mantis action and "Visit website" is secondary. On the jobs page, each row is only the title plus Apply [Confirmed], with the rows separated by Rule lines.

```
Back to map                                (keeps filters)
◯  Company name                             36/700
   Startup and Product company, Series A    14 Moss
   Koramangala, Bengaluru
   [ View jobs ]  [ Visit website ]
────────────────────────────────────────
Checked 2 days ago                          14 Moss
Senior backend engineer             [ Apply ]
────────────────────────────────────────
Product designer                    [ Apply ]
```

**Admin workspace:** the same tokens and type, with dense tables (14/20), Rule row lines, and Danger reserved for delete and unpublish.

## 6. Motion [Proposal]

- The one orchestrated moment is the cluster split and merge on the map ([map-spec.md §4](map-spec.md#4-animation)). Nothing else moves by itself: there are no entrance animations on sections and no hover lifts on tiles.
- Motion in response to an action is allowed when it shows what changed. Popups, sheets, and menus open in 160 ms ease-out and close in 120 ms.
- `prefers-reduced-motion: reduce` makes every UI transition instant, and the map follows map-spec §4.

## 7. Words [Proposal]

- Use the confirmed action names exactly, everywhere in the flow: **View company, Visit website, View jobs, Apply**. Apply adds visually hidden text: "(opens the employer's site)".
- Write counts as words: "38 companies in 41 offices". UI strings don't join fragments with middle dots.
- Links don't end in arrows. Back links read "Back to map".
- Empty and error states say what happened and what to do:
  - No results: "No companies match these filters." plus [Clear filters]
  - No jobs: "This company has no open jobs listed right now." plus [Visit website]
  - No WebGL: "The map can't run in this browser, so you're seeing the list view."
  - Tiles failed: "Map tiles didn't load." plus [Retry] and [Show list]

## 8. Implementation

The tokens are in `code/app/globals.css` (done in P1-01) and mapped onto the shadcn/ui variable names. Tailwind reads them through `@theme inline`. The block below is the core of that file.

```css
:root {
  /* brand */
  --milky: #FFFDF1;
  --mantis: #59C749;
  /* derived */
  --ink: #1F3A1A;
  --mantis-deep: #2F7A24;
  --mantis-wash: #E1F3D3;
  --milky-shade: #F4F0DA;
  --moss: #5A6655;
  --field: #7F8874;
  --rule: #E2DDC6;
  --danger: #B3261E;

  /* shadcn/ui roles */
  --background: var(--milky);
  --foreground: var(--ink);
  --card: var(--milky);
  --card-foreground: var(--ink);
  --popover: var(--milky);
  --popover-foreground: var(--ink);
  --primary: var(--mantis);
  --primary-foreground: var(--ink);   /* never white: 2.17:1 */
  --secondary: var(--milky-shade);
  --secondary-foreground: var(--ink);
  --muted: var(--milky-shade);
  --muted-foreground: var(--moss);
  --accent: var(--mantis-wash);
  --accent-foreground: var(--ink);
  --destructive: var(--danger);
  --border: var(--rule);
  --input: var(--field);
  --ring: var(--ink);
  --radius: 4px;
}
```

- Tailwind's default colour palette and type scale are reset in `@theme`, so `bg-red-500` or `text-3xl` produce nothing. Only the tokens and the §3 scale exist.
- Links are always underlined: Mantis Deep against Ink body text is only 2.34:1, so colour alone can't mark a link.
- The shadcn `.dark` block is removed. **There is no dark mode at launch** [Proposal]: Milky is the brand ground. A dark theme would need its own contrast table and an ADR.
- `code/tests/unit/design-tokens.test.ts` parses `app/globals.css` and asserts every pair in the contrast table above (the list is in `code/lib/design/tokens.ts`), so a token change that breaks contrast fails CI.
- `/dev/tokens` renders the palette, buttons, chips, marker previews, type scale, and live contrast table for review. It runs under `npm run dev`, and in a production build only with `DEV_ROUTES=on`.
- axe's `color-contrast` rule stays on in the Playwright accessibility suite.
- `map/theme.ts` converts the CSS variables to the linear RGBA values the shaders need (§2).

## 9. Choices checked against the brief

The first-draft instinct for each of these was a generic default. Here is what changed and why:

- **Mantis for links and headings** measured 2.12:1 on Milky, so it would fail WCAG. Mantis is now a fill only, and Mantis Deep carries green text.
- **A stock UI sans** fits any product. It was replaced with Overpass, whose road-sign lineage ties it to wayfinding and the map.
- **A basemap with green parks** would blur the one meaning of Mantis. The parks are stone-coloured now, so green means "companies are here".
- **Rainbow hash colours for letter fallbacks** clashed with the palette and could imitate clusters. Five muted non-green swatches replace them.
- **Rounded, shadowed Grid cards** are the stock SaaS kit. They became ruled tiles, and roundness is reserved for companies.
- **A giant stat hero on `/`** became the real office distribution drawn inside each city's boundary.

## Open items
- Review the palette in the running UI; the owner may change it (see the note at the top). Owner: product owner.
- The derived tokens, the font, and the map-colour rules need the product designer's sign-off (plan.md, Sprints 0–4).
- Geoapify terms for overriding style paint properties: unverified, checked in P1-05.
