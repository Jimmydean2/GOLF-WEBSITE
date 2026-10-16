// Server-only. Logging that cannot leak a family's details.
//
// A database error can carry the offending row in its `detail` ("Failing row contains
// (Pat Parent, pat@example.com, ...)"), and a mail server often repeats the recipient's address
// in its reply. Printing the error object as it is would put that in the hosting platform's logs.
// These helpers print what is needed to diagnose a problem (what failed, the error code, the
// constraint, the message with addresses removed, a few frames of where) and nothing else.

const ADDRESS = /[^\s<>@,;"']+@[^\s<>,;"']+/g;

export function redact(text: string): string {
  return text.replace(ADDRESS, "<address>");
}

export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return redact(String(err)).slice(0, 300);
  const e = err as Error & { code?: unknown; constraint?: unknown };
  const frames = (err.stack ?? "")
    .split("\n")
    .slice(1, 4)
    .map((line) => line.trim())
    .join(" | ");
  return [
    err.name,
    typeof e.code === "string" || typeof e.code === "number" ? `code=${e.code}` : "",
    typeof e.constraint === "string" ? `constraint=${e.constraint}` : "",
    redact(err.message).slice(0, 300),
    frames ? `[${frames}]` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function logError(context: string, err: unknown): void {
  console.error(`${context} ${describeError(err)}`);
}
