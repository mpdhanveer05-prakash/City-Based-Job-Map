"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { recallExplorer } from "@/lib/explorer/last-explorer";

const subscribeNever = () => () => {};

/**
 * "Back to map" (design-system.md §5): returns to the explorer the visitor came from, with its filters and camera,
 * when this tab remembers one. Otherwise it goes to the company's own city. The prerendered page always holds the
 * fallback, so it works with scripts off.
 */
export function BackToMap({ fallbackHref }: { fallbackHref: string }) {
  const remembered = useSyncExternalStore(subscribeNever, () => recallExplorer(), () => null);
  return (
    <Link href={remembered ?? fallbackHref} data-testid="back-to-map" className="inline-flex min-h-11 items-center text-base">
      Back to map
    </Link>
  );
}
