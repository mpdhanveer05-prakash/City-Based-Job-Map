"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAdmin } from "@/components/admin/admin-root";
import { useCompanyById } from "@/components/admin/company-picker";
import type { AnyError } from "@/components/admin/use-reference";
import { DataTable, Notice, PageHeader, Pager, Select, STATUS_LABELS, TextInput } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/admin/errors";
import { pathWith, withParams } from "@/lib/admin/url";

const PAGE_SIZE = 50;

type Row = { id: string; title: string; status: string; apply_url: string; last_checked_at: string | null; company: { id: string; name: string } | null };

const safeTerm = (q: string) => q.replace(/[,()*%\\:]/g, " ").trim();

function JobsList() {
  const { supabase } = useAdmin();
  const router = useRouter();
  const params = useSearchParams();
  const company = params.get("company") ?? "";
  const status = params.get("status") ?? "";
  const q = params.get("q") ?? "";
  const page = Math.max(0, Number(params.get("page") ?? 0) || 0);
  const [draft, setDraft] = useState(q);
  const companyFilter = useCompanyById(company || null);

  const go = (next: Record<string, string>) => router.replace(pathWith("/admin/jobs", withParams(params, next)));

  const jobs = useQuery({
    queryKey: ["admin", "jobs", company, status, q, page],
    queryFn: async () => {
      let query = supabase
        .from("job")
        .select("id, title, status, apply_url, last_checked_at, company:company_id(id, name)", { count: "exact" })
        .order("title")
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (company) query = query.eq("company_id", company);
      if (status) query = query.eq("status", status);
      const term = safeTerm(q);
      if (term) query = query.ilike("title", `%${term}%`);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as unknown as Row[], total: count ?? 0 };
    },
  });

  return (
    <>
      <PageHeader title="Jobs">
        <Button asChild>
          <Link href={`/admin/jobs/edit?new=1${company ? `&company=${company}` : ""}`} className="text-primary-foreground no-underline" data-testid="new-job">
            New job
          </Link>
        </Button>
      </PageHeader>
      {company && (
        <p className="mb-3 text-sm">
          Jobs of <strong>{companyFilter.data?.name ?? "…"}</strong>.{" "}
          <button type="button" className="min-h-11 text-link underline" onClick={() => go({ company: "" })}>
            Show all
          </button>
        </p>
      )}
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          go({ q: draft.trim(), page: "0" });
        }}
      >
        <div className="min-w-48 flex-1">
          <label htmlFor="job-search" className="text-sm font-semibold">
            Search the title
          </label>
          <TextInput id="job-search" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
        <div>
          <label htmlFor="job-status" className="text-sm font-semibold">
            Status
          </label>
          <Select id="job-status" value={status} onChange={(e) => go({ status: e.target.value, page: "0" })}>
            <option value="">All</option>
            {["draft", "active", "suspect", "expired", "withdrawn"].map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {jobs.isError && <Notice kind="error">{describeError(jobs.error as AnyError)}</Notice>}
      <DataTable label="Jobs">
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Company</th>
            <th scope="col">Status</th>
            <th scope="col">Last checked</th>
          </tr>
        </thead>
        <tbody data-testid="job-rows">
          {(jobs.data?.rows ?? []).map((j) => (
            <tr key={j.id}>
              <td>
                <Link href={`/admin/jobs/edit?id=${j.id}`}>{j.title}</Link>
              </td>
              <td>{j.company ? <Link href={`/admin/companies/edit?id=${j.company.id}`}>{j.company.name}</Link> : ""}</td>
              <td>{STATUS_LABELS[j.status] ?? j.status}</td>
              <td className="tabular-nums">{j.last_checked_at ? new Date(j.last_checked_at).toLocaleDateString("en-GB") : "Not yet"}</td>
            </tr>
          ))}
          {jobs.data?.rows.length === 0 && (
            <tr>
              <td colSpan={4} className="text-muted-foreground">
                No jobs match.
              </td>
            </tr>
          )}
        </tbody>
      </DataTable>
      <Pager page={page} pageSize={PAGE_SIZE} total={jobs.data?.total ?? 0} onPage={(p) => go({ page: String(p) })} />
    </>
  );
}

export default function JobsPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <JobsList />
    </Suspense>
  );
}
