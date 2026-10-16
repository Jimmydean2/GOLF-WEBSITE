import type { Metadata } from "next";
import Container from "@/components/Container";
import ContactForm from "@/components/ContactForm";
import { business, locations } from "@/lib/content";

export const metadata: Metadata = {
  title: `Contact | ${business.name}`,
};

export default function ContactPage() {
  return (
    <div className="py-16 sm:py-24">
      <Container>
        <div className="text-center">
          <p className="font-display text-sm uppercase tracking-[0.3em] text-gold">
            Get in Touch
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold text-forest sm:text-5xl">
            Contact
          </h1>
        </div>

        <div className="mx-auto mt-12 grid max-w-5xl gap-10 lg:grid-cols-2">
          <div className="space-y-8">
            <div>
              <h2 className="font-display text-xl font-semibold text-forest">
                Direct
              </h2>
              <ul className="mt-3 space-y-1 text-ink-soft">
                <li>
                  <a href={business.phoneHref} className="hover:text-forest">
                    {business.phone}
                  </a>
                </li>
                <li>
                  <a href={`mailto:${business.email}`} className="hover:text-forest">
                    {business.email}
                  </a>
                </li>
              </ul>
            </div>

            <LocationBlock
              label={locations.summer.label}
              name={locations.summer.name}
              address={locations.summer.address}
              mapsQuery={locations.summer.mapsQuery}
            />
            <LocationBlock
              label={locations.winter.label}
              name={locations.winter.name}
              address={locations.winter.address}
              mapsQuery={locations.winter.mapsQuery}
            />
          </div>

          <ContactForm />
        </div>
      </Container>
    </div>
  );
}

function LocationBlock({
  label,
  name,
  address,
  mapsQuery,
}: {
  label: string;
  name: string;
  address: string;
  mapsQuery: string;
}) {
  return (
    <div>
      <h2 className="font-display text-xl font-semibold text-forest">
        {label} &mdash; {name}
      </h2>
      <p className="mt-2 text-ink-soft">{address}</p>
      <div className="mt-3 overflow-hidden rounded-xl border border-gold/30">
        <iframe
          title={`Map to ${name}`}
          src={`https://maps.google.com/maps?q=${encodeURIComponent(mapsQuery)}&output=embed`}
          className="h-52 w-full"
          loading="lazy"
        />
      </div>
    </div>
  );
}
