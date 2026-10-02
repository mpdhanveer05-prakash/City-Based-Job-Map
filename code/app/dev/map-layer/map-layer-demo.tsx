"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { Button } from "@/components/ui/button";
import { MapA11yList, type MirrorListEntry } from "@/components/explorer/map-a11y-list";
import { MapPopup, type PopupCompany, type PopupLayout } from "@/components/explorer/map-popup";
import { buildGlyphSheet, cellSizeForDpr } from "@/map/atlas/glyph-sheet";
import { pageBytes, PAGE_SIZE } from "@/map/atlas/budget";
import { initialOf, swatchIndex } from "@/map/atlas/fallback";
import { LogoAtlas } from "@/map/atlas/logo-atlas";
import { loadLogoPixels } from "@/map/atlas/logo-loader";
import { mirrorEntries } from "@/map/a11y-mirror";
import { createBasemap } from "@/map/basemap";
import { TILE_NOTICE, WEBGL_NOTICE, checkWebGl2, watchTileFailures, type TileWatcher } from "@/map/fallback";
import { generateSyntheticDataset } from "@/map/fixtures/generate";
import { buildStaticScene } from "@/map/fixtures/static-scene";
import { attachMarkerInteractions, type MarkerInteractions } from "@/map/hit-test/interactions";
import type { HitCandidate } from "@/map/hit-test/hit-test";
import { colocateResponse, emptyStackMemo, type StackMemo } from "@/map/layer/colocation";
import { viewFor } from "@/map/layer/geometry";
import { CompanyLayer, attachCompanyLayer, type DrawnItem, type LayerStats } from "@/map/layer/company-layer";
import type { LayerItem } from "@/map/layer/instances";
import { MarkerController } from "@/map/layer/marker-controller";
import { placePopup, placeSheet } from "@/map/popup-placement";
import { SWATCH_TOKENS, readBasemapTheme, readMarkerTheme, type MarkerTheme } from "@/map/theme";
import { makeLogoUrls, type LogoControl } from "./logo-fixtures";
import { createClusterWorkerClient, type ClusterClient } from "@/map/worker/client";
import { KIND_CLUSTER, MAX_LEVEL, packPointSet } from "@/map/worker/protocol";

const BENGALURU: [number, number] = [77.5946, 12.9716];

type Scenario = "static" | "live" | "logos";

const LOGO_COUNT = 60;

/** What the live scenario shows about taps: the selection and an open spider or list. */
type MarkerState = { selected: string | null; spider: "circle" | "spiral" | "list" | null; members: string[] };
const NO_MARKER_STATE: MarkerState = { selected: null, spider: null, members: [] };

/** One tap's outcome, recorded for the tests. */
type MarkerEvent = { type: "logo" | "cluster" | "stack" | "background" | "view-company"; key?: string; zoom?: number; mode?: string };

/** The popup as the page renders it: the company and where it goes. */
type PopupState = { company: PopupCompany; layout: PopupLayout };

/** What the live scenario tells the page. */
type LiveUi = {
  onState(state: MarkerState): void;
  onMirror(entries: MirrorListEntry[]): void;
  onPopup(popup: PopupState | null): void;
};

type MarkerHooks = {
  controller: MarkerController;
  interactions: MarkerInteractions;
  /** The synthetic co-location cases: where they are and how many companies each holds. */
  groups: Array<{ id: string; kind: string; lng: number; lat: number; size: number }>;
  events: MarkerEvent[];
};

type LiveControl = {
  /** Reloads the worker with only the startups (a new filter hash), or all companies again. */
  setStartupsOnly(on: boolean): Promise<void>;
  /** Gives a marker the keyboard-focus ring (what the mirror list does on focus). */
  setFocused(key: string | null): void;
  /** Does what a tap on a drawn marker does (what Enter does in the mirror list). */
  activate(key: string): void;
  stop(): void;
};

