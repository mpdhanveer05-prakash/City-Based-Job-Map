import { describe, expect, it } from "vitest";
import { checkCompanyForm, checkJobForm, checkOfficeForm, normaliseDomain, slugify, type CompanyForm, type JobForm, type OfficeForm } from "@/lib/admin/forms";

const company = (patch: Partial<CompanyForm> = {}): CompanyForm => ({
  name: "Acme Pay",
  slug: "",
  domain: "acme-pay.test",
  website_url: "",
  careers_url: "",
  description: "",
  startup_stage: "",
  types: ["startup"],
  sectors: ["fintech"],
  status: "draft",
  ...patch,
});

const errorsOf = (r: ReturnType<typeof checkCompanyForm> | ReturnType<typeof checkOfficeForm> | ReturnType<typeof checkJobForm>) => (r.ok ? {} : r.errors);

describe("slugify and normaliseDomain", () => {
  it("makes lower-case hyphenated slugs", () => {
    expect(slugify("Acme Pay (India) Pvt. Ltd.")).toBe("acme-pay-india-pvt-ltd");
    expect(slugify("  --Hello__World--  ")).toBe("hello-world");
    expect(slugify("ಬೆಂಗಳೂರು")).toBe("");
  });
  it("reduces a URL to its host", () => {
    expect(normaliseDomain("https://www.Acme.test/about?x=1#y")).toBe("acme.test");
    expect(normaliseDomain("  Acme.test:8080 ")).toBe("acme.test");
    expect(normaliseDomain("careers.acme.test")).toBe("careers.acme.test");
  });
});

describe("checkCompanyForm", () => {
  it("accepts a company and fills in the slug and the website from the name and domain", () => {
    const r = checkCompanyForm(company());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.company).toEqual({
        name: "Acme Pay",
        slug: "acme-pay",
        domain: "acme-pay.test",
        website_url: "https://acme-pay.test",
        careers_url: null,
        description: null,
        startup_stage: null,
        ownership_status: null,
        status: "draft",
      });
      expect(r.value.types).toEqual(["startup"]);
      expect(r.value.sectors).toEqual(["fintech"]);
    }
  });

  it("keeps a slug that is given, takes a pasted URL as the domain, and removes repeated values", () => {
    const r = checkCompanyForm(company({ slug: "pay", domain: "https://www.acme-pay.test/about", types: ["startup", "startup", "mnc"], sectors: ["fintech", "fintech"] }));
    expect(r.ok && r.value.company.slug).toBe("pay");
    expect(r.ok && r.value.company.domain).toBe("acme-pay.test");
    expect(r.ok && r.value.types).toEqual(["startup", "mnc"]);
    expect(r.ok && r.value.sectors).toEqual(["fintech"]);
  });

  it("says what is wrong next to the field", () => {
    expect(errorsOf(checkCompanyForm(company({ name: " " })))).toMatchObject({ name: "The name is required." });
    expect(errorsOf(checkCompanyForm(company({ name: "x".repeat(201) })))).toMatchObject({ name: expect.stringMatching(/longer than 200/) });
    expect(errorsOf(checkCompanyForm(company({ domain: "" })))).toMatchObject({ domain: "The domain is required." });
    expect(errorsOf(checkCompanyForm(company({ domain: "not a domain" })))).toMatchObject({ domain: expect.stringMatching(/look like example.com/) });
    expect(errorsOf(checkCompanyForm(company({ slug: "Bad Slug" })))).toHaveProperty("slug");
    expect(errorsOf(checkCompanyForm(company({ website_url: "http://acme-pay.test" })))).toMatchObject({ website_url: expect.stringMatching(/must be https/) });
    expect(errorsOf(checkCompanyForm(company({ careers_url: "https://elsewhere.test/jobs" })))).toMatchObject({ careers_url: expect.stringMatching(/neither acme-pay.test/) });
    expect(errorsOf(checkCompanyForm(company({ description: "x".repeat(2001) })))).toHaveProperty("description");
  });

  it("lets a careers page sit on a known applicant-tracking host", () => {
    expect(checkCompanyForm(company({ careers_url: "https://boards.greenhouse.io/acme" })).ok).toBe(true);
  });

  it("takes an ownership status without needing any type (ADR-0017)", () => {
    const r = checkCompanyForm(company({ types: ["mnc"], ownership_status: "public" }));
    expect(r.ok && r.value.company.ownership_status).toBe("public");
    expect(checkCompanyForm(company({ ownership_status: "" })).ok && checkCompanyForm(company({})).ok).toBe(true);
    expect(errorsOf(checkCompanyForm(company({ ownership_status: "listed" })))).toMatchObject({ ownership_status: "That is not an ownership status." });
    expect(errorsOf(checkCompanyForm(company({ startup_stage: "acquired" })))).toHaveProperty("startup_stage");
  });

  it("needs the type Startup for a startup stage (ADR-0004)", () => {
    expect(checkCompanyForm(company({ startup_stage: "seed" })).ok).toBe(true);
    expect(errorsOf(checkCompanyForm(company({ startup_stage: "seed", types: ["mnc"] })))).toMatchObject({ startup_stage: "A startup stage needs the type Startup." });
    expect(errorsOf(checkCompanyForm(company({ startup_stage: "gigantic" })))).toHaveProperty("startup_stage");
  });
});

