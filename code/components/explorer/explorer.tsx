"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { fetchCityFiles, fetchSearchFile, type CityFilePaths } from "@/lib/data/browser";
import type { CityBoundary } from "@/lib/filters/dataset";
import { mergeDataset } from "@/lib/filters/dataset";
import { companyFacets, filterResult, listRows, prepareIndex } from "@/lib/filters/filter";
import { applyFilterChange, EMPTY_FILTERS, type CitySlug, type Filters, type View } from "@/lib/filters/schema";
import { ACCURACY_LABELS, TYPE_LABELS } from "@/lib/explorer/labels";
import { hashFilters } from "@/lib/explorer/filter-hash";
import { buildSuggestions, type Suggestion } from "@/lib/explorer/suggestions";
import { useExplorerState } from "@/lib/explorer/use-explorer-state";
import { initialOf, swatchIndex } from "@/map/atlas/fallback";
import { SWATCH_TOKENS } from "@/map/theme";
import { WEBGL_NOTICE, checkWebGl2 } from "@/map/fallback";
import type { ExplorerCamera } from "@/map/explorer-map";
import { CompanyGrid, CompanyList, type CompanyRowData } from "./company-views";
import { ExplorerMapView } from "./explorer-map-view";
import { ExplorerToolbar } from "./explorer-toolbar";
import type { FilterModel } from "./filter-controls";
import type { PopupCompany } from "./map-popup";

export type ExplorerCity = {
  slug: CitySlug;
  name: string;
  centre: [number, number];
  defaultZoom: number;
  dataVersion: number;
  synthetic: boolean;
  boundary: CityBoundary;
};

export type ExplorerProps = {
  city: ExplorerCity;
  paths: CityFilePaths;
};

/** The Geoapify key is public and restricted by referrer (ADR-0008). Without one the map draws a blank background. */
const geoapifyKey = (): string => {
  const key = process.env.NEXT_PUBLIC_GEOAPIFY_KEY ?? "";
  return key.startsWith("replace-") ? "" : key;
};

const subscribeNever = () => () => {};
let webGl2Checked: boolean | undefined;
/** Whether this browser lacks WebGL2. Asked once: the check makes and releases a context. */
const webGl2Missing = (): boolean => (webGl2Checked ??= !checkWebGl2().ok);

