"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAdmin } from "@/components/admin/admin-root";
import type { AnyError } from "@/components/admin/use-reference";
import { DataTable, Field, Notice, PageHeader, Select, TextInput } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/admin/errors";

const KINDS = ["manual", "csv_import", "ats_feed", "jsonld", "suggestion"] as const;
const KIND_LABELS: Record<(typeof KINDS)[number], string> = {
  manual: "Entered by hand",
  csv_import: "CSV import",
  ats_feed: "Applicant-tracking feed",
  jsonld: "Structured data on a site",
  suggestion: "Visitor suggestion",
};

type Row = { id: number; name: string; kind: string; base_url: string | null; permission_note: string; last_run_status: string | null };

/** Sources: where the data came from and what permission we have to use it (data-model.md). Admin role only. */
export default function SourcesPage() {
  const { supabase, can } = useAdmin();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", kind: "manual", base_url: "", permission_note: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const sources = useQuery({
    queryKey: ["admin", "sources"],
    queryFn: async () => {
      const { data, error } = await supabase.from("source").select("id, name, kind, base_url, permission_note, last_run_status").order("name");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  if (!can("admin")) {
    return (
      <>
        <PageHeader title="Sources" />
        <Notice kind="info">Sources are managed by admins.</Notice>
      </>
    );
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!form.name.trim()) found.name = "The name is required.";
    if (!form.permission_note.trim()) found.permission_note = "Say what permission there is to use this source.";
    if (form.base_url.trim() && !/^https:\/\//.test(form.base_url.trim())) found.base_url = "The address must start with https://";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const { error } = await supabase.from("source").insert({
      name: form.name.trim(),
      kind: form.kind,
      base_url: form.base_url.trim() || null,
      permission_note: form.permission_note.trim(),
    });
    if (error) {
      setMessage({ kind: "error", text: describeError(error) });
      return;
    }
    setMessage({ kind: "success", text: "Added." });
    setForm({ name: "", kind: "manual", base_url: "", permission_note: "" });
    await queryClient.invalidateQueries({ queryKey: ["admin"] });
  }

  return (
    <>
      <PageHeader title="Sources" />
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      {sources.isError && <Notice kind="error">{describeError(sources.error as AnyError)}</Notice>}
      <DataTable label="Sources">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Kind</th>
            <th scope="col">Address</th>
            <th scope="col">Permission</th>
          </tr>
        </thead>
        <tbody data-testid="source-rows">
          {(sources.data ?? []).map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{KIND_LABELS[s.kind as (typeof KINDS)[number]] ?? s.kind}</td>
              <td>{s.base_url ?? ""}</td>
              <td className="max-w-[24rem]">{s.permission_note}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>

      <h2 className="mt-8 text-xl font-bold">Add a source</h2>
      <form onSubmit={add} className="mt-3 grid max-w-2xl gap-4" noValidate data-testid="source-form">
        <Field label="Name" error={errors.name}>{(p) => <TextInput {...p} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
        <Field label="Kind">
          {(p) => (
            <Select {...p} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Address" error={errors.base_url} hint="Optional. Where the data is published.">
          {(p) => <TextInput {...p} type="url" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} />}
        </Field>
        <Field label="Permission to use it" error={errors.permission_note} hint="For example: the company publishes this feed for job boards; or: curated by us from public sources.">
          {(p) => <TextInput {...p} value={form.permission_note} onChange={(e) => setForm({ ...form, permission_note: e.target.value })} />}
        </Field>
        <div>
          <Button type="submit" data-testid="add-source">
            Add source
          </Button>
        </div>
      </form>
    </>
  );
}
