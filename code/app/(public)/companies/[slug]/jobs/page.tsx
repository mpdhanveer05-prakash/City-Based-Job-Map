import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackToMap } from "@/components/company/back-to-map";
import { Freshness } from "@/components/company/freshness";
import { OutboundLink } from "@/components/company/outbound-link";
import { loadCompanyPages } from "@/lib/data/company-data";
import { slugSchema } from "@/lib/filters/schema";

// P6-02. Each company has its own jobs page (decision D-10, option A). Option B (jobs on the company page) is
// task P6-04, switched on only if the build's file count warns.
export const dynamicParams = false;

export function generateStaticParams() {
  return [...loadCompanyPages().keys()].map((slug) => ({ slug }));
}

const find = async (params: PageProps<"/companies/[slug]/jobs">["params"]) => {
  const { slug } = await params;
  return slugSchema.safeParse(slug).success ? (loadCompanyPages().get(slug) ?? null) : null;
};

export async function generateMetadata({ params }: PageProps<"/companies/[slug]/jobs">): Promise<Metadata> {
  const company = await find(params);
  if (!company) return {};
  return {
    title: `Jobs at ${company.name}`,
    description: `Open jobs at ${company.name}. Apply on the employer's own site.`,
    alternates: { canonical: `/companies/${company.slug}/jobs` },
  };
}

export default async function CompanyJobsPage({ params }: PageProps<"/companies/[slug]/jobs">) {
  const company = await find(params);
  if (!company) notFound();

  const firstCity = company.cities[0]?.slug ?? "bangalore";
  // The freshest check among the listed jobs: the page says when the list was last confirmed, not job by job.
  const lastChecked = company.jobs.map((j) => j.lastCheckedAt).filter((t): t is string => !!t).sort().at(-1) ?? null;

  return (
    <main className="mx-auto w-full max-w-[72ch] flex-1 px-4 py-6 sm:px-6" data-testid="jobs-page" data-company={company.slug}>
      <div className="flex flex-wrap items-center gap-x-6">
        <BackToMap fallbackHref={`/${firstCity}`} />
        <Link href={`/companies/${company.slug}`} className="inline-flex min-h-11 items-center" data-testid="back-to-company">
          {company.name}
        </Link>
      </div>

      <h1 className="mt-2 text-4xl font-bold">Jobs at {company.name}</h1>
      {company.synthetic && <p className="mt-2 text-sm text-muted-foreground">Synthetic data. These are not real jobs.</p>}

      {company.jobs.length === 0 ? (
        <section className="mt-6" data-testid="no-jobs">
          <p className="text-base">This company has no open jobs listed right now.</p>
          <div className="mt-4">
            <OutboundLink href={company.websiteUrl} kind="website" targetId={company.id}>
              Visit website
            </OutboundLink>
          </div>
        </section>
      ) : (
        <>
          <div className="mt-2">
            <Freshness lastCheckedAt={lastChecked} />
          </div>
          {/* Each row is the job title and Apply, and nothing else (confirmed). */}
          <ul className="mt-4 border-t border-rule" data-testid="job-rows">
            {company.jobs.map((job) => (
              <li key={job.id} data-testid="job-row" data-job={job.id} className="flex items-center justify-between gap-4 border-b border-rule py-3">
                <span className="min-w-0 text-lg font-semibold">{job.title}</span>
                <OutboundLink href={job.applyUrl} kind="apply" targetId={job.id}>
                  Apply
                </OutboundLink>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
