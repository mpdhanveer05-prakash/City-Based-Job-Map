"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import type { ReactNode, RefObject } from "react";

/** Above this many items the rows are virtualised (plan P5-04). Below it, every row is in the page. */
export const VIRTUALIZE_ABOVE = 100;

type VirtualRowsProps<T> = {
  items: readonly T[];
  /** Items per row: 1 for the list, the column count for the grid. */
  columns?: number;
  /** The height of one row in px. Rows are fixed-height so the scroll bar is exact. */
  rowHeight: number;
  /** The element that scrolls. */
  scrollRef: RefObject<HTMLElement | null>;
  renderItem(item: T, index: number): ReactNode;
  /** The wrapper of one row's items (a grid for the grid view). */
  rowClassName?: string;
  rowGridStyle?: React.CSSProperties;
};

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Renders rows of items, and only the rows near the viewport once there are more than `VIRTUALIZE_ABOVE` items
 * (TanStack Virtual). The same rows either way, so the list holds every company however it is rendered.
 */
export function VirtualRows<T>({ items, columns = 1, rowHeight, scrollRef, renderItem, rowClassName, rowGridStyle }: VirtualRowsProps<T>) {
  const rows = chunk(items, columns);
  const virtual = items.length > VIRTUALIZE_ABOVE;
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual's hook is used as documented
  const virtualizer = useVirtualizer({
    count: virtual ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 6,
  });

  if (!virtual) {
    return (
      <>
        {rows.map((row, r) => (
          <div key={r} className={rowClassName} style={rowGridStyle}>
            {row.map((item, c) => renderItem(item, r * columns + c))}
          </div>
        ))}
      </>
    );
  }

  return (
    <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }} data-virtualized="true">
      {virtualizer.getVirtualItems().map((v) => (
        <div
          key={v.key}
          className={rowClassName}
          style={{ ...rowGridStyle, position: "absolute", top: 0, left: 0, width: "100%", height: rowHeight, transform: `translateY(${v.start}px)` }}
        >
          {rows[v.index].map((item, c) => renderItem(item, v.index * columns + c))}
        </div>
      ))}
    </div>
  );
}
