// Where a company's logo lives: the public `company-logos` bucket in Supabase Storage (docs/security.md,
// "Company logos are fetched from our own Storage host only"). A company without a logo, or a build without a
// Supabase project, has none: the map shows the letter fallback.

const placeholder = (value: string | undefined) => !value || value.startsWith("replace-");

const storageBase = (): string | null => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return placeholder(url) ? null : `${url!.replace(/\/+$/, "")}/storage/v1/object/public/company-logos`;
};

/** The URL of a company's logo, or null when it has none. */
export function logoUrl(logoKey: string | null): string | null {
  if (!logoKey) return null;
  const base = storageBase();
  if (!base || logoKey.includes("..") || logoKey.startsWith("/")) return null;
  return `${base}/${logoKey.split("/").map(encodeURIComponent).join("/")}`;
}

/** The host logos may come from, for the atlas's `allowedHosts`; null when there is no Storage host. */
export function logoHost(): string | null {
  const base = storageBase();
  return base ? new URL(base).hostname : null;
}
