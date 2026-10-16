import { juniorCamps } from "./content";

// Camp weeks in the order they happen. Week ids ("aug03", "jul06", "jun22") sort alphabetically
// into the WRONG order for a parent (August before June), so anything shown to a person is put
// in calendar order with these. (The database keeps using plain id order for its locks: any
// consistent order does for that.)
const ORDER = new Map<string, number>(juniorCamps.weeks.map((w, i) => [w.id as string, i]));

export const calendarOrder = (a: string, b: string): number => (ORDER.get(a) ?? 999) - (ORDER.get(b) ?? 999) || a.localeCompare(b);

export const inCalendarOrder = (ids: string[]): string[] => [...ids].sort(calendarOrder);
