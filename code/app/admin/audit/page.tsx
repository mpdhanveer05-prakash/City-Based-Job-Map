"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAdmin } from "@/components/admin/admin-root";
import type { AnyError } from "@/components/admin/use-reference";
import { DataTable, Notice, PageHeader, Pager, Select, TextInput } from "@/components/admin/ui";
import { describeError } from "@/lib/admin/errors";
import { changedKeys } from "@/lib/admin/audit";

const PAGE_SIZE = 50;
const TABLES = ["company", "office", "job", "company_founder", "company_type_tag", "company_sector", "job_city", "slug_redirect", "city", "neighbourhood", "tech_park", "sector", "source", "admin_user", "site_state"];

type Row = { id: number; at: string; actor: string | null; actor_role: string | null; table_name: string; row_id: string; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null };

export default function AuditPage() {
  const { supabase, can } = useAdmin();
  const [table, setTable] = useState("");
  const [action, setAction] = useState("");
  const [rowId, setRowId] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<number | null>(null);

  const log = useQuery({
    queryKey: ["admin", "audit", table, action, rowId, page],
    enabled: can("reviewer"),
    queryFn: async () => {
      let query = supabase.from("audit_log").select("*", { count: "exact" }).order("id", { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (table) query = query.eq("table_name", table);
      if (action) query = query.eq("action", action);
      if (rowId.trim()) query = query.eq("row_id", rowId.trim());
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as Row[], total: count ?? 0 };
    },
  });

  if (!can("reviewer")) {
    return (
      <>
        <PageHeader title="Audit log" />
        <Notice kind="info">The audit log is for reviewers and admins.</Notice>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Audit log" />
      <p className="max-w-[72ch] text-sm text-muted-foreground">Every change to the curated data, with who made it and what it was before and after. It cannot be edited or deleted.</p>
      <div className="my-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="audit-table" className="text-sm font-semibold">
            Table
          </label>
          <Select id="audit-table" value={table} onChange={(e) => { setTable(e.target.value); setPage(0); }}>
            <option value="">All</option>
            {TABLES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="audit-action" className="text-sm font-semibold">
            Action
          </label>
          <Select id="audit-action" value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }}>
            <option value="">All</option>
            {["insert", "update", "delete", "publish_now", "import"].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-48 flex-1">
          <label htmlFor="audit-row" className="text-sm font-semibold">
            Row id
          </label>
          <TextInput id="audit-row" value={rowId} onChange={(e) => { setRowId(e.target.value); setPage(0); }} placeholder="The id of one record" />
        </div>
      </div>

      {log.isError && <Notice kind="error">{describeError(log.error as AnyError)}</Notice>}
      <DataTable label="Audit log">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Who</th>
            <th scope="col">What</th>
            <th scope="col">Row</th>
            <th scope="col">Changed</th>
          </tr>
        </thead>
        <tbody data-testid="audit-rows">
          {(log.data?.rows ?? []).map((r) => {
            const keys = changedKeys(r.before, r.after);
            return (
              <tr key={r.id}>
                <td className="tabular-nums">{new Date(r.at).toLocaleString("en-GB")}</td>
                <td>{r.actor_role ?? "system"}</td>
                <td>
                  {r.action} {r.table_name}
                </td>
                <td className="max-w-[14rem] truncate">{r.row_id}</td>
                <td>
                  {keys.length > 0 ? keys.join(", ") : ""}
                  <button type="button" className="ml-2 min-h-11 text-link underline" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                    {open === r.id ? "Hide" : "Details"}
                  </button>
                  {open === r.id && (
                    <dl className="mt-2 grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-1 text-xs">
                      <dt className="font-semibold">Field</dt>
                      <dd className="font-semibold">Before</dd>
                      <dd className="font-semibold">After</dd>
                      {(keys.length > 0 ? keys : Object.keys(r.after ?? r.before ?? {})).map((k) => (
                        <FieldDiff key={k} name={k} before={r.before?.[k]} after={r.after?.[k]} />
                      ))}
                    </dl>
                  )}
                </td>
              </tr>
            );
          })}
          {log.data?.rows.length === 0 && (
            <tr>
              <td colSpan={5} className="text-muted-foreground">
                No entries match.
              </td>
            </tr>
          )}
        </tbody>
      </DataTable>
      <Pager page={page} pageSize={PAGE_SIZE} total={log.data?.total ?? 0} onPage={setPage} />
    </>
  );
}

function FieldDiff({ name, before, after }: { name: string; before: unknown; after: unknown }) {
  const show = (v: unknown) => (v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v));
  return (
    <>
      <dt className="text-muted-foreground">{name}</dt>
      <dd className="break-all">{show(before)}</dd>
      <dd className="break-all">{show(after)}</dd>
    </>
  );
}
