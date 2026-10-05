"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { getSupabase } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { Field, Notice, TextInput } from "./ui";

export type Role = "editor" | "reviewer" | "admin";
const RANK: Record<Role, number> = { editor: 1, reviewer: 2, admin: 3 };

export type AdminContextValue = {
  supabase: SupabaseClient;
  role: Role;
  email: string;
  userId: string;
  /** True when the signed-in admin holds `min` or a higher role. The database checks it again on every write. */
  can(min: Role): boolean;
};

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) throw new Error("useAdmin must be used inside AdminRoot");
  return value;
}

type Session =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "forbidden"; email: string }
  | { status: "ready"; email: string; userId: string; role: Role };

const NAV: Array<{ href: string; label: string; min: Role }> = [
  { href: "/admin", label: "Dashboard", min: "editor" },
  { href: "/admin/companies", label: "Companies", min: "editor" },
  { href: "/admin/offices", label: "Offices", min: "editor" },
  { href: "/admin/jobs", label: "Jobs", min: "editor" },
  { href: "/admin/import", label: "Import", min: "editor" },
  { href: "/admin/review", label: "Review", min: "editor" },
  { href: "/admin/audit", label: "Audit log", min: "reviewer" },
  { href: "/admin/sources", label: "Sources", min: "admin" },
];

/**
 * The admin workspace's gate and frame (P7-01). Everything under /admin is client-rendered and its JavaScript is public,
 * so this decides only what to *show*: it signs in with Supabase Auth, reads the signed-in user's own `admin_user` row
 * for the role, and shows the pages if there is one. Every read and write is checked again by row-level security and
 * the role checks in the database (docs/security.md), so hiding a page here protects nothing by itself.
 */
export function AdminRoot({ children }: { children: React.ReactNode }) {
  const supabase = getSupabase();
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } } }));
  const [session, setSession] = useState<Session>({ status: "loading" });

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    const { data } = supabase.auth.onAuthStateChange((_event, authSession) => {
      if (!authSession) {
        setSession({ status: "signed-out" });
        return;
      }
      const { id, email } = authSession.user;
      // Not inside the callback itself: supabase-js asks not to await its own calls there.
      setTimeout(() => {
        supabase
          .from("admin_user")
          .select("role")
          .eq("user_id", id)
          .maybeSingle()
          .then(({ data: row }) => {
            if (cancelled) return;
            const role = row?.role as Role | undefined;
            setSession(role && role in RANK ? { status: "ready", email: email ?? "", userId: id, role } : { status: "forbidden", email: email ?? "" });
          });
      }, 0);
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  const value = useMemo<AdminContextValue | null>(
    () =>
      supabase && session.status === "ready"
        ? { supabase, role: session.role, email: session.email, userId: session.userId, can: (min) => RANK[session.role] >= RANK[min] }
        : null,
    [supabase, session],
  );

  if (!supabase) {
    return (
      <Frame>
        <h1 className="text-2xl font-bold">Admin</h1>
        <Notice kind="error">This build has no Supabase project, so the admin cannot sign in. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.</Notice>
      </Frame>
    );
  }
  if (session.status === "loading") {
    return (
      <Frame>
        <p role="status" data-testid="admin-loading">
          Loading…
        </p>
      </Frame>
    );
  }
  if (session.status === "signed-out") return <SignIn supabase={supabase} />;
  if (session.status === "forbidden") {
    return (
      <Frame>
        <h1 className="text-2xl font-bold">Not an administrator</h1>
        <p className="mt-2" data-testid="admin-forbidden">
          {session.email} is signed in, but is not on the list of administrators, so there is nothing to show. Ask an admin to add this account.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </Button>
      </Frame>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AdminContext.Provider value={value}>
        <AdminFrame>{children}</AdminFrame>
      </AdminContext.Provider>
    </QueryClientProvider>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">{children}</main>;
}

function SignIn({ supabase }: { supabase: SupabaseClient }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  return (
    <Frame>
      <h1 className="text-2xl font-bold">Admin sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">For the people who curate the companies. There is no public sign-up.</p>
      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setMessage("");
          const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
          setBusy(false);
          // One message for a wrong email and a wrong password, so the form does not say which accounts exist.
          if (error) setMessage(/network|fetch/i.test(error.message) ? "The server could not be reached. Try again." : "The email or password is wrong.");
        }}
      >
        <Field label="Email">{(p) => <TextInput {...p} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Password">{(p) => <TextInput {...p} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        {message && <Notice kind="error">{message}</Notice>}
        <Button type="submit" disabled={busy} data-testid="sign-in">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </Frame>
  );
}

function AdminFrame({ children }: { children: React.ReactNode }) {
  const admin = useAdmin();
  const pathname = usePathname();
  return (
    <div className="flex flex-1 flex-col" data-testid="admin-frame" data-role={admin.role}>
      <header className="border-b border-rule bg-milky-shade">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2">
          <nav aria-label="Admin" className="flex flex-wrap items-center gap-x-1">
            <span className="mr-3 font-bold">Company Map admin</span>
            {NAV.filter((n) => admin.can(n.min)).map((n) => {
              const current = n.href === "/admin" ? pathname === "/admin" || pathname === "/admin/" : pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={current ? "page" : undefined}
                  className={cn("inline-flex min-h-11 items-center px-2 no-underline", current ? "font-bold shadow-[inset_0_-3px_0_var(--mantis-deep)]" : "text-foreground")}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span data-testid="admin-who">
              {admin.email} ({admin.role})
            </span>
            <Button variant="outline" size="sm" onClick={() => void admin.supabase.auth.signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
