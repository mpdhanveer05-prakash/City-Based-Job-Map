import { notFound } from "next/navigation";
import { connection } from "next/server";

// /dev/* holds design and prototype pages (tokens, and later the P2 map prototype).
// They exist in development, and in a production build only when DEV_ROUTES=on.
// Rendered per request, so the flag is read at runtime (a Worker var on Cloudflare)
// and /dev/tokens doubles as the server-rendering CPU probe for P1-02.
export default async function DevLayout({ children }: LayoutProps<"/dev">) {
  await connection();
  if (process.env.NODE_ENV === "production" && process.env.DEV_ROUTES !== "on") {
    notFound();
  }
  return children;
}
