import { initialOf, swatchIndex } from "@/map/atlas/fallback";
import { SWATCH_TOKENS } from "@/map/theme";
import { logoUrl } from "@/lib/data/logo";
import { cn } from "@/lib/utils";

/**
 * A company's mark: its logo in a round frame, or the Ink initial on one of five muted swatches when it has none
 * (design-system.md §2). Round means a company. The mark is decorative: the name is always written beside it.
 */
export function CompanyAvatar({ name, logoKey, className }: { name: string; logoKey: string | null; className?: string }) {
  const url = logoUrl(logoKey);
  const frame = cn("flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-moss text-lg font-extrabold", className);
  if (url) {
    // A plain img: next/image's default loader is not available in a static export (ADR-0006).
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className={cn(frame, "bg-milky object-contain")} />;
  }
  return (
    <span aria-hidden="true" className={frame} style={{ backgroundColor: `var(${SWATCH_TOKENS[swatchIndex(name)]})` }}>
      {initialOf(name)}
    </span>
  );
}
