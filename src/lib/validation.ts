// Shared, minimal input validation for the public booking/registration
// forms. Deliberately loose — the goal is to catch obviously malformed
// submissions, not to be a full RFC 5322 validator.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}
