"use client";
// A company's logo: upload with provenance, and a reviewer's decision (migration 20261007110000_logo_assets.sql). The file
// goes to the public company-logos bucket under <company id>/<sha-256>.<ext>; its record says where it came from and on what
// basis we may use it. Approving makes it the logo. The database checks all of this; the panel only collects and shows it.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAdmin } from "@/components/admin/admin-root";
import { CheckRow, DataTable, Field, Notice, Select, TextArea, TextInput } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/admin/errors";
import { logoUrl } from "@/lib/data/logo";
import { formatDate } from "@/lib/format-date";

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
const MAX_BYTES = 1_048_576;

export const PERMITTED_USE: Record<string, string> = {
  company_brand_assets: "The company's brand or press kit offers it",
  written_permission: "Written permission from the company",
  licensed_provider: "A licensed logo provider",
};

type Asset = {
  id: number;
  storage_key: string;
  source_url: string;
  permitted_use: string;
  permission_url: string;
  permission_note: string;
  obtained_on: string;
  terms_quote: string | null;
  uploaded_at: string;
  decision: "approved" | "rejected" | null;
  decision_note: string | null;
  self_reviewed: boolean | null;
};

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const https = (s: string) => /^https:\/\/\S+$/.test(s.trim());
const today = () => new Date().toISOString().slice(0, 10);

