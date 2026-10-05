// The explorer's map: the basemap, the company marker layer, the clustering worker, taps, the popup's
// position, and the keyboard mirror, wired together for one city (P4-03). Browser only, no React: the
// React shell (components/explorer/explorer-map-view.tsx) owns the DOM around it and hears from this
// class through `ExplorerMapEvents`.
//
// What it does not do: filter. The shell runs the one TypeScript filter (lib/filters) and hands the
// resulting offices to `setOffices`; every marker, cluster count, and mirror entry comes from that set,
// so the map cannot disagree with the list (CLAUDE.md, Conventions).
import type { Map as MapLibreMap } from "maplibre-gl";
import type { MirrorListEntry } from "../components/explorer/map-a11y-list";
import type { PopupLayout } from "../components/explorer/map-popup";
import { mirrorEntries } from "./a11y-mirror";
import { cellSizeForDpr, buildGlyphSheet } from "./atlas/glyph-sheet";
import { initialOf, swatchIndex } from "./atlas/fallback";
import { LogoAtlas } from "./atlas/logo-atlas";
import { loadLogoPixels } from "./atlas/logo-loader";
import { createBasemap } from "./basemap";
import { checkWebGl2, watchTileFailures, type TileWatcher } from "./fallback";
import type { HitCandidate } from "./hit-test/hit-test";
import { attachMarkerInteractions, type MarkerInteractions } from "./hit-test/interactions";
import { colocateResponse, emptyStackMemo, type StackMemo } from "./layer/colocation";
import { CompanyLayer, attachCompanyLayer, type DrawnItem } from "./layer/company-layer";
import type { LayerItem } from "./layer/instances";
import { MarkerController } from "./layer/marker-controller";
import { placePopup, placeSheet, type Rect } from "./popup-placement";
import { readBasemapTheme, readMarkerTheme } from "./theme";
import { createClusterWorkerClient, type ClusterClient } from "./worker/client";
import { KIND_CLUSTER, MAX_LEVEL, packPointSet } from "./worker/protocol";

export type ExplorerMapCompany = { id: string; name: string; logoUrl: string | null };
export type ExplorerMapOffice = { id: string; company_id: string; lng: number; lat: number };
export type ExplorerCamera = { lat: number; lng: number; zoom: number };

/** The city limit as GeoJSON, drawn as a dashed Moss line (design-system.md §2). */
export type ExplorerBoundary = { type: "MultiPolygon"; coordinates: unknown[] };

export type StackState = {
  mode: "circle" | "spiral" | "list" | null;
  /** The companies in an open stack list (more than 20 at one address), in key order. */
  companyIds: string[];
};

export type ExplorerMapEvents = {
  /** A visitor tapped a company's logo (its id) or the empty map (null). */
  onSelect(companyId: string | null): void;
  /** Where the popup for the selected company goes, or null when it should be hidden. */
  onPopup(popup: { companyId: string; officeId: string; layout: PopupLayout } | null): void;
  onMirror(entries: MirrorListEntry[]): void;
  onStack(state: StackState): void;
  /** The map stopped moving. */
  onCamera(camera: ExplorerCamera): void;
  onTilesFailing(failing: boolean): void;
  /** The basemap could not be loaded at all; the markers are drawn on a blank background. */
  onBasemapUnavailable(): void;
};

export type ExplorerMapOptions = {
  container: HTMLElement;
  /** Empty means no basemap: the blank Milky background and no Geoapify request. */
  apiKey: string;
  signal: AbortSignal;
  dataVersion: string;
  /** The whole city. A company's or office's number in these arrays is its id inside the worker. */
  companies: readonly ExplorerMapCompany[];
  offices: readonly ExplorerMapOffice[];
  boundary: ExplorerBoundary | null;
  initial: ExplorerCamera;
  /** The part of the map not covered by the toolbar, in px from the map's top-left. Null: the whole canvas. */
  getVisibleArea(): Rect | null;
  events: ExplorerMapEvents;
};

