import { NextResponse, after } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { reportPayment } from "@/lib/campDb";
import { notifyPaymentReported } from "@/lib/alerts";
import { registrationIdFromToken } from "@/lib/registrationLink";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { business } from "@/lib/content";

// POST /api/camp-registration/report   body: { token }
// The parent's "I've Sent My Payment". The token is their private link: it identifies the
// registration and proves they hold the link, and that is ALL it can do. It moves the
// registration to "Payment Reported, awaiting verification" and starts the 48-hour review.
// It does not confirm anything, and it asks for nothing else: no account, no screenshot,
// no banking details.
export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Online registration isn't set up yet." }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const ip = clientIp(request);
  const perIp = await rateLimit("report-ip", ip, 30, 3600);
  if (!perIp.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a little while." },
      { status: 429, headers: { "Retry-After": String(perIp.retryAfterSeconds) } }
    );
  }

  const registrationId = registrationIdFromToken(String(body.token ?? ""));
  if (!registrationId) {
    return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });
  }
  const perLink = await rateLimit("report-link", registrationId, 10, 3600);
  if (!perLink.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a little while." },
      { status: 429, headers: { "Retry-After": String(perLink.retryAfterSeconds) } }
    );
  }

  let result;
  try {
    result = await reportPayment(registrationId);
  } catch (err) {
    console.error("Payment report failed:", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 502 });
  }

  if (!result.ok) {
    switch (result.reason) {
      case "not_found":
        return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });
      case "already_paid":
        return NextResponse.json({ success: true, status: "paid" });
      case "released":
        return NextResponse.json(
          {
            error: `This reservation has been released. If you already sent your payment, please contact us at ${business.phone} or ${business.email} with your reference.`,
          },
          { status: 409 }
        );
      case "window_closed":
        return NextResponse.json(
          {
            error: `The time to report has passed, so this reservation is being released. If you already sent your payment, please contact us at ${business.phone} or ${business.email} with your reference.`,
          },
          { status: 409 }
        );
      case "report_unavailable":
        return NextResponse.json(
          {
            error: `We can't take a payment report online for this reservation. Please contact us at ${business.phone} or ${business.email} with your reference.`,
          },
          { status: 409 }
        );
    }
  }

  // Tell the administrators (once). After the response, so the parent isn't kept waiting.
  if (!result.alreadyReported) {
    const dashboardUrl = new URL("/admin/camp-rosters", request.url).toString();
    after(() => notifyPaymentReported(registrationId, { dashboardUrl }));
  }

  return NextResponse.json({ success: true, status: "payment_reported", alreadyReported: result.alreadyReported });
}
