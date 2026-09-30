import type { Metadata } from "next";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FALLBACK_SWATCHES, PALETTE } from "@/lib/design/tokens";
import { ContrastTable } from "./contrast-table";

export const metadata: Metadata = {
  title: "Design tokens",
  robots: { index: false },
};

// A review page for the Milky + Mantis palette (docs/design-system.md).
// Marker previews are HTML stand-ins; the real map draws them in WebGL (P2-03).

const TYPE_SCALE = [
  { className: "text-7xl font-extrabold tracking-[-0.02em]", label: "72 / 800", sample: "Bengaluru" },
  { className: "text-4xl font-bold", label: "36 / 700", sample: "Company name" },
  { className: "text-2xl font-bold", label: "24 / 700", sample: "Open jobs" },
  { className: "text-lg font-semibold", label: "18 / 600", sample: "Senior backend engineer" },
  { className: "text-base", label: "16 / 400", sample: "Visitors find companies by where their offices are." },
  { className: "text-sm text-muted-foreground", label: "14 / 400", sample: "Checked 2 days ago" },
  { className: "text-xs text-muted-foreground", label: "12 / 400", sample: "© Geoapify © OpenStreetMap contributors" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-rule pt-8">
      <h2 className="text-2xl font-bold">{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

export default function TokensPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 py-12 sm:px-6">
      <header>
        <h1 className="text-4xl font-bold">Design tokens</h1>
        <p className="mt-4 max-w-[64ch] text-muted-foreground">
          Milky and Mantis as they render in the app. Every value comes from{" "}
          <code>app/globals.css</code>, so changing the palette there changes this page.
        </p>
      </header>

      <Section title="Palette">
        <ul className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {PALETTE.map(({ token, role }) => (
            <li key={token} className="flex items-center gap-4">
              <span
                className="size-12 shrink-0 rounded-md border border-field"
                style={{ background: `var(--${token})` }}
              />
              <span>
                <span className="block font-semibold">{token}</span>
                <span className="block text-sm text-muted-foreground">{role}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Actions">
        <div className="flex flex-wrap items-center gap-4">
          <Button>View company</Button>
          <Button variant="outline">Visit website</Button>
          <Button variant="secondary">Clear filters</Button>
          <Button variant="destructive">Unpublish</Button>
          <Button variant="link">Back to map</Button>
        </div>
        <p className="mt-4 max-w-[64ch] text-sm text-muted-foreground">
          One Mantis button per view. Press Tab to check the focus outline.
        </p>
      </Section>

      <Section title="Filter chips">
        <div className="flex flex-wrap gap-3" role="group" aria-label="Company type">
          <button
            type="button"
            aria-pressed="true"
            className="inline-flex h-11 items-center gap-2 rounded-md border border-mantis-deep bg-mantis-wash px-4 font-semibold"
          >
            <Check className="size-4" aria-hidden="true" />
            Startup
          </button>
          <button
            type="button"
            aria-pressed="false"
            className="inline-flex h-11 items-center gap-2 rounded-md border border-field bg-background px-4"
          >
            MNC
          </button>
          <button
            type="button"
            aria-pressed="false"
            className="inline-flex h-11 items-center gap-2 rounded-md border border-field bg-background px-4"
          >
            Product
          </button>
        </div>
      </Section>

      <Section title="Map markers">
        <div className="flex flex-wrap items-end gap-8 rounded-md p-6" style={{ background: "var(--milky)" }}>
          <figure className="flex flex-col items-center gap-2">
            <span className="flex size-14 items-center justify-center rounded-full bg-mantis text-lg font-extrabold tabular-nums ring-2 ring-milky">
              38
            </span>
            <figcaption className="text-sm text-muted-foreground">Cluster</figcaption>
          </figure>
          <figure className="flex flex-col items-center gap-2">
            <span className="relative flex size-10 items-center justify-center rounded-full border-2 border-moss font-bold"
              style={{ background: "var(--swatch-sky)" }}
            >
              A
              <span className="absolute -top-2 -right-3 flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1 text-xs font-bold text-milky tabular-nums">
                6
              </span>
            </span>
            <figcaption className="text-sm text-muted-foreground">Stack</figcaption>
          </figure>
          <figure className="flex flex-col items-center gap-2">
            <span className="flex size-12 items-center justify-center rounded-full border-2 border-moss font-bold outline-3 outline-offset-0 outline-mantis-deep"
              style={{ background: "var(--swatch-sand)" }}
            >
              B
            </span>
            <figcaption className="text-sm text-muted-foreground">Selected</figcaption>
          </figure>
          {FALLBACK_SWATCHES.map((swatch, i) => (
            <figure key={swatch} className="flex flex-col items-center gap-2">
              <span
                className="flex size-10 items-center justify-center rounded-full border-2 border-moss font-bold"
                style={{ background: `var(--${swatch})` }}
              >
                {"CDEFG"[i]}
              </span>
              <figcaption className="text-sm text-muted-foreground">{swatch.replace("swatch-", "")}</figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <dl className="flex flex-col gap-6">
          {TYPE_SCALE.map(({ className, label, sample }) => (
            <div key={label} className="flex flex-col gap-1">
              <dt className="text-sm text-muted-foreground tabular-nums">{label}</dt>
              <dd className={`${className} max-w-full overflow-hidden text-ellipsis`}>{sample}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Contrast">
        <div className="overflow-x-auto">
          <ContrastTable />
        </div>
        <p className="mt-4 max-w-[64ch] text-sm text-muted-foreground">
          Never used: Mantis text on Milky (2.12:1) and white text on Mantis (2.17:1).
        </p>
      </Section>
    </main>
  );
}
