// Outbound links (P6-03, docs/security.md "Outbound links and content"). An Apply or Visit website URL must be
// https and must belong to the company or to a known applicant-tracking host. It is checked at build time: a URL
// that fails fails the build, so a bad row in the data never reaches a visitor. Links are then used unchanged (no
// redirect service), with rel="noopener noreferrer".

/**
 * Hosts of applicant-tracking systems and job boards that companies post through. A job's Apply link may point at
 * one of these (or a subdomain) instead of the company's own domain. [Proposal: the list is the product owner's to
 * extend; adding a host is a one-line change reviewed with the data source that needs it (D-04).]
 */
export const KNOWN_ATS_HOSTS: readonly string[] = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workable.com",
  "smartrecruiters.com",
  "myworkdayjobs.com",
  "recruitee.com",
  "bamboohr.com",
  "breezy.hr",
  "icims.com",
  "jobvite.com",
  "teamtailor.com",
  "zohorecruit.com",
  "freshteam.com",
  "keka.com",
];

export type LinkProblem = { url: string; reason: string };

const hostMatches = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** `www.example.com` and `example.com` are the same company domain. */
export const companyDomain = (websiteUrl: string): string | null => {
  try {
    return new URL(websiteUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Returns what is wrong with an outbound URL, or null. `domain` is the company's domain (from its website). With
 * `allowAts`, a host in KNOWN_ATS_HOSTS also passes (job apply links and careers pages).
 */
export function checkOutboundUrl(url: string, domain: string | null, { allowAts }: { allowAts: boolean }): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "not a valid URL";
  }
  if (parsed.protocol !== "https:") return "must be https";
  if (parsed.username || parsed.password) return "must not contain a user name or password";
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || IPV4.test(host) || host.startsWith("[")) {
    return "must be a named host, not localhost or an IP address";
  }
  if (!host.includes(".")) return "must be a fully qualified host name";
  if (domain && hostMatches(host, domain)) return null;
  if (allowAts && KNOWN_ATS_HOSTS.some((ats) => hostMatches(host, ats))) return null;
  return domain
    ? `host ${host} is neither ${domain} nor a known applicant-tracking host`
    : `host ${host} cannot be checked: the company has no usable website`;
}

export type CompanyLinks = {
  slug: string;
  websiteUrl: string;
  careersUrl: string | null;
  jobs: ReadonlyArray<{ id: string; applyUrl: string }>;
};

/**
 * Checks every outbound URL of a company: the website (https and well formed; it defines the domain), the careers
 * page, and each job's Apply link (the company's domain or a known applicant-tracking host).
 */
export function checkCompanyLinks(company: CompanyLinks): LinkProblem[] {
  const problems: LinkProblem[] = [];
  const domain = companyDomain(company.websiteUrl);
  const add = (url: string, reason: string | null, what: string) => {
    if (reason) problems.push({ url, reason: `${company.slug}: ${what} ${reason}` });
  };
  add(company.websiteUrl, checkOutboundUrl(company.websiteUrl, domain, { allowAts: false }), "website");
  if (company.careersUrl) add(company.careersUrl, checkOutboundUrl(company.careersUrl, domain, { allowAts: true }), "careers page");
  for (const job of company.jobs) {
    add(job.applyUrl, checkOutboundUrl(job.applyUrl, domain, { allowAts: true }), `apply link of job ${job.id}`);
  }
  return problems;
}
