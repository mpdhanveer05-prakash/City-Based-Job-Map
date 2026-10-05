"use client";

import { useSyncExternalStore } from "react";
import { formatDate } from "@/lib/format-date";

const subscribeNever = () => () => {};

const DAY = 86_400_000;

/** "Checked today", "Checked 2 days ago", or "Not yet checked". Pure: the page passes the time. */
export function freshnessText(lastCheckedAt: string | null, now: number): string {
  if (!lastCheckedAt) return "Not yet checked";
  const checked = Date.parse(lastCheckedAt);
  if (Number.isNaN(checked)) return "Not yet checked";
  const days = Math.max(0, Math.floor((now - checked) / DAY));
  if (days === 0) return "Checked today";
  if (days === 1) return "Checked yesterday";
  if (days < 60) return `Checked ${days} days ago`;
  return `Checked on ${formatDate(checked)}`;
}

/**
 * The freshness line of the jobs page. It is computed in the browser from `last_checked_at` (the page is static, so
 * "2 days ago" would be stale by the time it is read). The static HTML says "Checked <date>", which is true
 * whenever it is read.
 */
export function Freshness({ lastCheckedAt }: { lastCheckedAt: string | null }) {
  const parsed = lastCheckedAt ? Date.parse(lastCheckedAt) : NaN;
  const staticText = Number.isNaN(parsed) ? "Not yet checked" : `Checked on ${formatDate(parsed)}`;
  const text = useSyncExternalStore(subscribeNever, () => freshnessText(lastCheckedAt, Date.now()), () => staticText);
  return (
    <p className="text-sm text-muted-foreground" data-testid="freshness">
      {text}
    </p>
  );
}
