"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAdmin } from "@/components/admin/admin-root";
import { useReference, type AnyError, type Reference } from "@/components/admin/use-reference";
import { CheckRow, Field, Notice, PageHeader, Select, TextArea, TextInput } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/admin/errors";
import { checkCompanyForm, type CompanyForm, type FieldErrors } from "@/lib/admin/forms";
import { STAGE_LABELS, STATUS_LABELS, TYPE_LABELS } from "@/lib/explorer/labels";
import { COMPANY_TYPES, OWNERSHIP_STATUSES, STARTUP_STAGES } from "@/lib/filters/schema";

const EMPTY: CompanyForm = {
  name: "",
  slug: "",
  domain: "",
  website_url: "",
  careers_url: "",
  description: "",
  startup_stage: "",
  ownership_status: "",
  types: [],
  sectors: [],
  status: "draft",
};

type Loaded = { form: CompanyForm; offices: number; jobs: number };

function Editor() {
  const { supabase } = useAdmin();
  const params = useSearchParams();
  const id = params.get("id");
  const reference = useReference();

  const loaded = useQuery({
    queryKey: ["admin", "company", id],
    enabled: !!id,
    queryFn: async (): Promise<Loaded> => {
      const { data, error } = await supabase
        .from("company")
        .select("name, slug, domain, website_url, careers_url, description, startup_stage, ownership_status, status, company_type_tag(type), company_sector(sector(slug)), office(count), job(count)")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw { message: "That company does not exist, or you cannot see it." };
      const row = data as unknown as {
        name: string; slug: string; domain: string; website_url: string; careers_url: string | null; description: string | null;
        startup_stage: string | null; ownership_status: string | null; status: CompanyForm["status"];
        company_type_tag: Array<{ type: (typeof COMPANY_TYPES)[number] }>; company_sector: Array<{ sector: { slug: string } | null }>;
        office: Array<{ count: number }>; job: Array<{ count: number }>;
      };
      return {
        form: {
          name: row.name, slug: row.slug, domain: row.domain, website_url: row.website_url, careers_url: row.careers_url ?? "",
          description: row.description ?? "", startup_stage: row.startup_stage ?? "", ownership_status: row.ownership_status ?? "", status: row.status,
          types: row.company_type_tag.map((t) => t.type), sectors: row.company_sector.flatMap((s) => (s.sector ? [s.sector.slug] : [])),
        },
        offices: row.office[0]?.count ?? 0,
        jobs: row.job[0]?.count ?? 0,
      };
    },
  });

  if (id && loaded.isPending) return <p role="status">Loading…</p>;
  if (id && loaded.isError) return <Notice kind="error">{describeError(loaded.error as AnyError)}</Notice>;
  if (!reference.data) return reference.isError ? <Notice kind="error">{describeError(reference.error as AnyError)}</Notice> : <p role="status">Loading…</p>;

  return <CompanyFormView key={id ?? "new"} id={id} initial={loaded.data?.form ?? EMPTY} counts={loaded.data} reference={reference.data} />;
}

