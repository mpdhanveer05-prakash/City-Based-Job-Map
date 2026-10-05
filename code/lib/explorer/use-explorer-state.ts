"use client";

// The explorer's state lives in the URL (CLAUDE.md, Conventions). This hook is the one place components
// read it and the one place they change it: `parseExplorerState` and `serializeExplorerSearch`
// (lib/filters/url.ts) do the parsing and writing, `historyMode` decides push, replace, or nothing.
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo } from "react";
import { rememberExplorer } from "./last-explorer";
import { explorerHref, historyMode, parseExplorerState, type ExplorerState } from "../filters/url";
import type { CitySlug } from "../filters/schema";

export type ExplorerChange = Partial<Omit<ExplorerState, "city">>;
/** A change, or a function of the URL's state right now (for callbacks that may hold an old render's props). */
export type ExplorerChangeInput = ExplorerChange | ((current: ExplorerState) => ExplorerChange);
export type UpdateOptions = {
  /** Overrides the history decision (typing in the search box replaces the entry instead of adding one per key). */
  mode?: "push" | "replace";
};

export function useExplorerState(city: CitySlug): readonly [ExplorerState, (change: ExplorerChangeInput, options?: UpdateOptions) => void] {
  const searchParams = useSearchParams();
  // `searchParams` changes identity on every navigation, including `history.pushState` (Next integrates it).
  const state = useMemo(() => parseExplorerState(city, searchParams) as ExplorerState, [city, searchParams]);

  // A URL that is not canonical (stages without Startup, a stray parameter, unsorted lists) is rewritten in place, so
  // what the address bar shows is what the page is showing. It replaces the entry: nothing is added to history.
  useEffect(() => {
    const canonical = explorerHref(state);
    const current = window.location.pathname.replace(/\/$/, "") + window.location.search;
    if (canonical !== current) window.history.replaceState(null, "", canonical);
    // The company pages' "Back to map" returns here, filters and camera included.
    rememberExplorer(canonical);
  }, [state]);

  const update = useCallback(
    (change: ExplorerChangeInput, options: UpdateOptions = {}) => {
      // Read the URL as it is now, not the render's copy: two changes in one tick must both land.
      const current = parseExplorerState(city, new URLSearchParams(window.location.search)) as ExplorerState;
      const next: ExplorerState = { ...current, ...(typeof change === "function" ? change(current) : change) };
      const decided = historyMode(current, next);
      if (decided === "none") return;
      const mode = options.mode ?? decided;
      const url = explorerHref(next);
      if (mode === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [city],
  );

  return [state, update] as const;
}
