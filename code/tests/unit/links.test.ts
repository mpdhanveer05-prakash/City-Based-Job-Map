import { describe, expect, it } from "vitest";
import { checkCompanyLinks, checkOutboundUrl, companyDomain, KNOWN_ATS_HOSTS } from "@/lib/links";

const check = (url: string, domain: string | null = "acme.example", allowAts = true) => checkOutboundUrl(url, domain, { allowAts });

describe("checkOutboundUrl", () => {
  it("accepts https on the company's own domain and its subdomains", () => {
    expect(check("https://acme.example/careers/1")).toBeNull();
    expect(check("https://www.acme.example/jobs")).toBeNull();
    expect(check("https://careers.acme.example/jobs?id=7#apply")).toBeNull();
  });

  it("accepts a known applicant-tracking host for Apply links", () => {
    expect(check("https://boards.greenhouse.io/acme/jobs/1")).toBeNull();
    expect(check("https://jobs.lever.co/acme/abc")).toBeNull();
    expect(check("https://acme.myworkdayjobs.com/en-US/careers")).toBeNull();
    for (const host of KNOWN_ATS_HOSTS) expect(check(`https://${host}/x`)).toBeNull();
  });

  it("does not accept an applicant-tracking host where only the company's domain may be used", () => {
    expect(check("https://boards.greenhouse.io/acme", "acme.example", false)).toMatch(/neither acme.example nor a known/);
  });

  it("refuses http, other schemes, and malformed text", () => {
    expect(check("http://acme.example/careers")).toBe("must be https");
    expect(check("javascript:alert(1)")).toBe("must be https");
    expect(check("data:text/html,hi")).toBe("must be https");
    expect(check("ftp://acme.example/x")).toBe("must be https");
    expect(check("//acme.example/x")).toBe("not a valid URL");
    expect(check("")).toBe("not a valid URL");
    expect(check("acme.example/careers")).toBe("not a valid URL");
  });

  it("refuses look-alike hosts: a suffix is not a subdomain", () => {
    expect(check("https://evil-acme.example/x")).toMatch(/neither/);
    expect(check("https://acme.example.evil.test/x")).toMatch(/neither/);
    expect(check("https://notgreenhouse.io/x")).toMatch(/neither/);
    expect(check("https://greenhouse.io.evil.test/x")).toMatch(/neither/);
  });

  it("refuses credentials in the URL, localhost, IP addresses, and single-label hosts", () => {
    expect(check("https://user:pass@acme.example/x")).toMatch(/user name or password/);
    expect(check("https://acme.example@evil.test/x")).toMatch(/user name or password/);
    expect(check("https://localhost/x")).toMatch(/named host/);
    expect(check("https://app.localhost/x")).toMatch(/named host/);
    expect(check("https://203.0.113.9/x")).toMatch(/named host/);
    expect(check("https://[::1]/x")).toMatch(/named host/);
    expect(check("https://intranet/x", "intranet")).toMatch(/fully qualified/);
  });

  it("is case-insensitive about the host", () => {
    expect(check("https://ACME.Example/Careers")).toBeNull();
  });

  it("cannot check a link when the company has no usable domain", () => {
    expect(check("https://acme.example/x", null, false)).toMatch(/cannot be checked/);
    expect(check("https://jobs.lever.co/x", null, true)).toBeNull();
  });
});

describe("companyDomain", () => {
  it("takes the host without www", () => {
    expect(companyDomain("https://www.Acme.example/about")).toBe("acme.example");
    expect(companyDomain("https://acme.example")).toBe("acme.example");
    expect(companyDomain("nonsense")).toBeNull();
  });
});

describe("checkCompanyLinks", () => {
  const company = {
    slug: "acme",
    websiteUrl: "https://acme.example",
    careersUrl: "https://acme.example/careers",
    jobs: [
      { id: "j1", applyUrl: "https://acme.example/careers/1" },
      { id: "j2", applyUrl: "https://boards.greenhouse.io/acme/2" },
    ],
  };

  it("passes a company whose links all belong to it", () => {
    expect(checkCompanyLinks(company)).toEqual([]);
  });

  it("names every problem with the company and the link", () => {
    const problems = checkCompanyLinks({
      ...company,
      websiteUrl: "http://acme.example",
      careersUrl: "https://elsewhere.test/careers",
      jobs: [
        { id: "j9", applyUrl: "https://phish.test/apply" },
        { id: "j1", applyUrl: "https://acme.example/careers/1" },
      ],
    });
    expect(problems.map((p) => p.url)).toEqual(["http://acme.example", "https://elsewhere.test/careers", "https://phish.test/apply"]);
    expect(problems[0].reason).toBe("acme: website must be https");
    expect(problems[2].reason).toMatch(/^acme: apply link of job j9 host phish.test is neither/);
  });

  it("allows a company with no careers page", () => {
    expect(checkCompanyLinks({ ...company, careersUrl: null })).toEqual([]);
  });
});
