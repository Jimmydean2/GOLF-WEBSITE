import type { Metadata } from "next";
import JuniorCampsView from "@/components/JuniorCampsView";
import { juniorCamps } from "@/lib/content";
import { getMessages } from "@/lib/i18n";
import { campsPath } from "@/lib/i18n/routes";

const m = getMessages("fr");

export const metadata: Metadata = {
  title: m.camp.metaTitle(juniorCamps.year),
  description: m.camp.metaDescription(juniorCamps.year),
  alternates: { canonical: campsPath("fr"), languages: { en: campsPath("en"), "fr-CA": campsPath("fr") } },
};

export default function CampsJuniorsPage() {
  return <JuniorCampsView lang="fr" />;
}
