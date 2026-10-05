// Writes the Content-Security-Policy into every page of the static export (P9-02). Runs after `next build`, before the
// limits check (npm "postbuild"). The policy and its reasons are in lib/csp.ts.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { injectCsp } from "../lib/csp.ts";

const dir = path.resolve(process.argv[2] ?? "out");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseOrigin = url && !url.startsWith("replace-") ? new URL(url).origin : null;
function walk(d: string): string[] {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".html") ? [path.join(d, e.name)] : []));
}

let pages = 0;
for (const file of walk(dir)) {
  const html = readFileSync(file, "utf8");
  // The /dev pages (built only with DEV_ROUTES=on) draw their synthetic logos as blob: URLs and fetch them like real ones.
  // Real logos come from the Storage origin, which is already allowed, so no public page gets blob: in connect-src.
  const isDevPage = path.relative(dir, file).split(path.sep)[0] === "dev";
  const next = injectCsp(html, { supabaseOrigin, extraConnect: isDevPage ? ["blob:"] : [] });
  if (next !== html) {
    writeFileSync(file, next);
    pages++;
  }
}
console.log(`inject-csp: policy written to ${pages} pages${supabaseOrigin ? ` (Supabase ${supabaseOrigin})` : " (no Supabase project)"}`);
