import type { Metadata } from "next";
import Link from "next/link";
import { FeedbackForm } from "@/components/feedback/feedback-form";

export const metadata: Metadata = {
  title: "Suggest a company",
  description: "Tell us about a company with an office in Bengaluru or Chennai that is not on the map yet.",
  alternates: { canonical: "/suggest" },
};

export default function SuggestPage() {
  return (
    <main className="mx-auto w-full max-w-[72ch] flex-1 px-4 py-8 sm:px-6" data-testid="suggest-page">
      <Link href="/" className="inline-flex min-h-11 items-center">
        Company Map
      </Link>
      <h1 className="mt-4 text-4xl font-bold">Suggest a company</h1>
      <p className="mt-3 text-lg text-muted-foreground">
        Know a company with an office in Bengaluru or Chennai that is not on the map? Tell us its name and send a link to a page that shows it exists. A person checks every
        suggestion before anything is added.
      </p>
      <div className="mt-6">
        <FeedbackForm mode="suggestion" title="Suggest a company" />
      </div>
    </main>
  );
}
