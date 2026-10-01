// Keys and parent/child lineage for the split and merge animations (map-spec §2).
//
// Supercluster builds one tree per integer level, from the deepest level outwards. A point or cluster that is
// not merged at a level is carried to the next level unchanged, with the same ID. A cluster is created at one
// level (its *formation level*); its children are the items at the next level in.
//
// That gives two rules, and nothing else is needed:
//   - children of X at level L: if X was formed at L, they are getChildren(X); otherwise X is its own only child.
//   - parent of Y at level L: the cluster formed at L - 1 whose children include Y; otherwise Y is its own parent.
//
// The formation level is read from the cluster ID with the same arithmetic as Supercluster's own
// `_getOriginZoom` (id = (index << 5) + (formationLevel + 1) + pointCount). That is internal to Supercluster, so
// tests/unit/cluster-worker.test.ts compares the result with a brute-force leaf comparison.

export type BBox = [west: number, south: number, east: number, north: number];

export type KeyNamespace = { dataVersion: string; filterHash: string };

export type ClusterNode = {
  key: string;
  /** Supercluster's cluster_id, or null for an office. */
  clusterId: number | null;
};

export const officeKey = (officeId: number): string => `o:${officeId}`;

export const clusterKey = (ns: KeyNamespace, clusterId: number): string =>
  `c:${ns.dataVersion}:${ns.filterHash}:${clusterId}`;

/** The level at which Supercluster created this cluster. */
export const formationLevel = (clusterId: number, pointCount: number): number => ((clusterId - pointCount) % 32) - 1;

export type LineageSource = {
  /** The lowest level that has a tree. There is no parent level below it. */
  minLevel: number;
  /** How far, in degrees, a cluster at `level` can sit from the items it absorbed. */
  paddingDegrees(level: number): number;
  itemsAt(bbox: BBox, level: number): ClusterNode[];
  childrenOf(clusterId: number): ClusterNode[];
  formationLevel(clusterId: number): number;
};

export type Lineage = {
  parentKeys: string[];
  childOffsets: Uint32Array;
  childKeys: string[];
};

/** Grow a bbox by `pad` degrees. Longitude stays inside ±180 and latitude inside ±90. */
export function padBBox(bbox: BBox, pad: number): BBox {
  return [
    Math.max(-180, bbox[0] - pad),
    Math.max(-90, bbox[1] - pad),
    Math.min(180, bbox[2] + pad),
    Math.min(90, bbox[3] + pad),
  ];
}

export function computeLineage(src: LineageSource, nodes: ClusterNode[], level: number, bbox: BBox): Lineage {
  const childOffsets = new Uint32Array(nodes.length + 1);
  const childKeys: string[] = [];
  nodes.forEach((node, i) => {
    childOffsets[i] = childKeys.length;
    if (node.clusterId !== null && src.formationLevel(node.clusterId) === level) {
      for (const child of src.childrenOf(node.clusterId)) childKeys.push(child.key);
    } else {
      childKeys.push(node.key);
    }
  });
  childOffsets[nodes.length] = childKeys.length;

  // Only a cluster formed at level - 1 can be the parent of something that is not its own parent. A parent can
  // sit outside the viewport (its centre is a weighted mean), so look in a bbox padded by the cluster radius.
  const parentOf = new Map<string, string>();
  if (level > src.minLevel) {
    const padded = padBBox(bbox, src.paddingDegrees(level - 1));
    for (const outer of src.itemsAt(padded, level - 1)) {
      if (outer.clusterId === null || src.formationLevel(outer.clusterId) !== level - 1) continue;
      for (const child of src.childrenOf(outer.clusterId)) parentOf.set(child.key, outer.key);
    }
  }
  return { parentKeys: nodes.map((n) => parentOf.get(n.key) ?? n.key), childOffsets, childKeys };
}
