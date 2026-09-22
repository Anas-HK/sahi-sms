import { describe, expect, it } from 'vitest';
import {
  REG_SMS_PATTERN,
  buildRegSms,
  checkRegDate,
  formatCnicDisplay,
  isValidCnic,
  isValidPlate,
  normalizeCnic,
  normalizePlate,
  parseDateInput,
  smsHref,
  toDDMMYYYY,
} from '../lib/format';

/**
 * The reference date for every test that touches "is this in the future".
 * Fixed so the suite does not rot.
 */
const NOW = new Date('2026-09-23T00:00:00Z');

describe('the golden message', () => {
  /**
   * The shape here was confirmed end to end during development against a live
   * 9771 registration that came back successful. The real values are not kept
   * in this repo, so the assertion uses the example published in the official
   * guides. What is being protected is the shape: REG, 13 bare digits, the
   * plate with no separator, the province letter, DDMMYYYY, single spaces.
   */
  it('builds the exact shape 9771 accepts', () => {
    const body = buildRegSms(
      {
        cnic: '35202-1234567-1',
        plate: 'CHK-9513',
        province: 'S',
        date: '15/08/2026',
      },
      NOW,
    );
    expect(body).toBe('REG 3520212345671 CHK9513 S 15082026');
  });

  it('is identical however the user typed the inputs', () => {
    const expected = 'REG 3520212345671 CHK9513 S 15082026';
    const variants = [
      { cnic: '3520212345671', plate: 'chk 9513', date: '15-08-2026' },
      { cnic: '35202 1234567 1', plate: 'CHK9513', date: '15082026' },
      { cnic: '35202-1234567-1', plate: ' CHK-9513 ', date: '2026-08-15' },
      { cnic: '35202.1234567.1', plate: 'Chk-9513', date: '15.08.2026' },
    ];
    for (const v of variants) {
      expect(buildRegSms({ ...v, province: 'S' }, NOW)).toBe(expected);
    }
  });

  it('always matches the only shape 9771 accepts', () => {
    const body = buildRegSms(
      { cnic: '3520212345671', plate: 'CHK-9513', province: 'S', date: '15/08/2026' },
      NOW,
    );
    expect(REG_SMS_PATTERN.test(body)).toBe(true);
  });
});

describe('cnic', () => {
  it('strips every separator', () => {
    expect(normalizeCnic('35202-1234567-1')).toBe('3520212345671');
    expect(normalizeCnic('35202 1234567 1')).toBe('3520212345671');
  });

  it('accepts a well formed cnic', () => {
    expect(isValidCnic('35202-1234567-1')).toBe(true);
  });

  it.each([
    ['too short', '352021234567'],
    ['too long', '35202123456719'],
    ['leading zero', '0520212345671'],
    ['all one digit', '1111111111111'],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(isValidCnic(value)).toBe(false);
  });

  it('formats for display without changing what is sent', () => {
    expect(formatCnicDisplay('3520212345671')).toBe('35202-1234567-1');
    expect(formatCnicDisplay('35202')).toBe('35202');
    expect(formatCnicDisplay('352021234567')).toBe('35202-1234567');
  });
});

describe('plate', () => {
  it('normalises to uppercase with no separator', () => {
    expect(normalizePlate('chk-9513')).toBe('CHK9513');
    expect(normalizePlate(' C H K 9513 ')).toBe('CHK9513');
  });

  it.each([
    ['sindh bike', 'CHK-9513'],
    ['sindh long series', 'AAA-123456'],
    ['punjab car', 'LEB-123'],
    ['kpk', 'AB-1234'],
    ['digits only', '4731'],
  ])('accepts %s', (_label, value) => {
    expect(isValidPlate(value)).toBe(true);
  });

  it.each([
    ['too short', 'A1'],
    ['no digits', 'ABCD'],
    ['digits before letters', '123ABC'],
    ['too many digits', 'AB-12345678'],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(isValidPlate(value)).toBe(false);
  });
});

describe('registration date', () => {
  it('parses every shape the UI or OCR can produce', () => {
    const expected = { day: 15, month: 8, year: 2026 };
    for (const s of ['15/08/2026', '15-08-2026', '15.08.2026', '15082026', '2026-08-15']) {
      expect(parseDateInput(s)).toEqual(expected);
    }
  });

  it('converts to the DDMMYYYY the SMS needs', () => {
    expect(toDDMMYYYY('1/2/2015', NOW)).toBe('01022015');
    expect(toDDMMYYYY('15/08/2026', NOW)).toBe('15082026');
  });

  it.each([
    ['month 13', '13/13/2015', 'month'],
    ['day 32', '32/08/2015', 'day'],
    ['31 february', '31/02/2015', 'impossible'],
    ['before partition', '13/08/1899', 'year'],
    ['in the future', '13/08/2030', 'year'],
    ['tomorrow', '24/09/2026', 'future'],
    ['gibberish', 'not a date', 'unparseable'],
  ])('rejects %s', (_label, value, reason) => {
    const check = checkRegDate(value, NOW);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe(reason);
  });

  it('flags a day that could also be a month', () => {
    // 08/12/2015 could be read as 8 Dec or 12 Aug. Silent and expensive.
    expect(checkRegDate('08/12/2015', NOW)).toMatchObject({ ok: true, ambiguous: true });
    expect(checkRegDate('15/08/2026', NOW)).toMatchObject({ ok: true, ambiguous: false });
  });

  it('refuses to build a message from a bad date', () => {
    expect(() =>
      buildRegSms({ cnic: '3520212345671', plate: 'CHK9513', province: 'S', date: '32/08/2015' }, NOW),
    ).toThrow(/invalid registration date/);
  });
});

describe('sms deep link', () => {
  it('encodes the body so spaces survive', () => {
    expect(smsHref('9771', 'REG 3520212345671 CHK9513 S 15082026')).toBe(
      'sms:9771?body=REG%203520212345671%20CHK9513%20S%2015082026',
    );
  });

  it('builds the vehicle lookup link', () => {
    expect(smsHref('8785', 'CHK9513')).toBe('sms:8785?body=CHK9513');
  });
});
