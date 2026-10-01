"use client";

import { useEffect, useState } from "react";
import { generateSyntheticDataset } from "@/map/fixtures/generate";
import { createClusterWorkerClient } from "@/map/worker/client";
import { packPointSet, type BBox } from "@/map/worker/protocol";

const WORLD: BBox = [-180, -85, 180, 85];
const LEVELS = [0, 9, 12, 15, 18];

type Row = { level: number; items: number; offices: number; companies: number };
type Report =
  | { status: "running" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: Row[]; staleDropped: number; generation: number; keptAfterRace: boolean };

export function ClusterWorkerDemo() {
  const [report, setReport] = useState<Report>({ status: "running" });

  useEffect(() => {
    const client = createClusterWorkerClient();
    let cancelled = false;
    (async () => {
      try {
        const dataset = generateSyntheticDataset({ city: "bengaluru", size: "S" });
        const points = packPointSet(
          dataset.offices.map((o) => ({ id: o.id, companyId: o.companyId, lng: o.lng, lat: o.lat })),
          { dataVersion: "synthetic", filterHash: "none" },
        );
        await client.load(points);
        const rows: Row[] = [];
        for (const level of LEVELS) {
          const r = await client.getClusters(WORLD, level);
          if (!r) throw new Error(`Level ${level} came back stale with nothing else in flight.`);
          rows.push({
            level,
            items: r.keys.length,
            offices: r.officeCounts.reduce((a, b) => a + b, 0),
            // Companies summed over items; a company with offices in two clusters counts in both.
            companies: r.companyCounts.reduce((a, b) => a + b, 0),
          });
        }
        // Two requests in flight, the second at another zoom level: the first must be dropped.
        const [first, second] = await Promise.all([client.getClusters(WORLD, 10), client.getClusters(WORLD, 11)]);
        if (first !== null) throw new Error("The stale response was not dropped.");
        if (!cancelled) {
          setReport({
            status: "ready",
            rows,
            staleDropped: client.staleDropped,
            generation: client.generation,
            keptAfterRace: second !== null,
          });
        }
      } catch (e) {
        if (!cancelled) setReport({ status: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
      client.dispose();
    };
  }, []);

  return (
    <main className="mx-auto max-w-3xl p-4" data-testid="cluster-worker" data-status={report.status}>
      <h1 className="text-xl font-bold">Cluster worker check</h1>
      <p className="mt-1">Synthetic Bengaluru S dataset (1,500 offices), clustered in a Web Worker.</p>
      {report.status === "running" && <p className="mt-4">Running…</p>}
      {report.status === "error" && (
        <p className="mt-4" role="alert">
          {report.message}
        </p>
      )}
      {report.status === "ready" && (
        <>
          <table className="mt-4 w-full text-left">
            <caption className="sr-only">Items returned per zoom level for the whole city</caption>
            <thead>
              <tr>
                <th scope="col">Level</th>
                <th scope="col">Items</th>
                <th scope="col">Offices</th>
                <th scope="col">Company total</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {report.rows.map((row) => (
                <tr key={row.level} data-level={row.level}>
                  <th scope="row">{row.level}</th>
                  <td data-cell="items">{row.items}</td>
                  <td data-cell="offices">{row.offices}</td>
                  <td data-cell="companies">{row.companies}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4" data-testid="stale-report">
            Stale responses dropped: {report.staleDropped}. The newer response was kept:{" "}
            {report.keptAfterRace ? "yes" : "no"}. Generation {report.generation}.
          </p>
        </>
      )}
    </main>
  );
}
