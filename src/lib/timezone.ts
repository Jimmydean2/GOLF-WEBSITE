// Pure timezone helpers (no Node-only APIs), safe to import from both server
// and client code. Converts between a wall-clock date/time in a given IANA
// timezone and the real UTC instant it represents, correctly handling DST.

export function zonedTimeToUtc(
  year: number,
  month: number, // 0-indexed
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const asUtc = Date.UTC(year, month, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(asUtc));

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const tzAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );

  return new Date(asUtc + (asUtc - tzAsUtc));
}

export type ZonedParts = {
  year: number;
  month: number; // 0-indexed
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function utcToZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month") - 1,
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}
