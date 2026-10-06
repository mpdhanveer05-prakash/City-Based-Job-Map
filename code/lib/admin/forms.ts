// The admin forms' checks (P7-02): what a company, an office, or a job needs before it is sent to the database. These
// give the admin a message next to the field; they are not the security boundary. Row-level security, the triggers, and
// the CHECK constraints in Postgres decide what is stored, and their messages come back through `describeError`.
import "../zod-config.ts";
import { z } from "zod";
import { checkOutboundUrl, companyDomain } from "../links.ts";
import { COMPANY_TYPES, OWNERSHIP_STATUSES, STARTUP_STAGES, slugSchema } from "../filters/schema.ts";

export type FieldErrors = Record<string, string>;
export type Checked<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

/** A company name as a slug: lower case, letters and digits, single hyphens (the same rule as SQL `slugify`). */
export const slugify = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function run<T>(schema: z.ZodType<T>, input: unknown): Checked<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return { ok: false, errors };
}

const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} is longer than ${max} characters.`);

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} is longer than ${max} characters.`)
    .transform((v) => (v === "" ? null : v));

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** `https://www.Example.com/about` becomes `example.com`. */
export function normaliseDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, "");
}

export const COMPANY_STATUSES = ["draft", "published", "unpublished"] as const;
export const OFFICE_STATUSES = ["draft", "published", "unpublished"] as const;
export const JOB_STATUSES = ["draft", "active", "suspect", "expired", "withdrawn"] as const;
export const ACCURACIES = ["rooftop", "building", "campus", "street", "locality"] as const;
export const VERIFICATIONS = ["unverified", "auto", "reviewed"] as const;
export const WORK_MODES = ["onsite", "hybrid", "remote"] as const;

// ---- company -----------------------------------------------------------------------------------------------------

const companySchema = z
  .object({
    name: text("The name", 200),
    slug: z.string().trim(),
    domain: z.string().transform(normaliseDomain),
    website_url: z.string().trim(),
    careers_url: z.string().trim(),
    description: optionalText("The description", 2000),
    startup_stage: z.string().trim(),
    // Independent of the types (ADR-0017); empty means unknown.
    ownership_status: z.string().trim().default(""),
    types: z.array(z.enum(COMPANY_TYPES)),
    sectors: z.array(slugSchema),
    status: z.enum(COMPANY_STATUSES),
  })
  .superRefine((c, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (c.domain === "") issue("domain", "The domain is required.");
    else if (!DOMAIN.test(c.domain)) issue("domain", "The domain must look like example.com.");
    if (c.slug !== "" && !slugSchema.safeParse(c.slug).success) issue("slug", "The slug may use lower-case letters, digits, and single hyphens.");
    const website = c.website_url || (DOMAIN.test(c.domain) ? `https://${c.domain}` : "");
    const websiteProblem = website ? checkOutboundUrl(website, companyDomain(website), { allowAts: false }) : "is required";
    if (websiteProblem) issue("website_url", `The website ${websiteProblem}.`);
    if (c.careers_url) {
      const problem = checkOutboundUrl(c.careers_url, DOMAIN.test(c.domain) ? c.domain : null, { allowAts: true });
      if (problem) issue("careers_url", `The careers page ${problem}.`);
    }
    if (c.startup_stage !== "") {
      if (!(STARTUP_STAGES as readonly string[]).includes(c.startup_stage)) issue("startup_stage", "That is not a startup stage.");
      else if (!c.types.includes("startup")) issue("startup_stage", "A startup stage needs the type Startup.");
    }
    if (c.ownership_status !== "" && !(OWNERSHIP_STATUSES as readonly string[]).includes(c.ownership_status)) {
      issue("ownership_status", "That is not an ownership status.");
    }
  });

export type CompanyForm = z.input<typeof companySchema>;
export type CompanyPayload = {
  name: string;
  slug: string;
  domain: string;
  website_url: string;
  careers_url: string | null;
  description: string | null;
  startup_stage: string | null;
  ownership_status: string | null;
  status: (typeof COMPANY_STATUSES)[number];
};

export function checkCompanyForm(input: CompanyForm): Checked<{ company: CompanyPayload; types: string[]; sectors: string[] }> {
  const r = run(companySchema, input);
  if (!r.ok) return r;
  const c = r.value;
  return {
    ok: true,
    value: {
      company: {
        name: c.name,
        slug: c.slug || slugify(c.name),
        domain: c.domain,
        website_url: c.website_url || `https://${c.domain}`,
        careers_url: c.careers_url || null,
        description: c.description,
        startup_stage: c.startup_stage || null,
        ownership_status: c.ownership_status || null,
        status: c.status,
      },
      types: [...new Set(c.types)],
      sectors: [...new Set(c.sectors)],
    },
  };
}

// ---- office ------------------------------------------------------------------------------------------------------

