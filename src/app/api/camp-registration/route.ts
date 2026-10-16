import { after } from "next/server";
import { handleRegistrationRequest } from "@/lib/registrationService";
import { afterDuplicateAttempt, afterReservationCreated } from "@/lib/registrationEffects";

// Emails and the Google Sheets copy go out after the response, so the parent never waits for
// them; this is how long the platform may keep the function alive to finish them.
export const maxDuration = 30;

// POST /api/camp-registration
// All the logic lives in src/lib/registrationService.ts (validation, rate limits, the
// reservation itself, duplicates) so it can be tested without a web server.
export async function POST(request: Request) {
  return handleRegistrationRequest(request, {
    defer: (task) => after(task),
    onCreated: afterReservationCreated,
    onDuplicate: afterDuplicateAttempt,
  });
}
