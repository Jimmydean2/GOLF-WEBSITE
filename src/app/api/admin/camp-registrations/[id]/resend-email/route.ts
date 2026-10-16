import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { isDatabaseConfigured } from "@/lib/db";
import { getRegistrationById } from "@/lib/campDb";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { buildCoachNotificationEmail, buildParentConfirmationEmail } from "@/lib/campEmailTemplates";
import { business } from "@/lib/content";

// Resends either the parent's paid-confirmation email or the coach's
// original new-registration notification, by registration id. Which one
// makes sense depends on the registration's current status, so the admin
// picks explicitly rather than this route guessing.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Registrations aren't connected yet." }, { status: 503 });
  }
  if (!isEmailConfigured()) {
    return NextResponse.json({ error: "Email isn't connected yet." }, { status: 503 });
  }

  const { id } = await params;
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // default below
  }
  const target = body.target === "coach" ? "coach" : "parent";

  try {
    const registration = await getRegistrationById(id);
    if (!registration) {
      return NextResponse.json({ error: "Registration not found." }, { status: 404 });
    }

    if (target === "parent") {
      if (registration.status !== "paid") {
        return NextResponse.json(
          { error: "This registration hasn't been marked paid yet, so there's no parent confirmation to resend." },
          { status: 400 }
        );
      }
      const { subject, html, text } = buildParentConfirmationEmail(registration);
      await sendEmail({ to: registration.email, subject, html, text });
    } else {
      const dashboardUrl = new URL("/admin/camp-rosters", request.url);
      const { subject, html, text } = buildCoachNotificationEmail(registration, dashboardUrl.toString());
      await sendEmail({ to: business.email, subject, html, text });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Admin resend email failed:", err);
    return NextResponse.json({ error: "Could not resend the email. Please try again." }, { status: 502 });
  }
}
