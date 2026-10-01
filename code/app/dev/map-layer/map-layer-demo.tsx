"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { Button } from "@/components/ui/button";
import { targetsFromResponse } from "@/map/animation/targets";
import { buildGlyphSheet, cellSizeForDpr } from "@/map/atlas/glyph-sheet";
import { pageBytes, PAGE_SIZE } from "@/map/atlas/budget";
import { initialOf, swatchIndex } from "@/map/atlas/fallback";
import { LogoAtlas } from "@/map/atlas/logo-atlas";
import { loadLogoPixels } from "@/map/atlas/logo-loader";
import { createBasemap } from "@/map/basemap";
import { generateSyntheticDataset } from "@/map/fixtures/generate";
import { buildStaticScene } from "@/map/fixtures/static-scene";
import { viewFor } from "@/map/layer/geometry";
import { CompanyLayer, attachCompanyLayer, type LayerStats } from "@/map/layer/company-layer";
import type { LayerItem } from "@/map/layer/instances";
import { readBasemapTheme, readMarkerTheme } from "@/map/theme";
import { makeLogoUrls, type LogoControl } from "./logo-fixtures";
import { createClusterWorkerClient, type ClusterClient } from "@/map/worker/client";
import { KIND_CLUSTER, packPointSet } from "@/map/worker/protocol";

const BENGALURU: [number, number] = [77.5946, 12.9716];

type Scenario = "static" | "live" | "logos";

const LOGO_COUNT = 60;

type LiveControl = {
  /** Reloads the worker with only the startups (a new filter hash), or all companies again. */
  setStartupsOnly(on: boolean): Promise<void>;
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
    /** If set, the layer's animation clock (test hook): a test holds a transition still by returning a fixed time. */
    __layerNow?: () => number;
  }
}

export function MapLayerDemo({ apiKey }: { apiKey: string }) {
  const container = useRef<HTMLDivElement>(null);
  const api = useRef<{ map: MapLibreMap; layer: CompanyLayer; show: (s: Scenario) => void } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [scenario, setScenario] = useState<Scenario>("static");
  const [stats, setStats] = useState<LayerStats | null>(null);
  const [startupsOnly, setStartupsOnly] = useState(false);

  useEffect(() => {
    if (!container.current) return;
    const abort = new AbortController();
    let map: MapLibreMap | undefined;
    let client: ClusterClient | undefined;
    let removeLiveListener: (() => void) | undefined;
    let detachLayer: (() => void) | undefined;

    (async () => {
      const basemapTheme = readBasemapTheme();
      const created = await createBasemap({
        container: container.current!,
        apiKey,
        theme: basemapTheme,
        center: BENGALURU,
        zoom: 12,
        signal: abort.signal,
        lockNorthUp: true,
      });
      if (abort.signal.aborted) {
        created.remove();
        return;
      }
      map = created;
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
      const layer = new CompanyLayer({
        theme: readMarkerTheme(),
        glyphs,
        logoAtlas: atlas,
        now: () => window.__layerNow?.() ?? performance.now(),
      });
      if (!map.isStyleLoaded()) await new Promise<void>((resolve) => map!.once("load", () => resolve()));
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
          const live = startLive(map!, layer, (c) => (client = c));
          window.__liveControl = live;
          removeLiveListener = () => {
            live.stop();
            delete window.__liveControl;
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
      detachLayer?.();
      map?.remove();
      api.current = null;
      delete window.__mapLayer;
      delete window.__logoControl;
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
    api.current?.show(next);
  }

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
        {message && (
          <p role="alert" className="text-sm text-danger">
            {message}
          </p>
        )}
      </div>
    </main>
  );
}

/** The live scenario: Bengaluru M through the clustering worker, re-requested whenever the map settles. */
function startLive(map: MapLibreMap, layer: CompanyLayer, onClient: (client: ClusterClient) => void): LiveControl {
  const dataset = generateSyntheticDataset({ city: "bengaluru", size: "M" });
  const names = new Map(dataset.companies.map((c) => [c.id, c.name]));
  const startups = new Set(dataset.companies.filter((c) => c.types.includes("startup")).map((c) => c.id));
  const client = createClusterWorkerClient();
  onClient(client);
  let cancelled = false;
  let filterHash = "none";

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
    // markers are now. An older response than one already applied is ignored.
    const applied = layer.setTargets({
      targets: targetsFromResponse(response, makeItem),
      level: response.level,
      namespace: `synthetic:${filterHash}`,
      generation: response.generation,
    });
    if (applied) window.__liveKeys = response.keys;
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
    stop() {
      cancelled = true;
      map.off("moveend", refresh);
    },
  };
}