const office = (patch: Partial<OfficeForm> = {}): OfficeForm => ({
  company_id: "00000000-0000-4000-8000-0000000000c1",
  city_id: "1",
  neighbourhood_id: "",
  tech_park_id: "",
  address: "1 First Road",
  lat: "12.95",
  lng: "77.62",
  accuracy: "building",
  verification: "unverified",
  status: "draft",
  outside_reviewed: false,
  ...patch,
});

describe("checkOfficeForm", () => {
  it("builds the point as EWKT with longitude first", () => {
    const r = checkOfficeForm(office());
    expect(r.ok && r.value.geom).toBe("SRID=4326;POINT(77.62 12.95)");
    expect(r.ok && r.value).toMatchObject({ city_id: 1, neighbourhood_id: null, tech_park_id: null });
  });

  it("reads area ids as numbers and an empty choice as none", () => {
    const r = checkOfficeForm(office({ neighbourhood_id: "7", tech_park_id: 3 }));
    expect(r.ok && r.value).toMatchObject({ neighbourhood_id: 7, tech_park_id: 3 });
  });

  it("says what is wrong next to the field", () => {
    expect(errorsOf(checkOfficeForm(office({ company_id: "" })))).toMatchObject({ company_id: "Choose a company." });
    expect(errorsOf(checkOfficeForm(office({ city_id: "" })))).toHaveProperty("city_id");
    expect(errorsOf(checkOfficeForm(office({ address: "" })))).toMatchObject({ address: "The address is required." });
    expect(errorsOf(checkOfficeForm(office({ lat: "north" })))).toHaveProperty("lat");
    expect(errorsOf(checkOfficeForm(office({ lat: "95" })))).toMatchObject({ lat: "The latitude is out of range." });
    expect(errorsOf(checkOfficeForm(office({ lng: "181" })))).toMatchObject({ lng: "The longitude is out of range." });
    expect(errorsOf(checkOfficeForm(office({ lat: "" })))).toHaveProperty("lat");
  });
});

const job = (patch: Partial<JobForm> = {}): JobForm => ({
  company_id: "00000000-0000-4000-8000-0000000000c1",
  title: "Backend Engineer",
  apply_url: "https://acme-pay.test/careers/1",
  status: "draft",
  work_mode: "",
  exp_min_years: "",
  exp_max_years: "",
  posted_at: "",
  source_id: "1",
  city_ids: ["1"],
  company_domain: "acme-pay.test",
  ...patch,
});

describe("checkJobForm", () => {
  it("accepts a job and turns empty optional fields into null", () => {
    const r = checkJobForm(job());
    expect(r.ok && r.value.job).toEqual({
      company_id: "00000000-0000-4000-8000-0000000000c1",
      title: "Backend Engineer",
      apply_url: "https://acme-pay.test/careers/1",
      status: "draft",
      work_mode: null,
      exp_min_years: null,
      exp_max_years: null,
      posted_at: null,
      source_id: 1,
    });
    expect(r.ok && r.value.city_ids).toEqual([1]);
  });

  it("checks the apply link against the company's domain, or a known applicant-tracking host", () => {
    expect(errorsOf(checkJobForm(job({ apply_url: "https://phish.test/apply" })))).toMatchObject({ apply_url: expect.stringMatching(/neither acme-pay.test/) });
    expect(errorsOf(checkJobForm(job({ apply_url: "http://acme-pay.test/x" })))).toMatchObject({ apply_url: expect.stringMatching(/must be https/) });
    expect(checkJobForm(job({ apply_url: "https://jobs.lever.co/acme/1" })).ok).toBe(true);
  });

  it("checks experience, work mode, date, and cities", () => {
    expect(checkJobForm(job({ exp_min_years: "2", exp_max_years: "5", work_mode: "hybrid", posted_at: "2026-10-05" })).ok).toBe(true);
    expect(errorsOf(checkJobForm(job({ exp_min_years: "5", exp_max_years: "2" })))).toHaveProperty("exp_max_years");
    expect(errorsOf(checkJobForm(job({ exp_min_years: "-1" })))).toHaveProperty("exp_min_years");
    expect(errorsOf(checkJobForm(job({ exp_min_years: "two" })))).toHaveProperty("exp_min_years");
    expect(errorsOf(checkJobForm(job({ work_mode: "mars" })))).toHaveProperty("work_mode");
    expect(errorsOf(checkJobForm(job({ posted_at: "5 Oct" })))).toHaveProperty("posted_at");
    expect(errorsOf(checkJobForm(job({ city_ids: [] })))).toMatchObject({ city_ids: "Choose at least one city." });
    expect(errorsOf(checkJobForm(job({ title: "" })))).toMatchObject({ title: "The title is required." });
    expect(errorsOf(checkJobForm(job({ source_id: "" })))).toHaveProperty("source_id");
  });
});
