"use client";

import { useMemo, useState } from "react";
import { CompanyGrid, CompanyList, type CompanyRowData } from "@/components/explorer/company-views";
import { Button } from "@/components/ui/button";
import { generateSyntheticDataset } from "@/map/fixtures/generate";

const TYPES = ["startup", "mnc", "product"] as const;

export function VirtualListDemo() {
  const [view, setView] = useState<"list" | "grid">("list");
  const rows = useMemo<CompanyRowData[]>(() => {
    const dataset = generateSyntheticDataset({ city: "bengaluru", size: "L" });
    return dataset.companies
      .map((c) => ({
        company_id: String(c.id),
        slug: `synthetic-${c.id}`,
        name: c.name,
        logo_key: null,
        types: c.types.filter((t): t is (typeof TYPES)[number] => (TYPES as readonly string[]).includes(t)),
        startup_stage: null,
        ownership_status: null,
        office_count: 1,
        open_job_count: c.id % 7,
        areas: [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const props = { rows, selectedSlug: null, onShowOnMap: () => {}, onClearFilters: () => {}, paddingTop: 64 };
  return (
    <main className="relative h-dvh" data-testid="virtual-demo" data-rows={rows.length}>
      {view === "list" ? <CompanyList {...props} /> : <CompanyGrid {...props} />}
      <div className="absolute left-4 top-4 z-10 flex items-center gap-2 border border-rule bg-milky p-2 text-sm">
        <span>Synthetic data. {rows.length} companies.</span>
        <Button variant="outline" size="sm" onClick={() => setView(view === "list" ? "grid" : "list")}>
          {view === "list" ? "Grid" : "List"}
        </Button>
      </div>
    </main>
  );
}
