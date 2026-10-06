"use client";
// Employer feeds (ADR-0022 §7): which feeds the pipeline may read, who approved each and why, the changes held for a
// person to decide, and the full history of what each feed did. Reviewers approve, withdraw, apply, and reject; editors
// see everything but cannot act. The database decides every permission (approve_job_feed, withdraw_job_feed,
// resolve_feed_event); this page only shows the result.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useAdmin } from "@/components/admin/admin-root";
import type { AnyError } from "@/components/admin/use-reference";
import { DataTable, Notice, PageHeader, TextInput } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/admin/errors";
import { formatDate } from "@/lib/format-date";

type Feed = {
  id: number;
  provider: string;
  identifier: string;
  active: boolean;
  approved_by: string | null;
  approved_at: string | null;
  approval_note: string | null;
  withdrawn_note: string | null;
  company: { id: string; name: string; domain: string } | null;
};
type FeedEvent = {
  id: number;
  feed_id: number;
  job_id: string | null;
  at: string;
  kind: "inserted" | "changed" | "held_domain_change" | "held_ambiguous" | "suspect_missing" | "closed_missing";
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  external_ref: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  decision: "applied" | "rejected" | null;
  decision_note: string | null;
  job: { title: string; status: string; company: { name: string } | null } | null;
};

const EVENT_TEXT: Record<FeedEvent["kind"], string> = {
  inserted: "Job added from the feed",
  changed: "Field changed by the feed",
  held_domain_change: "Held: the application link moved to another domain",
  held_ambiguous: "Held: the feed lists this reference more than once",
  suspect_missing: "Missing from the feed once: marked suspect",
  closed_missing: "Missing from the feed twice: closed",
};

const when = (iso: string | null) => (iso ? formatDate(Date.parse(iso)) : "");