/** The deepest zoom the explorer allows (map-spec §1) and the widest. */
const MAX_ZOOM = 19;
const MIN_ZOOM = 8;
/** The selected company is brought to at least this zoom (the deepest clustering level, so its logo is drawn alone). */
const SELECT_ZOOM = 17;

const POPUP_SIZE = { width: 320, height: 260 };
/** The width below which the popup becomes a bottom sheet. */
const SHEET_BREAKPOINT = 640;

const BOUNDARY_ID = "city-boundary";

const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export type ExplorerMapDebug = {
  map: MapLibreMap;
  layer: CompanyLayer;
  controller: MarkerController;
  interactions: MarkerInteractions;
};

export class ExplorerMap {
  readonly map: MapLibreMap;
  readonly layer: CompanyLayer;
  readonly controller: MarkerController;
  readonly interactions: MarkerInteractions;

  private readonly options: ExplorerMapOptions;
  private readonly client: ClusterClient;
  private readonly tileWatcher: TileWatcher;
  private readonly detachLayer: () => void;
  private readonly memo: StackMemo = emptyStackMemo();
  private readonly officeNumber = new Map<string, number>();
  private readonly companyNumber = new Map<string, number>();
  private readonly officesOfCompany = new Map<string, number[]>();
  /** What is on the map by key, for the labels of the mirror list. */
  private readonly liveItems = new Map<string, LayerItem>();
  private currentOffices = new Set<number>();
  private filterHash = "none";
  private disposed = false;
  private mirrorSignature = "";
  private popupSignature = "";
  private selectedCompany: string | null = null;
  private stackSignature = "";
  private pendingFly = false;

  private constructor(options: ExplorerMapOptions, map: MapLibreMap, layer: CompanyLayer, detachLayer: () => void) {
    this.options = options;
    this.map = map;
    this.layer = layer;
    this.detachLayer = detachLayer;
    this.client = createClusterWorkerClient();
    options.offices.forEach((o, i) => {
      this.officeNumber.set(o.id, i);
      const list = this.officesOfCompany.get(o.company_id);
      if (list) list.push(i);
      else this.officesOfCompany.set(o.company_id, [i]);
    });
    options.companies.forEach((c, i) => this.companyNumber.set(c.id, i));

    this.controller = new MarkerController({ map, layer, theme: readMarkerTheme(), onChange: () => this.publish() });
    this.tileWatcher = watchTileFailures(map, {
      onFailing: () => options.events.onTilesFailing(true),
      onRecovered: () => options.events.onTilesFailing(false),
    });
    this.interactions = attachMarkerInteractions(map, layer, {
      onLogo: ({ hit }) => this.tapLogo(hit),
      onCluster: ({ hit, lngLat }) => this.tapCluster(hit, lngLat),
      onStack: ({ hit }) => this.tapStack(hit),
      onBackground: () => {
        // A tap on the empty map closes an open stack first; with none open it clears the selection (and the popup).
        if (this.controller.collapse()) return;
        if (this.controller.selectedKey) this.clearSelection();
      },
    });
    map.on("render", this.onRender);
    map.on("moveend", this.onMoveEnd);
  }

