"use client";

import { useState, type ReactNode } from "react";

/**
 * A "Tell us" disclosure that builds its form only once it has been opened. The form loads Cloudflare's Turnstile script,
 * and a visitor who never opens it should not make a request to a third party (docs/security.md, "Privacy").
 */
export function ReportDisclosure({ summary, children }: { summary: string; children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  return (
    <details onToggle={(e) => e.currentTarget.open && setOpened(true)}>
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-link underline underline-offset-3">{summary}</summary>
      <div className="mt-3">{opened ? children : null}</div>
    </details>
  );
}
