import { notFound } from "next/navigation";

// /dev/* holds design and prototype pages (tokens, and later the P2 map prototype).
// They exist in development, and in a production build only when DEV_ROUTES=on.
export default function DevLayout({ children }: LayoutProps<"/dev">) {
  if (process.env.NODE_ENV === "production" && process.env.DEV_ROUTES !== "on") {
    notFound();
  }
  return children;
}
