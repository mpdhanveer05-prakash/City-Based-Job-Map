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
import { ACCURACIES, VERIFICATIONS, checkOfficeForm, type FieldErrors, type OfficeForm } from "@/lib/admin/forms";

type Loaded = { form: OfficeForm; inside: boolean; companyName: string };

const BLANK = (company: string): OfficeForm => ({
  company_id: company,
  city_id: "",
  neighbourhood_id: "",
  tech_park_id: "",
  address: "",
  lat: "",
  lng: "",
  accuracy: "street",
  verification: "unverified",
  status: "draft",
  outside_reviewed: false,
});

function Editor() {
  const { supabase } = useAdmin();
  const params = useSearchParams();
  const id = params.get("id");
  const companyParam = params.get("company") ?? "";
  const reference = useReference();

  const loaded = useQuery({
    queryKey: ["admin", "office", id],
    enabled: !!id,
    queryFn: async (): Promise<Loaded> => {
      const { data, error } = await supabase.from("admin_offices").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      if (!data) throw { message: "That office does not exist, or you cannot see it." };
      const o = data as Record<string, string | number | boolean | null>;
      return {
        form: {
          company_id: String(o.company_id),
          city_id: String(o.city_id),
          neighbourhood_id: o.neighbourhood_id === null ? "" : String(o.neighbourhood_id),
          tech_park_id: o.tech_park_id === null ? "" : String(o.tech_park_id),
          address: String(o.address),
          lat: String(o.lat),
          lng: String(o.lng),
          accuracy: o.accuracy as OfficeForm["accuracy"],
          verification: o.verification as OfficeForm["verification"],
          status: o.status as OfficeForm["status"],
          outside_reviewed: Boolean(o.outside_reviewed),
        },
        inside: Boolean(o.inside_city),
        companyName: String(o.company_name),
      };
    },
  });
  const initialCompany = useCompanyById(loaded.data?.form.company_id ?? (companyParam || null));

  if (id && loaded.isPending) return <p role="status">Loading…</p>;
  if (id && loaded.isError) return <Notice kind="error">{describeError(loaded.error as AnyError)}</Notice>;
  if (!reference.data) return reference.isError ? <Notice kind="error">{describeError(reference.error as AnyError)}</Notice> : <p role="status">Loading…</p>;
  const wantsCompany = !!(loaded.data?.form.company_id ?? companyParam);
  if (wantsCompany && initialCompany.isPending) return <p role="status">Loading…</p>;

  return (
    <OfficeFormView
      key={id ?? "new"}
      id={id}
      initial={loaded.data?.form ?? BLANK(companyParam)}
      initialCompany={initialCompany.data ?? null}
      inside={loaded.data?.inside ?? true}
      reference={reference.data}
    />
  );
}