/** A number from a form field: an empty field is not zero, it is missing. */
const toNumber = (v: string | number): number => (typeof v === "string" && v.trim() === "" ? Number.NaN : Number(v));

const idOrNull = z.union([z.string(), z.number(), z.null()]).transform((v) => (v === "" || v === null ? null : Number(v)));

const officeSchema = z.object({
  company_id: z.string().uuid("Choose a company."),
  city_id: z.union([z.string(), z.number()]).transform(Number).pipe(z.number().int().positive("Choose a city.")),
  neighbourhood_id: idOrNull,
  tech_park_id: idOrNull,
  address: text("The address", 300),
  lat: z.union([z.string(), z.number()]).transform(toNumber).pipe(z.number("The latitude must be a number.").min(-90, "The latitude is out of range.").max(90, "The latitude is out of range.")),
  lng: z.union([z.string(), z.number()]).transform(toNumber).pipe(z.number("The longitude must be a number.").min(-180, "The longitude is out of range.").max(180, "The longitude is out of range.")),
  accuracy: z.enum(ACCURACIES),
  verification: z.enum(VERIFICATIONS),
  status: z.enum(OFFICE_STATUSES),
  outside_reviewed: z.boolean(),
});

export type OfficeForm = z.input<typeof officeSchema>;
export type OfficePayload = {
  company_id: string;
  city_id: number;
  neighbourhood_id: number | null;
  tech_park_id: number | null;
  address: string;
  /** EWKT text: PostgREST casts it to the geography column. Longitude first. */
  geom: string;
  accuracy: (typeof ACCURACIES)[number];
  verification: (typeof VERIFICATIONS)[number];
  status: (typeof OFFICE_STATUSES)[number];
  outside_reviewed: boolean;
};

export function checkOfficeForm(input: OfficeForm): Checked<OfficePayload> {
  const r = run(officeSchema, input);
  if (!r.ok) return r;
  const { lat, lng, ...rest } = r.value;
  return { ok: true, value: { ...rest, geom: `SRID=4326;POINT(${lng} ${lat})` } };
}

// ---- job ---------------------------------------------------------------------------------------------------------

const optionalNumber = (label: string, min: number, max: number) =>
  z
    .union([z.string(), z.number(), z.null()])
    .transform((v) => (v === "" || v === null ? null : Number(v)))
    .pipe(z.number(`${label} must be a number.`).int(`${label} must be a whole number.`).min(min, `${label} must be at least ${min}.`).max(max, `${label} must be at most ${max}.`).nullable());

const jobSchema = z
  .object({
    company_id: z.string().uuid("Choose a company."),
    title: text("The title", 200),
    apply_url: z.string().trim().min(1, "The apply link is required."),
    status: z.enum(JOB_STATUSES),
    work_mode: z.string().trim(),
    exp_min_years: optionalNumber("The minimum experience", 0, 60),
    exp_max_years: optionalNumber("The maximum experience", 0, 60),
    posted_at: z.string().trim(),
    source_id: z.union([z.string(), z.number()]).transform(Number).pipe(z.number().int().positive("Choose a source.")),
    city_ids: z.array(z.union([z.string(), z.number()]).transform(Number)).min(1, "Choose at least one city."),
    /** The company's domain, so the apply link can be checked against it. Not stored. */
    company_domain: z.string().trim(),
  })
  .superRefine((j, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    const problem = checkOutboundUrl(j.apply_url, j.company_domain || null, { allowAts: true });
    if (problem) issue("apply_url", `The apply link ${problem}.`);
    if (j.work_mode !== "" && !(WORK_MODES as readonly string[]).includes(j.work_mode)) issue("work_mode", "That is not a work mode.");
    if (j.exp_min_years !== null && j.exp_max_years !== null && j.exp_min_years > j.exp_max_years) issue("exp_max_years", "The maximum experience is below the minimum.");
    if (j.posted_at !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(j.posted_at)) issue("posted_at", "The posting date must look like 2026-10-05.");
  });

export type JobForm = z.input<typeof jobSchema>;
export type JobPayload = {
  company_id: string;
  title: string;
  apply_url: string;
  status: (typeof JOB_STATUSES)[number];
  work_mode: string | null;
  exp_min_years: number | null;
  exp_max_years: number | null;
  posted_at: string | null;
  source_id: number;
};

export function checkJobForm(input: JobForm): Checked<{ job: JobPayload; city_ids: number[] }> {
  const r = run(jobSchema, input);
  if (!r.ok) return r;
  const j = r.value;
  return {
    ok: true,
    value: {
      job: {
        company_id: j.company_id,
        title: j.title,
        apply_url: j.apply_url,
        status: j.status,
        work_mode: j.work_mode || null,
        exp_min_years: j.exp_min_years,
        exp_max_years: j.exp_max_years,
        posted_at: j.posted_at || null,
        source_id: j.source_id,
      },
      city_ids: [...new Set(j.city_ids)],
    },
  };
}
