"use client";

import { forwardRef, useId } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** What the popup shows (map-spec §8). Anything unknown stays unknown: the popup says so, it never guesses. */
export type PopupCompany = {
  /** The marker's key; it also names the popup for tests. */
  id: string;
  name: string;
  /** The initial shown in the logo disc until a logo is available. */
  letter: string;
  /** The CSS variable of the letter swatch, for example `--swatch-sand`; Milky when absent. */
  swatchVar?: string;
  /** Startup, MNC, Product: a company can be several. */
  types: string[];
  neighbourhood?: string | null;
  /** The office's location accuracy label (building, campus, locality). */
  accuracy?: string | null;
  /** Active jobs, or null when not known. */
  openJobs: number | null;
  /** Where View company goes. */
  href: string;
  /** True for fixtures: the popup says so. */
  synthetic?: boolean;
};

export type PopupLayout =
  | { kind: "popover"; left: number; top: number; width: number }
  /** A bottom sheet over the lower part of the map, `height` px tall. */
  | { kind: "sheet"; height: number };

export type MapPopupProps = {
  company: PopupCompany;
  layout: PopupLayout;
  onClose(): void;
  /** Called with the click, so a page that is not ready to navigate can stop it. */
  onViewCompany?(event: React.MouseEvent<HTMLAnchorElement>): void;
};

// A floating panel over the map: a 1 px Rule border and the over-the-map shadow (design-system.md). Square corners
// are 4 px; only the logo disc is round.
const FLOAT = "border border-rule bg-milky text-ink shadow-[0_1px_0_rgb(31_58_26/.08),0_6px_16px_rgb(31_58_26/.14)]";

export const MapPopup = forwardRef<HTMLElement, MapPopupProps>(function MapPopup({ company, layout, onClose, onViewCompany }, ref) {
  const titleId = useId();
  const style =
    layout.kind === "popover"
      ? { left: layout.left, top: layout.top, width: layout.width }
      : { left: 0, right: 0, bottom: 0, height: layout.height };

  return (
    <section
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="map-popup"
      data-company={company.id}
      data-layout={layout.kind}
      style={style}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      className={cn("popup-in absolute z-10 flex flex-col gap-3 p-4 outline-offset-0", FLOAT, layout.kind === "popover" ? "rounded-md" : "rounded-t-md")}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-moss text-lg font-extrabold"
          style={{ backgroundColor: company.swatchVar ? `var(${company.swatchVar})` : "var(--milky)" }}
        >
          {company.letter}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-lg font-semibold leading-snug">
            {company.name}
          </h2>
          {company.types.length > 0 && <p className="text-sm text-muted-foreground">{company.types.join(" · ")}</p>}
        </div>
        <Button variant="ghost" size="icon" aria-label={`Close ${company.name}`} onClick={onClose} className="-mr-2 -mt-2">
          <span aria-hidden="true" className="text-xl leading-none">
            ×
          </span>
        </Button>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Neighbourhood</dt>
        <dd>{company.neighbourhood ?? "Not stated"}</dd>
        <dt className="text-muted-foreground">Location</dt>
        <dd>{company.accuracy ? `Accurate to the ${company.accuracy}` : "Accuracy not stated"}</dd>
        <dt className="text-muted-foreground">Open jobs</dt>
        <dd className="tabular-nums">{company.openJobs === null ? "Not yet checked" : company.openJobs}</dd>
      </dl>

      {company.synthetic && <p className="text-xs text-muted-foreground">Synthetic data. This is not a real company.</p>}

      <Button asChild className="self-start">
        <a href={company.href} onClick={onViewCompany} className="text-primary-foreground no-underline">
          View company
        </a>
      </Button>
    </section>
  );
});
