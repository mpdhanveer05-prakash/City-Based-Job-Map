// The browser's Supabase client, for the admin pages only (P7-01). The public site never creates one: it reads static
// files, and its only call to Supabase is the click beacon. It uses the public anon key; what a visitor or an admin may
// do is decided by row-level security and the role checks in the database, not by anything in this file
// (docs/security.md: the admin JavaScript is public).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const placeholder = (value: string | undefined) => !value || value.trim() === "" || value.startsWith("replace-");

export const supabaseUrl = (): string | null => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return placeholder(url) ? null : url!.trim().replace(/\/+$/, "");
};

/** True when this build was given a Supabase project to talk to. */
export const supabaseConfigured = (): boolean => supabaseUrl() !== null && !placeholder(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

let client: SupabaseClient | undefined;

/** The one client for this page, or null when the build has no Supabase project (the admin then says so). */
export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured()) return null;
  client ??= createClient(supabaseUrl()!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(), {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}
