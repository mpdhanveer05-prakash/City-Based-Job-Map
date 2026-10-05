"use client";

import { Button } from "@/components/ui/button";
import { sendClick, type ClickKind } from "@/lib/beacon";

type OutboundLinkProps = {
  /** The stored URL, unchanged: it was checked at build time (lib/links.ts). */
  href: string;
  kind: ClickKind;
  /** The job's id for Apply, the company's id for Visit website. */
  targetId: string;
  variant?: "default" | "outline";
  children: React.ReactNode;
};

/**
 * A direct link to the employer (Apply or Visit website). It is a plain anchor: it works with scripts off, and
 * the click beacon (lib/beacon.ts) is only a count, sent as the link is followed and never waited for. It opens a
 * new tab with rel="noopener noreferrer" and says so to assistive technology (design-system.md §7).
 */
export function OutboundLink({ href, kind, targetId, variant = "outline", children }: OutboundLinkProps) {
  const count = () => void sendClick(kind, targetId);
  return (
    <Button asChild variant={variant}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={count}
        // A middle click opens the link in a new tab without a click event.
        onAuxClick={(event) => {
          if (event.button === 1) count();
        }}
        className={variant === "default" ? "text-primary-foreground no-underline" : "text-foreground no-underline"}
        data-testid={kind === "apply" ? "apply-link" : "website-link"}
      >
        {children}
        <span className="sr-only"> (opens the employer&apos;s site)</span>
      </a>
    </Button>
  );
}
