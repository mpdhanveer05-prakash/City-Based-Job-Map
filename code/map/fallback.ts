// Failure modes of the map (map-spec §9). Pure functions and one MapLibre watcher; no React.
//
// - WebGL2 unavailable: the explorer lands on List view with a notice (the list holds every company, so nothing
//   is lost).
// - Tiles failing to load: a banner with Retry and a link to List view. The markers still draw, so the map is
//   usable without a basemap; the banner says so.
import type { Map as MapLibreMap } from "maplibre-gl";

export type WebGlSupport = { ok: true } | { ok: false; reason: "no-webgl2" };

/** True when this browser can give the marker layer a WebGL2 context. Creates and discards a throwaway canvas. */
export function checkWebGl2(createCanvas: () => Pick<HTMLCanvasElement, "getContext"> = () => document.createElement("canvas")): WebGlSupport {
  try {
    const gl = createCanvas().getContext("webgl2");
    if (!gl) return { ok: false, reason: "no-webgl2" };
    // Give the context back at once: a page can hold only a handful, and the map needs its own.
    (gl as WebGL2RenderingContext).getExtension?.("WEBGL_lose_context")?.loseContext();
    return { ok: true };
  } catch {
    return { ok: false, reason: "no-webgl2" };
  }
}

/** The notice shown above the list when the map cannot start. Plain words, no jargon. */
export const WEBGL_NOTICE =
  "The map can't run on this device or browser, so the companies are shown as a list instead. You can still search, filter, and open any company.";

/** The banner text when the basemap tiles keep failing. The company markers still work. */
export const TILE_NOTICE = "The map background didn't load. The companies are still shown, and the list has all of them.";

export type TileFailureOptions = {
  /** Errors within `windowMs` that count as failing. Default 3. */
  threshold?: number;
  /** Default 10 s. */
  windowMs?: number;
};

/**
 * Counts tile load errors and says when the basemap is failing: `threshold` errors inside `windowMs`, with no tile
 * loaded since the last one. One dropped tile does not raise a banner, and one good tile clears it.
 */
export class TileFailureMonitor {
  private readonly threshold: number;
  private readonly windowMs: number;
  private errors: number[] = [];
  private _failing = false;

  constructor(options: TileFailureOptions = {}) {
    this.threshold = options.threshold ?? 3;
    this.windowMs = options.windowMs ?? 10_000;
  }

  get failing(): boolean {
    return this._failing;
  }

  /** A tile failed at time `at` (ms). Returns true if this call made the basemap start failing. */
  error(at: number): boolean {
    this.errors = this.errors.filter((t) => at - t <= this.windowMs);
    this.errors.push(at);
    if (this._failing || this.errors.length < this.threshold) return false;
    this._failing = true;
    return true;
  }

  /** A tile loaded. Returns true if this call ended a failing spell. */
  loaded(): boolean {
    this.errors = [];
    if (!this._failing) return false;
    this._failing = false;
    return true;
  }
}

export type TileWatcher = { retry(): void; dispose(): void };

/** Watches a map's tile loads and reports when the basemap starts and stops failing. */
export function watchTileFailures(
  map: MapLibreMap,
  handlers: { onFailing(): void; onRecovered(): void },
  options: TileFailureOptions & { now?: () => number } = {},
): TileWatcher {
  const monitor = new TileFailureMonitor(options);
  const now = options.now ?? (() => performance.now());
  // MapLibre reports a failed tile as an `error` event that names its source and tile.
  const onError = (event: object) => {
    const { sourceId, tile } = event as { sourceId?: string; tile?: unknown };
    if (sourceId && tile && monitor.error(now())) handlers.onFailing();
  };
  const onData = (event: object) => {
    const { dataType, tile } = event as { dataType?: string; tile?: unknown };
    if (dataType === "source" && tile && monitor.loaded()) handlers.onRecovered();
  };
  map.on("error", onError);
  map.on("data", onData);
  return {
    retry() {
      // MapLibre does not retry a tile that failed. Its public setTiles() marks failed tiles "loading" and then waits
      // for a request that was never sent (checked in 6.11.2), so the only way to ask again is to drop the source's
      // tiles. That is on the tile manager, which is not public API: use it when it is there, and fall back to
      // setTiles/setUrl (which at least reload tiles that did load) when a MapLibre upgrade moves it.
      type Manager = { clearTiles?: () => void };
      const style = map.style as unknown as { tileManagers?: Record<string, Manager>; sourceCaches?: Record<string, Manager> };
      const managers = style.tileManagers ?? style.sourceCaches ?? {};
      for (const [id, spec] of Object.entries(map.getStyle().sources)) {
        if (spec.type !== "vector") continue;
        const manager = managers[id];
        if (manager?.clearTiles) {
          manager.clearTiles();
          continue;
        }
        const source = map.getSource(id) as unknown as { url?: string; tiles?: string[]; setUrl(u: string): void; setTiles(t: string[]): void } | undefined;
        if (!source) continue;
        if (source.tiles?.length) source.setTiles([...source.tiles]);
        else if (source.url) source.setUrl(source.url);
      }
      // Dropping tiles does not ask for new ones until the next source update. resize() is the public call that runs
      // one (it also fires move events, which the explorer already handles).
      map.resize();
    },
    dispose() {
      map.off("error", onError);
      map.off("data", onData);
    },
  };
}
