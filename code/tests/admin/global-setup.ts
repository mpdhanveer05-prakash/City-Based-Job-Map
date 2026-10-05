// Global setup for the admin specs: the admin accounts, the two Edge Functions, and a stand-in for GitHub.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, openSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";

export const FAKE_GITHUB_PORT = 4099;
export const PASSWORD = "Test-password-1!";
export const USERS = {
  editor: "editor@admin.test",
  reviewer: "reviewer@admin.test",
  admin: "admin@admin.test",
  plain: "plain@admin.test",
} as const;

const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function ensureUser(url: string, serviceKey: string, email: string): Promise<string> {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  // Start clean: remove the account if an earlier run left it.
  const list = await (await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers })).json();
  for (const u of (list.users ?? []) as Array<{ id: string; email: string }>) {
    if (u.email === email) await fetch(`${url}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers });
  }
  const res = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers, body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }) });
  if (!res.ok) throw new Error(`Could not create ${email}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()).id as string;
}

async function waitFor(check: () => Promise<boolean>, what: string, ms = 90_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

export default async function globalSetup() {
  const url = process.env.ADMIN_E2E_SUPABASE_URL!;
  const serviceKey = process.env.ADMIN_E2E_SERVICE_KEY!;

  // 1. Accounts: an editor, a reviewer, an admin, and a signed-in user who is not an administrator.
  const ids: Record<keyof typeof USERS, string> = {
    editor: await ensureUser(url, serviceKey, USERS.editor),
    reviewer: await ensureUser(url, serviceKey, USERS.reviewer),
    admin: await ensureUser(url, serviceKey, USERS.admin),
    plain: await ensureUser(url, serviceKey, USERS.plain),
  };
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query("delete from admin_user");
    for (const role of ["editor", "reviewer", "admin"] as const) await client.query("insert into admin_user (user_id, role) values ($1, $2)", [ids[role], role]);
    // A fresh debounce: the first Publish now of the run must start a build.
    await client.query("update site_state set last_rebuild_requested_at = null");
  } finally {
    await client.end();
  }

  // 2. A stand-in for GitHub's repository_dispatch, which records what it is asked.
  const requests: Array<{ method: string; url: string; authorization: string | undefined; body: string }> = [];
  const github: Server = createServer((req, res) => {
    if (req.url === "/__requests") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(requests));
      return;
    }
    // A stand-in for Cloudflare's siteverify: a token that starts with "stub-token" passes, anything else fails.
    if (req.url === "/turnstile/siteverify" && req.method === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const form = new URLSearchParams(Buffer.concat(chunks).toString());
        const ok = (form.get("response") ?? "").startsWith("stub-token") && form.get("secret") === "test-turnstile-secret";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(ok ? { success: true, hostname: "localhost", action: "feedback" } : { success: false, "error-codes": ["invalid-input-response"] }));
      });
      return;
    }
    if (req.url === "/__reset") {
      requests.length = 0;
      res.writeHead(204).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      requests.push({ method: req.method ?? "", url: req.url ?? "", authorization: req.headers.authorization, body: Buffer.concat(chunks).toString() });
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => github.listen(FAKE_GITHUB_PORT, "0.0.0.0", resolve));

  // 3. The Edge Functions, as the local edge runtime serves them (the container reaches the host as host.docker.internal).
  const envFile = path.join(mkdtempSync(path.join(tmpdir(), "admin-e2e-")), "functions.env");
  writeFileSync(
    envFile,
    [
      "ALLOWED_ORIGINS=http://localhost:3100",
      "GITHUB_DISPATCH_TOKEN=test-dispatch-token",
      "GITHUB_REPOSITORY=owner/repo",
      `GITHUB_API_URL=http://host.docker.internal:${FAKE_GITHUB_PORT}`,
      "TURNSTILE_SECRET_KEY=test-turnstile-secret",
      `TURNSTILE_VERIFY_URL=http://host.docker.internal:${FAKE_GITHUB_PORT}/turnstile/siteverify`,
      "FEEDBACK_SALT=test-feedback-salt",
    ].join("\n"),
  );
  // The runtime's log goes to a file, kept outside test-results (Playwright empties that folder): a worker that fails to
  // boot or is stopped says why only here.
  const logFile = path.join(tmpdir(), "admin-e2e-functions.log");
  const log = openSync(logFile, "w");
  console.log(`Edge Functions log: ${logFile}`);
  const functions: ChildProcess = spawn("npx", ["supabase", "functions", "serve", "--env-file", envFile], { shell: true, stdio: ["ignore", log, log] });
  await waitFor(async () => {
    const res = await fetch(`${url}/functions/v1/click`, { method: "OPTIONS", headers: { Origin: "http://localhost:3100" } });
    return res.status === 204;
  }, "the Edge Functions runtime");
  // The runtime starts a function's worker, and fetches its npm packages, on the first request to it. Do that now for the
  // other two, so no spec pays for a cold start (a cold first call to request-rebuild once came back as a failure).
  // Any answer below 500 means the worker is up: a bare POST is refused (401 or 403) by the function itself.
  const anon = process.env.ADMIN_E2E_ANON_KEY!;
  for (const name of ["request-rebuild", "submit-feedback"]) {
    await waitFor(async () => {
      const res = await fetch(`${url}/functions/v1/${name}`, { method: "POST", headers: { Origin: "http://localhost:3100", apikey: anon, Authorization: `Bearer ${anon}` } });
      return res.status < 500;
    }, `the ${name} function`);
  }

  return async () => {
    github.close();
    functions.kill();
    // `supabase functions serve` runs in a container that outlives its CLI: stop the CLI's process tree on Windows too.
    if (process.platform === "win32" && functions.pid) spawn("taskkill", ["/pid", String(functions.pid), "/T", "/F"], { stdio: "ignore" });
  };
}
