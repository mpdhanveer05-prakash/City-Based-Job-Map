import type { Metadata } from "next";
import { Overpass } from "next/font/google";
import "./globals.css";

const overpass = Overpass({
  variable: "--font-overpass",
  subsets: ["latin"],
  display: "swap",
});

// "Company Map" is a working title until D-08 names the product.
export const metadata: Metadata = {
  title: "Company Map",
  description:
    "Find companies in Bengaluru and Chennai by where their offices are, then apply on the employer's own site.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${overpass.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
