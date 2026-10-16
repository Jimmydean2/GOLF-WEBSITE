// The payment-policy clocks and limits, with allowed ranges. Server-only in practice
// (it is read alongside the database), but has no Node-only imports.
//
// Stored in the camp_settings table (key = the property name below). A missing or
// out-of-range stored value falls back to the default, so a bad edit can never produce
// an unbounded clock. A new value affects only clocks that start after the change:
// every deadline is copied onto the registration when its clock starts.

export type CampSettings = {
  holdHours: number; // unpaid reservation hold
  reportAllowanceMinutes: number; // extra time after the hold in which a report is still accepted
  reviewHours: number; // verification review after a parent reports
  extensionDefaultHours: number;
  extensionMaxHours: number; // longest single extension an administrator can grant
  extensionMaxCount: number; // extensions per registration (the database allows at most 3)
  openReservationsPerContact: number;
  strikeLimit: number; // "payment not received" releases before the report button is withdrawn
  strikeWindowDays: number;
  alertDueSoonHours: number;
  alertReminderHours: number;
  alertEscalatedAfterHours: number; // overdue this long: [ESCALATED]
  alertCriticalAfterHours: number; // overdue this long: [CRITICAL], repeating
};

type Rule = { default: number; min: number; max: number };

export const SETTING_RULES: Record<keyof CampSettings, Rule> = {
  holdHours: { default: 12, min: 1, max: 48 },
  reportAllowanceMinutes: { default: 15, min: 0, max: 60 },
  reviewHours: { default: 48, min: 12, max: 96 },
  extensionDefaultHours: { default: 24, min: 1, max: 72 },
  extensionMaxHours: { default: 72, min: 1, max: 72 },
  extensionMaxCount: { default: 2, min: 0, max: 3 },
  openReservationsPerContact: { default: 8, min: 1, max: 20 },
  strikeLimit: { default: 2, min: 1, max: 10 },
  strikeWindowDays: { default: 30, min: 1, max: 180 },
  alertDueSoonHours: { default: 6, min: 1, max: 24 },
  alertReminderHours: { default: 6, min: 1, max: 24 },
  alertEscalatedAfterHours: { default: 24, min: 1, max: 168 },
  alertCriticalAfterHours: { default: 72, min: 1, max: 336 },
};

export const SETTING_KEYS = Object.keys(SETTING_RULES) as (keyof CampSettings)[];

export function defaultSettings(): CampSettings {
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, SETTING_RULES[k].default])) as CampSettings;
}

// Returns an error message, or null if the value is allowed.
export function validateSetting(key: string, value: unknown): string | null {
  const rule = (SETTING_RULES as Record<string, Rule | undefined>)[key];
  if (!rule) return `Unknown setting "${key}".`;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n)) return `${key} must be a whole number.`;
  if (n < rule.min || n > rule.max) return `${key} must be between ${rule.min} and ${rule.max}.`;
  return null;
}

export function parseSettings(rows: { key: string; value: string }[]): CampSettings {
  const settings = defaultSettings();
  for (const row of rows) {
    if (validateSetting(row.key, row.value) === null) {
      (settings as Record<string, number>)[row.key] = Number(row.value);
    }
  }
  return settings;
}
