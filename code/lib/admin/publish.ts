// "Publish now" from the admin (P7-02): calls the `request-rebuild` Edge Function and turns its answer into one plain
// sentence for the admin. The function and `publish_now` do the work and the role check; this only reads the result.
import type { SupabaseClient } from "@supabase/supabase-js";

export type PublishAnswer = {
  ok?: boolean;
  rebuild_requested?: boolean;
  retry_after_seconds?: number;
  versions?: Record<string, number>;
  error?: string;
};

export type PublishMessage = { kind: "success" | "info" | "error"; text: string };

const minutes = (seconds: number) => {
  const m = Math.ceil(seconds / 60);
  return m <= 1 ? "a minute" : `${m} minutes`;
};

export function describePublish(answer: PublishAnswer | null, httpStatus: number): PublishMessage {
  if (!answer) return { kind: "error", text: httpStatus === 401 ? "Your session has ended. Sign in again." : "The publish request got no answer. Try again." };
  if (answer.ok && answer.rebuild_requested) {
    return { kind: "success", text: "Published. The site is rebuilding and the new data will be live in a few minutes." };
  }
  if (answer.ok && !answer.rebuild_requested) {
    const wait = answer.retry_after_seconds ?? 0;
    return {
      kind: "info",
      text: `The changes are saved. A rebuild was already started in the last ten minutes, so they will go live with the next build (the nightly one, or press Publish now again in ${minutes(wait)}).`,
    };
  }
  if (httpStatus === 403) return { kind: "error", text: answer.error ?? "Publishing needs a reviewer or an admin." };
  return { kind: "error", text: answer.error ?? "Publishing failed." };
}

/** Calls the function with the signed-in session (supabase-js adds the Authorization header) and reads its answer. */
export async function requestRebuild(supabase: SupabaseClient): Promise<PublishMessage> {
  const { data, error } = await supabase.functions.invoke<PublishAnswer>("request-rebuild", { method: "POST" });
  if (!error) return describePublish(data ?? null, 200);
  // A non-2xx answer arrives as an error whose `context` is the Response, which still carries our JSON body.
  const response = (error as { context?: Response }).context;
  if (response && typeof response.json === "function") {
    const body = (await response.json().catch(() => null)) as PublishAnswer | null;
    return describePublish(body, response.status);
  }
  return { kind: "error", text: "The server could not be reached. Try again." };
}
