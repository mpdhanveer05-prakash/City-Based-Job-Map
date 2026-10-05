"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Office } from "@/lib/filters/dataset";
import type { CompanySummary } from "@/lib/filters/dataset";
import { logoUrl } from "@/lib/data/logo";
import { TILE_NOTICE } from "@/map/fallback";
import { ExplorerMap, type ExplorerBoundary, type ExplorerCamera, type StackState } from "@/map/explorer-map";
import type { Rect } from "@/map/popup-placement";
import { MapA11yList, type MirrorListEntry } from "./map-a11y-list";
import { MapPopup, type PopupCompany, type PopupLayout } from "./map-popup";
import { FLOATING } from "./floating";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    /** Test hook; not used by the app. */
    __explorer?: { map: ExplorerMap };
  }
}

type PopupState = { companyId: string; officeId: string; layout: PopupLayout };
const NO_STACK: StackState = { mode: null, companyIds: [] };

export type ExplorerMapViewProps = {
  /** The map is on screen (the Map view is chosen). It is created the first time this is true and kept after that. */
  active: boolean;
  dataVersion: string;
  companies: readonly CompanySummary[];
  /** The whole city's offices; their positions in this array are their ids inside the worker. */
  allOffices: readonly Office[];
  boundary: ExplorerBoundary;
  initialCamera: ExplorerCamera;
  geoapifyKey: string;
  /** The offices of the companies the filter kept. */
  offices: readonly Office[];
  filterHash: string;
  selectedCompanyId: string | null;
  /** The camera in the URL; the map follows it when it changes from outside (Back, Forward). */
  urlCamera: ExplorerCamera | null;
  onSelect(companyId: string | null): void;
  onCamera(camera: ExplorerCamera): void;
  /** What the popup shows for a company and the office the visitor picked. */
  popupFor(companyId: string, officeId: string): PopupCompany | null;
  /** The part of the map not covered by the toolbar. */
  getVisibleArea(): Rect | null;
  onShowList(): void;
  /** Called when the map failed to start: the shell shows the list. */
  onFailed(message: string): void;
};

const cameraClose = (a: ExplorerCamera, b: ExplorerCamera) =>
  Math.abs(a.lat - b.lat) < 2e-5 && Math.abs(a.lng - b.lng) < 2e-5 && Math.abs(a.zoom - b.zoom) < 0.02;

