"use client";

import { useSyncExternalStore } from "react";
import { contrastRatio } from "@/lib/design/contrast";
import { CONTRAST_PAIRS } from "@/lib/design/tokens";

// Reads the live CSS custom properties, so the table always reflects globals.css.
function readTokens(): Record<string, string> | null {
  if (typeof window === "undefined") return null;
  const style = getComputedStyle(document.documentElement);
  const names = new Set(CONTRAST_PAIRS.flatMap((p) => [p.fg, p.bg]));
  return Object.fromEntries(
    [...names].map((n) => [n, n === "white" ? "#ffffff" : style.getPropertyValue(`--${n}`).trim()]),
  );
}

const cssColor = (token: string) => (token === "white" ? "#ffffff" : `var(--${token})`);

let cached: Record<string, string> | null = null;
const subscribe = () => () => {};
const getSnapshot = () => (cached ??= readTokens());
const getServerSnapshot = () => null;

export function ContrastTable() {
  const values = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <table className="w-full max-w-3xl border-collapse text-sm">
      <caption className="sr-only">Contrast of each allowed colour pair</caption>
      <thead className="bg-milky-shade text-left">
        <tr>
          <th scope="col" className="p-3 font-semibold">Sample</th>
          <th scope="col" className="p-3 font-semibold">Pair</th>
          <th scope="col" className="p-3 font-semibold">Use</th>
          <th scope="col" className="p-3 text-right font-semibold">Ratio</th>
        </tr>
      </thead>
      <tbody>
        {CONTRAST_PAIRS.map((pair) => {
          const ratio = values ? contrastRatio(values[pair.fg], values[pair.bg]) : null;
          return (
            <tr key={`${pair.fg}/${pair.bg}`} className="border-b border-rule">
              <td className="p-3">
                {pair.min === 3 ? (
                  // A 3:1 pair is a boundary colour, so it is shown as a border, not text.
                  <span
                    className="inline-block h-9 w-14 rounded-md border-2"
                    style={{ borderColor: cssColor(pair.fg), background: cssColor(pair.bg) }}
                  />
                ) : (
                  <span
                    className="inline-flex h-9 w-14 items-center justify-center rounded-md text-base font-bold"
                    style={{ color: cssColor(pair.fg), background: cssColor(pair.bg) }}
                  >
                    Aa
                  </span>
                )}
              </td>
              <td className="p-3">
                {pair.fg} on {pair.bg}
              </td>
              <td className="p-3 text-muted-foreground">{pair.use}</td>
              <td className="p-3 text-right tabular-nums">
                {ratio === null ? "…" : `${ratio.toFixed(2)}:1`}
                <span className="text-muted-foreground"> (min {pair.min})</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
