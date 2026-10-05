"use client";

import Link from "next/link";
import { Search, X } from "lucide-react";
import { forwardRef, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { resultSummary } from "@/lib/explorer/labels";
import { normalizeQuery, VIEWS, type View } from "@/lib/filters/schema";
import { cn } from "@/lib/utils";
import { FLOATING } from "./floating";
import { FilterPopovers, FilterSheet, activeFilterCount, type FilterModel } from "./filter-controls";
import { SearchSuggestions } from "./search-suggestions";
import type { Suggestion } from "@/lib/explorer/suggestions";

const VIEW_LABELS: Record<View, string> = { map: "Map", grid: "Grid", list: "List" };

export type ExplorerToolbarProps = {
  cityName: string;
  /** The search text in the URL. */
  query: string;
  /** Called with the new text; `mode` is "replace" while the visitor is still typing the same search. */
  onQuery(text: string, mode: "push" | "replace"): void;
  /** The search box was focused: the search file (job titles, founders) can start loading. */
  onSearchFocus(): void;
  searchLoading: boolean;
  searchFailed: boolean;
  suggestions(text: string): Suggestion[];
  onSuggestion(suggestion: Suggestion): void;
  filterModel: FilterModel;
  onClearFilters(): void;
  companyCount: number;
  officeCount: number;
  view: View;
  onView(view: View): void;
  /** True when the map cannot run: the Map button is off and says why. */
  mapUnavailable: boolean;
  /** A plain sentence shown under the search (the WebGL notice). */
  notice?: string;
  /** The city files have not arrived: the counts say so instead of "0 companies". */
  loading?: boolean;
};

/** How long after the last key press the search is applied. The filter is fast; this only spares history and renders. */
const SEARCH_DEBOUNCE_MS = 200;

export const ExplorerToolbar = forwardRef<HTMLDivElement, ExplorerToolbarProps>(function ExplorerToolbar(props, ref) {
  const { query, onQuery, filterModel, view, onView } = props;
  const [text, setText] = useState(query);
  const [open, setOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const lastCommitted = useRef(normalizeQuery(query));
  const typing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);

  // A change from outside (Back, a shared link, Clear filters) replaces what is typed.
  useEffect(() => {
    if (normalizeQuery(query) !== lastCommitted.current) {
      lastCommitted.current = normalizeQuery(query);
      setText(query);
    }
  }, [query]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const commit = (value: string) => {
    clearTimeout(timer.current);
    const normalized = normalizeQuery(value);
    if (normalized === lastCommitted.current) return;
    lastCommitted.current = normalized;
    // The first change of a search adds a history entry; the keys after it rewrite that entry, so Back leaves the search.
    onQuery(value, typing.current ? "replace" : "push");
    typing.current = true;
  };

  const suggestions = open ? props.suggestions(text) : [];
  const listboxId = "search-suggestions";
  const filtersOn = activeFilterCount(filterModel.filters) > 0 || query !== "";

  return (
    <div ref={ref} data-testid="explorer-toolbar" className={cn("absolute inset-x-4 top-4 z-20 flex max-w-[46rem] flex-col gap-2 rounded-md p-3", FLOATING)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex shrink-0 items-baseline gap-x-3 sm:flex-col sm:gap-0">
          <h1 className="text-xl font-bold">{props.cityName}</h1>
          <Link href="/" className="text-sm">
            All cities
          </Link>
        </div>
        <div className="relative min-w-0 flex-1 basis-44">
          <label htmlFor="explorer-search" className="sr-only">
            Search jobs, companies, areas, and founders
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={input}
            id="explorer-search"
            data-testid="explorer-search"
            type="search"
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeSuggestion >= 0 ? `${listboxId}-${activeSuggestion}` : undefined}
            autoComplete="off"
            enterKeyHint="search"
            placeholder="Search companies, jobs, areas"
            value={text}
            maxLength={100}
            onFocus={() => {
              props.onSearchFocus();
              setOpen(true);
            }}
            onBlur={() => {
              // Clicking a suggestion blurs the input first; the list closes after the click has landed.
              setTimeout(() => setOpen(false), 120);
              commit(text);
              typing.current = false;
            }}
            onChange={(event) => {
              const value = event.target.value;
              setText(value);
              setOpen(true);
              setActiveSuggestion(-1);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => commit(value), SEARCH_DEBOUNCE_MS);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && suggestions.length > 0) {
                event.preventDefault();
                setActiveSuggestion((i) => (i + 1) % suggestions.length);
              } else if (event.key === "ArrowUp" && suggestions.length > 0) {
                event.preventDefault();
                setActiveSuggestion((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (activeSuggestion >= 0 && suggestions[activeSuggestion]) {
                  props.onSuggestion(suggestions[activeSuggestion]);
                  setOpen(false);
                  setActiveSuggestion(-1);
                } else {
                  commit(text);
                  setOpen(false);
                }
              } else if (event.key === "Escape" && open) {
                event.stopPropagation();
                setOpen(false);
                setActiveSuggestion(-1);
              }
            }}
            className="h-11 w-full rounded-md border border-field bg-milky-shade pl-9 pr-11 text-base text-foreground placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          {text !== "" && (
            <button
              type="button"
              aria-label="Clear search"
              data-testid="clear-search"
              onClick={() => {
                setText("");
                commit("");
                input.current?.focus();
              }}
              className="absolute right-0 top-0 flex size-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          )}
          {suggestions.length > 0 && (
            <SearchSuggestions
              id={listboxId}
              suggestions={suggestions}
              activeIndex={activeSuggestion}
              onPick={(suggestion) => {
                props.onSuggestion(suggestion);
                setOpen(false);
                setActiveSuggestion(-1);
              }}
            />
          )}
        </div>
        <FilterSheet model={filterModel} />
      </div>
      {(props.searchLoading || props.searchFailed) && (
        <p className="text-sm text-muted-foreground" role={props.searchFailed ? "alert" : "status"}>
          {props.searchFailed
            ? "Job titles and founder names could not be loaded, so search matches company names and places only."
            : "Loading job titles and founder names for search…"}
        </p>
      )}

      <FilterPopovers model={filterModel} />

      {props.notice && (
        <p role="status" data-testid="map-fallback-notice" className="rounded-md bg-milky-shade p-3 text-sm">
          {props.notice}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p aria-live="polite" data-testid="result-count" className="text-sm tabular-nums">
          {props.loading ? "Loading…" : resultSummary(props.companyCount, props.officeCount)}
          {filtersOn && (
            <>
              {" "}
              <button type="button" onClick={props.onClearFilters} data-testid="clear-filters" className="min-h-11 px-1 text-link underline underline-offset-3">
                Clear filters
              </button>
            </>
          )}
        </p>
        <div role="group" aria-label="View" className="flex">
          {VIEWS.map((v) => {
            const disabled = v === "map" && props.mapUnavailable;
            return (
              <Button
                key={v}
                // One Mantis button per view (design-system.md §1): the chosen view is Wash with a Mantis Deep
                // underline and a heavier label, so colour is not the only signal and aria-pressed carries it too.
                variant="outline"
                aria-pressed={view === v}
                disabled={disabled}
                title={disabled ? "The map can't run on this device or browser" : undefined}
                data-testid={`view-${v}`}
                onClick={() => onView(v)}
                className={cn(
                  "rounded-none first:rounded-l-md last:rounded-r-md [&:not(:first-child)]:-ml-px",
                  view === v && "bg-mantis-wash font-extrabold shadow-[inset_0_-3px_0_var(--mantis-deep)]",
                )}
              >
                {VIEW_LABELS[v]}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
});