export default function FeedsPage() {
  const { supabase, can, userId } = useAdmin();
  const queryClient = useQueryClient();
  const reviewer = can("reviewer");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const who = (id: string | null) => (!id ? "" : id === userId ? "you" : `reviewer ${id.slice(0, 8)}`);

  const feeds = useQuery({
    queryKey: ["admin", "feeds"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_feed")
        .select("id, provider, identifier, active, approved_by, approved_at, approval_note, withdrawn_note, company:company_id(id, name, domain)")
        .order("id");
      if (error) throw error;
      return (data ?? []) as unknown as Feed[];
    },
  });
  const events = useQuery({
    queryKey: ["admin", "feed-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("feed_event")
        .select("id, feed_id, job_id, at, kind, field, old_value, new_value, external_ref, resolved_at, resolved_by, decision, decision_note, job:job_id(title, status, company:company_id(name))")
        .order("at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as FeedEvent[];
    },
  });

  async function act(key: string, call: () => PromiseLike<{ error: AnyError | null }>, done: string) {
    const note = (notes[key] ?? "").trim();
    if (!note) {
      setMessage({ kind: "error", text: "Write a note saying why: it is kept with the decision." });
      return;
    }
    setBusy(key);
    setMessage(null);
    const { error } = await call();
    setBusy(null);
    if (error) {
      setMessage({ kind: "error", text: describeError(error) });
      return;
    }
    setNotes((n) => ({ ...n, [key]: "" }));
    setMessage({ kind: "success", text: done });
    await queryClient.invalidateQueries({ queryKey: ["admin"] });
  }

  const held = (events.data ?? []).filter((e) => e.kind.startsWith("held_") && !e.resolved_at);
  const noteBox = (key: string, label: string) => (
    <TextInput
      aria-label={label}
      placeholder="Why (kept with the decision)"
      value={notes[key] ?? ""}
      onChange={(e) => setNotes((n) => ({ ...n, [key]: e.target.value }))}
      disabled={!reviewer}
      data-testid={`note-${key}`}
    />
  );

  return (
    <>
      <PageHeader title="Employer feeds" />
      <p className="mb-4 max-w-[72ch] text-sm text-muted-foreground">
        The pipeline publishes jobs only from feeds a reviewer approved as the employer&apos;s official feed or an authorised source. Links on another
        employer&apos;s board are refused; a link that moves to another domain, or a reference the feed repeats, waits here for a decision. A feed that cannot be
        read never closes a job.
        {!reviewer && " Approving, withdrawing, and resolving need a reviewer or an admin."}
      </p>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      {(feeds.isError || events.isError) && <Notice kind="error">{describeError((feeds.error ?? events.error) as AnyError)}</Notice>}

      <section aria-labelledby="held" className="mb-8">
        <h2 id="held" className="text-xl font-bold">
          Changes waiting for a decision
        </h2>
        {held.length === 0 ? (
          <p className="text-sm" data-testid="no-held">
            {events.isPending ? "Loading…" : "Nothing is waiting."}
          </p>
        ) : (
          <DataTable label="Changes waiting for a decision">
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col">What the feed wants</th>
                <th scope="col">Now</th>
                <th scope="col">Proposed</th>
                <th scope="col">Seen</th>
                <th scope="col">Decision</th>
              </tr>
            </thead>
            <tbody data-testid="held-rows">
              {held.map((e) => {
                const key = `event-${e.id}`;
                return (
                  <tr key={e.id} data-event={e.id}>
                    <td>
                      {e.job_id ? <Link href={`/admin/jobs/edit?id=${e.job_id}`}>{e.job?.title ?? e.external_ref}</Link> : e.external_ref}
                      <div className="text-sm text-muted-foreground">{e.job?.company?.name}</div>
                    </td>
                    <td>{EVENT_TEXT[e.kind]}</td>
                    <td className="max-w-[22ch] break-all text-sm">{e.old_value}</td>
                    <td className="max-w-[22ch] break-all text-sm">{e.new_value}</td>
                    <td className="tabular-nums">{when(e.at)}</td>
                    <td className="min-w-[16rem]">
                      {noteBox(key, `Note for the decision on ${e.job?.title ?? e.external_ref}`)}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {e.kind === "held_domain_change" && (
                          <Button
                            type="button"
                            disabled={!reviewer || busy === key}
                            onClick={() => act(key, () => supabase.rpc("resolve_feed_event", { p_event: e.id, p_decision: "apply", p_note: notes[key] ?? "" }), "Applied: the new link is recorded as reviewed evidence and published.")}
                            data-testid="apply-held"
                          >
                            Apply the new link
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!reviewer || busy === key}
                          onClick={() => act(key, () => supabase.rpc("resolve_feed_event", { p_event: e.id, p_decision: "reject", p_note: notes[key] ?? "" }), "Rejected: the job stays as it is.")}
                          data-testid="reject-held"
                        >
                          Keep the job as it is
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </section>

      <section aria-labelledby="feeds" className="mb-8">
        <h2 id="feeds" className="text-xl font-bold">
          Feeds
        </h2>
        <DataTable label="Feeds">
          <thead>
            <tr>
              <th scope="col">Company</th>
              <th scope="col">Feed</th>
              <th scope="col">Approval</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody data-testid="feed-rows">
            {(feeds.data ?? []).map((f) => {
              const key = `feed-${f.id}`;
              return (
                <tr key={f.id} data-feed={f.id} data-approved={f.approved_at ? "true" : "false"}>
                  <td>
                    {f.company ? <Link href={`/admin/companies/edit?id=${f.company.id}`}>{f.company.name}</Link> : ""}
                    <div className="text-sm text-muted-foreground">{f.company?.domain}</div>
                  </td>
                  <td>
                    {f.provider}: {f.identifier}
                    {!f.active && <div className="text-sm text-muted-foreground">Inactive</div>}
                  </td>
                  <td className="max-w-[28ch] text-sm">
                    {f.approved_at ? (
                      <>
                        Approved {when(f.approved_at)} by {who(f.approved_by)}: {f.approval_note}
                      </>
                    ) : (
                      <>Not approved: the pipeline does not read it.{f.withdrawn_note ? ` Withdrawn: ${f.withdrawn_note}` : ""}</>
                    )}
                  </td>
                  <td className="min-w-[16rem]">
                    {noteBox(key, `Note for the feed ${f.provider} ${f.identifier}`)}
                    <div className="mt-2">
                      {f.approved_at ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!reviewer || busy === key}
                          onClick={() => act(key, () => supabase.rpc("withdraw_job_feed", { p_feed: f.id, p_note: notes[key] ?? "" }), "Approval withdrawn: the pipeline stops reading this feed.")}
                          data-testid="withdraw-feed"
                        >
                          Withdraw approval
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          disabled={!reviewer || busy === key}
                          onClick={() => act(key, () => supabase.rpc("approve_job_feed", { p_feed: f.id, p_note: notes[key] ?? "" }), "Approved: the pipeline reads this feed from its next run.")}
                          data-testid="approve-feed"
                        >
                          Approve as the official feed
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      </section>

      <section aria-labelledby="history">
        <h2 id="history" className="text-xl font-bold">
          Change history
        </h2>
        <p className="mb-2 text-sm text-muted-foreground">The latest 200 events from every feed. Feed jobs also carry their evidence on each job&apos;s page.</p>
        <DataTable label="Change history">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Job</th>
              <th scope="col">Event</th>
              <th scope="col">Change</th>
              <th scope="col">Decision</th>
            </tr>
          </thead>
          <tbody data-testid="history-rows">
            {(events.data ?? []).map((e) => (
              <tr key={e.id}>
                <td className="tabular-nums">{when(e.at)}</td>
                <td>{e.job?.title ?? e.external_ref}</td>
                <td>{EVENT_TEXT[e.kind]}</td>
                <td className="max-w-[30ch] break-all text-sm">{e.field ? `${e.field}: ${e.old_value ?? "(none)"} → ${e.new_value ?? "(none)"}` : ""}</td>
                <td className="text-sm">{e.decision ? `${e.decision === "applied" ? "Applied" : "Rejected"} ${when(e.resolved_at)} by ${who(e.resolved_by)}: ${e.decision_note}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </section>
    </>
  );
}
