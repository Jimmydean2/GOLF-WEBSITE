import type { Metadata } from "next";
import PrivacyNotice from "@/components/PrivacyNotice";
import { getMessages } from "@/lib/i18n";
import { privacyPath } from "@/lib/i18n/routes";

export const metadata: Metadata = {
  title: getMessages("fr").privacy.metaTitle,
  alternates: { canonical: privacyPath("fr"), languages: { en: privacyPath("en"), "fr-CA": privacyPath("fr") } },
};

export default function PageConfidentialite() {
  return <PrivacyNotice lang="fr" />;
}
