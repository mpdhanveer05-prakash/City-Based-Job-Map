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
  // P9-13: an administrator signed in with a password still needs the second factor (the database requires aal2).
  | { status: "mfa-enrol"; email: string }
  | { status: "mfa-verify"; email: string; factorId: string }
  | { status: "ready"; email: string; userId: string; role: Role };

const NAV: Array<{ href: string; label: string; min: Role }> = [
  { href: "/admin", label: "Dashboard", min: "editor" },
  { href: "/admin/companies", label: "Companies", min: "editor" },
  { href: "/admin/offices", label: "Offices", min: "editor" },
  { href: "/admin/jobs", label: "Jobs", min: "editor" },
  { href: "/admin/import", label: "Import", min: "editor" },
  { href: "/admin/review", label: "Review", min: "editor" },
  { href: "/admin/feeds", label: "Feeds", min: "editor" },
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
        void (async () => {
          // A password-only session may read its own admin_user row, so the role is known before the second factor.
          const { data: row } = await supabase.from("admin_user").select("role").eq("user_id", id).maybeSingle();
          const role = row?.role as Role | undefined;
          if (!role || !(role in RANK)) {
            if (!cancelled) setSession({ status: "forbidden", email: email ?? "" });
            return;
          }
          const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
          if (aal?.currentLevel === "aal2") {
            if (!cancelled) setSession({ status: "ready", email: email ?? "", userId: id, role });
            return;
          }
          // `totp` lists verified factors only: none yet means this administrator must set one up first.
          const { data: factors } = await supabase.auth.mfa.listFactors();
          const factor = factors?.totp[0];
          if (cancelled) return;
          setSession(factor ? { status: "mfa-verify", email: email ?? "", factorId: factor.id } : { status: "mfa-enrol", email: email ?? "" });
        })();
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
  if (session.status === "mfa-enrol") return <MfaEnrol supabase={supabase} email={session.email} />;
  if (session.status === "mfa-verify") return <MfaVerify supabase={supabase} email={session.email} factorId={session.factorId} />;
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

function CodeForm({ supabase, factorId, submitLabel }: { supabase: SupabaseClient; factorId: string; submitLabel: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <form
      className="mt-6 flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage("");
        // On success Supabase Auth issues an aal2 session, and the auth listener above shows the admin.
        const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
        setBusy(false);
        if (error) setMessage(/network|fetch/i.test(error.message) ? "The server could not be reached. Try again." : "That code is wrong or has expired. Enter the current code.");
      }}
    >
      <Field label="Six-digit code">
        {(p) => (
          <TextInput
            {...p}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            data-testid="mfa-code"
          />
        )}
      </Field>
      {message && <Notice kind="error">{message}</Notice>}
      <Button type="submit" disabled={busy} data-testid="mfa-submit">
        {busy ? "Checking…" : submitLabel}
      </Button>
    </form>
  );
}

function SignOutLink({ supabase }: { supabase: SupabaseClient }) {
  return (
    <Button variant="outline" className="mt-6" onClick={() => void supabase.auth.signOut()}>
      Sign out
    </Button>
  );
}

function MfaVerify({ supabase, email, factorId }: { supabase: SupabaseClient; email: string; factorId: string }) {
  return (
    <Frame>
      <h1 className="text-2xl font-bold">Enter your code</h1>
      <p className="mt-1" data-testid="mfa-verify">
        {email}: open your authenticator app and enter the code it shows for Company Map admin.
      </p>
      <CodeForm supabase={supabase} factorId={factorId} submitLabel="Continue" />
      <p className="mt-4 text-sm text-muted-foreground">Lost the app? Ask another administrator to remove your second factor, then set it up again.</p>
      <SignOutLink supabase={supabase} />
    </Frame>
  );
}

type Enrolment = { factorId: string; qr: string; secret: string } | { error: string } | null;

function MfaEnrol({ supabase, email }: { supabase: SupabaseClient; email: string }) {
  const [enrolment, setEnrolment] = useState<Enrolment>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // An unfinished earlier attempt leaves an unverified factor behind: remove it, then start again.
      const { data: factors } = await supabase.auth.mfa.listFactors();
      for (const f of factors?.all ?? []) if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Company Map admin" });
      if (cancelled) return;
      setEnrolment(error || !data ? { error: "The second factor could not be set up. Reload the page to try again." } : { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return (
    <Frame>
      <h1 className="text-2xl font-bold">Set up your second factor</h1>
      <p className="mt-1" data-testid="mfa-enrol">
        {email}: administrators sign in with a password and a code from an authenticator app. Scan the code below with the app, or type
        the key into it, then enter the six-digit code it shows.
      </p>
      {enrolment === null && (
        <p role="status" className="mt-4">
          Preparing…
        </p>
      )}
      {enrolment && "error" in enrolment && <Notice kind="error">{enrolment.error}</Notice>}
      {enrolment && "factorId" in enrolment && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL from Supabase Auth; nothing to optimise */}
          <img src={enrolment.qr} alt="QR code for your authenticator app" width={180} height={180} className="mt-4 bg-background p-2" />
          <p className="mt-2 text-sm">
            Key: <code className="break-all" data-testid="mfa-secret">{enrolment.secret}</code>
          </p>
          <CodeForm supabase={supabase} factorId={enrolment.factorId} submitLabel="Turn on and continue" />
        </>
      )}
      <SignOutLink supabase={supabase} />
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
