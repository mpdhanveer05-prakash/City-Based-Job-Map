// The marker controller: the one place that decides what the layer shows when something besides the worker changes
// it. It keeps the latest worker update, the selected marker, and an open spider, and re-composes them whenever any
// of the three changes (map-spec §7 and §8). The explorer reads state from here; the layer only draws.
//
// Spider legs are a thin MapLibre line layer under the markers. They are not company markers, so they do not
// break the no-DOM-markers, one-draw-call rule for markers.
import type { Map as MapLibreMap } from "maplibre-gl";
import type { MarkerTheme } from "../theme.ts";
import type { CompanyLayer, LayerTarget, LayerUpdate } from "./company-layer.ts";
import { screenToLngLat, viewFor } from "./geometry.ts";
import type { LayerItem } from "./instances.ts";
import { legsGeoJson, openSpider, type OpenSpider, type SpiderMember } from "./spider.ts";

export type MarkerControllerOptions = {
  map: MapLibreMap;
  /** Must already be added to the map: the legs are inserted just below it. */
  layer: CompanyLayer;
  theme: Pick<MarkerTheme, "spiderLeg">;
  /** Called after the selection or the spider changed. */
  onChange?: () => void;
};

const LEG_WIDTH_PX = 1.5;

export class MarkerController {
  private readonly map: MapLibreMap;
  private readonly layer: CompanyLayer;
  private readonly legColour: string;
  private readonly onChange: () => void;
  private readonly sourceId: string;
  private readonly legLayerId: string;
  private base: LayerUpdate | null = null;
  private selected: string | null = null;
  private focused: string | null = null;
  private open: OpenSpider | null = null;
  private disposed = false;

  constructor(options: MarkerControllerOptions) {
    this.map = options.map;
    this.layer = options.layer;
    this.legColour = options.theme.spiderLeg;
    this.onChange = options.onChange ?? (() => {});
    this.sourceId = `${options.layer.id}-spider-legs`;
    this.legLayerId = `${options.layer.id}-spider-legs`;
    this.map.on("zoomstart", this.collapseOnZoom);
    document.addEventListener("keydown", this.onKeyDown);
  }

  get selectedKey(): string | null {
    return this.selected;
  }

  /** The marker that has keyboard focus (drawn with the focus ring), or null. */
  get focusedKey(): string | null {
    return this.focused;
  }

  get spider(): OpenSpider | null {
    return this.open;
  }

  /** Applies a worker update. Returns false (changing nothing) when the layer already holds a newer one. */
  apply(update: LayerUpdate): boolean {
    const applied = this.layer.setTargets({ ...update, targets: this.compose(update.targets) });
    if (applied) this.base = update;
    return applied;
  }

  /** Selects a marker by key, or clears the selection with null. The selected marker is drawn on top, ringed, larger. */
  setSelected(key: string | null): void {
    if (this.selected === key) return;
    this.selected = key;
    this.recompose();
    this.onChange();
  }

  /** Gives a marker the keyboard-focus ring (a 2 px Ink ring, separate from the selection ring), or clears it. */
  setFocused(key: string | null): void {
    if (this.focused === key) return;
    this.focused = key;
    this.recompose();
    this.onChange();
  }

  /**
   * Opens a stack around its true position. Returns the spider; for more than 20 members it has mode "list" and no
   * items: the caller shows the side list. Opening another stack closes the first.
   */
  openStack(stack: { key: string; lng: number; lat: number }, members: readonly SpiderMember[]): OpenSpider {
    const canvas = this.map.getCanvas();
    const view = viewFor(this.map.getCenter(), this.map.getZoom(), canvas.clientWidth, canvas.clientHeight);
    this.open = openSpider({ stack, members, view, zoom: this.map.getZoom() });
    this.syncLegs();
    this.recompose();
    this.onChange();
    return this.open;
  }

  /** Closes the spider or the list. Returns whether anything was open. */
  collapse(): boolean {
    if (!this.open) return false;
    this.open = null;
    this.syncLegs();
    this.recompose();
    this.onChange();
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.map.off("zoomstart", this.collapseOnZoom);
    document.removeEventListener("keydown", this.onKeyDown);
    if (this.map.getLayer(this.legLayerId)) this.map.removeLayer(this.legLayerId);
    if (this.map.getSource(this.sourceId)) this.map.removeSource(this.sourceId);
  }

  /** The base targets with the selection and focus applied, plus the spider's members. */
  private compose(targets: readonly LayerTarget[]): LayerTarget[] {
    const mark = (item: LayerItem): LayerItem =>
      !!item.selected === (item.key === this.selected) && !!item.focused === (item.key === this.focused)
        ? item
        : { ...item, selected: item.key === this.selected, focused: item.key === this.focused };
    const marked = targets.map((t) => {
      const item = mark(t.item);
      return item === t.item ? t : { ...t, item };
    });
    const spiderItems = (this.open?.items ?? []).map<LayerTarget>((item) => ({
      item: mark(item),
      parentKey: item.key,
      childKeys: [item.key],
    }));
    return [...marked, ...spiderItems];
  }

  private recompose(): void {
    if (!this.base) return;
    // Same generation and level: the layer treats it as a pan, so new markers fade in and old ones fade out.
    this.layer.setTargets({ ...this.base, targets: this.compose(this.base.targets) });
  }

  // A spider's offsets were made for one zoom, so any zoom change closes it (map-spec §7).
  private readonly collapseOnZoom = (): void => {
    this.collapse();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.collapse()) event.preventDefault();
  };

  private syncLegs(): void {
    const data = legsGeoJson(this.open);
    try {
      const source = this.map.getSource(this.sourceId) as { setData(data: unknown): void } | undefined;
      if (source) {
        source.setData(data);
        return;
      }
      if (!this.open) return; // nothing to draw, nothing to create
      this.map.addSource(this.sourceId, { type: "geojson", data });
      this.map.addLayer(
        { id: this.legLayerId, type: "line", source: this.sourceId, paint: { "line-color": this.legColour, "line-width": LEG_WIDTH_PX } },
        this.layer.id,
      );
    } catch {
      // The style is reloading (after a lost WebGL context). The markers still show; the legs return on the next open.
    }
  }
}

/** A map click's screen point back to a position, for flying to a cluster. */
export function lngLatAtScreen(map: MapLibreMap, x: number, y: number): { lng: number; lat: number } {
  const canvas = map.getCanvas();
  return screenToLngLat(viewFor(map.getCenter(), map.getZoom(), canvas.clientWidth, canvas.clientHeight), x, y);
}
