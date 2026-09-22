/**
 * Field validation for the four things 9771 needs.
 *
 * Returns stable codes rather than prose, so lib/i18n.ts owns every string the
 * user reads and the rules stay language independent.
 *
 * There is deliberately nothing else here. Vehicle type, ownership and SIM
 * confirmation were all once blocking checkboxes; none of them change the
 * message, and the scheme rejects ineligible vehicles itself, so they were
 * friction in front of the only job this page has. The facts they carried now
 * live as one line of help text each.
 */

import {
  PROVINCE_CODES,
  checkRegDate,
  isValidCnic,
  isValidPlate,
  normalizeCnic,
  normalizePlate,
  type ProvinceCode,
} from './format';

export type Severity = 'error' | 'warn';

export interface FieldIssue {
  code: string;
  severity: Severity;
}

export interface FormState {
  cnic: string;
  plate: string;
  province: ProvinceCode | '';
  date: string;
}

export const EMPTY_FORM: FormState = {
  cnic: '',
  plate: '',
  province: '',
  date: '',
};

/* --------------------------------------------------------------- fields */

export function validateCnic(raw: string): FieldIssue | null {
  const d = normalizeCnic(raw);
  if (d.length === 0) return { code: 'cnic.required', severity: 'error' };
  if (d.length < 13) return { code: 'cnic.tooShort', severity: 'error' };
  if (d.length > 13) return { code: 'cnic.tooLong', severity: 'error' };
  if (!isValidCnic(d)) return { code: 'cnic.invalid', severity: 'error' };
  return null;
}

export function validatePlate(raw: string): FieldIssue | null {
  const p = normalizePlate(raw);
  if (p.length === 0) return { code: 'plate.required', severity: 'error' };
  if (!isValidPlate(p)) return { code: 'plate.invalid', severity: 'error' };
  return null;
}

export function validateProvince(code: string): FieldIssue | null {
  if (!code) return { code: 'province.required', severity: 'error' };
  if (!(PROVINCE_CODES as readonly string[]).includes(code)) {
    return { code: 'province.invalid', severity: 'error' };
  }
  return null;
}

export function validateDate(raw: string, now: Date = new Date()): FieldIssue | null {
  if (!raw?.trim()) return { code: 'date.required', severity: 'error' };
  const check = checkRegDate(raw, now);
  if (!check.ok) return { code: `date.${check.reason}`, severity: 'error' };
  // Both readings are plausible, and a silent DD/MM swap costs a failed send.
  if (check.ambiguous) return { code: 'date.ambiguous', severity: 'warn' };
  return null;
}

/* ------------------------------------------------------------ whole form */

export interface FormValidation {
  fields: {
    cnic: FieldIssue | null;
    plate: FieldIssue | null;
    province: FieldIssue | null;
    date: FieldIssue | null;
  };
  /** True when the REG message may be built and offered. */
  canSend: boolean;
}

export function validateForm(form: FormState, now: Date = new Date()): FormValidation {
  const fields = {
    cnic: validateCnic(form.cnic),
    plate: validatePlate(form.plate),
    province: validateProvince(form.province),
    date: validateDate(form.date, now),
  };

  const blocking = Object.values(fields).filter(
    (i): i is FieldIssue => i !== null && i.severity === 'error',
  );

  return { fields, canSend: blocking.length === 0 };
}