function OfficeFormView({ id, initial, initialCompany, inside, reference }: { id: string | null; initial: OfficeForm; initialCompany: PickedCompany | null; inside: boolean; reference: Reference }) {
  const { supabase, can } = useAdmin();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<OfficeForm>(initial);
  const [company, setCompany] = useState<PickedCompany | null>(initialCompany);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);

  const set = <K extends keyof OfficeForm>(key: K, value: OfficeForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const cityId = Number(form.city_id) || 0;
  const hoods = reference.neighbourhoods.filter((n) => n.city_id === cityId);
  const parks = reference.techParks.filter((t) => t.city_id === cityId);
  const canPublish = can("reviewer");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setNeedsReview(false);
    const checked = checkOfficeForm({ ...form, company_id: company?.id ?? "" });
    if (!checked.ok) {
      setErrors(checked.errors);
      setMessage({ kind: "error", text: "Some fields need attention." });
      return;
    }
    setErrors({});
    setBusy(true);
    const payload = { ...checked.value, ...(checked.value.verification === "reviewed" && initial.verification !== "reviewed" ? { last_verified_at: new Date().toISOString() } : {}) };
    const result = id ? await supabase.from("office").update(payload).eq("id", id).select("id").maybeSingle() : await supabase.from("office").insert(payload).select("id").single();
    setBusy(false);
    if (result.error) {
      // The city-boundary rule: a published office outside the city needs a reviewer's say-so (outside_reviewed).
      if (/outside the boundary/i.test(result.error.message)) setNeedsReview(true);
      setMessage({ kind: "error", text: describeError(result.error) });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["admin"] });
    if (!id && result.data) router.replace(`/admin/offices/edit?id=${(result.data as { id: string }).id}`);
    else setMessage({ kind: "success", text: "Saved." });
  }

  async function remove() {
    if (!id || !window.confirm("Delete this office? This cannot be undone.")) return;
    setBusy(true);
    const { error, count } = await supabase.from("office").delete({ count: "exact" }).eq("id", id);
    setBusy(false);
    if (error || !count) {
      setMessage({ kind: "error", text: error ? describeError(error) : "Your role may not delete this office (only an admin deletes a published one)." });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["admin"] });
    router.replace("/admin/offices");
  }

  return (
    <>
      <PageHeader title={id ? "Edit office" : "New office"}>
        <Link href="/admin/offices">All offices</Link>
      </PageHeader>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      {id && !inside && !initial.outside_reviewed && <Notice kind="error">This point is outside the city boundary. It cannot be published until a reviewer accepts it.</Notice>}

      <form onSubmit={save} className="grid max-w-3xl gap-4" noValidate data-testid="office-form">
        <Field label="Company" error={errors.company_id}>
          {(p) => <CompanyPicker id={p.id} picked={company} onPick={setCompany} invalid={!!errors.company_id} describedBy={p["aria-describedby"]} />}
        </Field>
        <Field label="City" error={errors.city_id}>
          {(p) => (
            <Select {...p} value={String(form.city_id)} onChange={(e) => setForm((f) => ({ ...f, city_id: e.target.value, neighbourhood_id: "", tech_park_id: "" }))}>
              <option value="">Choose a city</option>
              {reference.cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Neighbourhood" error={errors.neighbourhood_id}>
          {(p) => (
            <Select {...p} value={String(form.neighbourhood_id ?? "")} disabled={!cityId} onChange={(e) => set("neighbourhood_id", e.target.value)}>
              <option value="">None</option>
              {hoods.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Tech park" error={errors.tech_park_id}>
          {(p) => (
            <Select {...p} value={String(form.tech_park_id ?? "")} disabled={!cityId} onChange={(e) => set("tech_park_id", e.target.value)}>
              <option value="">None</option>
              {parks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Address" error={errors.address}>{(p) => <TextInput {...p} value={form.address} onChange={(e) => set("address", e.target.value)} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Latitude" error={errors.lat} hint="For example 12.9716">
            {(p) => <TextInput {...p} inputMode="decimal" value={String(form.lat)} onChange={(e) => set("lat", e.target.value)} />}
          </Field>
          <Field label="Longitude" error={errors.lng} hint="For example 77.5946">
            {(p) => <TextInput {...p} inputMode="decimal" value={String(form.lng)} onChange={(e) => set("lng", e.target.value)} />}
          </Field>
        </div>
        <Field label="Location accuracy" error={errors.accuracy} hint="How exact the point is. Street and locality go to the review queue.">
          {(p) => (
            <Select {...p} value={form.accuracy} onChange={(e) => set("accuracy", e.target.value as OfficeForm["accuracy"])}>
              {ACCURACIES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Verification" error={errors.verification}>
          {(p) => (
            <Select {...p} value={form.verification} onChange={(e) => set("verification", e.target.value as OfficeForm["verification"])}>
              {VERIFICATIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <CheckRow
          label="A reviewer has looked at this point and accepts it even though it is outside the city boundary"
          checked={form.outside_reviewed}
          disabled={!canPublish}
          onChange={(e) => set("outside_reviewed", e.target.checked)}
          data-testid="outside-reviewed"
        />
        {needsReview && <p className="text-sm">{canPublish ? "Tick the box above to accept it, or correct the coordinates." : "Ask a reviewer to accept it, or correct the coordinates."}</p>}
        <Field label="Status" error={errors.status} hint={canPublish ? undefined : "Publishing needs a reviewer or an admin."}>
          {(p) => (
            <Select {...p} value={form.status} onChange={(e) => set("status", e.target.value as OfficeForm["status"])}>
              <option value="draft">Draft</option>
              <option value="published" disabled={!canPublish && initial.status !== "published"}>Published</option>
              <option value="unpublished" disabled={!canPublish && initial.status !== "unpublished"}>Unpublished</option>
            </Select>
          )}
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={busy} data-testid="save-office">
            {busy ? "Saving…" : "Save"}
          </Button>
          {id && (
            <Button type="button" variant="destructive" disabled={busy} onClick={remove} data-testid="delete-office">
              Delete office
            </Button>
          )}
        </div>
      </form>
    </>
  );
}

export default function EditOfficePage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Editor />
    </Suspense>
  );
}