export function ExplorerMapView(props: ExplorerMapViewProps) {
  const { active, selectedCompanyId, urlCamera, offices, filterHash } = props;
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<ExplorerMap | null>(null);
  // The latest props, for callbacks the map holds on to for its whole life.
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  // Created the first time the map is on screen, and kept after that (derived during render, not in an effect).
  const [everActive, setEverActive] = useState(active);
  if (active && !everActive) setEverActive(true);
  const [ready, setReady] = useState(false);
  const [mirror, setMirror] = useState<MirrorListEntry[]>([]);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [stack, setStack] = useState<StackState>(NO_STACK);
  const [tilesFailing, setTilesFailing] = useState(false);
  const [notice, setNotice] = useState("");
  const popupRef = useRef<HTMLElement>(null);
  /** Set when a marker was opened from the keyboard, so focus moves into the popup and returns on close. */
  const keyboardOpen = useRef(false);
  const returnFocusTo = useRef<string | null>(null);
  const cameraTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ---- create and destroy the map ------------------------------------------------------------------------------
  useEffect(() => {
    if (!everActive || !container.current) return;
    const abort = new AbortController();
    let created: ExplorerMap | null = null;
    ExplorerMap.create({
      container: container.current,
      apiKey: props.geoapifyKey,
      signal: abort.signal,
      dataVersion: props.dataVersion,
      companies: props.companies.map((c) => ({ id: c.id, name: c.name, logoUrl: logoUrl(c.logo_key) })),
      offices: props.allOffices,
      boundary: props.boundary,
      initial: props.initialCamera,
      getVisibleArea: () => latest.current.getVisibleArea(),
      events: {
        onSelect: (id) => latest.current.onSelect(id),
        onPopup: (next) => setPopup(next),
        onMirror: setMirror,
        onStack: setStack,
        onCamera: (camera) => {
          // A pan or zoom writes the camera to the URL once it has settled, and rewrites the same entry.
          clearTimeout(cameraTimer.current);
          cameraTimer.current = setTimeout(() => latest.current.onCamera(camera), 250);
        },
        onTilesFailing: setTilesFailing,
        onBasemapUnavailable: () => setNotice("The map background could not be loaded, so the companies are drawn on a blank background."),
      },
    })
      .then((instance) => {
        if (!instance) return;
        if (abort.signal.aborted) {
          instance.dispose();
          return;
        }
        created = instance;
        map.current = instance;
        window.__explorer = { map: instance };
        setReady(true);
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        latest.current.onFailed(error instanceof Error ? error.message : "The map failed to start.");
      });
    return () => {
      abort.abort();
      clearTimeout(cameraTimer.current);
      created?.dispose();
      map.current = null;
      delete window.__explorer;
      setReady(false);
      setMirror([]);
      setPopup(null);
      setStack(NO_STACK);
    };
    // Rebuilt only for another city or dataset. Everything else reaches the map through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [everActive, props.dataVersion, props.geoapifyKey]);

  // ---- what the map shows --------------------------------------------------------------------------------------
  useEffect(() => {
    if (ready) void map.current?.setOffices(offices, filterHash);
  }, [ready, offices, filterHash]);

  useEffect(() => {
    if (ready) map.current?.setSelectedCompany(selectedCompanyId, { fly: true });
  }, [ready, selectedCompanyId]);

  useEffect(() => {
    if (!ready || !urlCamera || !map.current) return;
    if (!cameraClose(urlCamera, map.current.getCamera())) map.current.jumpTo(urlCamera);
  }, [ready, urlCamera]);

  // The map was hidden under the Grid or List view; it needs to measure itself again when it comes back.
  useEffect(() => {
    if (ready && active) map.current?.resize();
  }, [ready, active]);

  // ---- keyboard users: into the popup when a marker opens, back to its list entry when it closes ---------------
  const popupId = popup?.companyId ?? null;
  useEffect(() => {
    if (popupId && keyboardOpen.current) {
      keyboardOpen.current = false;
      returnFocusTo.current = popupId;
      popupRef.current?.focus();
    } else if (!popupId && returnFocusTo.current) {
      const id = returnFocusTo.current;
      returnFocusTo.current = null;
      // The popup's company is gone from the screen; land on the list's first entry rather than on nothing.
      void id;
      document.querySelector<HTMLButtonElement>('[data-testid="map-a11y-list"] button')?.focus();
    }
  }, [popupId]);

  const popupCompany = popup ? props.popupFor(popup.companyId, popup.officeId) : null;

  return (
    <div className={cn("absolute inset-0", !active && "hidden")} data-testid="explorer-map-view" aria-hidden={active ? undefined : true}>
      <div ref={container} className="h-full w-full" data-testid="explorer-map" data-status={ready ? "ready" : "loading"} />
      {ready && (
        <MapA11yList
          entries={mirror}
          focusedKey={focusedKey}
          onFocusKey={(key) => {
            setFocusedKey(key);
            map.current?.setFocused(key);
          }}
          onActivate={(key) => {
            keyboardOpen.current = true;
            map.current?.activate(key);
          }}
        />
      )}
      {popup && popupCompany && (
        <MapPopup
          ref={popupRef}
          company={popupCompany}
          layout={popup.layout}
          onClose={() => {
            map.current?.setSelectedCompany(null);
            props.onSelect(null);
          }}
        />
      )}
      {stack.mode === "list" && (
        <div
          role="region"
          aria-label="Companies at this address"
          data-testid="stack-list"
          className={cn("absolute bottom-8 right-4 z-10 flex max-h-[60%] w-[min(22rem,calc(100%-2rem))] flex-col gap-2 rounded-md p-4", FLOATING)}
        >
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-lg font-semibold">{stack.companyIds.length} companies at this address</h2>
            <Button variant="ghost" size="icon" aria-label="Close the list" onClick={() => map.current?.controller.collapse()} className="-mr-2 -mt-2">
              <span aria-hidden="true" className="text-xl leading-none">
                ×
              </span>
            </Button>
          </div>
          <ul className="overflow-auto">
            {stack.companyIds.map((id) => {
              const company = props.companies.find((c) => c.id === id);
              return (
                company && (
                  <li key={id} className="flex min-h-11 items-center justify-between gap-3 border-b border-rule">
                    <span className="min-w-0 truncate">{company.name}</span>
                    <Link href={`/companies/${company.slug}`} className="shrink-0 text-sm">
                      View company
                      <span className="sr-only"> {company.name}</span>
                    </Link>
                  </li>
                )
              );
            })}
          </ul>
        </div>
      )}
      {tilesFailing && (
        <div role="alert" data-testid="tile-banner" className={cn("absolute bottom-10 left-1/2 z-10 flex w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 flex-col gap-2 rounded-md p-3 text-sm", FLOATING)}>
          <p>{TILE_NOTICE}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => map.current?.retryTiles()}>
              Try again
            </Button>
            <Button variant="outline" onClick={props.onShowList}>
              Show the list
            </Button>
          </div>
        </div>
      )}
      {notice && (
        <p role="status" className={cn("absolute bottom-10 left-4 z-10 max-w-sm rounded-md p-3 text-sm", FLOATING)}>
          {notice}
        </p>
      )}
    </div>
  );
}
