// The click beacon (P6-03): tells the `click` Edge Function that a visitor followed an Apply or Visit website link.
// The link itself is a plain anchor to the employer, so it works whether or not this runs, and a blocked or failed
// beacon changes nothing for the visitor. It sends a kind and an id: no cookie, no address, no user identifier.
export type ClickKind = "apply" | "website";

const placeholder = (value: string | undefined) => !value || value.startsWith("replace-");

/** The URL of the `click` function, or null when this build has no Supabase project (a build without one counts nothing). */
export function clickEndpoint(supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  if (placeholder(supabaseUrl)) return null;
  return `${supabaseUrl!.replace(/\/+$/, "")}/functions/v1/click`;
}

/**
 * Sends one beacon. The body goes as text/plain, a CORS "simple" type, so the browser sends it without a preflight
 * (sendBeacon with a JSON content type would need one). Returns whether the browser accepted it for sending.
 */
export function sendClick(kind: ClickKind, id: string, nav: Pick<Navigator, "sendBeacon"> | undefined = typeof navigator === "undefined" ? undefined : navigator, endpoint: string | null = clickEndpoint()): boolean {
  if (!endpoint || !nav || typeof nav.sendBeacon !== "function") return false;
  try {
    return nav.sendBeacon(endpoint, new Blob([JSON.stringify({ kind, id })], { type: "text/plain;charset=UTF-8" }));
  } catch {
    return false;
  }
}
