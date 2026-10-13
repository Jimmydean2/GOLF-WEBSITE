import { NextResponse } from "next/server";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { buildParentConfirmationEmail } from "@/lib/campEmailTemplates";
import { isGoogleSheetsConfigured, markCampRegistrationPaid } from "@/lib/googleSheets";

function errorPage(message: string): NextResponse {
  const html = `<!doctype html>
<html>
  <body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif; background:#fbf6ea; padding:48px 16px; text-align:center; color:#1b1b16;">
    <p style="font-size:18px; font-weight:bold; margin:0 0 8px;">Link not valid</p>
    <p style="font-size:14px; color:#4a463c; margin:0;">${message}</p>
  </body>
</html>`;
  return new NextResponse(html, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// GET /api/camp-registration/confirm?id=...&token=...
// The "Mark as Paid & Send Confirmation" link from the coach's new-registration
// email. Marks the registration paid (idempotent — a repeat click is a no-op)
// and sends the parent their camp-day confirmation email, then redirects to a
// plain on-brand confirmation screen.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const id = searchParams.get("id") ?? "";
  const token = searchParams.get("token") ?? "";

  if (!id || !token) {
    return errorPage("This confirmation link is missing information. Please check the Google Sheet directly.");
  }

  if (!isGoogleSheetsConfigured()) {
    return errorPage("Registrations aren't connected yet. Please check with the site admin.");
  }

  let result;
  try {
    result = await markCampRegistrationPaid(id, token);
  } catch (err) {
    console.error("Failed to mark camp registration paid:", err);
    return errorPage("Something went wrong reaching the registration sheet. Please try again.");
  }

  if (!result) {
    return errorPage("This confirmation link is invalid or has expired.");
  }

  if (!result.alreadyPaid && isEmailConfigured()) {
    try {
      const { subject, html, text } = buildParentConfirmationEmail(result.row);
      await sendEmail({ to: result.row.email, subject, html, text });
    } catch (err) {
      console.error("Failed to send parent confirmation email:", err);
    }
  }

  const redirectUrl = new URL("/camp-registration/confirmed", origin);
  redirectUrl.searchParams.set("child", result.row.childName);
  redirectUrl.searchParams.set("week", result.row.week);
  redirectUrl.searchParams.set("email", result.row.email);
  redirectUrl.searchParams.set("already", result.alreadyPaid ? "1" : "0");
  redirectUrl.searchParams.set("emailSent", isEmailConfigured() ? "1" : "0");
  return NextResponse.redirect(redirectUrl);
}
