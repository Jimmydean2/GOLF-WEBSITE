import type { Metadata } from "next";
import PrivacyNotice from "@/components/PrivacyNotice";
import { getMessages } from "@/lib/i18n";
import { privacyPath } from "@/lib/i18n/routes";

export const metadata: Metadata = {
  title: getMessages("en").privacy.metaTitle,
  alternates: { canonical: privacyPath("en"), languages: { en: privacyPath("en"), "fr-CA": privacyPath("fr") } },
};

export default function PrivacyPage() {
  return <PrivacyNotice lang="en" />;
}
