"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAdmin } from "@/components/admin/admin-root";
import { CompanyPicker, useCompanyById, type PickedCompany } from "@/components/admin/company-picker";
import { useReference, type AnyError, type Reference } from "@/components/admin/use-reference";
import { CheckRow, Field, Notice, PageHeader, Select, TextInput } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/admin/errors";
import { WORK_MODES, checkJobForm, type FieldErrors, type JobForm } from "@/lib/admin/forms";

const BLANK = (company: string): JobForm => ({
  company_id: company,
  title: "",
  apply_url: "",
  status: "draft",
  work_mode: "",
  exp_min_years: "",
  exp_max_years: "",
  posted_at: "",
  source_id: "",
  city_ids: [],
  company_domain: "",
});

function Editor() {
  const { supabase } = useAdmin();
  const params = useSearchParams();
  const id = params.get("id");
  const companyParam = params.get("company") ?? "";
  const reference = useReference();

  const loaded = useQuery({
    queryKey: ["admin", "job", id],
    enabled: !!id,
    queryFn: async (): Promise<JobForm> => {
      const { data, error } = await supabase
        .from("job")
        .select("company_id, title, apply_url, status, work_mode, exp_min_years, exp_max_years, posted_at, source_id, job_city(city_id)")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw { message: "That job does not exist, or you cannot see it." };
      const j = data as unknown as Record<string, string | number | null> & { job_city: Array<{ city_id: number }> };
      return {
        company_id: String(j.company_id),
        title: String(j.title),
        apply_url: String(j.apply_url),
        status: j.status as JobForm["status"],
        work_mode: j.work_mode === null ? "" : String(j.work_mode),
        exp_min_years: j.exp_min_years === null ? "" : String(j.exp_min_years),
        exp_max_years: j.exp_max_years === null ? "" : String(j.exp_max_years),
        posted_at: j.posted_at === null ? "" : String(j.posted_at),
        source_id: String(j.source_id),
        city_ids: j.job_city.map((c) => String(c.city_id)),
        company_domain: "",
      };
    },
  });
  const initialCompany = useCompanyById(loaded.data?.company_id ?? (companyParam || null));

  if (id && loaded.isPending) return <p role="status">Loading…</p>;
  if (id && loaded.isError) return <Notice kind="error">{describeError(loaded.error as AnyError)}</Notice>;
  if (!reference.data) return reference.isError ? <Notice kind="error">{describeError(reference.error as AnyError)}</Notice> : <p role="status">Loading…</p>;
  if ((loaded.data?.company_id || companyParam) && initialCompany.isPending) return <p role="status">Loading…</p>;

  return <JobFormView key={id ?? "new"} id={id} initial={loaded.data ?? BLANK(companyParam)} initialCompany={initialCompany.data ?? null} reference={reference.data} />;
}

