/**
 * Pure string normalisation and SMS assembly.
 *
 * Everything the user sends to 9771 is built here. One wrong character fails the
 * registration, and three failures block the number for 24 hours, so these
 * functions are deliberately strict and fully unit-tested.
 *
 * Ground truth: this exact message was sent and accepted by 9771 --
 *   REG 3520212345671 CHK9513 S 15082026
 * built from Form G "REGN.No: CHK-9513  DT : 15/08/2026", province Sindh.
 * That pins the plate to uppercase-with-no-dash and the date to DDMMYYYY.
 */

export const PROVINCE_CODES = ['I', 'P', 'S', 'K', 'B', 'A', 'G'] as const;
export type ProvinceCode = (typeof PROVINCE_CODES)[number];

/** The only shape 9771 accepts, asserted on every build. */
export const REG_SMS_PATTERN = /^REG \d{13} [A-Z0-9]{3,10} [IPSKBAG] \d{8}$/;

export const SHORTCODE_SCHEME = '9771';
/** Provincial vehicle-details lookup by SMS. Coverage is province dependent. */
export const SHORTCODE_VEHICLE = '8785';

export interface RegInput {
  cnic: string;
  plate: string;
  province: ProvinceCode;
  /** Accepts DD/MM/YYYY, DD-MM-YYYY, DDMMYYYY or YYYY-MM-DD. */
  date: string;
}

/* ------------------------------------------------------------------ CNIC */

/** Digits only. The SMS carries 13 bare digits, never dashes. */
export function normalizeCnic(raw: string): string {
  return (raw ?? '').replace(/\D+/g, '');
}

export function isValidCnic(raw: string): boolean {
  const d = normalizeCnic(raw);
  if (d.length !== 13) return false;
  // A CNIC never starts with 0, and all-same-digit strings are placeholder junk.
  if (d[0] === '0') return false;
  if (/^(\d)\1{12}$/.test(d)) return false;
  return true;
}

/** 35202-1234567-1 for display only. Never sent. */
export function formatCnicDisplay(raw: string): string {
  const d = normalizeCnic(raw).slice(0, 13);
  const parts = [d.slice(0, 5), d.slice(5, 12), d.slice(12, 13)].filter(Boolean);
  return parts.join('-');
}

/* ----------------------------------------------------------------- plate */

/**
 * Uppercase, strip every separator. "CHK-9513" and "chk 9513" both become
 * "CHK9513", which is the form empirically confirmed to register.
 */
export function normalizePlate(raw: string): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

/**
 * Deliberately permissive. Pakistani plates vary by province and era:
 * Sindh uses up to AAA-123456, KPK and Balochistan two letters plus four
 * digits, Punjab bikes can be digits-led. The job here is to reject typos and
 * garbage, not to act as a registry.
 */
export function isValidPlate(raw: string): boolean {
  const p = normalizePlate(raw);
  if (p.length < 3 || p.length > 10) return false;
  return /^[A-Z]{0,4}\d{1,6}$/.test(p);
}

/** Splits a plate into its letter prefix and digit body, for OCR repair. */
export function splitPlate(raw: string): { letters: string; digits: string } | null {
  const m = /^([A-Z]{0,4})(\d{1,6})$/.exec(normalizePlate(raw));
  if (!m) return null;
  return { letters: m[1], digits: m[2] };
}

/* ------------------------------------------------------------------ date */

export interface DateParts {
  day: number;
  month: number;
  year: number;
}

/**
 * Accepts the shapes a user or an OCR pass can realistically produce.
 * Returns null rather than guessing when the input is ambiguous garbage.
 */
export function parseDateInput(raw: string): DateParts | null {
  const s = (raw ?? '').trim();
  if (!s) return null;

  // ISO, as emitted by <input type="date">
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    return { year: +iso[1], month: +iso[2], day: +iso[3] };
  }

  // DD/MM/YYYY with any single separator
  const sep = /^(\d{1,2})\s*[/.\-\s]\s*(\d{1,2})\s*[/.\-\s]\s*(\d{4})$/.exec(s);
  if (sep) {
    return { day: +sep[1], month: +sep[2], year: +sep[3] };
  }

  // Bare DDMMYYYY
  const bare = /^(\d{2})(\d{2})(\d{4})$/.exec(s.replace(/\s+/g, ''));
  if (bare) {
    return { day: +bare[1], month: +bare[2], year: +bare[3] };
  }

  return null;
}

export interface DateCheck {
  ok: boolean;
  /** True when day <= 12, so a DD/MM vs MM/DD misread would be silent. */
  ambiguous: boolean;
  reason?: 'unparseable' | 'day' | 'month' | 'year' | 'future' | 'impossible';
}

export function checkRegDate(raw: string, now: Date = new Date()): DateCheck {
  const p = parseDateInput(raw);
  if (!p) return { ok: false, ambiguous: false, reason: 'unparseable' };

  if (p.month < 1 || p.month > 12) return { ok: false, ambiguous: false, reason: 'month' };
  if (p.day < 1 || p.day > 31) return { ok: false, ambiguous: false, reason: 'day' };
  // Pakistan has existed since 1947; anything earlier is an OCR artefact.
  if (p.year < 1947 || p.year > now.getFullYear()) {
    return { ok: false, ambiguous: false, reason: 'year' };
  }

  // Reject 31 February and friends by round-tripping through Date.
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  if (
    d.getUTCFullYear() !== p.year ||
    d.getUTCMonth() !== p.month - 1 ||
    d.getUTCDate() !== p.day
  ) {
    return { ok: false, ambiguous: false, reason: 'impossible' };
  }

  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  if (d.getTime() > today.getTime()) {
    return { ok: false, ambiguous: false, reason: 'future' };
  }

  return { ok: true, ambiguous: p.day <= 12 };
}

/** DDMMYYYY, zero padded. Throws on anything checkRegDate would reject. */
export function toDDMMYYYY(raw: string, now: Date = new Date()): string {
  const check = checkRegDate(raw, now);
  if (!check.ok) throw new Error(`invalid registration date: ${check.reason}`);
  const p = parseDateInput(raw)!;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(p.day)}${pad(p.month)}${p.year}`;
}

/* ------------------------------------------------------------------- SMS */

/**
 * Assembles the REG message and asserts the result against the only shape
 * known to be accepted. A throw here is a bug in validation upstream, never
 * something the user should be able to trigger from the UI.
 */
export function buildRegSms(input: RegInput, now: Date = new Date()): string {
  const cnic = normalizeCnic(input.cnic);
  const plate = normalizePlate(input.plate);
  const date = toDDMMYYYY(input.date, now);
  const body = `REG ${cnic} ${plate} ${input.province} ${date}`;

  if (!REG_SMS_PATTERN.test(body)) {
    throw new Error(`refusing to build a malformed REG message: ${body}`);
  }
  return body;
}

export function buildTokSms(): string {
  return 'TOK';
}

/**
 * sms: deep link.
 *
 * ?body= is honoured by Android, which is the overwhelming majority of this
 * audience. iOS support for a prefilled body is unreliable and Apple's own
 * documentation says the URL must not carry message text, so the UI always
 * shows a copy button alongside this and never treats the link as the only
 * way through.
 */
export function smsHref(number: string, body: string): string {
  return `sms:${number}?body=${encodeURIComponent(body)}`;
}
