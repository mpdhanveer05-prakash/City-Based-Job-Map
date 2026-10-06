"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAdmin } from "@/components/admin/admin-root";
import type { AnyError } from "@/components/admin/use-reference";
import { DataTable, Notice, PageHeader, Pager, Select, STATUS_LABELS, TextInput } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/admin/errors";
import { pathWith, withParams } from "@/lib/admin/url";
import { TYPE_LABELS, STAGE_LABELS, STATUS_LABELS as OWNERSHIP_LABELS } from "@/lib/explorer/labels";
import type { CompanyType, OwnershipStatus, StartupStage } from "@/lib/filters/schema";

const PAGE_SIZE = 50;

type Row = {
  id: string;
  slug: string;
  name: string;
  domain: string;
  status: string;
  startup_stage: StartupStage | null;
  ownership_status: OwnershipStatus | null;
  company_type_tag: Array<{ type: CompanyType }>;
  office: Array<{ count: number }>;
};

/** What a person typed, made safe to put inside a PostgREST `or(...)` filter: no separators, wildcards, or escapes. */
const safeTerm = (q: string) => q.replace(/[,()*%\\:]/g, " ").trim();

function CompaniesList() {
  const { supabase } = useAdmin();
  const router = useRouter();
  const params = useSearchParams();
  const status = params.get("status") ?? "";
  const q = params.get("q") ?? "";
  const page = Math.max(0, Number(params.get("page") ?? 0) || 0);
  const [draft, setDraft] = useState(q);

  const go = (next: Record<string, string>) => router.replace(pathWith("/admin/companies", withParams(params, next)));

  const companies = useQuery({
    queryKey: ["admin", "companies", status, q, page],
    queryFn: async () => {
      let query = supabase
        .from("company")
        .select("id, slug, name, domain, status, startup_stage, ownership_status, company_type_tag(type), office(count)", { count: "exact" })
        .order("name")
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (status) query = query.eq("status", status);
      const term = safeTerm(q);
      if (term) query = query.or(`name.ilike.%${term}%,domain.ilike.%${term}%`);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as unknown as Row[], total: count ?? 0 };
    },
  });

  return (
    <>
      <PageHeader title="Companies">
        <Button asChild>
          <Link href="/admin/companies/edit?new=1" className="text-primary-foreground no-underline" data-testid="new-company">
            New company
          </Link>
        </Button>
      </PageHeader>

      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          go({ q: draft.trim(), page: "0" });
        }}
      >
        <div className="min-w-48 flex-1">
          <label htmlFor="company-search" className="text-sm font-semibold">
            Search by name or domain
          </label>
          <TextInput id="company-search" value={draft} onChange={(e) => setDraft(e.target.value)} data-testid="company-search" />
        </div>
        <div>
          <label htmlFor="company-status" className="text-sm font-semibold">
            Status
          </label>
          <Select id="company-status" value={status} onChange={(e) => go({ status: e.target.value, page: "0" })} data-testid="company-status">
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="unpublished">Unpublished</option>
          </Select>
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {companies.isError && <Notice kind="error">{describeError(companies.error as AnyError)}</Notice>}
      <DataTable label="Companies">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Domain</th>
            <th scope="col">Types</th>
            <th scope="col">Stage</th>
            <th scope="col">Ownership</th>
            <th scope="col" className="text-right">
              Offices
            </th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody data-testid="company-rows">
          {(companies.data?.rows ?? []).map((c) => (
            <tr key={c.id} data-company={c.slug}>
              <td>
                <Link href={`/admin/companies/edit?id=${c.id}`}>{c.name}</Link>
              </td>
              <td>{c.domain}</td>
              <td>{c.company_type_tag.map((t) => TYPE_LABELS[t.type]).join(", ") || "None"}</td>
              <td>{c.startup_stage ? STAGE_LABELS[c.startup_stage] : ""}</td>
              <td>{c.ownership_status ? OWNERSHIP_LABELS[c.ownership_status] : ""}</td>
              <td className="text-right tabular-nums">{c.office[0]?.count ?? 0}</td>
              <td>{STATUS_LABELS[c.status] ?? c.status}</td>
            </tr>
          ))}
          {companies.data?.rows.length === 0 && (
            <tr>
              <td colSpan={6} className="text-muted-foreground">
                No companies match.
              </td>
            </tr>
          )}
        </tbody>
      </DataTable>
      <Pager page={page} pageSize={PAGE_SIZE} total={companies.data?.total ?? 0} onPage={(p) => go({ page: String(p) })} />
    </>
  );
}

export default function CompaniesPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <CompaniesList />
    </Suspense>
  );
}
