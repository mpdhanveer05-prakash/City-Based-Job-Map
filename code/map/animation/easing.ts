// Easing curves and timings for marker transitions (map-spec §4). Pure.

export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;
export const easeOutCubic: Easing = (t) => 1 - (1 - t) ** 3;
export const easeInCubic: Easing = (t) => t * t * t;

/** Durations in ms. Split and merge are the plan's proposals (map-spec §4); the rest are mine. */
export const SPLIT_MS = 280;
export const MERGE_MS = 220;
/** An item entering or leaving because the view panned, not because the zoom level changed. */
export const PAN_MS = 120;
/** A whole scene replaced (filter change, data load, a jump of several levels, first draw). */
export const CROSSFADE_MS = 200;
/** prefers-reduced-motion: an opacity change of at most this long, and no movement. */
export const REDUCED_MS = 100;
/** More items than this moving at once cross-fade instead (map-spec §4). */
export const MAX_MOVING = 250;