declare global {
  interface Window {
    // Test hook; not used by the app.
    __mapLayer?: { map: MapLibreMap; layer: CompanyLayer; atlas: LogoAtlas };
    __logoControl?: LogoControl;
    /** The keys of the last worker response applied in the live scenario (test hook). */
    __liveKeys?: string[];
    /** Controls for the live scenario (test hook). */
    __liveControl?: LiveControl;
    /** The marker controller and hit tester of the live scenario (test hook). */
    __markers?: MarkerHooks;
    /** If set, the layer's animation clock (test hook): a test holds a transition still by returning a fixed time. */
    __layerNow?: () => number;
  }
}

export function MapLayerDemo({ apiKey }: { apiKey: string }) {
  const container = useRef<HTMLDivElement>(null);
  const api = useRef<{ map: MapLibreMap; layer: CompanyLayer; show: (s: Scenario) => void } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "fallback">("loading");
  const [message, setMessage] = useState("");
  const [scenario, setScenario] = useState<Scenario>("static");
  const [stats, setStats] = useState<LayerStats | null>(null);
  const [startupsOnly, setStartupsOnly] = useState(false);
  const [markerState, setMarkerState] = useState<MarkerState>(NO_MARKER_STATE);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [mirror, setMirror] = useState<MirrorListEntry[]>([]);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [tilesFailing, setTilesFailing] = useState(false);
  const [showList, setShowList] = useState(false);
  const tileWatcher = useRef<TileWatcher | null>(null);
  const popupRef = useRef<HTMLElement>(null);
  /** Set when a marker was opened from the keyboard, so focus moves into the popup and returns on close. */
  const keyboardOpen = useRef(false);
  const returnFocusTo = useRef<string | null>(null);

  // Keyboard users land in the popup when they open a marker, and return to that marker's list entry when it closes.
  const popupId = popup?.company.id ?? null;
  useEffect(() => {
    if (popupId && keyboardOpen.current) {
      keyboardOpen.current = false;
      returnFocusTo.current = popupId;
      popupRef.current?.focus();
    } else if (!popupId && returnFocusTo.current) {
      const key = returnFocusTo.current;
      returnFocusTo.current = null;
      document.querySelector<HTMLButtonElement>(`[data-testid="map-a11y-list"] button[data-key="${CSS.escape(key)}"]`)?.focus();
    }
  }, [popupId]);

  useEffect(() => {
    if (!container.current) return;
    const abort = new AbortController();
    let map: MapLibreMap | undefined;
    let client: ClusterClient | undefined;
    let removeLiveListener: (() => void) | undefined;
    let detachLayer: (() => void) | undefined;
    let theme!: MarkerTheme;

    (async () => {
      // No WebGL2, no map: land on the list with a notice (map-spec §9).
      if (!checkWebGl2().ok) {
        setStatus("fallback");
        return;
      }
      const basemapTheme = readBasemapTheme();
      const basemapOptions = {
        container: container.current!,
        theme: basemapTheme,
        center: BENGALURU,
        zoom: 12,
        signal: abort.signal,
        lockNorthUp: true,
      };
      // This page checks the marker layer, not the basemap: if the basemap cannot be reached, draw the markers on
      // the blank Milky background instead of leaving the page dead (the basemap has its own page and tests).
      const created = await createBasemap({ ...basemapOptions, apiKey }).catch((error: unknown) => {
        if (abort.signal.aborted || !apiKey) throw error;
        setMessage("The basemap could not be loaded, so the markers are drawn on a blank background.");
        return createBasemap({ ...basemapOptions, apiKey: "" });
      });
      if (abort.signal.aborted) {
        created.remove();
        return;
      }
      map = created;
      tileWatcher.current = watchTileFailures(map, { onFailing: () => setTilesFailing(true), onRecovered: () => setTilesFailing(false) });
      const fontFamily = getComputedStyle(document.body).fontFamily;
      const glyphs = await buildGlyphSheet(fontFamily, cellSizeForDpr(window.devicePixelRatio));
      if (abort.signal.aborted) return;

      // Test controls, from the query string: ?delay=<ms> slows every logo load, ?pagePx=<n> shrinks the atlas
      // pages, and ?pages=<n> caps the memory budget at n pages, so paging and eviction show with few logos.
      const query = new URLSearchParams(location.search);
      const control: LogoControl = { delayMs: Number(query.get("delay") ?? 0), hold: false, requested: 0 };
      window.__logoControl = control;
      const pageSize = Number(query.get("pagePx") ?? PAGE_SIZE);
      const pages = Number(query.get("pages") ?? 0);
      const atlas = new LogoAtlas({
        cellPx: cellSizeForDpr(window.devicePixelRatio),
        pageSize,
        budgetBytes: pages > 0 ? pages * pageBytes(pageSize) : undefined,
        loadPixels: async (url, cellPx, signal) => {
          control.requested++;
          if (control.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, control.delayMs));
          while (control.hold) await new Promise((resolve) => setTimeout(resolve, 25));
          return loadLogoPixels(url, cellPx, { signal });
        },
      });
      theme = readMarkerTheme();
      const layer = new CompanyLayer({
        theme,
        glyphs,
        logoAtlas: atlas,
        now: () => window.__layerNow?.() ?? performance.now(),
      });
      // Not waiting for the map's `load`: it needs every tile, and the markers must show even when the basemap fails.
      detachLayer = attachCompanyLayer(map, layer);

      const show = (next: Scenario) => {
        removeLiveListener?.();
        removeLiveListener = undefined;
        client?.dispose();
        client = undefined;
        if (next === "logos") {
          const styles = getComputedStyle(document.documentElement);
          const canvas = map!.getCanvas();
          const view = viewFor(map!.getCenter(), map!.getZoom(), canvas.clientWidth, canvas.clientHeight);
          makeLogoUrls(LOGO_COUNT, styles.getPropertyValue("--ink").trim(), styles.getPropertyValue("--milky").trim())
            .then((urls) => {
              if (abort.signal.aborted) return;
              const scene = buildStaticScene({ view, clusters: 0, logos: LOGO_COUNT, stacks: 0, offscreen: 0 });
              layer.setItems(scene.map((item, i) => ({ ...item, companyId: i, logoUrl: urls[i] })));
            })
            .catch(() => setMessage("The synthetic logos could not be made."));
        } else if (next === "static") {
          const canvas = map!.getCanvas();
          const view = viewFor(map!.getCenter(), map!.getZoom(), canvas.clientWidth, canvas.clientHeight);
          layer.setItems(buildStaticScene({ view }));
        } else {
          const live = startLive(map!, layer, theme, (c) => (client = c), {
            onState: setMarkerState,
            onMirror: setMirror,
            onPopup: setPopup,
          });
          window.__liveControl = live;
          removeLiveListener = () => {
            live.stop();
            delete window.__liveControl;
            setMirror([]);
            setPopup(null);
          };
        }
      };
      api.current = { map, layer, show };
      window.__mapLayer = { map, layer, atlas };
      show("static");
      // Ready means the layer has drawn a frame. It does not wait for basemap tiles (`idle`), which depend on
      // the network and are not what this page checks.
      map.on("idle", () => setStats({ ...layer.stats }));
      map.once("render", () => {
        setStats({ ...layer.stats });
        setStatus("ready");
      });
      map.triggerRepaint();
    })().catch((error: unknown) => {
      if (abort.signal.aborted) return;
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "The map failed to load.");
    });

    return () => {
      abort.abort();
      removeLiveListener?.();
      client?.dispose();
      tileWatcher.current?.dispose();
      tileWatcher.current = null;
      detachLayer?.();
      map?.remove();
      api.current = null;
      delete window.__mapLayer;
      delete window.__logoControl;
      delete window.__liveKeys;
    };
  }, [apiKey]);

  function toggleStartups() {
    const next = !startupsOnly;
    setStartupsOnly(next);
    void window.__liveControl?.setStartupsOnly(next);
  }

  function choose(next: Scenario) {
    setScenario(next);
    setStartupsOnly(false);
    setMarkerState(NO_MARKER_STATE);
    setPopup(null);
    setMirror([]);
    api.current?.show(next);
  }

  if (status === "fallback") return <ListFallback />;

  return (
    <main className="relative h-dvh w-full">
      <div className="absolute inset-0">
        <div
          ref={container}
          className="h-full w-full"
          data-testid="map-layer"
          data-status={status}
          data-scenario={scenario}
          data-drawn={stats?.drawn ?? ""}
          data-culled={stats?.culled ?? ""}
        />
      </div>
      {scenario === "live" && (
        <MapA11yList
          entries={mirror}
          focusedKey={focusedKey}
          onFocusKey={(key) => {
            setFocusedKey(key);
            window.__liveControl?.setFocused(key);
          }}
          onActivate={(key) => {
            keyboardOpen.current = true;
            window.__liveControl?.activate(key);
          }}
        />
      )}
      {popup && (
        <MapPopup
          ref={popupRef}
          company={popup.company}
          layout={popup.layout}
          onClose={() => window.__markers?.controller.setSelected(null)}
          onViewCompany={(event) => {
            // The company page does not exist yet (P6-01). Record the click instead of leaving the page.
            event.preventDefault();
            window.__markers?.events.push({ type: "view-company", key: popup.company.id });
          }}
        />
      )}
      {tilesFailing && (
        <div
          role="alert"
          data-testid="tile-banner"
          className="absolute bottom-10 left-1/2 z-10 flex max-w-md -translate-x-1/2 flex-col gap-2 border border-rule bg-milky p-3 text-sm shadow-[0_1px_0_rgb(31_58_26/.08),0_6px_16px_rgb(31_58_26/.14)]"
        >
          <p>{TILE_NOTICE}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => tileWatcher.current?.retry()}>
              Try again
            </Button>
            <Button variant="outline" onClick={() => setShowList(true)}>
              Show the list
            </Button>
          </div>
        </div>
      )}
      {showList && (
        <div className="absolute inset-y-0 right-0 z-20 w-full max-w-sm overflow-auto border-l border-rule bg-milky p-4" data-testid="list-view">
          <Button variant="outline" onClick={() => setShowList(false)}>
            Back to the map
          </Button>
          <CompanyList />
        </div>
      )}
      <div className="absolute left-4 top-4 flex max-w-xs flex-col gap-2 border border-rule bg-milky p-3 shadow-[0_1px_0_rgb(31_58_26/.08),0_6px_16px_rgb(31_58_26/.14)]">
        <h1 className="text-lg font-semibold">Marker layer check</h1>
        <p className="text-sm text-muted-foreground">Synthetic data. No real companies are shown.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant={scenario === "static" ? "default" : "outline"} aria-pressed={scenario === "static"} onClick={() => choose("static")}>
            Static scene
          </Button>
          <Button variant={scenario === "live" ? "default" : "outline"} aria-pressed={scenario === "live"} onClick={() => choose("live")}>
            Live clusters
          </Button>
          {scenario === "live" && (
            <Button variant={startupsOnly ? "default" : "outline"} aria-pressed={startupsOnly} onClick={toggleStartups}>
              Startups only
            </Button>
          )}
          <Button variant={scenario === "logos" ? "default" : "outline"} aria-pressed={scenario === "logos"} onClick={() => choose("logos")}>
            Logos
          </Button>
        </div>
        {status === "loading" && <p className="text-sm text-muted-foreground">Loading the map…</p>}
        {stats && (
          <p className="text-sm tabular-nums" data-testid="layer-stats">
            {stats.drawn} drawn, {stats.culled} culled, {stats.drawCalls} draw call
          </p>
        )}
        {scenario === "live" && (
          <p className="text-sm tabular-nums" data-testid="marker-state" data-selected={markerState.selected ?? ""} data-spider={markerState.spider ?? ""}>
            {markerState.selected ? `Selected ${markerState.selected}. ` : "Nothing selected. "}
            {markerState.spider ? `Stack open as a ${markerState.spider}.` : "No stack open."}
          </p>
        )}
        {markerState.spider === "list" && (
          <div data-testid="stack-list" className="max-h-48 overflow-auto border border-rule p-2 text-sm">
            <p className="font-semibold">{markerState.members.length} companies in this building</p>
            <ul>
              {markerState.members.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        )}
        {message && (
          <p role="alert" className="text-sm text-danger">
            {message}
          </p>
        )}
      </div>
    </main>
  );
}