  /**
   * Builds the map for one city. Resolves to null when `signal` aborted first (the caller already left), and
   * rejects when WebGL2 is not available: the shell checks `checkWebGl2` first and shows the list instead.
   */
  static async create(options: ExplorerMapOptions): Promise<ExplorerMap | null> {
    if (!checkWebGl2().ok) throw new Error("WebGL2 is not available");
    const basemapTheme = readBasemapTheme();
    const basemapOptions = {
      container: options.container,
      theme: basemapTheme,
      center: [options.initial.lng, options.initial.lat] as [number, number],
      zoom: options.initial.zoom,
      signal: options.signal,
      lockNorthUp: true,
    };
    // If the basemap cannot be reached, draw the markers on the blank Milky background instead of leaving the page
    // dead: the companies are what the visitor came for.
    const map = await createBasemap({ ...basemapOptions, apiKey: options.apiKey }).catch((error: unknown) => {
      if (options.signal.aborted || !options.apiKey) throw error;
      options.events.onBasemapUnavailable();
      return createBasemap({ ...basemapOptions, apiKey: "" });
    });
    if (options.signal.aborted) {
      map.remove();
      return null;
    }
    map.setMinZoom(MIN_ZOOM);
    map.setMaxZoom(MAX_ZOOM);

    const glyphs = await buildGlyphSheet(getComputedStyle(document.body).fontFamily, cellSizeForDpr(window.devicePixelRatio));
    if (options.signal.aborted) {
      map.remove();
      return null;
    }
    const atlas = new LogoAtlas({
      cellPx: cellSizeForDpr(window.devicePixelRatio),
      loadPixels: (url, cellPx, signal) => loadLogoPixels(url, cellPx, { signal }),
    });
    const layer = new CompanyLayer({ theme: readMarkerTheme(), glyphs, logoAtlas: atlas });
    // Not waiting for the map's `load`: it needs every tile, and the markers must show even when the basemap fails.
    const detachLayer = attachCompanyLayer(map, layer);
    const instance = new ExplorerMap(options, map, layer, detachLayer);
    instance.addBoundary(basemapTheme.label);
    return instance;
  }

  // ---- public API ---------------------------------------------------------------------------------------------

  /** Replaces what the map shows: the offices of the companies the filter kept. Resolves once the markers are applied. */
  async setOffices(offices: readonly ExplorerMapOffice[], filterHash: string): Promise<void> {
    if (this.disposed) return;
    this.filterHash = filterHash;
    const numbers = offices.map((o) => this.officeNumber.get(o.id)).filter((n): n is number => n !== undefined);
    this.currentOffices = new Set(numbers);
    await this.client.load(
      packPointSet(
        numbers.map((n) => {
          const o = this.options.offices[n];
          return { id: n, companyId: this.companyNumber.get(o.company_id) ?? 0, lng: o.lng, lat: o.lat };
        }),
        { dataVersion: this.options.dataVersion, filterHash },
      ),
    );
    await this.refresh();
    // A selection that is still in the set stays; one that left (a filter excluded it) is dropped by the shell.
    if (this.selectedCompany) this.setSelectedCompany(this.selectedCompany, { fly: this.pendingFly });
  }

  /**
   * Selects a company by id, or clears the selection with null. The marker is its first office in the current set
   * (the tapped one, if that is where the selection came from). `fly` brings it into view and zooms to it.
   */
  setSelectedCompany(companyId: string | null, { fly = false }: { fly?: boolean } = {}): void {
    if (this.disposed) return;
    this.selectedCompany = companyId;
    if (companyId === null) {
      this.pendingFly = false;
      this.controller.setSelected(null);
      return;
    }
    // Already on one of this company's offices (the visitor tapped it): nothing to move.
    const keyNow = this.controller.selectedKey;
    if (keyNow && this.companyOfKey(keyNow) === companyId) return;
    const numbers = (this.officesOfCompany.get(companyId) ?? []).filter((n) => this.currentOffices.has(n));
    if (numbers.length === 0) {
      // The points have not arrived yet (a shared link opens on a company), or the filter dropped it. Remember the
      // wish: `setOffices` tries again when the points are in.
      this.pendingFly = fly || this.pendingFly;
      this.controller.setSelected(null);
      return;
    }
    this.pendingFly = false;
    const office = this.options.offices[numbers[0]];
    const key = `o:${numbers[0]}`;
    if (fly) {
      const duration = prefersReducedMotion() ? 0 : 500;
      this.map.easeTo({ center: [office.lng, office.lat], zoom: Math.max(this.map.getZoom(), SELECT_ZOOM), duration });
    }
    this.controller.setSelected(key);
  }

