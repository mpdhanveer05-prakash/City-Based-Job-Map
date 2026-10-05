"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useAdmin } from "@/components/admin/admin-root";
import type { AnyError } from "@/components/admin/use-reference";
import { DataTable, Notice, PageHeader } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { CsvError, parseCsv } from "@/lib/admin/csv";
import { describeError } from "@/lib/admin/errors";
import {
  IMPORT_COLUMNS,
  REQUIRED_COLUMNS,
  readImportTable,
  rowsToCommit,
  summariseImport,
  validateImportRows,
  type ImportReference,
  type ImportRowResult,
  type ImportStatus,
} from "@/lib/admin/import-rows";

const TEMPLATE = [
  IMPORT_COLUMNS.join(","),
  'Example Co,example.com,https://example.com,https://example.com/careers,"Makes examples",startup;product,seed,fintech,Bengaluru,"1 Example Road, Koramangala",12.9352,77.6245,building,koramangala,',
].join("\n");

const STATUS_TEXT: Record<ImportStatus, string> = {
  new: "New company",
  attach: "Adds an office",
  "duplicate-office": "Already listed, skipped",
  error: "Cannot import",
};

/** Reads every row of a table, 1000 at a time (the API's page size). */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: AnyError | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

type ImportReport = { rows: number; created_companies: number; attached_offices: number; skipped: number; errors: number; results: Array<{ row: number; result: string; message: string }> };

