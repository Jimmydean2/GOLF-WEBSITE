import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../globals.css";
import SiteFrame from "@/components/SiteFrame";
import { business } from "@/lib/content";

// The French camp pages (everything under /fr). Only the camp journey is translated; the rest
// of the site (lessons, clinics, about, contact) is English and these pages do not link to it.
export const metadata: Metadata = {
  title: `${business.name} | Camps de golf juniors`,
  description: "Camps de golf juniors d’été à Golf Dorval, avec l’entraîneur James, professionnel certifié de la PGA du Canada.",
};

export default function FrenchRootLayout({ children }: { children: ReactNode }) {
  return <SiteFrame lang="fr">{children}</SiteFrame>;
}
