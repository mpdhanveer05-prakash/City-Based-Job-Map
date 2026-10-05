"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useAdmin } from "@/components/admin/admin-root";
import type { AnyError } from "@/components/admin/use-reference";
import { DataTable, Notice, PageHeader } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/admin/errors";

type OfficeRow = {
  id: string;
  company_id: string;
  company_name: string;
  city_name: string;
  address: string;
  accuracy: string;
  verification: string;
  status: string;
  outside_reviewed: boolean;
  inside_city: boolean;
  reason: string;
  lat: number;
  lng: number;
};
type SubmissionRow = {
  id: string;
  created_at: string;
  kind: "report" | "suggestion";
  target_type: "company" | "job" | "other";
  target_id: string | null;
  company_name: string | null;
  message: string;
  source_url: string | null;
};
type JobRow = { id: string; title: string; apply_url: string; last_checked_at: string | null; consecutive_failures: number; company: { id: string; name: string } | null };

export default function ReviewPage() {
  const { supabase, can } = useAdmin();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const offices = useQuery({
    queryKey: ["admin", "review-offices"],
    queryFn: async () => {
      const { data, error, count } = await supabase.from("review_offices").select("*", { count: "exact" }).order("company_name").limit(100);
      if (error) throw error;
      return { rows: (data ?? []) as OfficeRow[], total: count ?? 0 };
    },
  });
  const jobs = useQuery({
    queryKey: ["admin", "review-jobs"],
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from("job")
        .select("id, title, apply_url, last_checked_at, consecutive_failures, company:company_id(id, name)", { count: "exact" })
        .eq("status", "suspect")
        .order("last_checked_at", { ascending: true, nullsFirst: true })
        .limit(100);
      if (error) throw error;
      return { rows: (data ?? []) as unknown as JobRow[], total: count ?? 0 };
    },
  });

  const submissions = useQuery({
    queryKey: ["admin", "review-submissions"],
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from("submission")
        .select("id, created_at, kind, target_type, target_id, company_name, message, source_url", { count: "exact" })
        .eq("status", "new")
        .order("created_at", { ascending: true })
        .limit(100);
      if (error) throw error;
      return { rows: (data ?? []) as SubmissionRow[], total: count ?? 0 };
    },
  });
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function act(key: string, run: () => PromiseLike<{ error: AnyError | null; count?: number | null }>, done: string) {
    setBusy(key);
    setMessage(null);
    const { error, count } = await run();
    setBusy(null);
    if (error || count === 0) {
      setMessage({ kind: "error", text: error ? describeError(error) : "Nothing changed: your role may not do that." });
      return;
    }
    setMessage({ kind: "success", text: done });
    await queryClient.invalidateQueries({ queryKey: ["admin"] });
  }

  const reviewer = can("reviewer");

  return (
    <>
      <PageHeader title="Review" />
      {message && <Notice kind={message.kind}>{message.text}</Notice>}

      <section aria-labelledby="offices" className="mb-8">
        <h2 id="offices" className="text-xl font-bold">
          Offices that need a look
        </h2>
        <p className="mt-1 max-w-[72ch] text-sm text-muted-foreground">
          Locations below building accuracy, offices not yet verified, and points outside the city boundary. Open one to correct its point, or mark it reviewed once it is right.
        </p>
        {offices.isError && <Notice kind="error">{describeError(offices.error as AnyError)}</Notice>}
        <p className="mt-2 text-sm tabular-nums" data-testid="review-office-count">
          {offices.data ? `${offices.data.total} offices` : "Loading…"}
        </p>
        <DataTable label="Offices to review">
          <thead>
            <tr>
              <th scope="col">Company</th>
              <th scope="col">Address</th>
              <th scope="col">Why</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody data-testid="review-offices">
            {(offices.data?.rows ?? []).map((o) => (
              <tr key={o.id} data-office={o.id}>
                <td>
                  <Link href={`/admin/companies/edit?id=${o.company_id}`}>{o.company_name}</Link>
                </td>
                <td>
                  {o.address}, {o.city_name}
                </td>
                <td>{o.reason}</td>
                <td>{o.status}</td>
                <td>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/offices/edit?id=${o.id}`} className="text-foreground no-underline">
                        Open
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy !== null || o.verification === "reviewed"}
                      data-testid="mark-reviewed"
                      onClick={() =>
                        void act(`o-${o.id}`, () => supabase.from("office").update({ verification: "reviewed", last_verified_at: new Date().toISOString() }, { count: "exact" }).eq("id", o.id), "Marked as reviewed.")
                      }
                    >
                      Mark reviewed
                    </Button>
                    {!o.inside_city && !o.outside_reviewed && reviewer && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        data-testid="accept-outside"
                        onClick={() => void act(`b-${o.id}`, () => supabase.from("office").update({ outside_reviewed: true }, { count: "exact" }).eq("id", o.id), "Accepted outside the boundary.")}
                      >
                        Accept outside the boundary
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {offices.data?.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted-foreground">
                  Nothing to review. Every office is verified, accurate, and inside its city.
                </td>
              </tr>
            )}
          </tbody>
        </DataTable>
      </section>

      <section aria-labelledby="jobs" className="mb-8">
        <h2 id="jobs" className="text-xl font-bold">
          Suspect jobs
        </h2>
        <p className="mt-1 max-w-[72ch] text-sm text-muted-foreground">
          A job whose link failed one check. A second failure expires it on its own. Keep it if the link works, or expire it now. {reviewer ? "" : "Deciding needs a reviewer or an admin."}
        </p>
        {jobs.isError && <Notice kind="error">{describeError(jobs.error as AnyError)}</Notice>}
        <p className="mt-2 text-sm tabular-nums" data-testid="review-job-count">
          {jobs.data ? `${jobs.data.total} jobs` : "Loading…"}
        </p>
        <DataTable label="Suspect jobs">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Company</th>
              <th scope="col">Last checked</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody data-testid="review-jobs">
            {(jobs.data?.rows ?? []).map((j) => (
              <tr key={j.id} data-job={j.id}>
                <td>
                  <Link href={`/admin/jobs/edit?id=${j.id}`}>{j.title}</Link>
                </td>
                <td>{j.company?.name}</td>
                <td className="tabular-nums">{j.last_checked_at ? new Date(j.last_checked_at).toLocaleDateString("en-GB") : "Not yet"}</td>
                <td>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm">
                      <a href={j.apply_url} target="_blank" rel="noopener noreferrer" className="text-foreground no-underline">
                        Check the link<span className="sr-only"> for {j.title} (opens the employer&apos;s site)</span>
                      </a>
                    </Button>
                    <Button variant="outline" size="sm" disabled={!reviewer || busy !== null} data-testid="keep-job" onClick={() => void act(`k-${j.id}`, () => supabase.from("job").update({ status: "active", consecutive_failures: 0 }, { count: "exact" }).eq("id", j.id), "Kept as active.")}>
                      Keep
                    </Button>
                    <Button variant="destructive" size="sm" disabled={!reviewer || busy !== null} data-testid="expire-job" onClick={() => void act(`e-${j.id}`, () => supabase.from("job").update({ status: "expired" }, { count: "exact" }).eq("id", j.id), "Expired.")}>
                      Expire
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {jobs.data?.rows.length === 0 && (
              <tr>
                <td colSpan={4} className="text-muted-foreground">
                  No suspect jobs.
                </td>
              </tr>
            )}
          </tbody>
        </DataTable>
      </section>

      <section aria-labelledby="submissions" className="mb-8">
        <h2 id="submissions" className="text-xl font-bold">
          Reports and suggestions
        </h2>
        <p className="mt-1 max-w-[72ch] text-sm text-muted-foreground">
          What visitors sent, as they wrote it (plain text; there are no names or contact details). Nothing here is public. A suggestion is a lead: check the link, then
          add the company by hand or import it. Deciding needs a reviewer or an admin.
        </p>
        {submissions.isError && <Notice kind="error">{describeError(submissions.error as AnyError)}</Notice>}
        <p className="mt-2 text-sm tabular-nums" data-testid="review-submission-count">
          {submissions.data ? `${submissions.data.total} waiting` : "Loading…"}
        </p>
        <ul className="mt-2 divide-y divide-rule border-y border-rule" data-testid="review-submissions">
          {(submissions.data?.rows ?? []).map((r) => (
            <li key={r.id} data-submission={r.id} className="grid gap-2 py-3">
              <p className="text-sm text-muted-foreground">
                {new Date(r.created_at).toLocaleString("en-GB")}. {r.kind === "suggestion" ? `Suggestion: ${r.company_name}` : r.target_type === "job" ? "Report about a job" : "Report about a company"}.{" "}
                {r.target_id && (
                  <Link href={r.target_type === "job" ? `/admin/jobs/edit?id=${r.target_id}` : `/admin/companies/edit?id=${r.target_id}`}>Open it</Link>
                )}
              </p>
              <p className="whitespace-pre-line">{r.message}</p>
              {r.source_url && (
                <p className="text-sm">
                  <a href={r.source_url} target="_blank" rel="noopener noreferrer">
                    {r.source_url}
                    <span className="sr-only"> (opens another site)</span>
                  </a>
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`note-${r.id}`}>
                  Note for the decision
                </label>
                <input
                  id={`note-${r.id}`}
                  className="min-h-11 min-w-48 flex-1 rounded-md border border-field bg-milky px-3 text-base"
                  placeholder="A note (optional)"
                  maxLength={500}
                  value={notes[r.id] ?? ""}
                  onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                />
                <Button variant="outline" size="sm" disabled={!reviewer || busy !== null} data-testid="resolve-submission" onClick={() => void act(`s-${r.id}`, () => supabase.from("submission").update({ status: "resolved", resolution_note: notes[r.id]?.trim() || null }, { count: "exact" }).eq("id", r.id), "Resolved.")}>
                  Resolve
                </Button>
                <Button variant="destructive" size="sm" disabled={!reviewer || busy !== null} data-testid="reject-submission" onClick={() => void act(`r-${r.id}`, () => supabase.from("submission").update({ status: "rejected", resolution_note: notes[r.id]?.trim() || null }, { count: "exact" }).eq("id", r.id), "Rejected.")}>
                  Reject
                </Button>
              </div>
            </li>
          ))}
          {submissions.data?.rows.length === 0 && <li className="py-3 text-muted-foreground">Nothing is waiting.</li>}
        </ul>
      </section>
    </>
  );
}
