// What the database said, in words an admin can act on. PostgREST errors carry a Postgres SQLSTATE in `code`; the
// messages our own triggers and functions raise are already written for people, so they are passed through.

export type DbError = { code?: string | null; message?: string | null; details?: string | null; hint?: string | null };

/** SQLSTATEs that mean "you may not": a role check, row-level security, or a missing grant. */
const DENIED = new Set(["42501"]);

export function describeError(error: DbError | null | undefined): string {
  if (!error) return "";
  const message = (error.message ?? "").trim();
  const code = error.code ?? "";
  if (DENIED.has(code) || /row-level security|permission denied/i.test(message)) {
    // Our triggers raise 42501 with their own words ("only a reviewer or admin can ..."): keep those.
    if (/^(only|publishing|importing)/i.test(message)) return capitalise(message) + ".";
    return "Your role does not allow this. Ask a reviewer or an admin.";
  }
  if (code === "23505") {
    // The column comes from the detail ("Key (domain)=(x) already exists") or, when a function raised it, from the
    // constraint's name in the message ("company_domain_key").
    const field = /Key \((\w+)\)/.exec(error.details ?? "")?.[1] ?? /constraint "[a-z]+_([a-z_]+)_key"/.exec(message)?.[1];
    return field ? `Another record already uses that ${field.replace(/_/g, " ")}.` : "Another record already has that value.";
  }
  if (code === "23503") return "That record is still used by another one, or points at one that does not exist.";
  if (code === "23514" || code === "23502" || code === "22023" || code === "P0001") return capitalise(message) + (message.endsWith(".") ? "" : ".");
  if (code === "22P02") return "One of the values is not in the right form.";
  if (/Failed to fetch|NetworkError|network/i.test(message)) return "The server could not be reached. Check the connection and try again.";
  if (/JWT expired|invalid.*token/i.test(message)) return "Your session has ended. Sign in again.";
  return message ? capitalise(message) + (message.endsWith(".") ? "" : ".") : "Something went wrong.";
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
