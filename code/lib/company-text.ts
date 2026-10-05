// The sentences on a company page (design-system.md §5 and §7). Pure, so they are unit-tested, and they never invent a
// fact: a value the data does not have is left out or said to be unknown.
import { STAGE_LABELS, TYPE_LABELS } from "./explorer/labels.ts";
import { formatDate } from "./format-date.ts";
import type { CompanyType, StartupStage } from "./filters/schema.ts";

const join = (parts: readonly string[]): string =>
  parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

/** "Startup and Product company, Series A". With no type the line is the stage alone, or empty. */
export function typeSentence(types: readonly CompanyType[], stage: StartupStage | null): string {
  const kinds = types.length > 0 ? `${join(types.map((t) => TYPE_LABELS[t]))} company` : "";
  const stageText = stage && types.includes("startup") ? STAGE_LABELS[stage] : "";
  return [kinds, stageText].filter(Boolean).join(", ");
}

type PlaceOffice = { cityName: string; area: string | null; address: string };

/** "Koramangala, Bengaluru" for one office; "3 offices in Bengaluru and Chennai" for several. Empty for none. */
export function locationLine(offices: readonly PlaceOffice[]): string {
  if (offices.length === 0) return "";
  const cities = [...new Set(offices.map((o) => o.cityName))];
  if (offices.length === 1) {
    const o = offices[0];
    return `${o.area ?? o.address}, ${o.cityName}`;
  }
  return `${offices.length} offices in ${join(cities)}`;
}

/** "Verified 12 Sep 2026", or an honest "Not yet verified". The date is UTC, so the static page is deterministic. */
export function verifiedText(lastVerifiedAt: string | null): string {
  if (!lastVerifiedAt) return "Not yet verified";
  const t = Date.parse(lastVerifiedAt);
  if (Number.isNaN(t)) return "Not yet verified";
  return `Verified ${formatDate(t)}`;
}

/** A meta description of at most 160 characters, cut at a word. */
export function metaDescription(company: { name: string; description: string | null; types: readonly CompanyType[] }, where: string): string {
  const base = company.description?.trim() || `${company.name}${where ? `: ${where}` : ""}.`;
  const text = `${base}`.replace(/\s+/g, " ");
  if (text.length <= 160) return text;
  const cut = text.slice(0, 157);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 100))}…`;
}

/** JSON for a `<script type="application/ld+json">`: `<` is escaped so the data can never close the tag. */
export function safeJsonLd(value: unknown): string {
  // The line separator and paragraph separator characters (code points 8232 and 8233) are line terminators in old
  // JavaScript string literals, so they are escaped as well. Each becomes a backslash, a u, and four hex digits.
  const unsafe = new RegExp("[<" + String.fromCharCode(0x2028, 0x2029) + "]", "g");
  const escape = (c: string) => String.fromCharCode(92) + "u" + c.charCodeAt(0).toString(16).padStart(4, "0");
  return JSON.stringify(value).replace(unsafe, escape);
}
