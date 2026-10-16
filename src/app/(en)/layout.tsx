import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../globals.css";
import SiteFrame from "@/components/SiteFrame";
import { business } from "@/lib/content";

// The English site (every page except /fr/…). A second root layout, in (fr), serves the French
// camp pages with <html lang="fr-CA">; moving between the two is a full page load.
export const metadata: Metadata = {
  title: `${business.name} | ${business.tagline}`,
  description:
    "Private golf lessons, group clinics, and junior programs in Montreal with CPGA professional Coach James. Summer sessions at Golf Dorval, winter sessions at Royal Westcourt.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <SiteFrame lang="en">{children}</SiteFrame>;
}
