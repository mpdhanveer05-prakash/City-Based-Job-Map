// The backup-and-restore drill (P9-04, docs/backup-restore.md): a backup of the database AND the Storage files, restored
// the way a real restore works (migrations first, then the data), and checked part by part.
//
//   node scripts/backup-drill.mts backup [--out <dir>]
//       From the MAIN local stack, read only (every query runs in a read-only transaction; nothing is written there):
//       a full pg_dump, every Storage file (downloaded through the Storage API with its SHA-256), and a snapshot of what
//       the database holds. Written to <dir> (default ../.local-backups/drill-<time>, git-ignored: it holds real data).
//
//   node scripts/backup-drill.mts restore --from <dir>
//       Into the DISPOSABLE TEST STACK only (node scripts/test-stack.mts start, then reset): refuses any other database,
//       and a test stack at another migration. Empties its data, loads the backup's data (public, and the Auth users,
//       identities and MFA factors), and uploads the files.
//
//   node scripts/backup-drill.mts verify --from <dir> [--sign-in <email>]
//       Compares the restored test stack with the backup: every table's rows (content hash), sequences, grants,
//       row-level security and policies, what anon and authenticated can see, every foreign key, every file's bytes, and
//       the logo records against the files. Then through the real APIs: anon reads, and with --sign-in (password in
//       DRILL_PASSWORD) an administrator signs in, is refused admin data without MFA, and reads it after a TOTP step-up.
//
// Afterwards discard the test stack: node scripts/test-stack.mts stop. It holds a copy of the real data.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { checkStorage, compareSnapshots, orphanSql, type DatabaseSnapshot, type ForeignKey, type LogoRecord, type StoredFile } from "../lib/backup-drill.ts";

const CODE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAIN = { url: "postgresql://postgres:postgres@127.0.0.1:54322/postgres", container: "supabase_db_company-map" };
const TEST = { url: "postgresql://postgres:postgres@127.0.0.1:55322/postgres", container: "supabase_db_company-map-test" };
const DUMP_IN_CONTAINER = "/tmp/drill.dump";
/** The Auth data a restore needs: accounts, their sign-in identities, and MFA factors. Sessions, refresh tokens and
 *  challenges are left out on purpose: restoring them would bring old sign-ins back. */
const AUTH_TABLES = ["users", "identities", "mfa_factors"];
const BUCKETS = ["company-logos", "company-logos-pending"];
const SIGN_IN_COLUMNS = ["last_sign_in_at", "updated_at", "last_challenged_at"];

type Api = { url: string; serviceKey: string; anonKey: string };
type Backup = { created: string; source: string; snapshot: DatabaseSnapshot; files: StoredFile[] };

// ---- helpers ----------------------------------------------------------------------------------------------------------