export default function ImportPage() {
  const { supabase } = useAdmin();
  const queryClient = useQueryClient();
  const [filename, setFilename] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ results: ImportRowResult[]; unknownColumns: string[] } | null>(null);
  const [report, setReport] = useState<{ report: ImportReport; lines: number[] } | null>(null);

  async function load(file: File) {
    setProblem("");
    setPreview(null);
    setReport(null);
    setFilename(file.name);
    setBusy(true);
    try {
      const table = readImportTable(parseCsv(await file.text()));
      if (table.missingColumns.length > 0) {
        setProblem(`The file has no column for: ${table.missingColumns.join(", ")}. Required columns are ${REQUIRED_COLUMNS.join(", ")}.`);
        return;
      }
      if (table.records.length === 0) {
        setProblem("The file has a header but no rows.");
        return;
      }
      const [cities, neighbourhoods, techParks, sectors, companies, offices] = await Promise.all([
        supabase.from("city").select("slug, name, aliases"),
        readAll<{ slug: string; name: string; city: { slug: string } }>((a, b) => supabase.from("neighbourhood").select("slug, name, city:city_id(slug)").range(a, b) as never),
        readAll<{ slug: string; name: string; city: { slug: string } }>((a, b) => supabase.from("tech_park").select("slug, name, city:city_id(slug)").range(a, b) as never),
        supabase.from("sector").select("slug, name"),
        readAll<{ domain: string }>((a, b) => supabase.from("company").select("domain").range(a, b) as never),
        readAll<{ address: string; company: { domain: string }; city: { slug: string } }>((a, b) => supabase.from("office").select("address, company:company_id(domain), city:city_id(slug)").range(a, b) as never),
      ]);
      for (const r of [cities, sectors]) if (r.error) throw r.error;
      const reference: ImportReference = {
        cities: cities.data ?? [],
        neighbourhoods: neighbourhoods.map((n) => ({ city: n.city.slug, slug: n.slug, name: n.name })),
        techParks: techParks.map((n) => ({ city: n.city.slug, slug: n.slug, name: n.name })),
        sectors: sectors.data ?? [],
        existingDomains: new Set(companies.map((c) => c.domain)),
        existingOffices: new Set(offices.map((o) => `${o.company.domain}|${o.city.slug}|${o.address.toLowerCase()}`)),
      };
      setPreview({ results: validateImportRows(table.records, reference), unknownColumns: table.unknownColumns });
    } catch (error) {
      setProblem(error instanceof CsvError ? `${error.message} (line ${error.line})` : describeError(error as AnyError));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview) return;
    const { rows, lines } = rowsToCommit(preview.results);
    if (rows.length === 0) return;
    setBusy(true);
    setProblem("");
    const { data, error } = await supabase.rpc("import_commit", { p_filename: filename, p_rows: rows });
    setBusy(false);
    if (error) {
      setProblem(describeError(error));
      return;
    }
    setReport({ report: data as ImportReport, lines });
    setPreview(null);
    await queryClient.invalidateQueries({ queryKey: ["admin"] });
  }

  const summary = preview ? summariseImport(preview.results) : null;
  const sendable = summary ? summary.new + summary.attach : 0;

  return (
    <>
      <PageHeader title="Import companies" />
      <p className="max-w-[72ch] text-sm text-muted-foreground">
        Upload a CSV of companies and their offices. You see what each row would do before anything is saved. Everything imported lands as a <strong>draft</strong>;
        nothing is public until a reviewer publishes it. A row for a domain that already exists adds an office to that company.
      </p>
      <p className="mt-2 text-sm">
        Required columns: {REQUIRED_COLUMNS.join(", ")}. Optional: website_url, careers_url, description, types (startup, mnc, product, separated by ;), startup_stage, sectors, accuracy,
        neighbourhood, tech_park.{" "}
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="companies-template.csv" data-testid="template-link">
          Download a template
        </a>
      </p>

      <div className="mt-4">
        <label htmlFor="csv-file" className="text-sm font-semibold">
          CSV file
        </label>
        <input
          id="csv-file"
          data-testid="csv-file"
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void load(file);
          }}
          className="mt-1 block min-h-11 text-base"
        />
      </div>

      {problem && (
        <div className="mt-4">
          <Notice kind="error">{problem}</Notice>
        </div>
      )}

      {preview && summary && (
        <section aria-labelledby="preview" className="mt-6">
          <h2 id="preview" className="text-xl font-bold">
            Preview of {filename}
          </h2>
          <p className="mt-1 text-sm tabular-nums" data-testid="import-summary">
            {summary.rows} rows: {summary.new} new companies, {summary.attach} added offices, {summary.duplicateOffice} already listed, {summary.errors} that cannot be imported
            {summary.warnings > 0 ? `, ${summary.warnings} warnings` : ""}.
          </p>
          {preview.unknownColumns.length > 0 && <p className="mt-1 text-sm">Columns that are ignored: {preview.unknownColumns.join(", ")}.</p>}
          <div className="mt-3">
            <DataTable label="Import preview">
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col">Company</th>
                  <th scope="col">City</th>
                  <th scope="col">Result</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody data-testid="import-rows">
                {preview.results.slice(0, 300).map((r) => (
                  <tr key={r.line} data-status={r.status}>
                    <td className="tabular-nums">{r.line}</td>
                    <td>{r.label}</td>
                    <td>{r.payload?.city ?? ""}</td>
                    <td className={r.status === "error" ? "font-semibold text-danger" : ""}>{STATUS_TEXT[r.status]}</td>
                    <td>
                      {r.errors.map((e) => (
                        <p key={e} className="text-danger">
                          {e}
                        </p>
                      ))}
                      {r.warnings.map((w) => (
                        <p key={w} className="text-muted-foreground">
                          {w}
                        </p>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            {preview.results.length > 300 && <p className="mt-2 text-sm text-muted-foreground">Showing the first 300 of {preview.results.length} rows. All of them are checked and imported.</p>}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button disabled={busy || sendable === 0} onClick={() => void commit()} data-testid="import-commit">
              {busy ? "Importing…" : `Import ${sendable} ${sendable === 1 ? "row" : "rows"} as drafts`}
            </Button>
            {summary.errors > 0 && <p className="text-sm">The {summary.errors} rows with errors are left out. Fix them in the file and import it again: rows already imported are recognised and skipped.</p>}
          </div>
        </section>
      )}

      {report && (
        <section aria-labelledby="done" className="mt-6">
          <h2 id="done" className="text-xl font-bold">
            Imported
          </h2>
          <p className="mt-1 tabular-nums" data-testid="import-report">
            {report.report.created_companies} companies created, {report.report.attached_offices} offices added, {report.report.skipped} skipped, {report.report.errors} rows failed.
          </p>
          {report.report.errors > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-danger">
              {report.report.results
                .filter((r) => r.result === "error")
                .map((r) => (
                  <li key={r.row}>
                    Line {report.lines[r.row - 1] ?? r.row}: {r.message}
                  </li>
                ))}
            </ul>
          )}
          <p className="mt-3 text-sm">
            Next: <Link href="/admin/companies?status=draft">review the draft companies</Link> and the <Link href="/admin/review">offices that need a look</Link>, then a reviewer publishes them.
          </p>
        </section>
      )}
    </>
  );
}
