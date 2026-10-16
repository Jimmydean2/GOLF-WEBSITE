import Link from "next/link";
import Container from "@/components/Container";
import { business } from "@/lib/content";
import { campsPath, getMessages } from "@/lib/i18n";
import { ACCOUNTING_RECORD_YEARS, PRIVACY_NOTICE_REVIEWED, PRIVACY_NOTICE_VERSION, PROVIDERS, RETENTION_DAYS, privacyOfficer } from "@/lib/privacy";
import { isSeasonPreview } from "@/lib/registrationWindow";
import type { Lang } from "@/lib/lang";

// The privacy notice, in either language. Everything on it comes from the dictionary and the
// shared privacy facts, so what it says and what the system does cannot drift apart.
export default function PrivacyNotice({ lang }: { lang: Lang }) {
  const p = getMessages(lang).privacy;
  // An unreviewed notice is flagged as a draft on rehearsal sites. The real site cannot go live
  // with one: the preflight check (--production) refuses until PRIVACY_NOTICE_REVIEWED is true.
  const showDraft = !PRIVACY_NOTICE_REVIEWED && isSeasonPreview();

  const list = (items: readonly string[]) => (
    <ul className="mt-3 list-disc space-y-2 pl-6 text-sm leading-relaxed text-ink-soft">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
  const heading = (text: string) => <h2 className="mt-10 font-display text-xl font-semibold text-forest">{text}</h2>;
  const paragraph = (text: string) => <p className="mt-3 text-sm leading-relaxed text-ink-soft">{text}</p>;

  return (
    <div className="py-16 sm:py-24">
      <Container className="max-w-2xl">
        {showDraft && (
          <p role="note" className="mb-6 rounded-xl border border-flag bg-flag/5 p-4 text-sm font-semibold text-flag">
            {p.draftBanner}
          </p>
        )}
        <h1 className="font-display text-3xl font-semibold text-forest">{p.heading}</h1>
        <p className="mt-1 text-xs text-ink-soft">{p.version(PRIVACY_NOTICE_VERSION)}</p>
        {paragraph(p.intro)}

        {heading(p.responsibleHeading)}
        {paragraph(p.responsible(p.officerName, privacyOfficer.email, privacyOfficer.phone))}

        {heading(p.collectHeading)}
        {list(p.collectItems)}

        {heading(p.whyHeading)}
        {list(p.whyItems)}
        {paragraph(p.noMarketing)}

        {heading(p.whoHeading)}
        {list(p.who)}
        {paragraph(p.providersIntro)}
        <ul className="mt-3 list-disc space-y-1 pl-6 text-sm leading-relaxed text-ink-soft">
          {PROVIDERS.map((provider) => (
            <li key={provider.id}>
              {provider.name}: {provider.role[lang]}
            </li>
          ))}
        </ul>
        {paragraph(p.whoExtra)}

        {heading(p.whereHeading)}
        {paragraph(p.where)}

        {heading(p.keepHeading)}
        {list(p.keep(RETENTION_DAYS, ACCOUNTING_RECORD_YEARS))}

        {heading(p.protectHeading)}
        {list(p.protect)}

        {heading(p.rightsHeading)}
        {list(p.rights)}
        {paragraph(p.rightsContact(privacyOfficer.email, privacyOfficer.phone))}
        {paragraph(p.rightsComplaint)}

        {heading(p.childrenHeading)}
        {paragraph(p.children)}

        {heading(p.cookiesHeading)}
        {paragraph(p.cookies)}

        {heading(p.changesHeading)}
        {paragraph(p.changes)}

        <p className="mt-10 text-sm">
          <Link href={campsPath(lang)} className="font-semibold text-forest underline underline-offset-2">
            {p.back}
          </Link>
        </p>
        <p className="mt-6 text-xs text-ink-soft">
          {business.name} · {business.phone} · {business.email}
        </p>
      </Container>
    </div>
  );
}