  getCamera(): ExplorerCamera {
    const c = this.map.getCenter();
    return { lat: c.lat, lng: c.lng, zoom: this.map.getZoom() };
  }

  /** Moves the map to a camera taken from the URL (Back, Forward, a shared link). Instant: a history step is not a journey. */
  jumpTo(camera: ExplorerCamera): void {
    if (this.disposed) return;
    this.map.jumpTo({ center: [camera.lng, camera.lat], zoom: camera.zoom });
  }

  /** The map shows again after being hidden (the Grid or List view was on top). */
  resize(): void {
    if (!this.disposed) this.map.resize();
  }

  retryTiles(): void {
    this.tileWatcher.retry();
  }

  setFocused(key: string | null): void {
    this.controller.setFocused(key);
  }

  /** Does what a tap on the drawn marker does (the mirror list's Enter). */
  activate(key: string): void {
    const hit = this.layer.getDrawn().find((d) => d.key === key);
    if (hit) this.interactions.activate(hit);
  }

  /** What the map was given to show: the offices, and the companies they belong to. For the debug hook and tests. */
  loadedCounts(): { offices: number; companies: number } {
    const companies = new Set<string>();
    for (const n of this.currentOffices) companies.add(this.options.offices[n].company_id);
    return { offices: this.currentOffices.size, companies: companies.size };
  }

  /** The markers on the screen, for the debug hook and tests. */
  drawnKeys(): string[] {
    return this.layer.getDrawn().map((d) => d.key);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.map.off("render", this.onRender);
    this.map.off("moveend", this.onMoveEnd);
    this.interactions.detach();
    this.controller.dispose();
    this.tileWatcher.dispose();
    this.client.dispose();
    this.detachLayer();
    this.map.remove();
  }

  // ---- the city boundary --------------------------------------------------------------------------------------

  private addBoundary(colour: string): void {
    const boundary = this.options.boundary;
    if (!boundary) return;
    const add = () => {
      if (this.disposed || this.map.getSource(BOUNDARY_ID)) return;
      try {
        this.map.addSource(BOUNDARY_ID, { type: "geojson", data: { type: "Feature", properties: {}, geometry: boundary as never } });
        this.map.addLayer(
          { id: BOUNDARY_ID, type: "line", source: BOUNDARY_ID, paint: { "line-color": colour, "line-width": 1.5, "line-dasharray": [3, 2] } },
          this.map.getLayer(this.layer.id) ? this.layer.id : undefined,
        );
      } catch {
        // The style is still loading, or reloading after a lost context: try again at the next style event.
      }
    };
    add();
    // Re-added after a style reload (a restored WebGL context); the check at the top makes it a no-op otherwise.
    this.map.on("styledata", add);
  }

  // ---- keys, companies, offices -------------------------------------------------------------------------------

  private officeOfKey(key: string): ExplorerMapOffice | undefined {
    return key.startsWith("o:") ? this.options.offices[Number(key.slice(2))] : undefined;
  }

  private companyOfKey(key: string): string | undefined {
    return this.officeOfKey(key)?.company_id;
  }

  private company(id: string | undefined): ExplorerMapCompany | undefined {
    const n = id === undefined ? undefined : this.companyNumber.get(id);
    return n === undefined ? undefined : this.options.companies[n];
  }

  private memberItem(officeKey: string): Omit<LayerItem, "lng" | "lat"> {
    const office = this.officeOfKey(officeKey)!;
    const company = this.company(office.company_id);
    const name = company?.name ?? "";
    return {
      key: officeKey,
      kind: "logo",
      letter: initialOf(name),
      swatch: swatchIndex(name),
      companyId: this.companyNumber.get(office.company_id),
      logoUrl: company?.logoUrl ?? null,
    };
  }

  // ---- worker -------------------------------------------------------------------------------------------------

  private readonly onMoveEnd = (): void => {
    void this.refresh();
    this.options.events.onCamera(this.getCamera());
  };