/** The deepest zoom the explorer allows (map-spec §1). */
const MAX_ZOOM = 19;

const TYPE_LABELS: Record<string, string> = { startup: "Startup", mnc: "MNC", product: "Product" };

/** The popup is this big on a desktop; the placement keeps it clear of the control panel and the map controls. */
const POPUP_SIZE = { width: 320, height: 260 };
/** The width below which the popup becomes a bottom sheet. */
const SHEET_BREAKPOINT = 640;

const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The live scenario: Bengaluru M through the clustering worker, re-requested whenever the map settles, with the
 * explorer's tap behaviour: a logo is selected and opens its popup, a cluster flies to its expansion zoom, a stack
 * opens its spider (or the list above 20), and a tap on the map closes the spider. The same actions work from the
 * keyboard through the mirror list.
 */
function startLive(
  map: MapLibreMap,
  layer: CompanyLayer,
  theme: MarkerTheme,
  onClient: (client: ClusterClient) => void,
  ui: LiveUi,
): LiveControl {
  const dataset = generateSyntheticDataset({ city: "bengaluru", size: "M" });
  const companies = new Map(dataset.companies.map((c) => [c.id, c]));
  const names = new Map(dataset.companies.map((c) => [c.id, c.name]));
  const officeById = new Map(dataset.offices.map((o) => [o.id, o]));
  const startups = new Set(dataset.companies.filter((c) => c.types.includes("startup")).map((c) => c.id));
  const client = createClusterWorkerClient();
  onClient(client);
  const memo: StackMemo = emptyStackMemo();
  const events: MarkerEvent[] = [];
  /** What is on the map by key, for the labels of the mirror list. */
  const liveItems = new Map<string, LayerItem>();
  let cancelled = false;
  let filterHash = "none";
  let mirrorSignature = "";
  let popupSignature = "";

  const companyOfKey = (key: string) => {
    const office = officeById.get(Number(key.slice(2)));
    return office ? companies.get(office.companyId) : undefined;
  };

  const publish = () => {
    const spider = controller.spider;
    ui.onState({
      selected: controller.selectedKey,
      spider: spider?.mode ?? null,
      members: spider?.mode === "list" ? spider.memberKeys.map((k) => companyOfKey(k)?.name ?? k) : [],
    });
    syncPopup();
  };
  const controller = new MarkerController({ map, layer, theme, onChange: publish });

  const memberItem = (officeKey: string): Omit<LayerItem, "lng" | "lat"> => {
    const office = officeById.get(Number(officeKey.slice(2)))!;
    const name = names.get(office.companyId) ?? "";
    return { key: officeKey, kind: "logo", letter: initialOf(name), swatch: swatchIndex(name), companyId: office.companyId };
  };

  // ---- the popup -------------------------------------------------------------------------------------------
  const popupCompany = (key: string): PopupCompany | null => {
    const company = companyOfKey(key);
    if (!company) return null;
    return {
      id: key,
      name: company.name,
      letter: initialOf(company.name),
      swatchVar: SWATCH_TOKENS[swatchIndex(company.name)],
      types: company.types.map((t) => TYPE_LABELS[t] ?? t),
      // The synthetic data has no neighbourhood, location accuracy, or jobs: the popup says "not stated", never a guess.
      neighbourhood: null,
      accuracy: null,
      openJobs: null,
      href: `/companies/synthetic-${company.id}`,
      synthetic: true,
    };
  };

  const layoutFor = (d: { x: number; y: number; radius: number }) => {
    const canvas = map.getCanvas();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width < SHEET_BREAKPOINT) {
      const sheet = placeSheet(d, { width, height });
      return { layout: { kind: "sheet", height: sheet.height } as PopupLayout, pan: sheet.pan };
    }
    // The control panel is on the left (about 340 px), the zoom buttons on the right, the attribution along the bottom.
    const placement = placePopup(d, POPUP_SIZE, { left: 344, top: 8, right: width - 56, bottom: height - 28 });
    return { layout: { kind: "popover", left: placement.left, top: placement.top, width: POPUP_SIZE.width } as PopupLayout, pan: placement.pan };
  };

  /** Keeps the popup beside its marker as the map moves. Hidden while the selected marker is not on the map. */
  function syncPopup() {
    const key = controller.selectedKey;
    const drawn = key ? layer.getDrawn().find((d) => d.key === key && d.kind === "logo") : undefined;
    const company = key && drawn ? popupCompany(key) : null;
    if (!company || !drawn) {
      if (popupSignature !== "") ui.onPopup(null);
      popupSignature = "";
      return;
    }
    const { layout } = layoutFor(drawn);
    const signature = `${key}|${JSON.stringify(layout)}`;
    if (signature === popupSignature) return;
    popupSignature = signature;
    ui.onPopup({ company, layout });
  }

  /** When a marker is selected, eases the map so its popup fits (map-spec §8). Done once per selection, not per frame. */
  const easeForPopup = (hit: HitCandidate) => {
    const { pan } = layoutFor(hit);
    if (pan.dx !== 0 || pan.dy !== 0) map.panBy([-pan.dx, -pan.dy], { duration: prefersReducedMotion() ? 0 : 300 });
  };

  // ---- the mirror list -------------------------------------------------------------------------------------
  const labelFor = (d: DrawnItem): string => {
    const item = liveItems.get(d.key) ?? controller.spider?.items.find((i) => i.key === d.key);
    if (d.kind === "cluster") return `${item?.count ?? "Several"} companies. Press Enter to zoom in.`;
    if (d.kind === "stack") return `${item?.count ?? "Several"} companies at the same address. Press Enter to open.`;
    return companyOfKey(d.key)?.name ?? d.key;
  };

  /** Rebuilds the list from the last settled frame, and only when the set of markers changed. */
  const syncMirror = () => {
    if (layer.stats.animating) return;
    const canvas = map.getCanvas();
    const entries = mirrorEntries(layer.getDrawn(), { width: canvas.clientWidth, height: canvas.clientHeight });
    const signature = entries.map((e) => e.key).join("|");
    if (signature === mirrorSignature) return;
    mirrorSignature = signature;
    const byKey = new Map(layer.getDrawn().map((d) => [d.key, d]));
    ui.onMirror(entries.map((e) => ({ ...e, label: labelFor(byKey.get(e.key)!) })));
  };
  const onRender = () => {
    syncMirror();
    syncPopup();
  };
  map.on("render", onRender);

  // ---- taps ------------------------------------------------------------------------------------------------
  const interactions = attachMarkerInteractions(map, layer, {
    onLogo: ({ hit }) => {
      events.push({ type: "logo", key: hit.key });
      controller.setSelected(hit.key);
      easeForPopup(hit);
    },
    onCluster: ({ hit, lngLat }) => {
      void client.getExpansionZoom(hit.key).then((zoom) => {
        events.push({ type: "cluster", key: hit.key, zoom: zoom ?? undefined });
        if (zoom === null || cancelled) return;
        map.easeTo({ center: [lngLat.lng, lngLat.lat], zoom: Math.min(zoom, MAX_ZOOM), duration: prefersReducedMotion() ? 0 : 400 });
      });
    },
    onStack: ({ hit }) => {
      if (controller.spider?.stackKey === hit.key) {
        events.push({ type: "stack", key: hit.key, mode: "closed" });
        controller.collapse();
        return;
      }
      const group = memo.stacks.get(hit.key);
      if (!group) return;
      const spider = controller.openStack({ key: group.key, lng: group.lng, lat: group.lat }, group.memberKeys.map(memberItem));
      events.push({ type: "stack", key: hit.key, mode: spider.mode });
    },
    onBackground: () => {
      events.push({ type: "background" });
      controller.collapse();
    },
  });

  window.__markers = {
    controller,
    interactions,
    events,
    groups: dataset.groups.map((g) => ({ id: g.id, kind: g.kind, lng: g.lng, lat: g.lat, size: g.officeIds.length })),
  };

  // ---- the worker ------------------------------------------------------------------------------------------
  const refresh = async () => {
    const b = map.getBounds();
    const padLng = (b.getEast() - b.getWest()) * 0.2;
    const padLat = (b.getNorth() - b.getSouth()) * 0.2;
    const response = await client.getClusters(
      [b.getWest() - padLng, b.getSouth() - padLat, b.getEast() + padLng, b.getNorth() + padLat],
      map.getZoom(),
    );
    if (!response || cancelled) return; // null: a newer request superseded this one
    const makeItem = (i: number): LayerItem => {
      const key = response.keys[i];
      const lng = response.lngLat[2 * i];
      const lat = response.lngLat[2 * i + 1];
      if (response.kinds[i] === KIND_CLUSTER) return { key, kind: "cluster", lng, lat, count: response.companyCounts[i] };
      const name = names.get(response.companyIds[i]) ?? "";
      return { key, kind: "logo", lng, lat, letter: initialOf(name), swatch: swatchIndex(name) };
    };
    // The response carries each item's parent and children, so the layer can split and merge from where the
    // markers are now. Co-located offices become stacks on the deepest level. An older response than one already
    // applied is ignored.
    const targets = colocateResponse(response, {
      makeItem,
      makeStack: (group) => {
        const first = memberItem(group.memberKeys[0]);
        return { key: group.key, kind: "stack", lng: group.lng, lat: group.lat, count: group.count, letter: first.letter, swatch: first.swatch };
      },
      namespace: `synthetic:${filterHash}`,
      memo,
      deepestLevel: MAX_LEVEL,
    });
    const applied = controller.apply({
      targets,
      level: response.level,
      namespace: `synthetic:${filterHash}`,
      generation: response.generation,
    });
    if (applied) {
      liveItems.clear();
      for (const t of targets) liveItems.set(t.item.key, t.item);
      mirrorSignature = ""; // labels may have changed
      window.__liveKeys = response.keys;
    }
  };

  const load = async (hash: string) => {
    filterHash = hash;
    const offices = dataset.offices.filter((o) => hash === "none" || startups.has(o.companyId));
    await client.load(
      packPointSet(
        offices.map((o) => ({ id: o.id, companyId: o.companyId, lng: o.lng, lat: o.lat })),
        { dataVersion: "synthetic", filterHash: hash },
      ),
    );
    await refresh();
  };

  load("none").catch(() => {});
  map.on("moveend", refresh);
  return {
    setStartupsOnly: (on) => load(on ? "startups" : "none"),
    setFocused: (key) => controller.setFocused(key),
    activate: (key) => {
      const hit = layer.getDrawn().find((d) => d.key === key);
      if (hit) interactions.activate(hit);
    },
    stop() {
      cancelled = true;
      map.off("moveend", refresh);
      map.off("render", onRender);
      interactions.detach();
      controller.dispose();
      delete window.__markers;
      delete window.__liveKeys;
    },
  };
}

/** The list of companies the page falls back to when the map cannot run, and its "Show the list" companion. */
function CompanyList() {
  const rows = generateSyntheticDataset({ city: "bengaluru", size: "S" })
    .companies.slice(0, 100)
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <p className="mt-3 text-sm text-muted-foreground">Synthetic data. These are not real companies.</p>
      <ul className="mt-2 divide-y divide-rule border-y border-rule" data-testid="company-list">
        {rows.map((c) => (
          <li key={c.id} className="flex min-h-11 items-center justify-between gap-3 py-2">
            <span className="font-semibold">{c.name}</span>
            <span className="text-sm text-muted-foreground">{c.types.map((t) => TYPE_LABELS[t] ?? t).join(" · ")}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function ListFallback() {
  return (
    <main className="mx-auto max-w-2xl p-4" data-testid="map-layer" data-status="fallback">
      <h1 className="text-2xl font-semibold">Companies</h1>
      <p role="status" data-testid="map-fallback-notice" className="mt-2 border border-rule bg-milky-shade p-3 text-sm">
        {WEBGL_NOTICE}
      </p>
      <CompanyList />
    </main>
  );
}
