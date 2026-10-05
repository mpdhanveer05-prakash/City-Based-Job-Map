"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { feedbackAvailable, submitFeedback, turnstileSiteKey, type FeedbackPayload } from "@/lib/feedback";
import { Turnstile } from "./turnstile";

type Target = { type: "company" | "job"; options: Array<{ id: string; label: string }>; legend: string };

type Props =
  | { mode: "report"; target: Target; title: string }
  | { mode: "suggestion"; title: string };

const control = "min-h-11 w-full rounded-md border border-field bg-milky px-3 py-2 text-base text-foreground";

/**
 * A report ("this job is gone", "this company's page is wrong") or a suggestion ("add this company"). Nothing is
 * published: a person reads each one. No name, email, or address is asked for. The send is held until the Turnstile check
 * has given a token, and the token is used up by the send.
 */
export function FeedbackForm(props: Props) {
  const siteKey = turnstileSiteKey();
  const [message, setMessage] = useState("");
  const [targetId, setTargetId] = useState(props.mode === "report" ? (props.target.options[0]?.id ?? "") : "");
  const [companyName, setCompanyName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  if (!feedbackAvailable() || !siteKey) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="feedback-unavailable">
        Reports and suggestions are not available in this version of the site.
      </p>
    );
  }

  if (receipt) {
    return (
      <p role="status" data-testid="feedback-receipt" className="rounded-md border border-rule bg-milky-shade px-3 py-2">
        Thank you. We received it (reference {receipt.slice(0, 8)}). A person reads every one, and nothing is published without a check.
      </p>
    );
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!token) {
      setError({ text: "Wait for the check that you are a person to finish, then send again." });
      return;
    }
    const payload: FeedbackPayload =
      props.mode === "report"
        ? { kind: "report", target_type: props.target.type, target_id: targetId, message }
        : { kind: "suggestion", target_type: "other", company_name: companyName, source_url: sourceUrl, message };
    setBusy(true);
    const outcome = await submitFeedback(payload, token);
    setBusy(false);
    // The token is single-use whatever happened: ask for a fresh check.
    setToken(null);
    setRound((n) => n + 1);
    if (outcome.ok) setReceipt(outcome.id);
    else setError({ text: outcome.message, field: outcome.field });
  }

  const invalid = (field: string) => (error?.field === field ? true : undefined);

  return (
    <form onSubmit={send} className="grid max-w-xl gap-4" noValidate data-testid={`feedback-form-${props.mode}`}>
      {props.mode === "report" && props.target.type === "job" && (
        <div className="flex flex-col gap-1">
          <label htmlFor="feedback-target" className="text-sm font-semibold">
            {props.target.legend}
          </label>
          <select id="feedback-target" className={control} value={targetId} onChange={(e) => setTargetId(e.target.value)} data-testid="feedback-target">
            {props.target.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {props.mode === "suggestion" && (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor="feedback-company" className="text-sm font-semibold">
              Company name
            </label>
            <input id="feedback-company" className={control} value={companyName} maxLength={200} aria-invalid={invalid("company_name")} onChange={(e) => setCompanyName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="feedback-source" className="text-sm font-semibold">
              A page that shows the company exists
            </label>
            <input id="feedback-source" className={control} type="url" inputMode="url" value={sourceUrl} maxLength={1000} aria-invalid={invalid("source_url")} onChange={(e) => setSourceUrl(e.target.value)} />
            <p className="text-sm text-muted-foreground">Its own website, a press page, or a registry entry. It must start with https://</p>
          </div>
        </>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor="feedback-message" className="text-sm font-semibold">
          {props.mode === "report" ? "What is wrong?" : "What should we know?"}
        </label>
        <textarea id="feedback-message" className={`${control} min-h-28`} value={message} maxLength={1000} aria-invalid={invalid("message")} onChange={(e) => setMessage(e.target.value)} data-testid="feedback-message" />
        <p className="text-sm text-muted-foreground">Do not include your name or contact details: we do not need them.</p>
      </div>
      <Turnstile siteKey={siteKey} resetKey={round} onToken={setToken} />
      {error && (
        <p role="alert" data-testid="feedback-error" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {error.text}
        </p>
      )}
      <div>
        <Button type="submit" variant="outline" disabled={busy} data-testid="feedback-send">
          {busy ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}
