// Where the company popup goes (architecture plan, "Card placement"; map-spec §8). Pure and DOM-free.
//
// Desktop: the popup tries four positions around the marker (right, left, above, below) and takes the first that
// lies fully inside the visible map area with a 12 px gap from the marker. If none fits, the map eases until the
// marker sits where the right-hand position fits. The popup never overlaps its marker.
// Mobile: the popup is a bottom sheet, and the map eases so the marker sits in the middle of the uncovered area.

export type Rect = { left: number; top: number; right: number; bottom: number };
export type Size = { width: number; height: number };
export type MarkerDisc = { x: number; y: number; radius: number };

export type PopupSide = "right" | "left" | "above" | "below";

export const POPUP_GAP = 12;
const SIDES: readonly PopupSide[] = ["right", "left", "above", "below"];

export type PopupPlacement = {
  side: PopupSide;
  /** The popup's top-left corner, px, in the same space as the marker. */
  left: number;
  top: number;
  /** How far to move the map (its content, in px) so the popup fits; zero when it already does. */
  pan: { dx: number; dy: number };
};

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** The popup's corner on `side`, centred on the marker along the other axis and then pulled inside the area. */
function cornerFor(side: PopupSide, marker: MarkerDisc, size: Size, area: Rect, gap: number): { left: number; top: number } {
  const reach = marker.radius + gap;
  const fitX = (left: number) => clamp(left, area.left, area.right - size.width);
  const fitY = (top: number) => clamp(top, area.top, area.bottom - size.height);
  switch (side) {
    case "right": return { left: marker.x + reach, top: fitY(marker.y - size.height / 2) };
    case "left": return { left: marker.x - reach - size.width, top: fitY(marker.y - size.height / 2) };
    case "above": return { left: fitX(marker.x - size.width / 2), top: marker.y - reach - size.height };
    case "below": return { left: fitX(marker.x - size.width / 2), top: marker.y + reach };
  }
}

const inside = (left: number, top: number, size: Size, area: Rect) =>
  left >= area.left && top >= area.top && left + size.width <= area.right && top + size.height <= area.bottom;

/** A popup that is still beside the marker after being pulled into the area (its span covers the marker's axis). */
function pointsAtMarker(side: PopupSide, corner: { left: number; top: number }, marker: MarkerDisc, size: Size): boolean {
  return side === "right" || side === "left"
    ? marker.y >= corner.top && marker.y <= corner.top + size.height
    : marker.x >= corner.left && marker.x <= corner.left + size.width;
}

/** Distance from the marker's centre to the nearest point of the popup's box. */
export function distanceToPopup(marker: MarkerDisc, left: number, top: number, size: Size): number {
  const nx = clamp(marker.x, left, left + size.width);
  const ny = clamp(marker.y, top, top + size.height);
  return Math.hypot(marker.x - nx, marker.y - ny);
}

/**
 * Desktop placement. `area` is the visible map area: the canvas minus the list panel and the map controls.
 * With no fitting side, the right-hand side is returned together with the pan that makes it fit.
 */
export function placePopup(marker: MarkerDisc, size: Size, area: Rect, gap = POPUP_GAP): PopupPlacement {
  for (const side of SIDES) {
    const corner = cornerFor(side, marker, size, area, gap);
    if (inside(corner.left, corner.top, size, area) && pointsAtMarker(side, corner, marker, size)) {
      return { side, ...corner, pan: { dx: 0, dy: 0 } };
    }
  }
  // Nothing fits: move the marker to where the right-hand popup fits, as far left as that takes and no further
  // than keeps the whole marker in view; and to the middle of the vertical room the popup needs.
  const reach = marker.radius + gap;
  const targetX = clamp(marker.x, area.left + marker.radius, Math.max(area.left + marker.radius, area.right - size.width - reach));
  const targetY = clamp(marker.y, area.top + size.height / 2, Math.max(area.top + size.height / 2, area.bottom - size.height / 2));
  return {
    side: "right",
    left: targetX + reach,
    top: targetY - size.height / 2,
    pan: { dx: targetX - marker.x, dy: targetY - marker.y },
  };
}

export type SheetLayout = {
  /** The sheet's height, px. */
  height: number;
  /** Bottom padding to give the map so its centre is the middle of the uncovered area. */
  paddingBottom: number;
  /** How far to move the map so the marker sits in the middle of the uncovered area. */
  pan: { dx: number; dy: number };
};

/** The sheet's peek and expanded heights as fractions of the screen (architecture plan). */
export const SHEET_PEEK = 0.3;
export const SHEET_EXPANDED = 0.6;

/** Mobile bottom sheet: the map's bottom padding is the sheet's height, and the marker is centred in what remains. */
export function placeSheet(marker: MarkerDisc, viewport: Size, fraction: number = SHEET_PEEK): SheetLayout {
  const height = Math.round(viewport.height * fraction);
  const visibleHeight = viewport.height - height;
  return {
    height,
    paddingBottom: height,
    pan: { dx: viewport.width / 2 - marker.x, dy: visibleHeight / 2 - marker.y },
  };
}
