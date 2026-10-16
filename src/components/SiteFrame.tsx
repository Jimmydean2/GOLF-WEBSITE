import type { ReactNode } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import JuniorCampsPromo from "@/components/JuniorCampsPromo";
import ScrollToTop from "@/components/ScrollToTop";
import { inter, playfair } from "@/app/fonts";
import { season } from "@/lib/season";
import { configuredOpensAt, isSeasonPublic } from "@/lib/registrationWindow";
import { getMessages } from "@/lib/i18n";
import type { Lang } from "@/lib/lang";

function openingMoment(): string | null {
  const opens = configuredOpensAt();
  return opens.ok ? opens.iso : null;
}

// The <html> shell shared by the English and French root layouts: only the language, the
// header and the footer differ.
export default function SiteFrame({ lang, children }: { lang: Lang; children: ReactNode }) {
  return (
    <html lang={getMessages(lang).lang.htmlLang} className={`${playfair.variable} ${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-cream text-ink">
        <ScrollToTop />
        <Navbar lang={lang} />
        <main className="flex-1">{children}</main>
        <Footer lang={lang} />
        {/* Decided when the site is built: a draft calendar shows no advert at all, and the
            wording follows the opening moment. The form and the endpoint decide for real. */}
        {lang === "en" && <JuniorCampsPromo year={season.year} show={isSeasonPublic() && configuredOpensAt().ok} opensAt={openingMoment()} />}
      </body>
    </html>
  );
}
