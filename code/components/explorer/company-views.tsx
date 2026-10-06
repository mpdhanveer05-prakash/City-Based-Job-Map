"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CompanyAvatar } from "@/components/company/company-avatar";
import { Button } from "@/components/ui/button";
import { jobs, offices, TYPE_LABELS, STAGE_LABELS, STATUS_LABELS } from "@/lib/explorer/labels";
import type { ListRow } from "@/lib/filters/filter";
import { cn } from "@/lib/utils";
import { VirtualRows } from "./virtual-rows";

/** A list row plus the places the company is in (neighbourhood or tech park names). */
export type CompanyRowData = ListRow & { areas: string[] };

type ViewProps = {
  rows: readonly CompanyRowData[];
  selectedSlug: string | null;
  /** Selects the company and goes back to the map, where its popup opens. */
  onShowOnMap(slug: string): void;
  onClearFilters(): void;
  /** Room for the toolbar that floats over the top of the view, in px. */
  paddingTop: number;
};

/** Width of an element, kept current. 0 until measured. */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function Meta({ row }: { row: CompanyRowData }) {
  const types = row.types.map((t) => TYPE_LABELS[t]).join(" and ");
  const stage = row.startup_stage ? `, ${STAGE_LABELS[row.startup_stage]}` : "";
  const status = row.ownership_status ? `, ${STATUS_LABELS[row.ownership_status]}` : "";
  return (
    <>
      <p className="truncate text-sm text-muted-foreground">
        {types}
        {stage}
        {status}
      </p>
      <p className="truncate text-sm text-muted-foreground tabular-nums">
        {row.areas.length > 0 ? `${row.areas.join(", ")}. ` : ""}
        {offices(row.office_count)}. {jobs(row.open_job_count)}
      </p>
    </>
  );
}

function Actions({ row, onShowOnMap, className }: { row: CompanyRowData; onShowOnMap(slug: string): void; className?: string }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
      <Button variant="outline" onClick={() => onShowOnMap(row.slug)} aria-label={`Show ${row.name} on the map`} data-testid="show-on-map">
        Show on map
      </Button>
      {/* Both are outline buttons: a list of many rows must not hold many Mantis buttons (design-system.md §1, rule 1). */}
      <Button asChild variant="outline">
        <Link href={`/companies/${row.slug}`} className="text-foreground no-underline" data-testid="view-company">
          View company
          <span className="sr-only"> {row.name}</span>
        </Link>
      </Button>
    </div>
  );
}

function Empty({ onClearFilters }: { onClearFilters(): void }) {
  return (
    <div className="mx-auto max-w-[72ch] px-4 py-8 sm:px-6" data-testid="no-results">
      <p className="text-lg">No companies match these filters.</p>
      <Button variant="outline" className="mt-4" onClick={onClearFilters}>
        Clear filters
      </Button>
    </div>
  );
}

/**
 * List view: one row per company, with a Rule line between rows. Fixed row height, so TanStack Virtual keeps the
 * scroll bar exact once there are more than 100 rows.
 */
export function CompanyList({ rows, selectedSlug, onShowOnMap, onClearFilters, paddingTop }: ViewProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const width = useWidth(scroller);
  const narrow = width > 0 && width < 640;

  return (
    <div ref={scroller} data-testid="list-view" className="absolute inset-0 overflow-auto bg-background" style={{ paddingTop }}>
      {rows.length === 0 ? (
        <Empty onClearFilters={onClearFilters} />
      ) : (
        // role="list": the virtual rows are wrappers between the list and its items, which a native <ul> does not allow.
        <div role="list" className="mx-auto max-w-5xl px-4 pb-8 sm:px-6" aria-label="Companies" data-testid="company-rows">
          <VirtualRows
            items={rows}
            rowHeight={narrow ? 148 : 88}
            scrollRef={scroller}
            renderItem={(row) => (
              <div
                role="listitem"
                key={row.company_id}
                data-testid="company-row"
                data-company={row.slug}
                aria-current={row.slug === selectedSlug ? "true" : undefined}
                className={cn(
                  "flex h-full flex-col justify-center gap-2 border-b border-rule sm:flex-row sm:items-center sm:justify-between sm:gap-4",
                  row.slug === selectedSlug && "bg-mantis-wash",
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <CompanyAvatar name={row.name} logoKey={row.logo_key} />
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold">{row.name}</h2>
                    <Meta row={row} />
                  </div>
                </div>
                <Actions row={row} onShowOnMap={onShowOnMap} />
              </div>
            )}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Grid view: ruled tiles on Milky, separated by 1 px Rule lines, no shadow and no radius (design-system.md §4).
 * One, two, or three columns by width.
 */
export function CompanyGrid({ rows, selectedSlug, onShowOnMap, onClearFilters, paddingTop }: ViewProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const width = useWidth(scroller);
  const columns = width >= 1024 ? 3 : width >= 640 ? 2 : 1;

  return (
    <div ref={scroller} data-testid="grid-view" className="absolute inset-0 overflow-auto bg-background" style={{ paddingTop }}>
      {rows.length === 0 ? (
        <Empty onClearFilters={onClearFilters} />
      ) : (
        <div role="list" className="mx-auto max-w-6xl px-4 pb-8 sm:px-6" aria-label="Companies" data-testid="company-rows">
          <VirtualRows
            items={rows}
            columns={columns}
            rowHeight={216}
            scrollRef={scroller}
            rowGridStyle={{ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            rowClassName="border-b border-rule [&>*]:border-l [&>*]:border-rule [&>*:first-child]:border-l-0"
            renderItem={(row) => (
              <div
                role="listitem"
                key={row.company_id}
                data-testid="company-row"
                data-company={row.slug}
                aria-current={row.slug === selectedSlug ? "true" : undefined}
                className={cn("flex h-full min-w-0 flex-col gap-3 p-4", row.slug === selectedSlug && "bg-mantis-wash")}
              >
                <div className="flex items-center gap-3">
                  <CompanyAvatar name={row.name} logoKey={row.logo_key} />
                  <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{row.name}</h2>
                </div>
                <div className="min-w-0 flex-1">
                  <Meta row={row} />
                </div>
                <Actions row={row} onShowOnMap={onShowOnMap} className="flex-wrap" />
              </div>
            )}
          />
        </div>
      )}
    </div>
  );
}