function JobFormView({ id, initial, initialCompany, reference }: { id: string | null; initial: JobForm; initialCompany: PickedCompany | null; reference: Reference }) {
  const { supabase, can } = useAdmin();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<JobForm>(initial);
  const [company, setCompany] = useState<PickedCompany | null>(initialCompany);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canPublish = can("reviewer");

  const set = <K extends keyof JobForm>(key: K, value: JobForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggleCity = (cityId: string) =>
    setForm((f) => ({ ...f, city_ids: f.city_ids.map(String).includes(cityId) ? f.city_ids.filter((c) => String(c) !== cityId) : [...f.city_ids, cityId] }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    const checked = checkJobForm({ ...form, company_id: company?.id ?? "", company_domain: company?.domain ?? "" });
    if (!checked.ok) {
      setErrors(checked.errors);
      setMessage({ kind: "error", text: "Some fields need attention." });
      return;
    }
    setErrors({});
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_save_job", { p_id: id, p_job: checked.value.job, p_city_ids: checked.value.city_ids });
    setBusy(false);
    if (error) {
      setMessage({ kind: "error", text: describeError(error) });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["admin"] });
    if (!id) router.replace(`/admin/jobs/edit?id=${data as string}`);
    else setMessage({ kind: "success", text: "Saved." });
  }

  async function remove() {
    if (!id || !window.confirm("Delete this job? This cannot be undone.")) return;
    setBusy(true);
    const { error, count } = await supabase.from("job").delete({ count: "exact" }).eq("id", id);
    setBusy(false);
    if (error || !count) {
      setMessage({ kind: "error", text: error ? describeError(error) : "Your role may not delete this job (an active or suspect job is withdrawn first)." });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["admin"] });
    router.replace("/admin/jobs");
  }

  const publicStatus = (s: string) => s === "active" || s === "suspect";

  return (
    <>
      <PageHeader title={id ? "Edit job" : "New job"}>
        <Link href="/admin/jobs">All jobs</Link>
      </PageHeader>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}

      <form onSubmit={save} className="grid max-w-3xl gap-4" noValidate data-testid="job-form">
        <Field label="Company" error={errors.company_id}>
          {(p) => <CompanyPicker id={p.id} picked={company} onPick={setCompany} invalid={!!errors.company_id} describedBy={p["aria-describedby"]} />}
        </Field>
        <Field label="Title" error={errors.title}>{(p) => <TextInput {...p} value={form.title} onChange={(e) => set("title", e.target.value)} />}</Field>
        <Field label="Apply link" error={errors.apply_url} hint="On the company's own domain or a known applicant-tracking site. Visitors go straight to it.">
          {(p) => <TextInput {...p} type="url" value={form.apply_url} onChange={(e) => set("apply_url", e.target.value)} />}
        </Field>
        <fieldset>
          <legend className="text-sm font-semibold">Listed in</legend>
          <div className="flex flex-wrap gap-x-6">
            {reference.cities.map((c) => (
              <CheckRow key={c.id} label={c.name} checked={form.city_ids.map(String).includes(String(c.id))} onChange={() => toggleCity(String(c.id))} />
            ))}
          </div>
          {errors.city_ids && (
            <p className="text-sm text-danger" data-testid="field-error">
              {errors.city_ids}
            </p>
          )}
        </fieldset>
        <Field label="Source" error={errors.source_id} hint="Where the job came from.">
          {(p) => (
            <Select {...p} value={String(form.source_id)} onChange={(e) => set("source_id", e.target.value)}>
              <option value="">Choose a source</option>
              {reference.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Status" error={errors.status} hint={canPublish ? "Active and suspect jobs are public after the next rebuild." : "Making a job active needs a reviewer or an admin."}>
          {(p) => (
            <Select {...p} value={form.status} onChange={(e) => set("status", e.target.value as JobForm["status"])}>
              {(["draft", "active", "suspect", "expired", "withdrawn"] as const).map((s) => (
                <option key={s} value={s} disabled={!canPublish && publicStatus(s) !== publicStatus(initial.status)}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Work mode" error={errors.work_mode}>
          {(p) => (
            <Select {...p} value={form.work_mode} onChange={(e) => set("work_mode", e.target.value)}>
              <option value="">Not stated</option>
              {WORK_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Minimum experience (years)" error={errors.exp_min_years}>
            {(p) => <TextInput {...p} inputMode="numeric" value={String(form.exp_min_years ?? "")} onChange={(e) => set("exp_min_years", e.target.value)} />}
          </Field>
          <Field label="Maximum experience (years)" error={errors.exp_max_years}>
            {(p) => <TextInput {...p} inputMode="numeric" value={String(form.exp_max_years ?? "")} onChange={(e) => set("exp_max_years", e.target.value)} />}
          </Field>
        </div>
        <Field label="Posted on" error={errors.posted_at} hint="Only if the employer says so, as 2026-10-05.">
          {(p) => <TextInput {...p} value={form.posted_at} onChange={(e) => set("posted_at", e.target.value)} />}
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={busy} data-testid="save-job">
            {busy ? "Saving…" : "Save"}
          </Button>
          {id && (
            <Button type="button" variant="destructive" disabled={busy} onClick={remove} data-testid="delete-job">
              Delete job
            </Button>
          )}
        </div>
      </form>
    </>
  );
}

export default function EditJobPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Editor />
    </Suspense>
  );
}
