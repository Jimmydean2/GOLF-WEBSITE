import Image from "next/image";
import Link from "next/link";
import { business, locations, nav } from "@/lib/content";

export default function Footer() {
  return (
    <footer className="border-t border-gold/30 bg-forest text-cream">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-3">
            <Image
              src="/images/jimmy-dean-golf-logo.webp"
              alt={`${business.name} logo`}
              width={44}
              height={44}
              className="h-11 w-11 rounded-full"
            />
            <span className="font-display text-lg font-semibold">{business.name}</span>
          </div>
          <p className="mt-4 max-w-xs text-sm text-cream/80">
            Private lessons, group clinics, and junior programs in the Montreal area.
          </p>
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
          <h3 className="font-display text-base font-semibold text-gold-light">Explore</h3>
          <ul className="mt-4 space-y-2 text-sm">
            {nav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-cream/80 hover:text-gold-light">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="font-display text-base font-semibold text-gold-light">Get in Touch</h3>
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
              Summer &mdash; {locations.summer.name}, {locations.summer.address}
            </li>
            <li className="text-cream/60">
              Winter &mdash; {locations.winter.name}, {locations.winter.address}
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-cream/10 py-4 text-center text-xs text-cream/60">
        &copy; {new Date().getFullYear()} {business.name}. All rights reserved.
      </div>
    </footer>
  );
}
