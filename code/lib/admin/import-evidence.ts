// The evidence a CSV row gives for each field it fills in (P9-07, owner decision of 6 Oct 2026). Pure and unit-tested;
// `import_commit` checks the same rules again in the database.
//
//   source_url, verified_at   the row's source and the day someone checked it (both required in every row)
//   source_covers             the fields that row source supports, separated by ; or , (a row source is NOT evidence
//                             for every field: only for those listed here)
//   <field>_source_url        a different source for one field, with <field>_verified_at (both, or neither)
//
// A field the row fills in must be covered by one of the two. A per-field source for a field the row leaves empty is an
// error; a field listed in source_covers that the row leaves empty is ignored.

/** The fields evidence can be given for, in a CSV row: company facts, then the office's. */
export const EVIDENCE_FIELDS = ["name", "website", "description", "types", "sectors", "startup_stage", "ownership_status", "address", "location"] as const;
export type EvidenceField = (typeof EVIDENCE_FIELDS)[number];
export const OFFICE_EVIDENCE_FIELDS: readonly EvidenceField[] = ["address", "location"];

export const EVIDENCE_LABELS: Record<EvidenceField, string> = {
  name: "name",
  website: "website",
  description: "description",
  types: "company type",
  sectors: "sector",
  startup_stage: "startup stage",
  ownership_status: "ownership status",
  address: "address",
  location: "location (latitude and longitude)",
};

export type EvidenceEntry = { field: EvidenceField; source_url: string; verified_at: string };

/** The per-field column names: name_source_url, name_verified_at, and so on. */
export const PER_FIELD_COLUMNS = EVIDENCE_FIELDS.flatMap((f) => [`${f}_source_url`, `${f}_verified_at`] as const);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in YYYY-MM-DD, not before 2000 and not after `today`. Returns a reason when it is not. */
export function checkVerifiedDate(value: string, today: string): string | null {
  const m = ISO_DATE.exec(value);
  if (!m) return "must be a date written as YYYY-MM-DD";
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return "is not a real date";
  if (value < "2000-01-01") return "is before 2000";
  if (value > today) return "is in the future: it must be the day someone checked the source";
  return null;
}

const isHttpsUrl = (value: string) => /^https:\/\/[^\s]+$/.test(value) && value.length <= 2000 && URL.canParse(value);

export type RowEvidenceInput = {
  cells: Readonly<Record<string, string | undefined>>;
  /** The fields this row fills in and that need evidence. */
  needed: readonly EvidenceField[];
  /** The row's old-style stage of Public or Acquired became the ownership status: evidence for the stage moves with it. */
  stageMovedToOwnership: boolean;
  today: string;
};

export function rowEvidence({ cells, needed, stageMovedToOwnership, today }: RowEvidenceInput): {
  evidence: EvidenceEntry[];
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cell = (key: string) => (cells[key] ?? "").trim();
  const target = (f: EvidenceField): EvidenceField => (stageMovedToOwnership && f === "startup_stage" ? "ownership_status" : f);

  const rowSource = cell("source_url");
  const rowDate = cell("verified_at");
  let rowOk = true;
  if (rowSource === "") {
    errors.push("The source_url is missing: every row needs the page someone checked.");
    rowOk = false;
  } else if (!isHttpsUrl(rowSource)) {
    errors.push(`The source_url "${rowSource}" must be an https link.`);
    rowOk = false;
  }
  if (rowDate === "") {
    errors.push("The verified_at date is missing: every row needs the day someone checked the source.");
    rowOk = false;
  } else {
    const problem = checkVerifiedDate(rowDate, today);
    if (problem) {
      errors.push(`The verified_at date "${rowDate}" ${problem}.`);
      rowOk = false;
    }
  }

  const covers = new Set<EvidenceField>();
  for (const raw of cell("source_covers").split(/[;,|]/).map((s) => s.trim().toLowerCase().replace(/[\s-]+/g, "_")).filter(Boolean)) {
    const key = raw === "industry" || raw === "sector" ? "sectors" : raw === "type" ? "types" : raw === "stage" ? "startup_stage" : raw === "website_url" ? "website" : raw;
    if ((EVIDENCE_FIELDS as readonly string[]).includes(key)) covers.add(target(key as EvidenceField));
    else errors.push(`"${raw}" in source_covers is not a field (use ${EVIDENCE_FIELDS.join(", ")}).`);
  }

  const evidence: EvidenceEntry[] = [];
  const perField = new Set<EvidenceField>();
  for (const f of EVIDENCE_FIELDS) {
    const src = cell(`${f}_source_url`);
    const date = cell(`${f}_verified_at`);
    if (src === "" && date === "") continue;
    const field = target(f);
    const label = EVIDENCE_LABELS[field];
    if (src === "" || date === "") {
      errors.push(`The ${label} has ${src === "" ? "a verified date but no source" : "a source but no verified date"}: give both ${f}_source_url and ${f}_verified_at.`);
      continue;
    }
    if (!isHttpsUrl(src)) {
      errors.push(`The source for the ${label} must be an https link.`);
      continue;
    }
    const problem = checkVerifiedDate(date, today);
    if (problem) {
      errors.push(`The verified date for the ${label} ${problem}.`);
      continue;
    }
    if (!needed.includes(field)) {
      errors.push(`There is a source for the ${label}, but this row leaves it empty.`);
      continue;
    }
    perField.add(field);
    evidence.push({ field, source_url: src, verified_at: date });
  }

  for (const field of needed) {
    if (perField.has(field)) continue;
    if (covers.has(field)) {
      if (rowOk) evidence.push({ field, source_url: rowSource, verified_at: rowDate });
    } else {
      errors.push(`There is no evidence for the ${EVIDENCE_LABELS[field]}: list it in source_covers, or give ${field}_source_url and ${field}_verified_at.`);
    }
  }
  // A field listed in source_covers that the row leaves empty is ignored: one list often serves a whole file.

  evidence.sort((a, b) => EVIDENCE_FIELDS.indexOf(a.field) - EVIDENCE_FIELDS.indexOf(b.field));
  return { evidence, errors, warnings };
}
