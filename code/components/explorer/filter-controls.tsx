"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
import type { Ref } from "@/lib/filters/dataset";
import type { FacetRow } from "@/lib/filters/filter";
import { COMPANY_TYPES, STARTUP_STAGES, type Filters } from "@/lib/filters/schema";
import { STAGE_LABELS, TYPE_LABELS } from "@/lib/explorer/labels";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { FilterGroup, type FilterOption } from "./filter-group";

export type FilterModel = {
  filters: Filters;
  facets: readonly FacetRow[];
  neighbourhoods: readonly Ref[];
  techParks: readonly Ref[];
  sectors: readonly Ref[];
  /** How many companies the current filters show, for the sheet's close button. */
  resultCount: number;
  onChange(change: Partial<Filters>): void;
};

type GroupId = "types" | "stages" | "neighbourhoods" | "tech_parks" | "sectors";

const NEEDS_STARTUP = "Choose Startup to filter by stage.";

function count(facets: readonly FacetRow[], facet: FacetRow["facet"], value: string): number {
  return facets.find((f) => f.facet === facet && f.value === value)?.company_count ?? 0;
}

type GroupSpec = { id: GroupId; button: string; legend: string; options: FilterOption[]; selected: string[]; disabledNote?: string };

/** The groups in toolbar order. The stage group is off, with a reason, unless Startup is selected (ADR-0004). */
export function filterGroups(model: FilterModel): GroupSpec[] {
  const { filters, facets } = model;
  const refOptions = (refs: readonly Ref[], facet: FacetRow["facet"]): FilterOption[] =>
    refs.map((r) => ({ value: r.slug, label: r.name, count: count(facets, facet, r.slug) }));
  return [
    {
      id: "types",
      button: "Type",
      legend: "Company type",
      options: COMPANY_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t], count: count(facets, "type", t) })),
      selected: filters.types,
    },
    {
      id: "stages",
      button: "Stage",
      legend: "Startup stage",
      options: STARTUP_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s], count: count(facets, "stage", s) })),
      selected: filters.stages,
      disabledNote: filters.types.includes("startup") ? undefined : NEEDS_STARTUP,
    },
    { id: "neighbourhoods", button: "Neighbourhood", legend: "Neighbourhood", options: refOptions(model.neighbourhoods, "neighbourhood"), selected: filters.neighbourhoods },
    { id: "tech_parks", button: "Tech park", legend: "Tech park", options: refOptions(model.techParks, "tech_park"), selected: filters.tech_parks },
    { id: "sectors", button: "Sector", legend: "Sector", options: refOptions(model.sectors, "sector"), selected: filters.sectors },
  ];
}

/** How many filters are on, for the Filters button on a phone. */
export function activeFilterCount(filters: Filters): number {
  return filters.types.length + filters.stages.length + filters.neighbourhoods.length + filters.tech_parks.length + filters.sectors.length;
}

function groupChange(id: GroupId, next: string[]): Partial<Filters> {
  return { [id]: next } as Partial<Filters>;
}

/** On a desktop: one button per group, each opening a small panel over the map. */
export function FilterPopovers({ model }: { model: FilterModel }) {
  return (
    <div className="hidden flex-wrap items-center gap-2 sm:flex" role="group" aria-label="Filters">
      {filterGroups(model).map((group) => (
        <Popover key={group.id}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              data-testid={`filter-${group.id}`}
              aria-label={group.selected.length > 0 ? `${group.button}, ${group.selected.length} selected` : group.button}
              className={group.selected.length > 0 ? "bg-mantis-wash" : undefined}
            >
              {group.button}
              {group.selected.length > 0 && <span className="tabular-nums">{group.selected.length}</span>}
              <ChevronDown aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent data-testid={`filter-panel-${group.id}`}>
            <FilterGroup
              legend={group.legend}
              options={group.options}
              selected={group.selected}
              disabledNote={group.disabledNote}
              onChange={(next) => model.onChange(groupChange(group.id, next))}
            />
          </PopoverContent>
        </Popover>
      ))}
    </div>
  );
}

/** On a phone: one Filters button that opens every group in a bottom sheet. */
export function FilterSheet({ model }: { model: FilterModel }) {
  const active = activeFilterCount(model.filters);
  return (
    <div className="sm:hidden">
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline" data-testid="filters-sheet-open" aria-label={active > 0 ? `Filters, ${active} selected` : "Filters"} className={active > 0 ? "bg-mantis-wash" : undefined}>
            <SlidersHorizontal aria-hidden="true" />
            Filters
            {active > 0 && <span className="tabular-nums">{active}</span>}
          </Button>
        </SheetTrigger>
        <SheetContent data-testid="filters-sheet">
          <SheetTitle className="text-xl font-bold">Filters</SheetTitle>
          <SheetDescription className="sr-only">Narrow the companies by type, stage, neighbourhood, tech park, and sector.</SheetDescription>
          {filterGroups(model).map((group) => (
            <FilterGroup
              key={group.id}
              legend={group.legend}
              options={group.options}
              selected={group.selected}
              disabledNote={group.disabledNote}
              onChange={(next) => model.onChange(groupChange(group.id, next))}
            />
          ))}
          <SheetClose asChild>
            <Button className="sticky bottom-0">{`Show ${model.resultCount} ${model.resultCount === 1 ? "company" : "companies"}`}</Button>
          </SheetClose>
        </SheetContent>
      </Sheet>
    </div>
  );
}
