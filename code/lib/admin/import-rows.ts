// Reading and checking a company CSV before it is imported (P7-03, ADM03): which columns it has, what each row would
// do (create a company, add an office to one that exists, or nothing), and what is wrong with the rows that cannot go
// in. Pure, so it is unit-tested. The admin sees this as a preview and confirms; only then does `import_commit` run,
// and the database checks everything again (nothing here is a security boundary).
import { checkOutboundUrl, companyDomain } from "../links.ts";
import { COMPANY_TYPES, OWNERSHIP_STATUSES, STARTUP_STAGES, type CompanyType, type OwnershipStatus, type StartupStage } from "../filters/schema.ts";

export const IMPORT_COLUMNS = [
  "name",
  "domain",
  "website_url",
  "careers_url",
  "description",
  "types",
  "startup_stage",
  "ownership_status",
  "sectors",
  "city",
  "address",
  "lat",
  "lng",
  "accuracy",
  "neighbourhood",
  "tech_park",
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export const REQUIRED_COLUMNS: readonly ImportColumn[] = ["name", "domain", "city", "address", "lat", "lng"];

/** Other names a column may go by in a file from a spreadsheet. */
const ALIASES: Record<string, ImportColumn> = {
  company: "name",
  "company name": "name",
  website: "website_url",
  "website url": "website_url",
  url: "website_url",
  careers: "careers_url",
  "careers url": "careers_url",
  "careers page": "careers_url",
  type: "types",
  "company type": "types",
  stage: "startup_stage",
  "startup stage": "startup_stage",
  ownership: "ownership_status",
  "ownership status": "ownership_status",
  sector: "sectors",
  latitude: "lat",
  longitude: "lng",
  lon: "lng",
  long: "lng",
  neighborhood: "neighbourhood",
  area: "neighbourhood",
  "tech park": "tech_park",
  techpark: "tech_park",
};

const normaliseHeader = (h: string): string => h.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
const canonicalColumn = (h: string): ImportColumn | null => {
  const n = normaliseHeader(h);
  const direct = IMPORT_COLUMNS.find((c) => c.replace(/_/g, " ") === n);
  return direct ?? ALIASES[n] ?? null;
};

export type ImportTable = {
  /** The file's columns, in order, as the import calls them (null for one it does not use). */
  columns: Array<ImportColumn | null>;
  unknownColumns: string[];
  missingColumns: ImportColumn[];
  /** Each data row by column, with its 1-based line in the file (the header is line 1). */
  records: Array<{ line: number; cells: Partial<Record<ImportColumn, string>> }>;
};

/** Turns parsed CSV rows into records keyed by column. The first row is the header. */
export function readImportTable(rows: readonly string[][]): ImportTable {
  const header = rows[0] ?? [];
  const columns = header.map(canonicalColumn);
  const unknownColumns = header.filter((_, i) => columns[i] === null && header[i].trim() !== "");
  const missingColumns = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  const records = rows.slice(1).map((cells, i) => {
    const byColumn: Partial<Record<ImportColumn, string>> = {};
    cells.forEach((value, c) => {
      const column = columns[c];
      // The first of two columns with the same meaning wins.
      if (column && byColumn[column] === undefined) byColumn[column] = value.trim();
    });
    return { line: i + 2, cells: byColumn };
  });
  return { columns, unknownColumns, missingColumns, records };
}

/** What the database knows, as the check needs it. Fetched when the admin opens the import page. */
export type ImportReference = {
  cities: Array<{ slug: string; name: string; aliases: string[] }>;
  neighbourhoods: Array<{ city: string; slug: string; name: string }>;
  techParks: Array<{ city: string; slug: string; name: string }>;
  sectors: Array<{ slug: string; name: string }>;
  /** Domains of every company, any status. */
  existingDomains: ReadonlySet<string>;
  /** `domain|city slug|lower-cased address` of every office, any status. */
  existingOffices: ReadonlySet<string>;
};

/** The row as `import_commit` takes it. */
export type ImportPayloadRow = {
  name: string;
  domain: string;
  website_url: string;
  careers_url: string | null;
  description: string | null;
  types: CompanyType[];
  startup_stage: StartupStage | null;
  ownership_status: OwnershipStatus | null;
  sectors: string[];
  city: string;
  address: string;
  lat: number;
  lng: number;
  accuracy: string;
  neighbourhood: string | null;
  tech_park: string | null;
};

export type ImportStatus = "new" | "attach" | "duplicate-office" | "error";

export type ImportRowResult = {
  /** The line in the file. */
  line: number;
  status: ImportStatus;
  errors: string[];
  warnings: string[];
  /** A short label for the preview: the name, or the domain when there is no name. */
  label: string;
  payload: ImportPayloadRow | null;
};

const ACCURACIES = ["rooftop", "building", "campus", "street", "locality"];
/** A point outside this box is almost certainly a swapped or mistyped coordinate (the launch cities are in India). */
const INDIA = { latMin: 6, latMax: 38, lngMin: 68, lngMax: 98 };

const slugOf = (text: string) => text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const list = (value: string | undefined): string[] =>
  (value ?? "")
    .split(/[;|,]/)
    .map((s) => s.trim())
    .filter(Boolean);

function normaliseDomain(raw: string): string {
  let d = raw.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/^www\./, "");
  return d.split(/[/?#]/)[0].replace(/:\d+$/, "");
}

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function parseStage(raw: string): StartupStage | null {
  const key = raw.trim().toLowerCase().replace(/\+/g, " plus").replace(/[\s-]+/g, "_");
  return (STARTUP_STAGES as readonly string[]).includes(key) ? (key as StartupStage) : null;
}

/**
 * Checks every record. `existingDomains` and `existingOffices` come from the database; rows earlier in the same file
 * count too, so a company listed twice becomes one company with two offices, and a repeated office is flagged.
 */
export function validateImportRows(records: ImportTable["records"], ref: ImportReference): ImportRowResult[] {
  const cityBy = new Map<string, string>();
  for (const c of ref.cities) {
    cityBy.set(c.slug, c.slug);
    cityBy.set(c.name.toLowerCase(), c.slug);
    for (const a of c.aliases) cityBy.set(a.toLowerCase(), c.slug);
  }
  const sectorBy = new Map<string, string>();
  for (const s of ref.sectors) {
    sectorBy.set(s.slug, s.slug);
    sectorBy.set(s.name.toLowerCase(), s.slug);
  }
  const areaBy = (items: ImportReference["neighbourhoods"]) => {
    const m = new Map<string, string>();
    for (const n of items) {
      m.set(`${n.city}|${n.slug}`, n.slug);
      m.set(`${n.city}|${n.name.toLowerCase()}`, n.slug);
    }
    return m;
  };
  const hoodBy = areaBy(ref.neighbourhoods);
  const parkBy = areaBy(ref.techParks);

  const seenDomains = new Set<string>();
  const seenOffices = new Set<string>();

  return records.map(({ line, cells }): ImportRowResult => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const name = (cells.name ?? "").trim();
    const domain = normaliseDomain(cells.domain ?? "");
    const label = name || domain || `line ${line}`;

    if (name === "") errors.push("The company name is missing.");
    else if (name.length > 200) errors.push("The company name is longer than 200 characters.");
    if (domain === "") errors.push("The domain is missing.");
    else if (!DOMAIN.test(domain)) errors.push(`"${cells.domain}" is not a valid domain such as example.com.`);

    const website = (cells.website_url ?? "").trim() || (DOMAIN.test(domain) ? `https://${domain}` : "");
    if (website) {
      const problem = checkOutboundUrl(website, companyDomain(website), { allowAts: false });
      if (problem) errors.push(`The website ${problem}.`);
      else if (DOMAIN.test(domain) && companyDomain(website) !== domain) warnings.push(`The website's host is not ${domain}.`);
    }
    const careers = (cells.careers_url ?? "").trim();
    if (careers) {
      const problem = checkOutboundUrl(careers, DOMAIN.test(domain) ? domain : null, { allowAts: true });
      if (problem) errors.push(`The careers page ${problem}.`);
    }
    const description = (cells.description ?? "").trim();
    if (description.length > 2000) errors.push("The description is longer than 2000 characters.");

    const types: CompanyType[] = [];
    for (const t of list(cells.types)) {
      const key = t.toLowerCase();
      if ((COMPANY_TYPES as readonly string[]).includes(key)) {
        if (!types.includes(key as CompanyType)) types.push(key as CompanyType);
      } else errors.push(`"${t}" is not a company type (use startup, mnc, or product).`);
    }
    if (types.length === 0 && !errors.some((e) => e.includes("company type"))) warnings.push("No company type: it will not appear under Startup, MNC, or Product.");

    let ownership: OwnershipStatus | null = null;
    const ownershipRaw = (cells.ownership_status ?? "").trim().toLowerCase();
    if (ownershipRaw !== "") {
      if ((OWNERSHIP_STATUSES as readonly string[]).includes(ownershipRaw)) ownership = ownershipRaw as OwnershipStatus;
      else errors.push(`"${cells.ownership_status}" is not an ownership status (use ${OWNERSHIP_STATUSES.join(", ")}).`);
    }

    let stage: StartupStage | null = null;
    const stageRaw = (cells.startup_stage ?? "").trim();
    const legacyStatus = stageRaw.toLowerCase();
    if (legacyStatus === "public" || legacyStatus === "acquired") {
      // A file made before ADR-0017: Public and Acquired are an ownership status now (import_commit does the same).
      if (ownership && ownership !== legacyStatus) errors.push(`The stage "${stageRaw}" and the ownership status "${ownership}" disagree.`);
      else {
        ownership = legacyStatus;
        warnings.push(`"${stageRaw}" is an ownership status now, not a startup stage; it is imported as the ownership status.`);
      }
    } else if (stageRaw !== "") {
      stage = parseStage(stageRaw);
      if (!stage) errors.push(`"${cells.startup_stage}" is not a startup stage.`);
      else if (!types.includes("startup")) errors.push("A startup stage needs the type startup.");
    }

    const citySlug = cityBy.get((cells.city ?? "").trim().toLowerCase()) ?? null;
    if ((cells.city ?? "").trim() === "") errors.push("The city is missing.");
    else if (!citySlug) errors.push(`"${cells.city}" is not a city this site covers (${ref.cities.map((c) => c.name).join(", ")}).`);

    const sectors: string[] = [];
    for (const s of list(cells.sectors)) {
      const slug = sectorBy.get(s.toLowerCase()) ?? sectorBy.get(slugOf(s));
      if (!slug) errors.push(`"${s}" is not a known sector.`);
      else if (!sectors.includes(slug)) sectors.push(slug);
    }

    const address = (cells.address ?? "").trim();
    if (address === "") errors.push("The address is missing.");

    const lat = Number(cells.lat);
    const lng = Number(cells.lng);
    const hasCoords = (cells.lat ?? "").trim() !== "" && (cells.lng ?? "").trim() !== "";
    if (!hasCoords || !Number.isFinite(lat) || !Number.isFinite(lng)) errors.push("The latitude and longitude must be numbers.");
    else if (Math.abs(lat) > 90 || Math.abs(lng) > 180) errors.push("The latitude or longitude is out of range.");
    else if (lat < INDIA.latMin || lat > INDIA.latMax || lng < INDIA.lngMin || lng > INDIA.lngMax) {
      warnings.push("The point is outside India: are the latitude and longitude the right way round?");
    }

    let accuracy = (cells.accuracy ?? "").trim().toLowerCase();
    if (accuracy === "") {
      accuracy = "locality";
      warnings.push("No accuracy given: locality is assumed, so the office will be queued for review.");
    } else if (!ACCURACIES.includes(accuracy)) errors.push(`"${cells.accuracy}" is not an accuracy (${ACCURACIES.join(", ")}).`);

    let neighbourhood: string | null = null;
    let techPark: string | null = null;
    if (citySlug) {
      const hood = (cells.neighbourhood ?? "").trim();
      if (hood) {
        neighbourhood = hoodBy.get(`${citySlug}|${hood.toLowerCase()}`) ?? hoodBy.get(`${citySlug}|${slugOf(hood)}`) ?? null;
        if (!neighbourhood) errors.push(`"${hood}" is not a neighbourhood of this city.`);
      }
      const park = (cells.tech_park ?? "").trim();
      if (park) {
        techPark = parkBy.get(`${citySlug}|${park.toLowerCase()}`) ?? parkBy.get(`${citySlug}|${slugOf(park)}`) ?? null;
        if (!techPark) errors.push(`"${park}" is not a tech park of this city.`);
      }
    }

    if (errors.length > 0) return { line, status: "error", errors, warnings, label, payload: null };

    const officeKey = `${domain}|${citySlug}|${address.toLowerCase()}`;
    let status: ImportStatus;
    if (ref.existingOffices.has(officeKey) || seenOffices.has(officeKey)) status = "duplicate-office";
    else if (ref.existingDomains.has(domain) || seenDomains.has(domain)) status = "attach";
    else status = "new";
    seenDomains.add(domain);
    seenOffices.add(officeKey);
    if (status === "duplicate-office") warnings.push("This office is already listed, so the row is skipped.");

    return {
      line,
      status,
      errors,
      warnings,
      label,
      payload: {
        name,
        domain,
        website_url: website,
        careers_url: careers || null,
        description: description || null,
        types,
        startup_stage: stage,
        ownership_status: ownership,
        sectors,
        city: citySlug!,
        address,
        lat,
        lng,
        accuracy,
        neighbourhood,
        tech_park: techPark,
      },
    };
  });
}

export type ImportSummary = { rows: number; new: number; attach: number; duplicateOffice: number; errors: number; warnings: number };

export function summariseImport(results: readonly ImportRowResult[]): ImportSummary {
  return {
    rows: results.length,
    new: results.filter((r) => r.status === "new").length,
    attach: results.filter((r) => r.status === "attach").length,
    duplicateOffice: results.filter((r) => r.status === "duplicate-office").length,
    errors: results.filter((r) => r.status === "error").length,
    warnings: results.reduce((n, r) => n + r.warnings.length, 0),
  };
}

/** The rows to send to `import_commit` (new companies and added offices), and the file line of each, in the same order. */
export function rowsToCommit(results: readonly ImportRowResult[]): { rows: ImportPayloadRow[]; lines: number[] } {
  const send = results.filter((r) => (r.status === "new" || r.status === "attach") && r.payload);
  return { rows: send.map((r) => r.payload!), lines: send.map((r) => r.line) };
}
