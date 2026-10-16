import { NextResponse, after } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { reportPayment } from "@/lib/campDb";
import { notifyPaymentReported } from "@/lib/alerts";
import { registrationIdFromToken } from "@/lib/registrationLink";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { siteOrigin } from "@/lib/siteUrl";
import { parseLang } from "@/lib/lang";
import { getMessages } from "@/lib/i18n";
import { logError } from "@/lib/safeLog";

// POST /api/camp-registration/report   body: { token }
// The parent's "I've Sent My Payment". The token is their private link: it identifies the
// registration and proves they hold the link, and that is ALL it can do. It moves the
// registration to "Payment Reported, awaiting verification" and starts the 48-hour review.
// It does not confirm anything, and it asks for nothing else: no account, no screenshot,
// no banking details.
export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  let bodyError = false;
  try {
    body = await request.json();
  } catch {
    bodyError = true;
  }
  // Answers are in the language of the page the parent is looking at.
  const m = getMessages(parseLang(body?.language)).errors;

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: m.reportSetup }, { status: 503 });
  }
  if (bodyError || !body || typeof body !== "object") {
    return NextResponse.json({ error: m.invalidRequest }, { status: 400 });
  }

  const ip = clientIp(request);
  const perIp = await rateLimit("report-ip", ip, 30, 3600);
  if (!perIp.allowed) {
    return NextResponse.json(
      { error: m.tooManyAttempts },
      { status: 429, headers: { "Retry-After": String(perIp.retryAfterSeconds) } }
    );
  }

  const registrationId = registrationIdFromToken(String(body.token ?? ""));
  if (!registrationId) {
    return NextResponse.json({ error: m.linkInvalid }, { status: 404 });
  }
  const perLink = await rateLimit("report-link", registrationId, 10, 3600);
  if (!perLink.allowed) {
    return NextResponse.json(
      { error: m.tooManyAttempts },
      { status: 429, headers: { "Retry-After": String(perLink.retryAfterSeconds) } }
    );
  }

  let result;
  try {
    result = await reportPayment(registrationId);
  } catch (err) {
    logError("Payment report failed:", err);
    return NextResponse.json({ error: m.tryAgain }, { status: 502 });
  }

  if (!result.ok) {
    switch (result.reason) {
      case "not_found":
        return NextResponse.json({ error: m.linkInvalid }, { status: 404 });
      case "already_paid":
        return NextResponse.json({ success: true, status: "paid" });
      case "released":
        return NextResponse.json(
          { error: m.reportReleased },
          { status: 409 }
        );
      case "window_closed":
        return NextResponse.json(
          { error: m.reportWindowClosed },
          { status: 409 }
        );
      case "report_unavailable":
        return NextResponse.json(
          { error: m.reportUnavailable },
          { status: 409 }
        );
    }
  }

  // Tell the administrators (once). After the response, so the parent isn't kept waiting.
  if (!result.alreadyReported) {
    const dashboardUrl = `${siteOrigin(request.url)}/admin/camp-rosters`;
    after(() => notifyPaymentReported(registrationId, { dashboardUrl }));
  }

  return NextResponse.json({ success: true, status: "payment_reported", alreadyReported: result.alreadyReported });
}
