import type { Metadata } from "next";
import { Playfair_Display, Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import JuniorCampsPromo from "@/components/JuniorCampsPromo";
import ScrollToTop from "@/components/ScrollToTop";
import { business } from "@/lib/content";
import { season } from "@/lib/season";
import { configuredOpensAt, isSeasonPublic } from "@/lib/registrationWindow";

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: `${business.name} | ${business.tagline}`,
  description:
    "Private golf lessons, group clinics, and junior programs in Montreal with CPGA professional Coach James. Summer sessions at Golf Dorval, winter sessions at Royal Westcourt.",
};

function configuredOpensAtIso(): string | null {
  const opens = configuredOpensAt();
  return opens.ok ? opens.iso : null;
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${playfair.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-cream text-ink">
        <ScrollToTop />
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
        {/* Decided when the site is built: a draft calendar shows no advert at all, and the
            wording follows the opening moment. The form and the endpoint decide for real. */}
        <JuniorCampsPromo year={season.year} show={isSeasonPublic() && configuredOpensAt().ok} opensAt={configuredOpensAtIso()} />
      </body>
    </html>
  );
}
