import { describe, expect, it } from 'vitest';
import { EMPTY_FORM, validateDate, validateForm, type FormState } from '../lib/validate';

const NOW = new Date('2026-09-23T00:00:00Z');

const VALID: FormState = {
  cnic: '35202-1234567-1',
  plate: 'CHK-9513',
  province: 'S',
  date: '15/08/2026',
};

describe('form gating', () => {
  it('lets a complete registration through', () => {
    expect(validateForm(VALID, NOW).canSend).toBe(true);
  });

  it('blocks an empty form', () => {
    expect(validateForm(EMPTY_FORM, NOW).canSend).toBe(false);
  });

  it.each([
    ['cnic', { cnic: '352021234567' }, 'cnic.tooShort'],
    ['plate', { plate: 'A1' }, 'plate.invalid'],
    ['province', { province: '' as const }, 'province.required'],
    ['date', { date: '32/08/2015' }, 'date.day'],
  ])('reports a bad %s and nothing else', (field, patch, code) => {
    const v = validateForm({ ...VALID, ...patch }, NOW);
    expect(v.canSend).toBe(false);
    expect(v.fields[field as keyof typeof v.fields]?.code).toBe(code);
    const others = Object.entries(v.fields).filter(([k]) => k !== field);
    expect(others.every(([, issue]) => issue === null)).toBe(true);
  });

  /**
   * The province letter is part of the published format and part of the only
   * message confirmed to have registered. It is never guessed, because a wrong
   * letter fails the send and three failures block the number for 24 hours.
   */
  it('never lets a message be built without a province', () => {
    expect(validateForm({ ...VALID, province: '' }, NOW).canSend).toBe(false);
  });

  it('asks for nothing beyond the four fields 9771 needs', () => {
    expect(Object.keys(validateForm(VALID, NOW).fields).sort()).toEqual([
      'cnic',
      'date',
      'plate',
      'province',
    ]);
  });
});

describe('ambiguous dates warn but do not block', () => {
  it('warns when the day could also be a month', () => {
    const issue = validateDate('08/12/2015', NOW);
    expect(issue).toMatchObject({ code: 'date.ambiguous', severity: 'warn' });
    expect(validateForm({ ...VALID, date: '08/12/2015' }, NOW).canSend).toBe(true);
  });
});
