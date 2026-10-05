"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useAdmin } from "@/components/admin/admin-root";
import { DataTable, Notice, PageHeader } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/admin/errors";
import { requestRebuild, type PublishMessage } from "@/lib/admin/publish";

type Counts = { draftCompanies: number; publishedCompanies: number; unpublishedCompanies: number; suspectJobs: number; reviewOffices: number };

export default function AdminDashboard() {
  const { supabase, can } = useAdmin();
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<PublishMessage | null>(null);

  const counts = useQuery({
    queryKey: ["admin", "counts"],
    queryFn: async (): Promise<Counts> => {
      const countOf = async (table: string, column?: string, value?: string) => {
        let query = supabase.from(table).select("*", { count: "exact", head: true });
        if (column) query = query.eq(column, value);
        const { count, error } = await query;
        if (error) throw error;
        return count ?? 0;
      };
      const [draftCompanies, publishedCompanies, unpublishedCompanies, suspectJobs, reviewOffices] = await Promise.all([
        countOf("company", "status", "draft"),
        countOf("company", "status", "published"),
        countOf("company", "status", "unpublished"),
        countOf("job", "status", "suspect"),
        countOf("review_offices"),
      ]);
      return { draftCompanies, publishedCompanies, unpublishedCompanies, suspectJobs, reviewOffices };
    },
  });

  const recent = useQuery({
    queryKey: ["admin", "recent-audit"],
    enabled: can("reviewer"),
    queryFn: async () => {
      const { data, error } = await supabase.from("audit_log").select("id, at, actor_role, table_name, action, row_id").order("id", { ascending: false }).limit(8);
      if (error) throw error;
      return data;
    },
  });

  return (
    <>
      <PageHeader title="Dashboard" />

      {counts.isError && <Notice kind="error">{describeError(counts.error as never)}</Notice>}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5" data-testid="admin-counts">
        <Stat label="Draft companies" value={counts.data?.draftCompanies} href="/admin/companies?status=draft" />
        <Stat label="Published companies" value={counts.data?.publishedCompanies} href="/admin/companies?status=published" />
        <Stat label="Unpublished companies" value={counts.data?.unpublishedCompanies} href="/admin/companies?status=unpublished" />
        <Stat label="Offices to review" value={counts.data?.reviewOffices} href="/admin/review" />
        <Stat label="Suspect jobs" value={counts.data?.suspectJobs} href="/admin/review" />
      </dl>

      <section aria-labelledby="publish" className="mt-8">
        <h2 id="publish" className="text-xl font-bold">
          Publish
        </h2>
        <p className="mt-1 max-w-[72ch] text-sm text-muted-foreground">
          Edits are saved at once but only reach visitors when the site is rebuilt. Publish now gives every city a new data version and starts a rebuild
          (at most one every ten minutes). Moving a company, office, or job to Published needs a reviewer; so does this button.
        </p>
        {message && <div className="mt-3"><Notice kind={message.kind === "success" ? "success" : message.kind}>{message.text}</Notice></div>}
        <Button
          className="mt-2"
          disabled={!can("reviewer") || publishing}
          data-testid="publish-now"
          onClick={async () => {
            setPublishing(true);
            setMessage(null);
            setMessage(await requestRebuild(supabase));
            setPublishing(false);
          }}
        >
          {publishing ? "Publishing…" : "Publish now"}
        </Button>
        {!can("reviewer") && <p className="mt-2 text-sm text-muted-foreground">Your role is editor. A reviewer or an admin publishes.</p>}
      </section>

      {can("reviewer") && (
        <section aria-labelledby="recent" className="mt-8">
          <h2 id="recent" className="text-xl font-bold">
            Recent changes
          </h2>
          {recent.isError && <Notice kind="error">{describeError(recent.error as never)}</Notice>}
          <DataTable label="Recent changes">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">What</th>
                <th scope="col">Row</th>
              </tr>
            </thead>
            <tbody>
              {(recent.data ?? []).map((row) => (
                <tr key={row.id}>
                  <td className="tabular-nums">{new Date(row.at).toLocaleString("en-GB")}</td>
                  <td>{row.actor_role ?? "system"}</td>
                  <td>
                    {row.action} {row.table_name}
                  </td>
                  <td className="max-w-[16rem] truncate">{row.row_id}</td>
                </tr>
              ))}
              {recent.data?.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-muted-foreground">
                    Nothing has changed yet.
                  </td>
                </tr>
              )}
            </tbody>
          </DataTable>
        </section>
      )}
    </>
  );
}

function Stat({ label, value, href }: { label: string; value: number | undefined; href: string }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums">
        <Link href={href} className="no-underline hover:underline">
          {value ?? "…"}
        </Link>
      </dd>
    </div>
  );
}
