import { describe, expect, it } from "vitest";
import { checkStorage, compareSnapshots, keySha256, orphanSql, type DatabaseSnapshot, type LogoRecord, type StoredFile } from "@/lib/backup-drill";

const snap = (over: Partial<DatabaseSnapshot> = {}): DatabaseSnapshot => ({
  migration: "20261007160000",
  tables: { company: { rows: 2, md5: "a" }, "auth.users": { rows: 1, md5: "u" } },
  sequences: { "public.audit_log_id_seq": 10 },
  access: { "table grants": ["company anon SELECT", "company authenticated SELECT"] },
  visible: { "anon company": 2 },
  ...over,
});

describe("comparing a restore with its backup", () => {
  it("finds nothing when they match", () => {
    expect(compareSnapshots(snap(), snap())).toEqual([]);
  });

  it("names every kind of difference", () => {
    const restored = snap({
      migration: "20261007150000",
      tables: { company: { rows: 2, md5: "b" }, office: { rows: 1, md5: "o" } },
      sequences: { "public.audit_log_id_seq": 15 },
      access: { "table grants": ["company authenticated SELECT", "company anon INSERT"] },
      visible: { "anon company": -1 },
    });
    const diff = compareSnapshots(snap(), restored);
    expect(diff).toEqual([
      "migration: backed up at 20261007160000, restored stack at 20261007150000",
      "table auth.users: missing after the restore",
      "table company: same row count (2) but different content",
      "table office: not in the backup",
      "sequence public.audit_log_id_seq: 10 backed up, 15 restored",
      "table grants: 1 missing, 1 extra -company anon SELECT +company anon INSERT",
      "visible anon company: 2 backed up, -1 restored",
    ]);
  });
});

describe("the foreign-key orphan query", () => {
  it("counts rows whose key is set but points at nothing", () => {
    expect(orphanSql({ name: "fk", table: "company_sector", columns: ["sector_id"], refTable: "sector", refColumns: ["id"] })).toBe(
      "select count(*)::int as n from company_sector t where t.sector_id is not null and not exists (select 1 from sector r where r.id = t.sector_id)",
    );
  });
  it("handles composite keys and refuses mismatched ones", () => {
    expect(orphanSql({ name: "fk", table: "a", columns: ["x", "y"], refTable: "b", refColumns: ["p", "q"] })).toContain("r.p = t.x and r.q = t.y");
    expect(() => orphanSql({ name: "fk", table: "a", columns: ["x"], refTable: "b", refColumns: [] })).toThrow();
  });
});

describe("restored files and logo records", () => {
  const H1 = "1".repeat(64);
  const H2 = "2".repeat(64);
  const key = `c0/${H1}.png`;
  const file = (bucket: string, sha = H1, bytes = 68): StoredFile => ({ bucket, name: key, bytes, contentType: "image/png", sha256: sha });
  const logo = (over: Partial<LogoRecord> = {}): LogoRecord => ({ id: 1, storage_key: key, bytes: 68, decision: "approved", activated_at: "2026-10-07", verified_sha256: H1, ...over });
  const backed = [file("company-logos-pending"), file("company-logos")];

  it("reads the hash a key names", () => {
    expect(keySha256(key)).toBe(H1);
    expect(keySha256("c0/logo.png")).toBeNull();
  });

  it("passes when every file is back with the same bytes and the records agree", () => {
    expect(checkStorage(backed, backed, [logo()])).toEqual([]);
  });

  it("finds a missing file, an extra file, and changed bytes", () => {
    const restored = [file("company-logos-pending", H2, 12), { ...file("company-logos-pending"), name: "c0/extra.png" }];
    const problems = checkStorage(backed, restored, [logo({ activated_at: null })]);
    expect(problems).toContain(`file company-logos/${key}: missing after the restore`);
    expect(problems).toContain("file company-logos-pending/c0/extra.png: not in the backup");
    expect(problems.some((p) => p.includes("bytes differ"))).toBe(true);
    expect(problems.some((p) => p.includes("not the hash its name gives"))).toBe(true);
  });

  it("finds a logo whose public copy, size, or verified hash disagrees", () => {
    const restored = [file("company-logos-pending"), file("company-logos", H2)];
    const problems = checkStorage(restored, restored, [logo({ bytes: 70 })]);
    expect(problems).toContain("logo 1: the record says 70 B, the file has 68 B");
    expect(problems).toContain("logo 1: the public copy's bytes differ from the upload's");
    expect(problems).toContain("logo 1: verified_sha256 does not match the public file");
    expect(checkStorage([], [], [logo()])).toContain(`logo 1: no file in company-logos-pending for ${key}`);
  });
});
