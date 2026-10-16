import { business } from "./content";
import { getPayByAt, getRegistrationById } from "./campDb";
import { appendCampRegistration, isGoogleSheetsConfigured } from "./googleSheets";
import { isEmailConfigured, sendEmail } from "./email";
import { buildCoachNotificationEmail, buildParentInstructionsEmail } from "./campEmailTemplates";
import { makeAccessToken } from "./registrationLink";

// Server-only. What happens AFTER a reservation has been committed and the parent has their
// answer. None of it can undo or fail the reservation: the parent already has the payment
// instructions on screen, and an administrator can see every registration on the dashboard.

// Google Sheets is a secondary reporting copy, never the source of truth.
async function copyToSheets(registrationId: string): Promise<void> {
  if (!isGoogleSheetsConfigured()) return;
  const registration = await getRegistrationById(registrationId);
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

async function sendInstructions(registrationId: string, origin: string): Promise<void> {
  const registration = await getRegistrationById(registrationId);
  if (!registration || !isEmailConfigured()) return;
  const statusUrl = new URL(`/camp-registration/${makeAccessToken(registration.id)}`, origin).toString();
  const payByAt = (await getPayByAt(registration.id)) ?? new Date().toISOString();
  const instructions = buildParentInstructionsEmail(registration, { statusUrl, payByAt });
  await sendEmail({ to: registration.email, ...instructions });
}

export async function afterReservationCreated(info: { registrationId: string; origin: string }): Promise<void> {
  try {
    await copyToSheets(info.registrationId);
  } catch (err) {
    console.error("Failed to sync camp registration to Google Sheets (non-fatal):", err);
  }
  if (!isEmailConfigured()) return;
  try {
    await sendInstructions(info.registrationId, info.origin);
  } catch (err) {
    console.error("Failed to send the parent's payment instructions (non-fatal):", err);
  }
  try {
    const registration = await getRegistrationById(info.registrationId);
    if (registration) {
      const dashboardUrl = new URL("/admin/camp-rosters", info.origin).toString();
      const { subject, html, text } = buildCoachNotificationEmail(registration, dashboardUrl);
      await sendEmail({ to: business.email, subject, html, text });
    }
  } catch (err) {
    console.error("Failed to send the coach notification (non-fatal):", err);
  }
}

export async function afterDuplicateAttempt(info: { registrationIds: string[]; origin: string }): Promise<void> {
  for (const id of info.registrationIds.slice(0, 2)) {
    try {
      await sendInstructions(id, info.origin);
    } catch (err) {
      console.error("Failed to re-send payment instructions (non-fatal):", err);
    }
  }
}
