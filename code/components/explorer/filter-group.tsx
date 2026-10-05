"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

export type FilterOption = {
  value: string;
  label: string;
  /** Companies a selection of just this value would show (the facet count). */
  count?: number;
};

type FilterGroupProps = {
  legend: string;
  options: readonly FilterOption[];
  selected: readonly string[];
  onChange(next: string[]): void;
  /** Explains why the whole group is off, shown under the legend (the stage filter without Startup). */
  disabledNote?: string;
};

/**
 * A group of checkboxes for one filter (design-system.md §1, rule 3: a selected option is Mantis Wash and a
 * checked box, never colour alone). A native fieldset and native checkboxes, so keyboard and screen readers work as
 * they do everywhere else. Rows are 44 px tall.
 */
export function FilterGroup({ legend, options, selected, onChange, disabledNote }: FilterGroupProps) {
  const noteId = useId();
  const disabled = disabledNote !== undefined;
  const chosen = new Set(selected);

  const toggle = (value: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(value);
    else next.delete(value);
    onChange([...next]);
  };

  return (
    <fieldset disabled={disabled} aria-describedby={disabled ? noteId : undefined} className="min-w-0">
      <legend className="mb-1 text-sm font-semibold">{legend}</legend>
      {disabled && (
        <p id={noteId} className="mb-1 text-sm text-muted-foreground">
          {disabledNote}
        </p>
      )}
      <ul className="flex flex-col">
        {options.map((option) => {
          const checked = chosen.has(option.value);
          return (
            <li key={option.value}>
              <label
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-3 px-2 text-base",
                  checked && "bg-mantis-wash",
                  disabled && "cursor-not-allowed text-muted-foreground",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={(event) => toggle(option.value, event.target.checked)}
                  className="size-5 shrink-0 accent-ink"
                />
                <span className="flex-1">{option.label}</span>
                {option.count !== undefined && (
                  <span className={cn("text-sm tabular-nums", option.count === 0 ? "text-muted-foreground" : "text-foreground")}>
                    {/* Read as "Startup, 17 companies"; the comma keeps the name and the count apart. */}
                    <span className="sr-only">, </span>
                    {option.count}
                    <span className="sr-only"> companies</span>
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
