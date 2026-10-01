"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { Button } from "@/components/ui/button";
import { createBasemap, createRequestCounter, type RequestStats } from "@/map/basemap";
import { readBasemapTheme } from "@/map/theme";

const CITIES = {
  bengaluru: { label: "Bengaluru", center: [77.5946, 12.9716] as [number, number], zoom: 11 },
  chennai: { label: "Chennai", center: [80.2707, 13.0827] as [number, number], zoom: 11 },
};
type CityId = keyof typeof CITIES;

declare global {
  interface Window {
    // Test hook for the tile-count measurement; not used by the app.
    __basemap?: { map: MapLibreMap; stats: RequestStats };
  }
}

export function BasemapDemo({ apiKey }: { apiKey: string }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(apiKey ? "loading" : "error");
  const [message, setMessage] = useState(apiKey ? "" : "NEXT_PUBLIC_GEOAPIFY_KEY is not set.");

  useEffect(() => {
    if (!apiKey || !container.current) return;
    const abort = new AbortController();
    const counter = createRequestCounter();
    let map: MapLibreMap | undefined;

    createBasemap({
      container: container.current,
      apiKey,
      theme: readBasemapTheme(),
      center: CITIES.bengaluru.center,
      zoom: CITIES.bengaluru.zoom,
      signal: abort.signal,
      transformRequest: counter.transformRequest,
    })
      .then((created) => {
        if (abort.signal.aborted) {
          created.remove();
          return;
        }
        map = created;
        mapRef.current = created;
        window.__basemap = { map: created, stats: counter.stats };
        created.on("error", (event) => setMessage(String(event.error?.message ?? "Map error")));
        // `idle` fires once every tile in view has loaded and rendering has settled.
        created.once("idle", () => setStatus("ready"));
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "The basemap failed to load.");
      });

    return () => {
      abort.abort();
      map?.remove();
      mapRef.current = null;
      delete window.__basemap;
    };
  }, [apiKey]);

  function goTo(id: CityId) {
    mapRef.current?.jumpTo({ center: CITIES[id].center, zoom: CITIES[id].zoom });
  }

  return (
    <main className="relative h-dvh w-full">
      {/* MapLibre's CSS sets position: relative on its container (unlayered, so it beats Tailwind's
          utilities): the wrapper owns the sizing and the container just fills it. */}
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" data-testid="basemap" data-status={status} />
      </div>
      <div className="absolute left-4 top-4 flex flex-col gap-2 border border-rule bg-milky p-3 shadow-[0_1px_0_rgb(31_58_26/.08),0_6px_16px_rgb(31_58_26/.14)]">
        <h1 className="text-lg font-semibold">Basemap check</h1>
        <div className="flex gap-2">
          {(Object.keys(CITIES) as CityId[]).map((id) => (
            <Button key={id} variant="outline" onClick={() => goTo(id)}>
              {CITIES[id].label}
            </Button>
          ))}
        </div>
        {status === "loading" && <p className="text-sm text-muted-foreground">Loading the map…</p>}
        {message && (
          <p role="alert" className="text-sm text-danger">
            {message}
          </p>
        )}
      </div>
    </main>
  );
}