function docker(container: string, ...cmd: string[]): string {
  return execFileSync("docker", ["exec", container, ...cmd], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

function statusOf(workdir?: string): Api {
  const out = execFileSync("npx", ["supabase", "status", "-o", "json", ...(workdir ? ["--workdir", workdir] : [])], { cwd: CODE, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: true });
  const s = JSON.parse(out.slice(out.indexOf("{"))) as Record<string, string>;
  return { url: s.API_URL, serviceKey: s.SERVICE_ROLE_KEY, anonKey: s.ANON_KEY };
}

async function connect(url: string, readOnly: boolean): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url, options: readOnly ? "-c default_transaction_read_only=on" : undefined });
  await client.connect();
  return client;
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const describe = (f: StoredFile & { data: Buffer }): StoredFile => ({ bucket: f.bucket, name: f.name, bytes: f.bytes, contentType: f.contentType, sha256: f.sha256 });
const option = (args: string[], name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

// ---- measuring a database ---------------------------------------------------------------------------------------------

const SCHEMAS = "('public'::regnamespace, 'storage'::regnamespace)";
const ACCESS_SQL: Record<string, string> = {
  "table grants": `select format('%s %s %s', c.oid::regclass, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type) as x
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.relnamespace in ${SCHEMAS} and c.relkind in ('r', 'p', 'v', 'm')`,
  "function grants": `select format('%s %s %s', p.oid::regprocedure, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type) as x
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.pronamespace = 'public'::regnamespace`,
  "row-level security": `select format('%s rls=%s force=%s', c.oid::regclass, c.relrowsecurity, c.relforcerowsecurity) as x
    from pg_class c where c.relnamespace in ${SCHEMAS} and c.relkind in ('r', 'p')`,
  policies: `select format('%s.%s %s %s %s using(%s) check(%s)', schemaname, tablename, policyname, cmd, roles, qual, with_check) as x
    from pg_policies where schemaname in ('public', 'storage')`,
  triggers: `select format('%s %s enabled=%s', t.tgrelid::regclass, t.tgname, t.tgenabled) as x
    from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relnamespace in ${SCHEMAS}`,
  buckets: `select format('%s public=%s limit=%s types=%s', id, public, file_size_limit, allowed_mime_types) as x from storage.buckets`,
  "scheduled jobs": `select format('%s %s', jobname, schedule) as x from cron.job`,
};

async function tablesOf(client: pg.Client): Promise<string[]> {
  const pub = await client.query<{ name: string }>(
    "select c.oid::regclass::text as name from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relispartition order by 1",
  );
  return [...pub.rows.map((r) => r.name), ...AUTH_TABLES.map((t) => `auth.${t}`)];
}

async function measure(client: pg.Client): Promise<DatabaseSnapshot> {
  const migration = (await client.query<{ v: string }>("select max(version) as v from supabase_migrations.schema_migrations")).rows[0].v;
  const tables: DatabaseSnapshot["tables"] = {};
  for (const name of await tablesOf(client)) {
    // Auth rewrites these on every sign-in (the drill's own sign-in check included), so they are not part of the content.
    const row = name.startsWith("auth.") ? `(to_jsonb(t) - '{${SIGN_IN_COLUMNS.join(",")}}'::text[])::text` : "t::text";
    const r = (await client.query<{ rows: number; md5: string }>(
      `select count(*)::int as rows, md5(coalesce(string_agg(${row}, E'\\n' order by ${row}), '')) as md5 from ${name} t`,
    )).rows[0];
    tables[name] = r;
  }
  const sequences: DatabaseSnapshot["sequences"] = {};
  for (const r of (await client.query<{ name: string; last_value: string | null }>(
    "select schemaname || '.' || sequencename as name, last_value from pg_sequences where schemaname = 'public' order by 1",
  )).rows) sequences[r.name] = r.last_value === null ? null : Number(r.last_value);
  const access: DatabaseSnapshot["access"] = {};
  for (const [part, sql] of Object.entries(ACCESS_SQL)) access[part] = (await client.query<{ x: string }>(sql)).rows.map((r) => r.x).sort();

  // What each role sees, measured as that role (a denied table counts as -1).
  const visible: DatabaseSnapshot["visible"] = {};
  const pub = (await tablesOf(client)).filter((t) => !t.startsWith("auth."));
  await client.query("begin");
  try {
    for (const role of ["anon", "authenticated"]) {
      for (const table of pub) {
        await client.query("savepoint s");
        try {
          await client.query(`set local role ${role}`);
          visible[`${role} ${table}`] = Number((await client.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0].n);
        } catch {
          visible[`${role} ${table}`] = -1;
        }
        await client.query("rollback to savepoint s");
      }
    }
    for (const city of (await client.query<{ slug: string }>("select slug from public.city order by slug")).rows.map((r) => r.slug)) {
      await client.query("savepoint s");
      try {
        await client.query("set local role anon");
        visible[`anon company_filter(${city})`] = Number((await client.query<{ n: string }>("select count(*) as n from public.company_filter($1, '{}')", [city])).rows[0].n);
      } catch {
        visible[`anon company_filter(${city})`] = -1;
      }
      await client.query("rollback to savepoint s");
    }
  } finally {
    await client.query("rollback");
  }
  return { migration, tables, sequences, access, visible };
}

async function foreignKeys(client: pg.Client): Promise<ForeignKey[]> {
  const rows = (await client.query<{ name: string; tbl: string; ref: string; cols: string[]; refcols: string[] }>(`
    select c.conname as name, c.conrelid::regclass::text as tbl, c.confrelid::regclass::text as ref,
      array(select quote_ident(a.attname) from unnest(c.conkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.o) as cols,
      array(select quote_ident(a.attname) from unnest(c.confkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.o) as refcols
    from pg_constraint c
    where c.contype = 'f' and c.conparentid = 0 and c.connamespace in ('public'::regnamespace, 'auth'::regnamespace)
    order by 1`)).rows;
  return rows.map((r) => ({ name: r.name, table: r.tbl, refTable: r.ref, columns: r.cols, refColumns: r.refcols }));
}

// ---- Storage ----------------------------------------------------------------------------------------------------------

const headers = (key: string) => ({ Authorization: `Bearer ${key}`, apikey: key });
const objectUrl = (api: Api, bucket: string, name: string) => `${api.url}/storage/v1/object/${bucket}/${name.split("/").map(encodeURIComponent).join("/")}`;

async function listFiles(api: Api, bucket: string, prefix = ""): Promise<string[]> {
  const response = await fetch(`${api.url}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: { ...headers(api.serviceKey), "Content-Type": "application/json" },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } }),
  });
  if (!response.ok) throw new Error(`Listing ${bucket}/${prefix}: HTTP ${response.status} ${await response.text()}`);
  const out: string[] = [];
  for (const entry of (await response.json()) as Array<{ name: string; id: string | null }>) {
    if (entry.id === null) out.push(...(await listFiles(api, bucket, `${prefix}${entry.name}/`)));
    else out.push(`${prefix}${entry.name}`);
  }
  return out;
}

async function download(api: Api, bucket: string, name: string): Promise<{ bytes: Buffer; contentType: string }> {
  const response = await fetch(objectUrl(api, bucket, name), { headers: headers(api.serviceKey) });
  if (!response.ok) throw new Error(`Downloading ${bucket}/${name}: HTTP ${response.status}`);
  return { bytes: Buffer.from(await response.arrayBuffer()), contentType: (response.headers.get("content-type") ?? "").split(";")[0] };
}

async function allFiles(api: Api): Promise<Array<StoredFile & { data: Buffer }>> {
  const out: Array<StoredFile & { data: Buffer }> = [];
  for (const bucket of BUCKETS) {
    for (const name of await listFiles(api, bucket)) {
      const { bytes, contentType } = await download(api, bucket, name);
      out.push({ bucket, name, bytes: bytes.length, contentType, sha256: sha256(bytes), data: bytes });
    }
  }
  return out;
}

// ---- the three steps --------------------------------------------------------------------------------------------------

async function backup(args: string[]): Promise<void> {
  const out = path.resolve(option(args, "--out") ?? path.join(CODE, "..", ".local-backups", `drill-${new Date().toISOString().replace(/[:.]/g, "-")}`));
  // The backup holds administrators' accounts, password hashes and TOTP secrets: inside the repository it may only go where
  // Git ignores it (.local-backups/, which is also restricted to the owner's account; docs/backup-restore.md).
  const repo = path.resolve(CODE, "..");
  if (!path.relative(repo, out).startsWith("..")) {
    try {
      execFileSync("git", ["check-ignore", "-q", path.join(out, "backup.json")], { cwd: repo, stdio: "ignore" });
    } catch {
      throw new Error(`Refusing to write a backup to ${out}: Git does not ignore it. Use .local-backups/ (the default).`);
    }
  }
  mkdirSync(out, { recursive: true });
  const client = await connect(MAIN.url, true);
  try {
    console.log(`Backing up the main local stack (read only) to ${out}`);
    const snapshot = await measure(client);
    console.log(`  database at ${snapshot.migration}: ${Object.keys(snapshot.tables).length} tables, ${Object.values(snapshot.tables).reduce((a, t) => a + t.rows, 0)} rows`);
    // Full dump; partitioned data loads through the partition root, so it lands in whichever partitions the target has.
    docker(MAIN.container, "pg_dump", "-U", "postgres", "-d", "postgres", "-Fc", "--load-via-partition-root", "-f", DUMP_IN_CONTAINER);
    execFileSync("docker", ["cp", `${MAIN.container}:${DUMP_IN_CONTAINER}`, path.join(out, "database.dump")]);
    docker(MAIN.container, "rm", "-f", DUMP_IN_CONTAINER);
    console.log(`  database.dump: ${statSync(path.join(out, "database.dump")).size} bytes`);
    const files = await allFiles(statusOf());
    for (const f of files) {
      const target = path.join(out, "storage", f.bucket, ...f.name.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, f.data);
    }
    console.log(`  storage: ${files.length} files, ${files.reduce((a, f) => a + f.bytes, 0)} bytes`);
    const record: Backup = { created: new Date().toISOString(), source: "main local stack (company-map, :54322)", snapshot, files: files.map(describe) };
    writeFileSync(path.join(out, "backup.json"), JSON.stringify(record, null, 2));
    console.log("Backup written. Nothing was changed in the source.");
    console.log("It holds administrators' accounts, password hashes and TOTP secrets: keep it in .local-backups/ only, and encrypt it before it goes anywhere else (docs/backup-restore.md).");
  } finally {
    await client.end();
  }
}

function readBackup(dir: string): Backup {
  return JSON.parse(readFileSync(path.join(dir, "backup.json"), "utf8")) as Backup;
}

async function restore(args: string[]): Promise<void> {
  const dir = path.resolve(option(args, "--from") ?? "");
  const record = readBackup(dir);
  // Only the disposable test stack, and only while it holds no real data (the same guard every database test uses).
  const { assertDisposableDatabase } = await import("../tests/disposable-db.ts");
  await assertDisposableDatabase(TEST.url);
  const client = await connect(TEST.url, false);
  try {
    const migration = (await client.query<{ v: string }>("select max(version) as v from supabase_migrations.schema_migrations")).rows[0].v;
    if (migration !== record.snapshot.migration) {
      throw new Error(`The test stack is at ${migration} but the backup was taken at ${record.snapshot.migration}: a data-only restore needs the same schema.`);
    }
    const tables = (await tablesOf(client)).filter((t) => !t.startsWith("auth."));
    console.log(`Restoring ${dir} into the test stack (${TEST.container})`);
    // Empty what the migrations and seed put there. TRUNCATE ... CASCADE follows foreign keys whatever the triggers.
    docker(TEST.container, "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
      `set session_replication_role = replica; truncate ${tables.join(", ")}, auth.users restart identity cascade;`);
    const api = statusOf(".test-stack");
    for (const bucket of BUCKETS) {
      const names = await listFiles(api, bucket);
      if (names.length) {
        const r = await fetch(`${api.url}/storage/v1/object/${bucket}`, { method: "DELETE", headers: { ...headers(api.serviceKey), "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: names }) });
        if (!r.ok) throw new Error(`Emptying ${bucket}: HTTP ${r.status}`);
      }
    }
    execFileSync("docker", ["cp", path.join(dir, "database.dump"), `${TEST.container}:${DUMP_IN_CONTAINER}`]);
    // Data only, triggers off (the audit log must not record the restore as edits; foreign keys are checked by `verify`).
    for (const filter of [["-n", "public"], ["-n", "auth", ...AUTH_TABLES.flatMap((t) => ["-t", t])]]) {
      docker(TEST.container, "pg_restore", "-U", "supabase_admin", "-d", "postgres", "--data-only", "--disable-triggers", "--no-owner", "--exit-on-error", ...filter, DUMP_IN_CONTAINER);
    }
    docker(TEST.container, "rm", "-f", DUMP_IN_CONTAINER);
    console.log("  data loaded (public; auth users, identities, MFA factors)");
    for (const f of record.files) {
      const body = readFileSync(path.join(dir, "storage", f.bucket, ...f.name.split("/")));
      const r = await fetch(objectUrl(api, f.bucket, f.name), { method: "POST", headers: { ...headers(api.serviceKey), "Content-Type": f.contentType, "x-upsert": "true" }, body });
      if (!r.ok) throw new Error(`Uploading ${f.bucket}/${f.name}: HTTP ${r.status} ${await r.text()}`);
    }
    console.log(`  ${record.files.length} files uploaded`);
  } finally {
    await client.end();
  }
}

async function verify(args: string[]): Promise<void> {
  const dir = path.resolve(option(args, "--from") ?? "");
  const record = readBackup(dir);
  const client = await connect(TEST.url, false);
  const problems: string[] = [];
  const check = (label: string, found: string[]) => {
    console.log(`  ${found.length ? "FAIL" : "ok  "} ${label}${found.length ? `: ${found.length} problem(s)` : ""}`);
    for (const p of found.slice(0, 10)) console.log(`         ${p}`);
    problems.push(...found);
  };
  try {
    console.log(`Verifying the test stack against ${dir}`);
    const actual = await measure(client);
    const diff = compareSnapshots(record.snapshot, actual);
    const n = (prefix: string) => diff.filter((d) => d.startsWith(prefix));
    check(`rows and content of ${Object.keys(record.snapshot.tables).length} tables (public, auth users, identities, MFA factors)`, n("table "));
    check(`${Object.keys(record.snapshot.sequences).length} sequences`, n("sequence"));
    check(`grants, row-level security, policies, triggers, buckets, scheduled jobs (${Object.values(record.snapshot.access).reduce((a, l) => a + l.length, 0)} lines)`,
      diff.filter((d) => Object.keys(ACCESS_SQL).some((k) => d.startsWith(`${k}:`))));
    check(`rows visible to anon and authenticated (${Object.keys(record.snapshot.visible).length} measures)`, n("visible"));
    check("migration", n("migration"));

    const fks = await foreignKeys(client);
    const orphans: string[] = [];
    for (const fk of fks) {
      const count = (await client.query<{ n: number }>(orphanSql(fk))).rows[0].n;
      if (count > 0) orphans.push(`${fk.name} on ${fk.table}: ${count} row(s) point at nothing in ${fk.refTable}`);
    }
    check(`${fks.length} foreign keys have no orphans`, orphans);

    const api = statusOf(".test-stack");
    const restored = (await allFiles(api)).map(describe);
    const logos = (await client.query<LogoRecord>("select id, storage_key, bytes, decision, activated_at, verified_sha256 from public.logo_asset order by id")).rows;
    check(`${record.files.length} files' bytes, and ${logos.length} logo records against the files`, checkStorage(record.files, restored, logos));

    // Through the real APIs (PostgREST and Auth), not only SQL.
    const count = async (table: string, token: string): Promise<number> => {
      const r = await fetch(`${api.url}/rest/v1/${table}?select=*`, { headers: { apikey: api.anonKey, Authorization: `Bearer ${token}`, Prefer: "count=exact", Range: "0-0" } });
      if (!r.ok && r.status !== 416) return -1;
      return Number((r.headers.get("content-range") ?? "*/-1").split("/")[1]);
    };
    const apiProblems: string[] = [];
    for (const table of ["company", "office", "job"]) {
      const got = await count(table, api.anonKey);
      const want = record.snapshot.visible[`anon ${table}`];
      if (got !== want) apiProblems.push(`anon sees ${got} ${table} rows through the API; the backup's anon saw ${want}`);
    }
    const email = option(args, "--sign-in");
    if (email) {
      const password = process.env.DRILL_PASSWORD;
      if (!password) throw new Error("--sign-in needs the administrator's password in DRILL_PASSWORD");
      const auth = (p: string, body: unknown, token = api.anonKey) =>
        fetch(`${api.url}/auth/v1/${p}`, { method: "POST", headers: { apikey: api.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const signIn = await auth("token?grant_type=password", { email, password });
      if (!signIn.ok) apiProblems.push(`${email} cannot sign in with the restored password: HTTP ${signIn.status}`);
      else {
        const aal1 = ((await signIn.json()) as { access_token: string }).access_token;
        const before = await count("field_evidence", aal1);
        if (before !== 0) apiProblems.push(`${email} reads ${before} evidence rows before MFA; expected none`);
        // The restored TOTP factor: the drill plays the authenticator app with the secret Auth stored (local stacks only).
        const factor = (await client.query<{ id: string; secret: string }>(
          "select f.id, f.secret from auth.mfa_factors f join auth.users u on u.id = f.user_id where u.email = $1 and f.status = 'verified' limit 1", [email],
        )).rows[0];
        if (!factor) apiProblems.push(`${email} has no verified MFA factor after the restore`);
        else {
          const { totp } = await import("../tests/admin/totp.ts");
          const challenge = (await (await auth(`factors/${factor.id}/challenge`, {}, aal1)).json()) as { id: string };
          const verified = await auth(`factors/${factor.id}/verify`, { challenge_id: challenge.id, code: totp(factor.secret) }, aal1);
          if (!verified.ok) apiProblems.push(`${email}'s restored TOTP factor was refused: HTTP ${verified.status}`);
          else {
            const aal2 = ((await verified.json()) as { access_token: string }).access_token;
            const after = await count("field_evidence", aal2);
            const want = record.snapshot.tables["field_evidence"].rows; // public tables print without their schema
            if (after !== want) apiProblems.push(`${email} reads ${after} evidence rows after MFA; the backup holds ${want}`);
            else console.log(`         ${email}: signed in, refused admin data without MFA, read all ${after} evidence rows after a TOTP step-up`);
          }
        }
      }
    }
    check(`through the APIs: anon reads${email ? `, ${email} signs in with MFA` : ""}`, apiProblems);
  } finally {
    await client.end();
  }
  console.log(problems.length ? `\nDrill FAILED: ${problems.length} problem(s).` : "\nDrill passed: the restored stack matches the backup.");
  process.exit(problems.length ? 1 : 0);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "backup") await backup(rest);
  else if (command === "restore") await restore(rest);
  else if (command === "verify") await verify(rest);
  else {
    console.error("usage: node scripts/backup-drill.mts backup [--out <dir>] | restore --from <dir> | verify --from <dir> [--sign-in <email>]");
    process.exit(2);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