  private async refresh(): Promise<void> {
    if (this.disposed) return;
    const b = this.map.getBounds();
    const padLng = (b.getEast() - b.getWest()) * 0.2;
    const padLat = (b.getNorth() - b.getSouth()) * 0.2;
    const response = await this.client.getClusters(
      [b.getWest() - padLng, b.getSouth() - padLat, b.getEast() + padLng, b.getNorth() + padLat],
      this.map.getZoom(),
    );
    if (!response || this.disposed) return; // null: a newer request superseded this one
    const namespace = `${this.options.dataVersion}:${this.filterHash}`;
    const makeItem = (i: number): LayerItem => {
      const key = response.keys[i];
      const lng = response.lngLat[2 * i];
      const lat = response.lngLat[2 * i + 1];
      if (response.kinds[i] === KIND_CLUSTER) return { key, kind: "cluster", lng, lat, count: response.companyCounts[i] };
      return { ...this.memberItem(key), lng, lat };
    };
    // The response carries each item's parent and children, so the layer can split and merge from where the markers
    // are now. Co-located offices become stacks on the deepest level.
    const targets = colocateResponse(response, {
      makeItem,
      makeStack: (group) => {
        const first = this.memberItem(group.memberKeys[0]);
        return { key: group.key, kind: "stack", lng: group.lng, lat: group.lat, count: group.count, letter: first.letter, swatch: first.swatch };
      },
      namespace,
      memo: this.memo,
      deepestLevel: MAX_LEVEL,
    });
    const applied = this.controller.apply({ targets, level: response.level, namespace, generation: response.generation });
    if (applied) {
      this.liveItems.clear();
      for (const t of targets) this.liveItems.set(t.item.key, t.item);
      this.mirrorSignature = ""; // labels may have changed
      this.ensureSelectedVisible();
    }
  }

  /**
   * A selected company that sits in a stack of co-located offices is not drawn as a logo: open the stack's spider so
   * its marker (and its popup) can show. Only after a zoom or a load, never over a spider the visitor already opened.
   */
  private ensureSelectedVisible(): void {
    const key = this.controller.selectedKey;
    if (!key || this.controller.spider || this.liveItems.has(key)) return;
    for (const group of this.memo.stacks.values()) {
      if (!group.memberKeys.includes(key) || !this.liveItems.has(group.key)) continue;
      this.controller.openStack({ key: group.key, lng: group.lng, lat: group.lat }, group.memberKeys.map((k) => this.memberItem(k)));
      return;
    }
  }

  // ---- taps ---------------------------------------------------------------------------------------------------

  private tapLogo(hit: HitCandidate): void {
    const companyId = this.companyOfKey(hit.key);
    if (!companyId) return;
    this.selectedCompany = companyId;
    this.controller.setSelected(hit.key);
    this.easeForPopup(hit);
    this.options.events.onSelect(companyId);
  }

  private tapCluster(hit: HitCandidate, lngLat: { lng: number; lat: number }): void {
    void this.client.getExpansionZoom(hit.key).then((zoom) => {
      if (zoom === null || this.disposed) return;
      this.map.easeTo({ center: [lngLat.lng, lngLat.lat], zoom: Math.min(zoom, MAX_ZOOM), duration: prefersReducedMotion() ? 0 : 400 });
    });
  }

  private tapStack(hit: HitCandidate): void {
    if (this.controller.spider?.stackKey === hit.key) {
      this.controller.collapse();
      return;
    }
    const group = this.memo.stacks.get(hit.key);
    if (!group) return;
    this.controller.openStack({ key: group.key, lng: group.lng, lat: group.lat }, group.memberKeys.map((k) => this.memberItem(k)));
  }

  private clearSelection(): void {
    this.selectedCompany = null;
    this.controller.setSelected(null);
    this.options.events.onSelect(null);
  }

  // ---- the popup, the mirror list, the stack list -------------------------------------------------------------