export function LogoPanel({ companyId }: { companyId: string }) {
  const { supabase, can } = useAdmin();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [use, setUse] = useState("");
  const [permissionUrl, setPermissionUrl] = useState("");
  const [note, setNote] = useState("");
  const [obtainedOn, setObtainedOn] = useState("");
  const [termsQuote, setTermsQuote] = useState("");
  const [allows, setAllows] = useState({ storage: false, display: false, atlas: false });
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const assets = useQuery({
    queryKey: ["admin", "logos", companyId],
    queryFn: async () => {
      const { data, error } = await supabase.from("logo_asset").select("*").eq("company_id", companyId).order("id", { ascending: false });
      if (error) throw new Error(describeError(error));
      return data as Asset[];
    },
  });
  const company = useQuery({
    queryKey: ["admin", "logos", companyId, "current"],
    queryFn: async () => {
      const { data, error } = await supabase.from("company").select("logo_key").eq("id", companyId).maybeSingle();
      if (error) throw new Error(describeError(error));
      return (data?.logo_key as string | null | undefined) ?? null;
    },
  });
  const currentKey = company.data ?? null;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["admin", "logos", companyId] });

  const upload = async () => {
    setMessage(null);
    const problem = !file
      ? "Choose the logo file."
      : !TYPES[file.type]
        ? "The logo must be a PNG, JPEG, WebP, GIF, or AVIF image. SVG is not accepted."
        : file.size > MAX_BYTES
          ? "The logo must be at most 1 MB."
          : !https(sourceUrl)
            ? "Give the https address the file came from."
            : !use
              ? "Say on what basis we may use it."
              : !https(permissionUrl)
                ? "Give the https address of the page that shows that basis."
                : note.trim().length < 10
                  ? "Write a note of at least ten characters: who allows it, and on what terms."
                  : !obtainedOn || obtainedOn > today()
                    ? "Give the date the file was obtained (not in the future)."
                    : termsQuote.trim().length < 20
                      ? "Quote the wording in the brand guidelines, permission, or licence that allows this use (at least 20 characters). Being the official logo is not permission by itself."
                      : !(allows.storage && allows.display && allows.atlas)
                        ? "The terms must allow all three uses: storing the file, showing it on the site, and resizing it for the map. If they do not, do not upload it."
                        : null;
    if (problem) return setMessage({ kind: "error", text: problem });
    setBusy(true);
    try {
      const key = `${companyId}/${await sha256Hex(file!)}.${TYPES[file!.type]}`;
      // Uploads wait in the private bucket until a reviewer approves them (migration 20261007130000).
      const stored = await supabase.storage.from("company-logos-pending").upload(key, file!, { contentType: file!.type, upsert: false, cacheControl: "31536000" });
      // The same file uploaded again already has its key: record it anyway.
      if (stored.error && !/exists|duplicate/i.test(stored.error.message)) throw new Error(`The file could not be uploaded: ${stored.error.message}`);
      const { error } = await supabase.from("logo_asset").insert({
        company_id: companyId,
        storage_key: key,
        content_type: file!.type,
        bytes: file!.size,
        source_url: sourceUrl.trim(),
        permitted_use: use,
        permission_url: permissionUrl.trim(),
        permission_note: note.trim(),
        obtained_on: obtainedOn,
        terms_quote: termsQuote.trim(),
        allows_storage: allows.storage,
        allows_display: allows.display,
        allows_atlas: allows.atlas,
      });
      if (error) throw new Error(describeError(error));
      setMessage({ kind: "success", text: "Uploaded. A reviewer approves it before it becomes the logo." });
      setFile(null);
      setNote("");
      setTermsQuote("");
      setAllows({ storage: false, display: false, atlas: false });
      refresh();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "The logo could not be uploaded." });
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id: number, decision: "approved" | "rejected") => {
    setMessage(null);
    const why = (notes[id] ?? "").trim();
    if (!why) return setMessage({ kind: "error", text: "Write a note saying why." });
    if (decision === "approved") {
      // The public copy first: review_logo approves only a file that is already in the public bucket.
      const key = assets.data?.find((x) => x.id === id)?.storage_key;
      if (!key) return setMessage({ kind: "error", text: "That upload is no longer listed. Reload the page." });
      const copied = await supabase.storage.from("company-logos-pending").copy(key, key, { destinationBucket: "company-logos" });
      if (copied.error && !/exists|duplicate/i.test(copied.error.message)) return setMessage({ kind: "error", text: `The file could not be published: ${copied.error.message}` });
    }
    const { error } = await supabase.rpc("review_logo", { p_id: id, p_decision: decision, p_note: why });
    if (error) return setMessage({ kind: "error", text: describeError(error) });
    setMessage({ kind: "success", text: decision === "approved" ? "Approved: it is now the logo." : "Rejected." });
    refresh();
  };

  const current = logoUrl(currentKey);
  return (
    <section className="mt-10" aria-labelledby="logo-heading" data-testid="logo-panel">
      <h2 id="logo-heading" className="text-xl font-bold">
        Logo
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Only this company&apos;s current logo, and only when we may use it. Every upload records where it came from and why it is allowed, and a
        reviewer approves it.
      </p>
      <p className="mt-2" data-testid="current-logo">
        {currentKey ? (
          <>
            Current logo: {current ? <a href={current} target="_blank" rel="noopener noreferrer">{currentKey}</a> : currentKey}
          </>
        ) : (
          "No logo: the site shows the first letter of the name."
        )}
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Logo file" hint="PNG, JPEG, WebP, GIF, or AVIF; at most 1 MB.">
          {(p) => <TextInput {...p} type="file" accept={Object.keys(TYPES).join(",")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="logo-file" />}
        </Field>
        <Field label="Where the file came from (https)">
          {(p) => <TextInput {...p} type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} data-testid="logo-source" />}
        </Field>
        <Field label="Why we may use it">
          {(p) => (
            <Select {...p} value={use} onChange={(e) => setUse(e.target.value)} data-testid="logo-use">
              <option value="">Choose…</option>
              {Object.entries(PERMITTED_USE).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Brand guidelines, permission, or licence page (https)">
          {(p) => <TextInput {...p} type="url" value={permissionUrl} onChange={(e) => setPermissionUrl(e.target.value)} data-testid="logo-permission-url" />}
        </Field>
        <Field label="Note: who allows it, and on what terms">
          {(p) => <TextArea {...p} value={note} onChange={(e) => setNote(e.target.value)} data-testid="logo-note" />}
        </Field>
        <Field label="Date obtained">
          {(p) => <TextInput {...p} type="date" max={today()} value={obtainedOn} onChange={(e) => setObtainedOn(e.target.value)} data-testid="logo-obtained" />}
        </Field>
        <Field label="The wording that allows this use" hint="Quote it exactly from that page or the permission.">
          {(p) => <TextArea {...p} value={termsQuote} onChange={(e) => setTermsQuote(e.target.value)} data-testid="logo-terms" />}
        </Field>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-semibold">The terms allow us to</legend>
          <CheckRow label="Store the file in our storage" checked={allows.storage} onChange={(e) => setAllows({ ...allows, storage: e.target.checked })} data-testid="logo-allows-storage" />
          <CheckRow label="Show it on the site" checked={allows.display} onChange={(e) => setAllows({ ...allows, display: e.target.checked })} data-testid="logo-allows-display" />
          <CheckRow label="Resize it for the map's logo atlas" checked={allows.atlas} onChange={(e) => setAllows({ ...allows, atlas: e.target.checked })} data-testid="logo-allows-atlas" />
        </fieldset>
      </div>
      <Button className="mt-4" onClick={() => void upload()} disabled={busy || !can("editor")} data-testid="upload-logo">
        {busy ? "Uploading…" : "Upload logo"}
      </Button>
      {message && (
        <div className="mt-3">
          <Notice kind={message.kind}>{message.text}</Notice>
        </div>
      )}

      {assets.error && <Notice kind="error">{(assets.error as Error).message}</Notice>}
      {assets.data && assets.data.length > 0 && (
        <div className="mt-6">
          <DataTable label="Logo uploads">
            <thead>
              <tr>
                <th>Uploaded</th>
                <th>Source and basis</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody data-testid="logo-rows">
              {assets.data.map((a) => (
                <tr key={a.id} data-logo={a.id} data-decision={a.decision ?? "pending"}>
                  <td>
                    {formatDate(Date.parse(a.uploaded_at))}
                    <br />
                    obtained {formatDate(Date.parse(a.obtained_on))}
                  </td>
                  <td>
                    <a href={a.source_url} target="_blank" rel="noopener noreferrer">
                      File source
                    </a>{" "}
                    ·{" "}
                    <a href={a.permission_url} target="_blank" rel="noopener noreferrer">
                      {PERMITTED_USE[a.permitted_use] ?? a.permitted_use}
                    </a>
                    <br />
                    {a.permission_note}
                    {a.terms_quote && <q className="mt-1 block italic">{a.terms_quote}</q>}
                  </td>
                  <td>
                    {a.decision ? (
                      <>
                        {a.decision === "approved" ? "Approved" : "Rejected"}
                        {a.self_reviewed ? " (self-reviewed)" : ""}: {a.decision_note}
                      </>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <TextInput
                          aria-label="Reason for the decision"
                          value={notes[a.id] ?? ""}
                          onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })}
                          disabled={!can("reviewer")}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => void decide(a.id, "approved")} disabled={!can("reviewer")} data-testid="approve-logo">
                            Approve
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => void decide(a.id, "rejected")} disabled={!can("reviewer")} data-testid="reject-logo">
                            Reject
                          </Button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      )}
    </section>
  );
}