function CompanyFormView({ id, initial, counts, reference }: { id: string | null; initial: CompanyForm; counts: Loaded | undefined; reference: Reference }) {
  const { supabase, can } = useAdmin();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CompanyForm>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof CompanyForm>(key: K, value: CompanyForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggle = (key: "types" | "sectors", value: string) =>
    setForm((f) => {
      const list = (f[key] as string[]).includes(value) ? (f[key] as string[]).filter((v) => v !== value) : [...(f[key] as string[]), value];
      const next = { ...f, [key]: list } as CompanyForm;
      // The stage is only for Startups: dropping the type clears it, as the filter does (ADR-0004).
      if (key === "types" && !list.includes("startup")) next.startup_stage = "";
      return next;
    });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    const checked = checkCompanyForm(form);
    if (!checked.ok) {
      setErrors(checked.errors);
      setMessage({ kind: "error", text: "Some fields need attention." });
      return;
    }
    setErrors({});
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_save_company", {
      p_id: id,
      p_company: checked.value.company,
      p_types: checked.value.types,
      p_sectors: checked.value.sectors,
    });
    setBusy(false);
    if (error) {
      setMessage({ kind: "error", text: describeError(error) });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["admin"] });
    if (!id) router.replace(`/admin/companies/edit?id=${data as string}`);
    else setMessage({ kind: "success", text: "Saved." });
  }

  async function remove() {
    if (!id || !window.confirm(`Delete ${form.name} with all its offices and jobs? This cannot be undone.`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("admin_delete_company", { p_id: id });
    setBusy(false);
    if (error) {
      setMessage({ kind: "error", text: describeError(error) });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["admin"] });
    router.replace("/admin/companies");
  }

  const canPublish = can("reviewer");

  return (
    <>
      <PageHeader title={id ? `Edit ${initial.name}` : "New company"}>
        <Link href="/admin/companies">All companies</Link>
      </PageHeader>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      {counts && (
        <p className="mb-4 text-sm">
          <Link href={`/admin/offices?company=${id}`}>{counts.offices} offices</Link>, <Link href={`/admin/jobs?company=${id}`}>{counts.jobs} jobs</Link>
        </p>
      )}

      <form onSubmit={save} className="grid max-w-3xl gap-4" noValidate data-testid="company-form">
        <Field label="Name" error={errors.name}>{(p) => <TextInput {...p} value={form.name} onChange={(e) => set("name", e.target.value)} />}</Field>
        <Field label="Domain" error={errors.domain} hint="The company's own domain, such as example.com. Apply links are checked against it.">
          {(p) => <TextInput {...p} value={form.domain} onChange={(e) => set("domain", e.target.value)} />}
        </Field>
        <Field label="Slug" error={errors.slug} hint="The address of its page. Leave empty to make it from the name. An old slug keeps redirecting after a change.">
          {(p) => <TextInput {...p} value={form.slug} onChange={(e) => set("slug", e.target.value)} />}
        </Field>
        <Field label="Website" error={errors.website_url} hint="Leave empty to use https://the-domain.">
          {(p) => <TextInput {...p} type="url" value={form.website_url} onChange={(e) => set("website_url", e.target.value)} />}
        </Field>
        <Field label="Careers page" error={errors.careers_url}>{(p) => <TextInput {...p} type="url" value={form.careers_url} onChange={(e) => set("careers_url", e.target.value)} />}</Field>
        <Field label="Description" error={errors.description} hint="Plain text. It is shown as written, never as markup.">
          {(p) => <TextArea {...p} value={form.description} onChange={(e) => set("description", e.target.value)} />}
        </Field>

        <fieldset>
          <legend className="text-sm font-semibold">Company type</legend>
          <p className="text-sm text-muted-foreground">A company can be several, such as a Startup and a Product company.</p>
          <div className="flex flex-wrap gap-x-6">
            {COMPANY_TYPES.map((t) => (
              <CheckRow key={t} label={TYPE_LABELS[t]} checked={form.types.includes(t)} onChange={() => toggle("types", t)} />
            ))}
          </div>
        </fieldset>

        <Field label="Startup stage" error={errors.startup_stage} hint={form.types.includes("startup") ? undefined : "Choose the type Startup to set a stage."}>
          {(p) => (
            <Select {...p} value={form.startup_stage} disabled={!form.types.includes("startup")} onChange={(e) => set("startup_stage", e.target.value)}>
              <option value="">Not stated</option>
              {STARTUP_STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Ownership status" error={errors.ownership_status} hint="Private, public, or acquired, from a source you can cite. Leave it unknown otherwise.">
          {(p) => (
            <Select {...p} value={form.ownership_status} onChange={(e) => set("ownership_status", e.target.value)}>
              <option value="">Not stated</option>
              {OWNERSHIP_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <fieldset>
          <legend className="text-sm font-semibold">Sectors</legend>
          <div className="flex flex-wrap gap-x-6">
            {reference.sectors.map((s) => (
              <CheckRow key={s.slug} label={s.name} checked={form.sectors.includes(s.slug)} onChange={() => toggle("sectors", s.slug)} />
            ))}
          </div>
        </fieldset>

        <Field label="Status" error={errors.status} hint={canPublish ? "Published companies are public after the next rebuild." : "Publishing needs a reviewer or an admin."}>
          {(p) => (
            <Select {...p} value={form.status} onChange={(e) => set("status", e.target.value as CompanyForm["status"])} data-testid="company-form-status">
              <option value="draft">Draft</option>
              <option value="published" disabled={!canPublish && initial.status !== "published"}>Published</option>
              <option value="unpublished" disabled={!canPublish && initial.status !== "unpublished"}>Unpublished</option>
            </Select>
          )}
        </Field>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={busy} data-testid="save-company">
            {busy ? "Saving…" : "Save"}
          </Button>
          {id && (
            <Button type="button" variant="destructive" disabled={busy} onClick={remove} data-testid="delete-company">
              Delete company
            </Button>
          )}
        </div>
      </form>
    </>
  );
}

export default function EditCompanyPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Editor />
    </Suspense>
  );
}
