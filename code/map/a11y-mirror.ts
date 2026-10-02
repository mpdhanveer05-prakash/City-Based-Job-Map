// The keyboard model for the mirror list (map-spec §8). Pure and DOM-free.
//
// A visually hidden, focusable list mirrors the markers drawn on the map. Tab reaches the list once (roving
// tabindex); the arrow keys then move focus to the neighbouring marker *as drawn* (spatial navigation), Home and End
// jump to the first and last in reading order, Enter opens the marker, and the layer draws the focus ring on the
// focused marker.
import type { MarkerKindName } from "./hit-test/hit-test.ts";

export type MirrorEntry = {
  key: string;
  kind: MarkerKindName;
  /** Screen position, CSS px. */
  x: number;
  y: number;
  radius: number;
  opacity?: number;
};

export type MirrorBounds = { width: number; height: number };

/** A marker that is mostly faded is on its way in or out; it is not listed. */
export const MIN_MIRROR_OPACITY = 0.5;

/** Rows for reading order: markers whose centres are within this many px vertically read left to right. */
const ROW_PX = 40;

const lexical = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The markers a person can reach: visible (inside the map, not fading), in reading order (top row to bottom row,
 * left to right inside a row, ties by key). The order is the Tab and screen-reader order, so it must not depend on
 * the order the layer happens to draw in.
 */
export function mirrorEntries(drawn: readonly MirrorEntry[], bounds: MirrorBounds): MirrorEntry[] {
  return drawn
    .filter(
      (d) =>
        (d.opacity ?? 1) >= MIN_MIRROR_OPACITY && d.x >= 0 && d.x <= bounds.width && d.y >= 0 && d.y <= bounds.height,
    )
    .sort((a, b) => Math.round(a.y / ROW_PX) - Math.round(b.y / ROW_PX) || a.x - b.x || lexical(a.key, b.key));
}

export type Direction = "up" | "down" | "left" | "right";

const VECTORS: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * The marker one arrow key away from `fromKey`: the nearest one whose centre lies ahead of it, preferring those
 * straight ahead (sideways distance counts double). Returns null at the edge of the map, so focus stays where it is.
 */
export function neighbour(entries: readonly MirrorEntry[], fromKey: string, direction: Direction): MirrorEntry | null {
  const from = entries.find((e) => e.key === fromKey);
  if (!from) return null;
  const v = VECTORS[direction];
  let best: { entry: MirrorEntry; score: number } | null = null;
  for (const e of entries) {
    if (e === from) continue;
    const dx = e.x - from.x;
    const dy = e.y - from.y;
    const ahead = dx * v.x + dy * v.y;
    if (ahead <= 0) continue;
    const sideways = Math.abs(dx * v.y - dy * v.x);
    // Inside a 90° cone, straight ahead is better; outside it, a marker is still reachable but costs more.
    const score = ahead + 2 * sideways + (sideways > ahead ? 1000 : 0);
    if (!best || score < best.score || (score === best.score && lexical(e.key, best.entry.key) < 0)) best = { entry: e, score };
  }
  return best?.entry ?? null;
}

export type MirrorKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";

const ARROWS: Record<string, Direction> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

/** The key to focus after `pressed`, or null when the press does nothing here (not a navigation key, or an edge). */
export function nextFocus(entries: readonly MirrorEntry[], currentKey: string | null, pressed: string): string | null {
  if (entries.length === 0) return null;
  if (pressed === "Home") return entries[0].key;
  if (pressed === "End") return entries[entries.length - 1].key;
  const direction = ARROWS[pressed];
  if (!direction) return null;
  if (currentKey === null || !entries.some((e) => e.key === currentKey)) return entries[0].key;
  return neighbour(entries, currentKey, direction)?.key ?? null;
}

/** The entry to keep as the one tab stop: the focused one if it is still listed, otherwise the first. */
export function tabStop(entries: readonly MirrorEntry[], focusedKey: string | null): string | null {
  if (entries.length === 0) return null;
  return entries.some((e) => e.key === focusedKey) ? focusedKey : entries[0].key;
}
