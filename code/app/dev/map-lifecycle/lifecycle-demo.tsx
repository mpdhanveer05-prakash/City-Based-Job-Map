"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MapLayerDemo } from "../map-layer/map-layer-demo";

export function LifecycleDemo({ apiKey }: { apiKey: string }) {
  const [mounted, setMounted] = useState(true);
  const [mounts, setMounts] = useState(1);
  // Read once: the basemap only loads when asked for, so a long run costs no tile requests.
  const [basemap] = useState(() => (typeof location === "undefined" ? false : new URLSearchParams(location.search).get("basemap") === "on"));

  return (
    <>
      {mounted && <MapLayerDemo apiKey={basemap ? apiKey : ""} />}
      <div className="fixed bottom-14 right-3 z-50 flex items-center gap-3 border border-rule bg-milky p-2 text-sm">
        <Button
          variant="outline"
          onClick={() => {
            if (!mounted) setMounts((n) => n + 1);
            setMounted(!mounted);
          }}
        >
          {mounted ? "Unmount the map" : "Mount the map"}
        </Button>
        <span data-testid="mount-count" data-mounted={mounted ? "yes" : "no"} className="tabular-nums">
          Mounted {mounts} times
        </span>
      </div>
    </>
  );
}
