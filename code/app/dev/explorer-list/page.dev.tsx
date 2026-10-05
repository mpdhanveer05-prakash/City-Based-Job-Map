import type { Metadata } from "next";
import { VirtualListDemo } from "./virtual-list-demo";

export const metadata: Metadata = {
  title: "Virtual list check",
  robots: { index: false },
};

// P5-04: the List and Grid views with thousands of rows, so a test can check that only the rows near the viewport are
// in the page (TanStack Virtual) and that scrolling reaches the last company. Synthetic data, labelled as such.
export default function ExplorerListPage() {
  return <VirtualListDemo />;
}
