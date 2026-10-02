"use client";

import { useEffect, useRef } from "react";
import { nextFocus, tabStop, type MirrorEntry } from "@/map/a11y-mirror";

export type MirrorListEntry = MirrorEntry & {
  /** What a screen reader says: the company name, or "12 companies, press Enter to zoom in". */
  label: string;
};

export type MapA11yListProps = {
  entries: readonly MirrorListEntry[];
  /** The marker the layer draws the focus ring on, or null. */
  focusedKey: string | null;
  onFocusKey(key: string | null): void;
  /** Enter or Space on a marker: the same as tapping it. */
  onActivate(key: string): void;
};

/**
 * A visually hidden, focusable list that mirrors the markers drawn on the map (map-spec §8). Tab reaches it once
 * (one tab stop); the arrow keys move to the neighbouring marker as drawn, Home and End to the first and last, and
 * Enter opens the marker. The layer draws the focus ring on whichever marker is focused here. The full, visible List
 * view is always available as well and is the main non-visual route.
 */
export function MapA11yList({ entries, focusedKey, onFocusKey, onActivate }: MapA11yListProps) {
  const root = useRef<HTMLUListElement>(null);
  const stop = tabStop(entries, focusedKey);
  const focusAfterRender = useRef<string | null>(null);

  // Move DOM focus once the button for the new key exists.
  useEffect(() => {
    const key = focusAfterRender.current;
    if (!key) return;
    focusAfterRender.current = null;
    root.current?.querySelector<HTMLButtonElement>(`button[data-key="${CSS.escape(key)}"]`)?.focus();
  });

  // If the focused marker leaves the map (a zoom removed it), keep keyboard focus in the list on the new tab stop.
  useEffect(() => {
    const list = root.current;
    if (!list || !list.contains(document.activeElement)) return;
    const active = (document.activeElement as HTMLElement).dataset.key;
    if (active && !entries.some((e) => e.key === active) && stop) focusAfterRender.current = stop;
  }, [entries, stop]);

  return (
    <ul
      ref={root}
      aria-label="Companies on the map"
      data-testid="map-a11y-list"
      className="sr-only"
      onKeyDown={(event) => {
        const target = nextFocus(entries, (event.target as HTMLElement).dataset.key ?? null, event.key);
        if (target === null) return;
        event.preventDefault();
        onFocusKey(target);
        root.current?.querySelector<HTMLButtonElement>(`button[data-key="${CSS.escape(target)}"]`)?.focus();
      }}
    >
      {entries.map((entry) => (
        <li key={entry.key}>
          <button
            type="button"
            data-key={entry.key}
            tabIndex={entry.key === stop ? 0 : -1}
            onFocus={() => onFocusKey(entry.key)}
            onBlur={(event) => {
              // Focus moving to another marker in this list is handled by that marker's onFocus.
              if (!root.current?.contains(event.relatedTarget as Node | null)) onFocusKey(null);
            }}
            onClick={() => onActivate(entry.key)}
          >
            {entry.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
