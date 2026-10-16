import { juniorCamps } from "./content";

// Camp weeks in the order they happen. A week's id is the ISO date of its Monday
// ("2027-06-21"), so ids already sort into calendar order; this keeps the order explicit
// (and tolerant of an id it has never heard of) for anything shown to a person. The database
// keeps using plain id order for its locks: any consistent order does for that.
const ORDER = new Map<string, number>(juniorCamps.weeks.map((w, i) => [w.id as string, i]));

export const calendarOrder = (a: string, b: string): number => (ORDER.get(a) ?? 999) - (ORDER.get(b) ?? 999) || a.localeCompare(b);

export const inCalendarOrder = (ids: string[]): string[] => [...ids].sort(calendarOrder);
