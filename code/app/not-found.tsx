import Link from "next/link";

// Next's default 404 follows the OS colour scheme; this keeps it on Milky.
export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-24 sm:px-6">
      <h1 className="text-4xl font-bold">This page doesn&apos;t exist.</h1>
      <p className="mt-4 max-w-[60ch] text-lg text-muted-foreground">
        The link may be old, or the company may have moved.
      </p>
      <p className="mt-8">
        <Link href="/">Go to the home page</Link>
      </p>
    </main>
  );
}
