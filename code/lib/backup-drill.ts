// The checks of the backup-and-restore drill (P9-04, docs/backup-restore.md), kept pure so Vitest can test them
// (tests/unit/backup-drill.test.ts). scripts/backup-drill.mts measures a database and its Storage files and calls these.

/** What a database looked like when it was backed up, or after a restore. Every part must match. */
export type DatabaseSnapshot = {
  /** The newest applied migration: a data-only restore needs the same schema. */
  migration: string;
  /** Row count and a content hash (md5 of every row as text, sorted) of each table. */
  tables: Record<string, { rows: number; md5: string }>;
  /** Each sequence's last value (null when never used). */
  sequences: Record<string, number | null>;
  /** Grants on tables and functions, row-level security flags, policies, storage buckets and scheduled jobs, as sorted lines. */
  access: Record<string, string[]>;
  /** Rows each role can see, measured as that role: the effect of the grants and policies on the data. */
  visible: Record<string, number>;
};

/** Every difference between two snapshots, in words. Empty means the restore matches. */
export function compareSnapshots(expected: DatabaseSnapshot, actual: DatabaseSnapshot): string[] {
  const out: string[] = [];
  if (expected.migration !== actual.migration) out.push(`migration: backed up at ${expected.migration}, restored stack at ${actual.migration}`);
  for (const name of union(Object.keys(expected.tables), Object.keys(actual.tables))) {
    const [e, a] = [expected.tables[name], actual.tables[name]];
    if (!e || !a) out.push(`table ${name}: ${e ? "missing after the restore" : "not in the backup"}`);
    else if (e.rows !== a.rows) out.push(`table ${name}: ${e.rows} rows backed up, ${a.rows} restored`);
    else if (e.md5 !== a.md5) out.push(`table ${name}: same row count (${e.rows}) but different content`);
  }
  for (const name of union(Object.keys(expected.sequences), Object.keys(actual.sequences))) {
    if (expected.sequences[name] !== actual.sequences[name]) out.push(`sequence ${name}: ${expected.sequences[name]} backed up, ${actual.sequences[name]} restored`);
  }
  for (const part of union(Object.keys(expected.access), Object.keys(actual.access))) {
    const [e, a] = [new Set(expected.access[part] ?? []), new Set(actual.access[part] ?? [])];
    const missing = [...e].filter((x) => !a.has(x));
    const extra = [...a].filter((x) => !e.has(x));
    if (missing.length || extra.length) {
      out.push(`${part}: ${missing.length} missing, ${extra.length} extra${[...missing.slice(0, 3).map((x) => ` -${x}`), ...extra.slice(0, 3).map((x) => ` +${x}`)].join("")}`);
    }
  }
  for (const name of union(Object.keys(expected.visible), Object.keys(actual.visible))) {
    if (expected.visible[name] !== actual.visible[name]) out.push(`visible ${name}: ${expected.visible[name]} backed up, ${actual.visible[name]} restored`);
  }
  return out;
}

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])].sort();

/** A foreign key as the catalogue describes it, with names already quoted. */
export type ForeignKey = { name: string; table: string; columns: string[]; refTable: string; refColumns: string[] };

/**
 * SQL counting the rows of `fk.table` whose key is set but points at nothing. A data-only restore runs with triggers off,
 * so Postgres does not check foreign keys while loading: this is how the drill checks every relationship afterwards.
 */
export function orphanSql(fk: ForeignKey): string {
  if (fk.columns.length === 0 || fk.columns.length !== fk.refColumns.length) throw new Error(`Foreign key ${fk.name} has mismatched columns`);
  const set = fk.columns.map((c) => `t.${c} is not null`).join(" and ");
  const join = fk.columns.map((c, i) => `r.${fk.refColumns[i]} = t.${c}`).join(" and ");
  return `select count(*)::int as n from ${fk.table} t where ${set} and not exists (select 1 from ${fk.refTable} r where ${join})`;
}

/** One stored file: where it is and what its bytes were. */
export type StoredFile = { bucket: string; name: string; bytes: number; contentType: string; sha256: string };

/** A logo upload's record (public.logo_asset), as far as the drill needs it. */
export type LogoRecord = { id: number; storage_key: string; bytes: number; decision: string | null; activated_at: string | null; verified_sha256: string | null };

/** The hash a logo's storage key names: `<company id>/<sha256>.<ext>`. */
export function keySha256(key: string): string | null {
  const m = /^[^/]+\/([0-9a-f]{64})\.[a-z0-9]+$/.exec(key);
  return m ? m[1] : null;
}

/**
 * Checks the restored files against the backup's manifest, and the logo records against the files:
 *  - every backed-up file is back, with the same bytes (SHA-256) and size, and nothing else is there;
 *  - a logo file's bytes hash to the hash its key names;
 *  - every upload has its file in the private bucket; an activated logo also has the same bytes in the public bucket, and
 *    its verified hash (when set) is that hash.
 */
export function checkStorage(manifest: readonly StoredFile[], restored: readonly StoredFile[], logos: readonly LogoRecord[]): string[] {
  const out: string[] = [];
  const at = (files: readonly StoredFile[]) => new Map(files.map((f) => [`${f.bucket}/${f.name}`, f]));
  const [before, after] = [at(manifest), at(restored)];
  for (const [path, f] of before) {
    const r = after.get(path);
    if (!r) out.push(`file ${path}: missing after the restore`);
    else if (r.sha256 !== f.sha256 || r.bytes !== f.bytes) out.push(`file ${path}: bytes differ (${f.bytes} B ${f.sha256.slice(0, 12)} backed up, ${r.bytes} B ${r.sha256.slice(0, 12)} restored)`);
  }
  for (const path of after.keys()) if (!before.has(path)) out.push(`file ${path}: not in the backup`);
  for (const f of restored) {
    if (!f.bucket.startsWith("company-logos")) continue;
    const named = keySha256(f.name);
    if (named && named !== f.sha256) out.push(`file ${f.bucket}/${f.name}: its bytes hash to ${f.sha256.slice(0, 12)}, not the hash its name gives`);
  }
  for (const logo of logos) {
    const pending = after.get(`company-logos-pending/${logo.storage_key}`);
    if (!pending) out.push(`logo ${logo.id}: no file in company-logos-pending for ${logo.storage_key}`);
    else if (pending.bytes !== logo.bytes) out.push(`logo ${logo.id}: the record says ${logo.bytes} B, the file has ${pending.bytes} B`);
    if (logo.activated_at) {
      const live = after.get(`company-logos/${logo.storage_key}`);
      if (!live) out.push(`logo ${logo.id}: activated, but no file in company-logos`);
      else if (pending && live.sha256 !== pending.sha256) out.push(`logo ${logo.id}: the public copy's bytes differ from the upload's`);
      if (logo.verified_sha256 && live && logo.verified_sha256 !== live.sha256) out.push(`logo ${logo.id}: verified_sha256 does not match the public file`);
    }
  }
  return out;
}
