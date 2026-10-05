import type { Metadata } from "next";
import { AdminRoot } from "@/components/admin/admin-root";

// The admin workspace is client-rendered (ADR-0006) and never indexed. Its JavaScript is public: access is enforced by
// Supabase row-level security and the role checks in the database, not by anything here (docs/security.md).
export const metadata: Metadata = {
  title: { absolute: "Admin" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <AdminRoot>{children}</AdminRoot>;
}
