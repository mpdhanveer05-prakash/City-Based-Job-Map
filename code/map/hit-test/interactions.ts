// Connects map clicks and taps to the marker layer (map-spec §6). Browser only, no React.
//
// A tap is resolved against what the layer drew in its last frame (`getDrawn`), at the markers' animated
// positions, so a tap during a split or merge selects what is under the finger. The caller decides what each kind
// of marker does; this file only finds it.
import type { Map as MapLibreMap } from "maplibre-gl";
import type { CompanyLayer } from "../layer/company-layer.ts";
import { screenToLngLat } from "../layer/geometry.ts";
import { HitTester, type HitCandidate, type PointerKind } from "./hit-test.ts";

export type MarkerTap = {
  hit: HitCandidate;
  /** The marker's position on the map. */
  lngLat: { lng: number; lat: number };
};

export type MarkerHandlers = {
  /** A single company's logo. */
  onLogo?(tap: MarkerTap): void;
  /** A cluster: the explorer flies to its expansion zoom. */
  onCluster?(tap: MarkerTap): void;
  /** A stack of co-located companies: the explorer opens its spider or list. */
  onStack?(tap: MarkerTap): void;
  /** A tap that hit no marker. */
  onBackground?(): void;
};

export type MarkerInteractions = {
  /** Resolves a screen point (CSS px from the map's top-left) to the marker under it, as a tap would. */
  hitTest(x: number, y: number, pointer?: PointerKind): HitCandidate | null;
  /** Does what a tap on `hit` does. The mirror list calls it for Enter, so the keyboard and the pointer share one path. */
  activate(hit: HitCandidate): void;
  /** The tester, for the debug hook: which method answered last and how often the index was built. */
  readonly tester: HitTester;
  detach(): void;
};

export function attachMarkerInteractions(map: MapLibreMap, layer: CompanyLayer, handlers: MarkerHandlers): MarkerInteractions {
  const tester = new HitTester();
  let lastPointer: PointerKind = "mouse";

  const canvas = map.getCanvas();
  // MapLibre's click event carries a MouseEvent whatever the device, so the pointer type is read from the
  // pointer event that came just before it.
  const onPointerDown = (event: PointerEvent) => {
    lastPointer = event.pointerType === "touch" ? "touch" : "mouse";
  };
  canvas.addEventListener("pointerdown", onPointerDown);

  const hitTest = (x: number, y: number, pointer: PointerKind = lastPointer): HitCandidate | null =>
    tester.test({ items: layer.getDrawn(), frame: layer.stats.frames, animating: layer.stats.animating }, x, y, pointer);

  const activate = (hit: HitCandidate) => {
    const view = layer.getView();
    const lngLat = view ? screenToLngLat(view, hit.x, hit.y) : map.unproject([hit.x, hit.y]);
    const tap: MarkerTap = { hit, lngLat: { lng: lngLat.lng, lat: lngLat.lat } };
    if (hit.kind === "cluster") handlers.onCluster?.(tap);
    else if (hit.kind === "stack") handlers.onStack?.(tap);
    else handlers.onLogo?.(tap);
  };

  const onClick = (event: { point: { x: number; y: number } }) => {
    const hit = hitTest(event.point.x, event.point.y);
    if (hit) activate(hit);
    else handlers.onBackground?.();
  };
  map.on("click", onClick);

  return {
    hitTest,
    activate,
    tester,
    detach() {
      map.off("click", onClick);
      canvas.removeEventListener("pointerdown", onPointerDown);
    },
  };
}
