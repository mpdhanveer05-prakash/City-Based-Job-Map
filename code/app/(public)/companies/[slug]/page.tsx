import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackToMap } from "@/components/company/back-to-map";
import { CompanyAvatar } from "@/components/company/company-avatar";
import { OutboundLink } from "@/components/company/outbound-link";
import { FeedbackForm } from "@/components/feedback/feedback-form";
import { ReportDisclosure } from "@/components/feedback/report-disclosure";
import { Button } from "@/components/ui/button";
import { locationLine, metaDescription, safeJsonLd, typeSentence, verifiedText } from "@/lib/company-text";
import { loadCompanyPages } from "@/lib/data/company-data";
import { ACCURACY_LABELS, offices as officeCount } from "@/lib/explorer/labels";
import { slugSchema } from "@/lib/filters/schema";

// Every company is a page built ahead of time (ADR-0006). A slug that is not a company is a 404; an old slug is
// redirected to the current page by public/_redirects before it gets here.
export const dynamicParams = false;

export function generateStaticParams() {
  return [...loadCompanyPages().keys()].map((slug) => ({ slug }));
}

const find = async (params: PageProps<"/companies/[slug]">["params"]) => {
  const { slug } = await params;
  return slugSchema.safeParse(slug).success ? (loadCompanyPages().get(slug) ?? null) : null;
};

export async function generateMetadata({ params }: PageProps<"/companies/[slug]">): Promise<Metadata> {
  const company = await find(params);
  if (!company) return {};
  const where = locationLine(company.offices);
  return {
    title: company.name,
    description: metaDescription(company, where),
    alternates: { canonical: `/companies/${company.slug}` },
  };
}

export default async function CompanyPage({ params }: PageProps<"/companies/[slug]">) {
  const company = await find(params);
  if (!company) notFound();

  const kind = typeSentence(company.types, company.stage, company.ownershipStatus);
  const where = locationLine(company.offices);
  const firstCity = company.cities[0]?.slug ?? "bangalore";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: company.name,
    url: company.websiteUrl,
    ...(company.description ? { description: company.description } : {}),
    ...(company.offices.length > 0
      ? { address: company.offices.map((o) => ({ "@type": "PostalAddress", streetAddress: o.address, addressLocality: o.cityName, addressCountry: "IN" })) }
      : {}),
  };

  return (
    <main className="mx-auto w-full max-w-[72ch] flex-1 px-4 py-6 sm:px-6" data-testid="company-page" data-company={company.slug}>
      <BackToMap fallbackHref={`/${firstCity}`} />

      <header className="mt-4 flex items-start gap-4">
        <CompanyAvatar name={company.name} logoKey={company.logoKey} className="size-16 text-3xl" />
        <div className="min-w-0">
          <h1 className="text-4xl font-bold" data-testid="company-name">
            {company.name}
          </h1>
          {kind && <p className="mt-1 text-sm text-muted-foreground">{kind}</p>}
          {where && <p className="text-sm text-muted-foreground">{where}</p>}
        </div>
      </header>

      {company.synthetic && (
        <p className="mt-4 text-sm text-muted-foreground" data-testid="synthetic-note">
          Synthetic data. This is not a real company.
        </p>
      )}

      {/* "View jobs" is the one next step on this page, so it is the Mantis button; "Visit website" is secondary. */}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button asChild>
          <Link href={`/companies/${company.slug}/jobs`} className="text-primary-foreground no-underline" data-testid="view-jobs">
            View jobs
          </Link>
        </Button>
        <OutboundLink href={company.websiteUrl} kind="website" targetId={company.id}>
          Visit website
        </OutboundLink>
      </div>

      <hr className="my-6 border-rule" />

      {company.description ? (
        <section aria-labelledby="about">
          <h2 id="about" className="text-2xl font-bold">
            About
          </h2>
          {/* Plain text only: React escapes it, so a description can never add markup. */}
          <p className="mt-2 max-w-[72ch] whitespace-pre-line text-base" data-testid="company-description">
            {company.description}
          </p>
        </section>
      ) : null}

      <section aria-labelledby="details" className="mt-6">
        <h2 id="details" className="text-2xl font-bold">
          Details
        </h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-base">
          <dt className="text-muted-foreground">Sectors</dt>
          <dd>{company.sectors.length > 0 ? company.sectors.join(", ") : "Not stated"}</dd>
          <dt className="text-muted-foreground">Verification</dt>
          <dd data-testid="verified">{verifiedText(company.lastVerifiedAt)}</dd>
          <dt className="text-muted-foreground">Open jobs</dt>
          <dd className="tabular-nums">{company.jobs.length}</dd>
        </dl>
      </section>

      <section aria-labelledby="offices" className="mt-6">
        <h2 id="offices" className="text-2xl font-bold">
          Offices
        </h2>
        {company.offices.length === 0 ? (
          <p className="mt-2 text-muted-foreground">No office is listed.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground tabular-nums">{officeCount(company.offices.length)}</p>
            <ul className="mt-2 divide-y divide-rule border-y border-rule" data-testid="offices">
              {company.offices.map((o) => (
                <li key={o.id} className="py-3">
                  <p className="font-semibold">
                    {o.area ? `${o.area}, ` : ""}
                    {o.cityName}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {o.address}. Location accurate to the {ACCURACY_LABELS[o.accuracy] ?? o.accuracy}.
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex flex-wrap gap-x-6">
              {company.cities.map((c) => (
                <Link key={c.slug} href={`/${c.slug}?company=${company.slug}`} data-testid={`show-on-map-${c.slug}`} className="inline-flex min-h-11 items-center">
                  Show on the map in {c.name}
                </Link>
              ))}
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="report" className="mt-8 border-t border-rule pt-4">
        <h2 id="report" className="sr-only">
          Report a problem
        </h2>
        <ReportDisclosure summary="Something wrong on this page? Tell us">
          <FeedbackForm mode="report" title="Report a problem" target={{ type: "company", legend: "Company", options: [{ id: company.id, label: company.name }] }} />
        </ReportDisclosure>
      </section>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
    </main>
  );
}
