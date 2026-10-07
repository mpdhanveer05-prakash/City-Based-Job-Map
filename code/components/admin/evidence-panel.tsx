"use client";
// The evidence for a company, its offices, and its founders, or for a job (P9-07, ADR-0022): every fact the record holds, whether a source
// supports it, and why the company cannot be published yet. An editor records evidence; a reviewer reviews it. The
// database decides all of this (evidence_report, publication_problems, the field_evidence policies and guard); this
// panel only shows it.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAdmin } from "@/components/admin/admin-root";
import { DataTable, Field, Notice, Select, TextInput } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/admin/errors";
import { formatDate } from "@/lib/format-date";

type ReportRow = {
  record_type: "company" | "office" | "founder" | "job";
  record_id: string;
  record_label: string;
  field: string;
  current_value: string;
  state: "missing" | "stale" | "claimed" | "reviewed";
  evidence_id: number | null;
  source_url: string | null;
  verified_at: string | null;
  reviewed_at: string | null;
  self_reviewed: boolean | null;
  last_check_at: string | null;
  last_check_outcome: "fetch_failed" | "value_found" | "value_not_found" | "reachable" | null;
};

const CHECK_TEXT: Record<NonNullable<ReportRow["last_check_outcome"]>, string> = {
  fetch_failed: "Source could not be read",
  value_found: "Value found on the source",
  value_not_found: "Value not found on the source: check it",
  reachable: "Source answered",
};

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  website: "Website",
  description: "Description",
  types: "Company type",
  sectors: "Sectors",
  startup_stage: "Startup stage",
  ownership_status: "Ownership status",
  address: "Address",
  location: "Location",
  full_name: "Founder name",
  title: "Job title",
  employer: "Employer",
  apply_url: "Application link",
};
const STATE_TEXT: Record<ReportRow["state"], string> = {
  missing: "No evidence",
  stale: "Evidence is for an older value",
  claimed: "Claimed, not reviewed",
  reviewed: "Reviewed",
};

const recordText = (r: ReportRow) =>
  r.record_type === "company" ? "Company" : r.record_type === "job" ? "Job" : r.record_type === "office" ? `Office: ${r.record_label}` : `Founder: ${r.record_label}`;
const keyOf = (r: Pick<ReportRow, "record_type" | "record_id" | "field">) => `${r.record_type}:${r.record_id}:${r.field}`;
const today = () => new Date().toISOString().slice(0, 10);