  private readonly onRender = (): void => {
    this.syncMirror();
    this.syncPopup();
  };

  /** Called by the marker controller after the selection or the spider changed. */
  private publish(): void {
    const spider = this.controller.spider;
    const companyIds = spider?.mode === "list" ? spider.memberKeys.map((k) => this.companyOfKey(k)).filter((id): id is string => !!id) : [];
    const state: StackState = { mode: spider?.mode ?? null, companyIds };
    const signature = `${state.mode}|${companyIds.join(",")}`;
    if (signature !== this.stackSignature) {
      this.stackSignature = signature;
      this.options.events.onStack(state);
    }
    this.syncPopup();
  }

  private visibleArea(): Rect {
    const canvas = this.map.getCanvas();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const given = this.options.getVisibleArea();
    // Leave room for the zoom buttons on the right and the attribution along the bottom.
    return given ?? { left: 8, top: 8, right: width - 56, bottom: height - 28 };
  }

  private layoutFor(d: { x: number; y: number; radius: number }): { layout: PopupLayout; pan: { dx: number; dy: number } } {
    const canvas = this.map.getCanvas();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width < SHEET_BREAKPOINT) {
      const sheet = placeSheet(d, { width, height });
      return { layout: { kind: "sheet", height: sheet.height }, pan: sheet.pan };
    }
    const placement = placePopup(d, POPUP_SIZE, this.visibleArea());
    return { layout: { kind: "popover", left: placement.left, top: placement.top, width: POPUP_SIZE.width }, pan: placement.pan };
  }

  /** Keeps the popup beside its marker as the map moves. Hidden while the selected marker is not on the map. */
  private syncPopup(): void {
    const key = this.controller.selectedKey;
    const drawn = key ? this.layer.getDrawn().find((d) => d.key === key && d.kind === "logo") : undefined;
    const companyId = key ? this.companyOfKey(key) : undefined;
    const office = key ? this.officeOfKey(key) : undefined;
    if (!key || !drawn || !companyId || !office) {
      if (this.popupSignature !== "") this.options.events.onPopup(null);
      this.popupSignature = "";
      return;
    }
    const { layout } = this.layoutFor(drawn);
    const signature = `${key}|${JSON.stringify(layout)}`;
    if (signature === this.popupSignature) return;
    this.popupSignature = signature;
    this.options.events.onPopup({ companyId, officeId: office.id, layout });
  }

  /** When a marker is selected, eases the map so its popup fits (map-spec §8). Done once per selection, not per frame. */
  private easeForPopup(hit: HitCandidate): void {
    const { pan } = this.layoutFor(hit);
    if (pan.dx !== 0 || pan.dy !== 0) this.map.panBy([-pan.dx, -pan.dy], { duration: prefersReducedMotion() ? 0 : 300 });
  }

  private labelFor(d: DrawnItem): string {
    const item = this.liveItems.get(d.key) ?? this.controller.spider?.items.find((i) => i.key === d.key);
    if (d.kind === "cluster") return `${item?.count ?? "Several"} companies. Press Enter to zoom in.`;
    if (d.kind === "stack") return `${item?.count ?? "Several"} companies at the same address. Press Enter to open.`;
    return this.company(this.companyOfKey(d.key))?.name ?? d.key;
  }

  /** Rebuilds the keyboard list from the last settled frame, and only when the set of markers changed. */
  private syncMirror(): void {
    if (this.layer.stats.animating) return;
    const canvas = this.map.getCanvas();
    const drawn = this.layer.getDrawn();
    const entries = mirrorEntries(drawn, { width: canvas.clientWidth, height: canvas.clientHeight });
    const signature = entries.map((e) => e.key).join("|");
    if (signature === this.mirrorSignature) return;
    this.mirrorSignature = signature;
    const byKey = new Map(drawn.map((d) => [d.key, d]));
    this.options.events.onMirror(entries.map((e) => ({ ...e, label: this.labelFor(byKey.get(e.key)!) })));
  }
}
