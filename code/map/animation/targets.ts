// Glue between the clustering worker's response and the animator. Pure.
import type { ClusterResponse } from "../worker/protocol.ts";

export type ResponseTarget<T> = {
  item: T;
  /** The key one level out (the item's own key when it survives). */
  parentKey: string;
  /** The keys one level in (the item's own key when it does not split). */
  childKeys: string[];
};

/** One target per item in the response, carrying its lineage. `makeItem` builds the drawable for item `i`. */
export function targetsFromResponse<T>(response: ClusterResponse, makeItem: (index: number) => T): Array<ResponseTarget<T>> {
  return response.keys.map((_, i) => ({
    item: makeItem(i),
    parentKey: response.parentKeys[i],
    childKeys: response.childKeys.slice(response.childOffsets[i], response.childOffsets[i + 1]),
  }));
}
