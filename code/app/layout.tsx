import type { Metadata } from "next";
import { Overpass } from "next/font/google";
import { INDEXABLE, SITE_URL } from "@/lib/site";
import "./globals.css";

const overpass = Overpass({
  variable: "--font-overpass",
  subsets: ["latin"],
  display: "swap",
});

// "Company Map" is a working title until D-08 names the product.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Company Map",
  description:
    "Find companies in Bengaluru and Chennai by where their offices are, then apply on the employer's own site.",
  // Staging and other non-production builds are never indexed (ADR-0006).
  robots: INDEXABLE ? undefined : { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${overpass.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
