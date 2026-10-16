import type { Metadata } from "next";
import JuniorCampsView from "@/components/JuniorCampsView";
import { juniorCamps } from "@/lib/content";
import { getMessages } from "@/lib/i18n";
import { campsPath } from "@/lib/i18n/routes";

const m = getMessages("en");

export const metadata: Metadata = {
  title: m.camp.metaTitle(juniorCamps.year),
  description: m.camp.metaDescription(juniorCamps.year),
  alternates: { canonical: campsPath("en"), languages: { en: campsPath("en"), "fr-CA": campsPath("fr") } },
};

export default function JuniorCampsPage() {
  return <JuniorCampsView lang="en" />;
}