export function EvidencePanel({ companyId, jobId }: { companyId?: string; jobId?: string }) {
  const id = (jobId ?? companyId)!;
  const isJob = !!jobId;
  const { supabase, can } = useAdmin();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [verifiedAt, setVerifiedAt] = useState("");
  const [proposed, setProposed] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const report = useQuery({
    queryKey: ["admin", "evidence", id],
    queryFn: async () => {
      const [rows, problems] = await Promise.all(
        isJob
          ? [supabase.rpc("job_evidence_report", { p_job: id }), supabase.rpc("job_publication_problems", { p_job: id })]
          : [supabase.rpc("evidence_report", { p_company: id }), supabase.rpc("publication_problems", { p_company: id })],
      );
      if (rows.error) throw rows.error;
      if (problems.error) throw problems.error;
      return { rows: (rows.data ?? []) as ReportRow[], problems: (problems.data ?? []) as string[] };
    },
  });

  async function record(event: React.FormEvent) {
    event.preventDefault();
    const row = report.data?.rows.find((r) => keyOf(r) === target);
    if (!row) {
      setMessage({ kind: "error", text: "Choose the fact this source supports." });
      return;
    }
    setBusy(true);
    const column = { company: "company_id", office: "office_id", founder: "founder_id", job: "job_id" }[row.record_type];
    // A proposed value records evidence for a change before it is made (a public fact changes only with reviewed evidence).
    const value = proposed.trim() || null;
    const { error } = await supabase.from("field_evidence").insert({ [column]: row.record_id, field: row.field, source_url: sourceUrl.trim(), verified_at: verifiedAt, value });
    setBusy(false);
    if (error) {
      setMessage({ kind: "error", text: describeError(error) });
      return;
    }
    setMessage({ kind: "success", text: "Evidence recorded. It is a claim until a reviewer reviews it." });
    setSourceUrl("");
    setProposed("");
    await queryClient.invalidateQueries({ queryKey: ["admin", "evidence", id] });
  }

  async function review(evidenceId: number) {
    setBusy(true);
    const { error } = await supabase.rpc("review_evidence", { p_ids: [evidenceId] });
    setBusy(false);
    if (error) setMessage({ kind: "error", text: describeError(error) });
    else setMessage({ kind: "success", text: "Marked reviewed." });
    await queryClient.invalidateQueries({ queryKey: ["admin", "evidence", id] });
  }

  if (report.isPending) return <p className="mt-8 text-sm">Loading the evidence…</p>;
  if (report.isError) return <Notice kind="error">{describeError(report.error)}</Notice>;
  const { rows, problems } = report.data;

  return (
    <section className="mt-10 max-w-5xl" aria-labelledby="evidence-heading" data-testid="evidence-panel">
      <h2 id="evidence-heading" className="mb-2 text-lg font-bold">
        Evidence
      </h2>
      <p className="mb-3 max-w-[72ch] text-sm text-muted-foreground">
        Every fact needs a source someone checked. Recorded evidence is a claim until a reviewer reviews it.{" "}
        {isJob
          ? "Publishing a job needs reviewed evidence for its title, employer, location and work arrangement, and application link. The company's own verification says nothing about whether its jobs are open."
          : "Publishing needs a reviewed name and website, a published office with reviewed address and location, and reviewed evidence for every other fact it shows (or leave that fact empty)."}{" "}
        Once a record is public, a changed fact needs reviewed evidence for the new value first: record it below with the proposed value.
      </p>
      {problems.length > 0 ? (
        <div data-testid="publication-problems">
          <Notice kind="info">
            Cannot be published yet:
            <ul className="ml-5 list-disc">
              {problems.map((p) => (
                <li key={p}>{p.charAt(0).toUpperCase() + p.slice(1)}.</li>
              ))}
            </ul>
          </Notice>
        </div>
      ) : (
        <Notice kind="success">The evidence is enough to publish.</Notice>
      )}
      {message && <Notice kind={message.kind}>{message.text}</Notice>}

      <DataTable label="Evidence for each fact">
        <thead>
          <tr>
            <th scope="col">Record</th>
            <th scope="col">Fact</th>
            <th scope="col">Value</th>
            <th scope="col">Evidence</th>
            <th scope="col">Source</th>
            <th scope="col">Checked</th>
            <th scope="col">Reviewed</th>
            <th scope="col">Latest source check</th>
            <th scope="col">
              <span className="sr-only">Review</span>
            </th>
          </tr>
        </thead>
        <tbody data-testid="evidence-rows">
          {rows.map((r) => (
            <tr key={keyOf(r)} data-evidence={keyOf(r)} data-state={r.state}>
              <td>{recordText(r)}</td>
              <td>{FIELD_LABELS[r.field] ?? r.field}</td>
              <td className="max-w-[24ch] truncate">{r.current_value}</td>
              <td>{STATE_TEXT[r.state]}</td>
              <td className="max-w-[24ch] truncate">
                {r.source_url ? (
                  <a href={r.source_url} target="_blank" rel="noopener noreferrer">
                    {r.source_url}
                  </a>
                ) : (
                  ""
                )}
              </td>
              <td className="tabular-nums">{r.verified_at ? formatDate(Date.parse(r.verified_at)) : ""}</td>
              <td data-testid="reviewed-cell">
                {r.reviewed_at ? `${formatDate(Date.parse(r.reviewed_at))}${r.self_reviewed ? ", by the person who recorded it" : ""}` : ""}
              </td>
              <td>{r.last_check_outcome ? `${CHECK_TEXT[r.last_check_outcome]} (${formatDate(Date.parse(r.last_check_at!))})` : ""}</td>
              <td>
                {r.state === "claimed" && r.evidence_id !== null && can("reviewer") && (
                  <Button type="button" variant="outline" disabled={busy} onClick={() => review(r.evidence_id!)} data-testid="review-evidence">
                    Mark reviewed
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>

      <form onSubmit={record} className="mt-4 grid max-w-3xl gap-3" noValidate data-testid="evidence-form">
        <h3 className="text-base font-semibold">Record evidence</h3>
        <Field label="Fact">
          {(p) => (
            <Select {...p} value={target} onChange={(e) => setTarget(e.target.value)} data-testid="evidence-target">
              <option value="">Choose a fact</option>
              {rows.map((r) => (
                <option key={keyOf(r)} value={keyOf(r)}>
                  {recordText(r)}: {FIELD_LABELS[r.field] ?? r.field}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Source link" hint="The https page that shows this fact.">
          {(p) => <TextInput {...p} type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} data-testid="evidence-source" />}
        </Field>
        <Field label="Proposed value" hint="Only for a change to a public record: the new value this source supports. Leave empty for the current value.">
          {(p) => <TextInput {...p} value={proposed} onChange={(e) => setProposed(e.target.value)} data-testid="evidence-value" />}
        </Field>
        <Field label="Checked on" hint="The day someone looked at the source, not today unless it was today.">
          {(p) => <TextInput {...p} type="date" max={today()} value={verifiedAt} onChange={(e) => setVerifiedAt(e.target.value)} data-testid="evidence-date" />}
        </Field>
        <div>
          <Button type="submit" disabled={busy} data-testid="save-evidence">
            Record evidence
          </Button>
        </div>
      </form>
    </section>
  );
}
