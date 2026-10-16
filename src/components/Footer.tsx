import Image from "next/image";
import Link from "next/link";
import { business, locations, nav } from "@/lib/content";
import { campsPath, getMessages, privacyPath } from "@/lib/i18n";
import type { Lang } from "@/lib/lang";

export default function Footer({ lang = "en" }: { lang?: Lang }) {
  const m = getMessages(lang);
  // The French footer lists only the pages that exist in French.
  const links = lang === "fr" ? [{ label: m.camp.heroTitle, href: campsPath("fr") }] : nav;
  return (
    <footer className="relative bg-gradient-to-b from-forest via-forest-dark to-black text-cream">
      <div className="gold-divider" aria-hidden="true" />
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-3">
            <Image
              src="/images/jimmy-dean-golf-logo.webp"
              alt={m.site.logoAlt}
              width={44}
              height={44}
              className="h-11 w-11 rounded-full object-contain"
            />
            <span className="font-display text-lg font-semibold">{business.name}</span>
          </div>
          <p className="mt-4 max-w-xs text-sm text-cream/80">{m.site.footerTagline}</p>
          <div className="mt-4 flex gap-4 text-sm">
            {business.instagramUrl && (
              <a
                href={business.instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cream/80 hover:text-gold-light"
              >
                Instagram
              </a>
            )}
            {business.facebookUrl && (
              <a
                href={business.facebookUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cream/80 hover:text-gold-light"
              >
                Facebook
              </a>
            )}
          </div>
        </div>

        <div>
          <h3 className="font-display text-base font-semibold text-gold-light">{m.site.footerExplore}</h3>
          <ul className="mt-4 space-y-2 text-sm">
            {links.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-cream/80 hover:text-gold-light">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="font-display text-base font-semibold text-gold-light">{m.site.footerContact}</h3>
          <ul className="mt-4 space-y-2 text-sm text-cream/80">
            <li>
              <a href={business.phoneHref} className="hover:text-gold-light">
                {business.phone}
              </a>
            </li>
            <li>
              <a href={`mailto:${business.email}`} className="hover:text-gold-light">
                {business.email}
              </a>
            </li>
            <li className="pt-2 text-cream/60">
              {m.site.summer} &mdash; {locations.summer.name}, {locations.summer.address}
            </li>
            <li className="text-cream/60">
              {m.site.winter} &mdash; {locations.winter.name}, {locations.winter.address}
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-gold/10 py-4 text-center text-xs text-cream/60">
        <p>{m.site.rights(new Date().getFullYear())}</p>
        <p className="mt-1">
          <Link href={privacyPath(lang)} className="underline underline-offset-2 hover:text-gold-light">
            {m.site.privacy}
          </Link>
        </p>
      </div>
    </footer>
  );
}