export function Explorer({ city, paths }: ExplorerProps) {
  const [state, update] = useExplorerState(city.slug);
  const toolbar = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  // The map cannot run without WebGL2 (checked in the browser) or when it failed to start: the list is the way in.
  const noWebGl = useSyncExternalStore(subscribeNever, webGl2Missing, () => false);
  const [mapFailed, setMapFailed] = useState(false);
  const mapUnavailable = noWebGl || mapFailed;
  const [searchWanted, setSearchWanted] = useState(false);

  // ---- data ----------------------------------------------------------------------------------------------------
  const files = useQuery({
    queryKey: ["city-files", city.slug, city.dataVersion],
    queryFn: ({ signal }) => fetchCityFiles(paths, signal),
  });
  const searchActive = searchWanted || state.filters.q !== "";
  const searchFile = useQuery({
    queryKey: ["city-search", city.slug, city.dataVersion],
    queryFn: ({ signal }) => fetchSearchFile(paths.search, signal),
    enabled: searchActive,
  });

  const index = useMemo(() => {
    if (!files.data) return null;
    return prepareIndex(
      mergeDataset({ companies: files.data.companies, offices: files.data.offices, search: { version: 1, entries: searchFile.data?.entries ?? [] } }),
    );
  }, [files.data, searchFile.data]);

  // One result feeds the map, the grid, the list, and every count (CLAUDE.md: never filter anywhere else).
  const filters = state.filters;
  const result = useMemo(() => (index ? filterResult(index, filters) : null), [index, filters]);
  const facets = useMemo(() => (index ? companyFacets(index, filters) : []), [index, filters]);
  const filterHash = useMemo(() => hashFilters(filters), [filters]);

  const rows = useMemo<CompanyRowData[]>(() => {
    if (!index || !result) return [];
    const areas = new Map<string, string[]>();
    for (const o of result.offices) {
      const name = (o.neighbourhood && index.neighbourhoodNames.get(o.neighbourhood)) || (o.tech_park && index.techParkNames.get(o.tech_park));
      if (!name) continue;
      const list = areas.get(o.company_id) ?? [];
      if (!list.includes(name) && list.length < 3) list.push(name);
      areas.set(o.company_id, list);
    }
    return listRows(result).map((row) => ({ ...row, areas: areas.get(row.company_id) ?? [] }));
  }, [index, result]);

  const companiesBySlug = useMemo(() => new Map((files.data?.companies.companies ?? []).map((c) => [c.slug, c])), [files.data]);
  const selected = state.company ? (companiesBySlug.get(state.company) ?? null) : null;

  // ---- keep the URL consistent with what exists ----------------------------------------------------------------
  // A selected company that the filters (or a stale link) exclude is dropped from the URL.
  useEffect(() => {
    if (!result || !state.company) return;
    if (!result.companies.some((c) => c.slug === state.company)) update({ company: null }, { mode: "replace" });
  }, [result, state.company, update]);

  // ---- the toolbar's height, so the list and grid start below it -----------------------------------------------
  useEffect(() => {
    const el = toolbar.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setToolbarHeight(el.offsetHeight));
    observer.observe(el);
    setToolbarHeight(el.offsetHeight);
    return () => observer.disconnect();
  }, []);

  const view: View = mapUnavailable && state.view === "map" ? "list" : state.view;

  // ---- actions -------------------------------------------------------------------------------------------------
  const onFilters = useCallback((change: Partial<Filters>) => update((current) => ({ filters: applyFilterChange(current.filters, change) })), [update]);
  const onQuery = useCallback(
    (text: string, mode: "push" | "replace") => update((current) => ({ filters: applyFilterChange(current.filters, { q: text }) }), { mode }),
    [update],
  );
  const onClearFilters = useCallback(() => update({ filters: { ...EMPTY_FILTERS }, company: null }), [update]);
  const onView = useCallback((next: View) => update({ view: next }), [update]);
  const onShowOnMap = useCallback((slug: string) => update({ view: "map", company: slug }), [update]);
  const onSuggestion = useCallback(
    (s: Suggestion) =>
      update((current) => {
        switch (s.kind) {
          case "company":
            // Picking a company is a clear request for that company: other filters that could hide it are dropped.
            return { filters: applyFilterChange({ ...EMPTY_FILTERS }, { q: s.label }), company: s.slug };
          case "neighbourhood":
            return { filters: applyFilterChange(current.filters, { q: "", neighbourhoods: [...new Set([...current.filters.neighbourhoods, s.slug])] }) };
          case "tech_park":
            return { filters: applyFilterChange(current.filters, { q: "", tech_parks: [...new Set([...current.filters.tech_parks, s.slug])] }) };
          case "job":
            return { filters: applyFilterChange(current.filters, { q: s.label }) };
        }
      }),
    [update],
  );
  const onSelect = useCallback((companyId: string | null) => {
    const slug = companyId ? files.data?.companies.companies.find((c) => c.id === companyId)?.slug : undefined;
    update({ company: slug ?? null });
  }, [files.data, update]);
  const onCamera = useCallback((camera: ExplorerCamera) => update({ camera }), [update]);

  const popupFor = useCallback(
    (companyId: string, officeId: string): PopupCompany | null => {
      if (!index) return null;
      const company = index.dataset.companies.find((c) => c.id === companyId);
      const office = index.dataset.offices.find((o) => o.id === officeId);
      if (!company) return null;
      const area = office && ((office.neighbourhood && index.neighbourhoodNames.get(office.neighbourhood)) || (office.tech_park && index.techParkNames.get(office.tech_park)));
      return {
        id: officeId,
        name: company.name,
        letter: initialOf(company.name),
        swatchVar: SWATCH_TOKENS[swatchIndex(company.name)],
        types: company.types.map((t) => TYPE_LABELS[t]),
        neighbourhood: area || null,
        accuracy: office ? (ACCURACY_LABELS[office.accuracy] ?? office.accuracy) : null,
        openJobs: company.open_jobs,
        href: `/companies/${company.slug}`,
        synthetic: city.synthetic,
      };
    },
    [index, city.synthetic],
  );

  const getVisibleArea = useCallback(() => {
    const el = toolbar.current;
    const mapEl = document.querySelector('[data-testid="explorer-map"]');
    if (!el || !mapEl) return null;
    const t = el.getBoundingClientRect();
    const m = mapEl.getBoundingClientRect();
    return { left: 8, top: Math.max(8, t.bottom - m.top + 8), right: m.width - 56, bottom: m.height - 28 };
  }, []);

  const filterModel: FilterModel = {
    filters,
    facets,
    neighbourhoods: files.data?.companies.neighbourhoods ?? [],
    techParks: files.data?.companies.tech_parks ?? [],
    sectors: files.data?.companies.sectors ?? [],
    resultCount: result?.companies.length ?? 0,
    onChange: onFilters,
  };

  const initialCamera = useMemo<ExplorerCamera>(
    () => state.camera ?? { lng: city.centre[0], lat: city.centre[1], zoom: city.defaultZoom },
    // The camera in the URL at the time the map is built; later changes reach the map through `urlCamera`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [city.slug],
  );

  return (
    <main className="relative min-h-0 flex-1" data-testid="explorer" data-city={city.slug} data-view={view} data-ready={result ? "true" : "false"}>
      {/* First in the document, so Tab meets search and filters before the companies. It is positioned and layered, so this does not change how it looks. */}
      <ExplorerToolbar
        ref={toolbar}
        cityName={city.name}
        query={filters.q}
        onQuery={onQuery}
        onSearchFocus={() => setSearchWanted(true)}
        searchLoading={searchActive && searchFile.isPending}
        searchFailed={searchFile.isError}
        suggestions={(text) => (index ? buildSuggestions(index, text) : [])}
        onSuggestion={onSuggestion}
        filterModel={filterModel}
        onClearFilters={onClearFilters}
        companyCount={result?.companies.length ?? 0}
        officeCount={result?.offices.length ?? 0}
        view={view}
        onView={onView}
        mapUnavailable={mapUnavailable}
        notice={mapUnavailable ? WEBGL_NOTICE : undefined}
        loading={files.isPending}
      />

      {files.data && result && (
        <ExplorerMapView
          active={view === "map"}
          dataVersion={String(city.dataVersion)}
          companies={files.data.companies.companies}
          allOffices={files.data.offices.offices}
          boundary={city.boundary}
          initialCamera={initialCamera}
          geoapifyKey={geoapifyKey()}
          offices={result.offices}
          filterHash={filterHash}
          selectedCompanyId={selected?.id ?? null}
          urlCamera={state.camera}
          onSelect={onSelect}
          onCamera={onCamera}
          popupFor={popupFor}
          getVisibleArea={getVisibleArea}
          onShowList={() => onView("list")}
          onFailed={() => setMapFailed(true)}
        />
      )}
      {result && view === "list" && (
        <CompanyList rows={rows} selectedSlug={state.company} onShowOnMap={onShowOnMap} onClearFilters={onClearFilters} paddingTop={toolbarHeight + 32} />
      )}
      {result && view === "grid" && (
        <CompanyGrid rows={rows} selectedSlug={state.company} onShowOnMap={onShowOnMap} onClearFilters={onClearFilters} paddingTop={toolbarHeight + 32} />
      )}

      {files.isPending && (
        <p role="status" data-testid="explorer-loading" className="absolute inset-x-0 top-1/2 text-center text-lg text-muted-foreground">
          Loading the companies in {city.name}…
        </p>
      )}
      {files.isError && (
        <div role="alert" data-testid="explorer-error" className="absolute inset-x-4 top-1/2 mx-auto flex max-w-md -translate-y-1/2 flex-col items-start gap-3 border border-rule bg-milky p-4">
          <p>{files.error instanceof Error ? files.error.message : "The companies could not be loaded."}</p>
          <Button variant="outline" onClick={() => void files.refetch()}>
            Try again
          </Button>
        </div>
      )}
    </main>
  );
}
