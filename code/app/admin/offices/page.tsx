"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAdmin } from "@/components/admin/admin-root";
import { useCompanyById } from "@/components/admin/company-picker";
import { useReference, type AnyError } from "@/components/admin/use-reference";
import { DataTable, Notice, PageHeader, Pager, Select, STATUS_LABELS, TextInput } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/admin/errors";
import { pathWith, withParams } from "@/lib/admin/url";

const PAGE_SIZE = 50;

type Row = {
  id: string;
  company_id: string;
  company_name: string;
  city_name: string;
  neighbourhood_name: string | null;
  tech_park_name: string | null;
  address: string;
  accuracy: string;
  verification: string;
  status: string;
  inside_city: boolean;
  outside_reviewed: boolean;
};

const safeTerm = (q: string) => q.replace(/[,()*%\\:]/g, " ").trim();

function OfficesList() {
  const { supabase } = useAdmin();
  const router = useRouter();
  const params = useSearchParams();
  const company = params.get("company") ?? "";
  const status = params.get("status") ?? "";
  const city = params.get("city") ?? "";
  const q = params.get("q") ?? "";
  const page = Math.max(0, Number(params.get("page") ?? 0) || 0);
  const [draft, setDraft] = useState(q);
  const reference = useReference();
  const companyFilter = useCompanyById(company || null);

  const go = (next: Record<string, string>) => router.replace(pathWith("/admin/offices", withParams(params, next)));

  const offices = useQuery({
    queryKey: ["admin", "offices", company, status, city, q, page],
    queryFn: async () => {
      let query = supabase
        .from("admin_offices")
        .select("id, company_id, company_name, city_name, neighbourhood_name, tech_park_name, address, accuracy, verification, status, inside_city, outside_reviewed", { count: "exact" })
        .order("company_name")
        .order("address")
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (company) query = query.eq("company_id", company);
      if (status) query = query.eq("status", status);
      if (city) query = query.eq("city_slug", city);
      const term = safeTerm(q);
      if (term) query = query.ilike("address", `%${term}%`);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as unknown as Row[], total: count ?? 0 };
    },
  });

  return (
    <>
      <PageHeader title="Offices">
        <Button asChild>
          <Link href={`/admin/offices/edit?new=1${company ? `&company=${company}` : ""}`} className="text-primary-foreground no-underline" data-testid="new-office">
            New office
          </Link>
        </Button>
      </PageHeader>

      {company && (
        <p className="mb-3 text-sm">
          Offices of <strong>{companyFilter.data?.name ?? "…"}</strong>.{" "}
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
          <label htmlFor="office-search" className="text-sm font-semibold">
            Search the address
          </label>
          <TextInput id="office-search" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
        <div>
          <label htmlFor="office-city" className="text-sm font-semibold">
            City
          </label>
          <Select id="office-city" value={city} onChange={(e) => go({ city: e.target.value, page: "0" })}>
            <option value="">All</option>
            {(reference.data?.cities ?? []).map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="office-status" className="text-sm font-semibold">
            Status
          </label>
          <Select id="office-status" value={status} onChange={(e) => go({ status: e.target.value, page: "0" })}>
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

      {offices.isError && <Notice kind="error">{describeError(offices.error as AnyError)}</Notice>}
      <DataTable label="Offices">
        <thead>
          <tr>
            <th scope="col">Company</th>
            <th scope="col">Address</th>
            <th scope="col">City and area</th>
            <th scope="col">Accuracy</th>
            <th scope="col">Verification</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody data-testid="office-rows">
          {(offices.data?.rows ?? []).map((o) => (
            <tr key={o.id}>
              <td>
                <Link href={`/admin/companies/edit?id=${o.company_id}`}>{o.company_name}</Link>
              </td>
              <td>
                <Link href={`/admin/offices/edit?id=${o.id}`}>{o.address}</Link>
                {!o.inside_city && !o.outside_reviewed && <span className="ml-2 text-danger">Outside the city boundary</span>}
              </td>
              <td>
                {o.city_name}
                {o.neighbourhood_name || o.tech_park_name ? `, ${o.neighbourhood_name ?? o.tech_park_name}` : ""}
              </td>
              <td>{o.accuracy}</td>
              <td>{o.verification}</td>
              <td>{STATUS_LABELS[o.status] ?? o.status}</td>
            </tr>
          ))}
          {offices.data?.rows.length === 0 && (
            <tr>
              <td colSpan={6} className="text-muted-foreground">
                No offices match.
              </td>
            </tr>
          )}
        </tbody>
      </DataTable>
      <Pager page={page} pageSize={PAGE_SIZE} total={offices.data?.total ?? 0} onPage={(p) => go({ page: String(p) })} />
    </>
  );
}

export default function OfficesPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <OfficesList />
    </Suspense>
  );
}
