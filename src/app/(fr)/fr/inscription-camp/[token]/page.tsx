import type { Metadata } from "next";
import ReservationView from "@/components/ReservationView";
import { getMessages } from "@/lib/i18n";

// The link is the credential: never indexed, never sent as a referrer, never cached.
export const metadata: Metadata = {
  title: getMessages("fr").parent.metaTitle,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

export default async function PageReservation({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ReservationView token={token} lang="fr" />;
}
