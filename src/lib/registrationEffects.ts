import { getRegistrationSnapshot } from "./campDb";
import { appendCampRegistration, isCampSheetsCopyEnabled } from "./googleSheets";
import { enqueueInstructionsResend, processOutbox } from "./outbox";
import { logError } from "./safeLog";

// Server-only. What happens AFTER a reservation has been committed and the parent has their
// answer. None of it can undo or fail the reservation: the parent already has the payment
// instructions on screen, and every email they are owed is already recorded in the outbox
// (in the same transaction as the reservation), so a failure here only delays an email,
// it never loses one: the scheduled check, or the next visitor, sends what is left.

// Google Sheets is an optional reporting copy, never the source of truth, and it is not retried.
// OFF unless CAMP_SHEETS_COPY=true (see isCampSheetsCopyEnabled).
async function copyToSheets(registrationId: string): Promise<void> {
  if (!isCampSheetsCopyEnabled()) return;
  const registration = await getRegistrationSnapshot(registrationId);
  if (!registration) return;
  for (const child of registration.children) {
    await appendCampRegistration({
      parentName: registration.parentName,
      email: registration.email,
      primaryPhone: registration.primaryPhone,
      secondaryPhone: registration.secondaryPhone,
      childName: child.fullName,
      dateOfBirth: child.dateOfBirth,
      childAge: child.age,
      healthInfo: child.healthInfo,
      emergencyName: registration.emergencyName,
      emergencyRelationship: registration.emergencyRelationship,
      emergencyPhone: registration.emergencyPhone,
      weeks: registration.allWeekIds.join(","),
      codeOfConductAccepted: "Yes",
      consentAccepted: "Yes",
      id: registration.id,
      reference: registration.reference,
    });
  }
}

export async function afterReservationCreated(info: { registrationId: string; origin: string }): Promise<void> {
  // The parent's email first: it is the one that matters, and Sheets can be slow.
  try {
    await processOutbox({ registrationId: info.registrationId, origin: info.origin });
  } catch (err) {
    logError("Sending the new reservation's emails failed (they stay queued and are retried):", err);
  }
  try {
    await copyToSheets(info.registrationId);
  } catch (err) {
    logError("Failed to sync camp registration to Google Sheets (non-fatal):", err);
  }
}

export async function afterDuplicateAttempt(info: { registrationIds: string[]; origin: string }): Promise<void> {
  for (const id of info.registrationIds.slice(0, 2)) {
    try {
      await enqueueInstructionsResend(id);
      await processOutbox({ registrationId: id, origin: info.origin });
    } catch (err) {
      logError("Re-sending payment instructions failed (non-fatal):", err);
    }
  }
}
