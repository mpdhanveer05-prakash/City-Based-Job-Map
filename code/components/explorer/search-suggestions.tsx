"use client";

import { SUGGESTION_KIND_LABELS, type Suggestion } from "@/lib/explorer/suggestions";
import { cn } from "@/lib/utils";
import { FLOATING } from "./floating";

/** The listbox under the search combobox (ARIA 1.2). The input keeps focus; arrow keys move the active option. */
export function SearchSuggestions({
  id,
  suggestions,
  activeIndex,
  onPick,
}: {
  id: string;
  suggestions: readonly Suggestion[];
  activeIndex: number;
  onPick(suggestion: Suggestion): void;
}) {
  return (
    <ul id={id} role="listbox" aria-label="Suggestions" data-testid="search-suggestions" className={cn("absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-md", FLOATING)}>
      {suggestions.map((suggestion, i) => (
        <li
          key={`${suggestion.kind}:${"slug" in suggestion ? suggestion.slug : suggestion.label}`}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === activeIndex}
          // mousedown, not click: the input must not lose focus (and close the list) before the pick lands.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(suggestion)}
          className={cn("flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-2 text-base", i === activeIndex && "bg-mantis-wash")}
        >
          <span>{suggestion.label}</span>
          <span className="shrink-0 text-sm text-muted-foreground">{SUGGESTION_KIND_LABELS[suggestion.kind]}</span>
        </li>
      ))}
    </ul>
  );
}
