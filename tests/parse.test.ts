import { describe, expect, it } from 'vitest';
import {
  extractFromOcr,
  extractOwnerNic,
  gradeConfidence,
  repairDigits,
  repairLetters,
  repairPlateToken,
} from '../lib/ocr/parse';

const NOW = new Date('2026-09-23T00:00:00Z');

/** The top line of the Sindh Form G the scanner is aimed at. */
const CLEAN_LINE = 'REGN.No:  CHK-9513   DT : 15/08/2026';

/** The same certificate with the surrounding text tesseract also picks up. */
const FULL_PAGE = [
  'Form G',
  '[See Section 2 (2) and 41(2)]',
  'Form of Certificate of Registration',
  'REGN.No:  CHK-9513   DT : 15/08/2026',
  'NIC:  3520298765432',
  "Owner's Name: OWNER NAME HERE",
  'Class of Vehicle: MC',
  'Chassis number: XYZ-456789',
  'Engine number: XYW-987654',
  'B0000000',
].join(' ');

describe('character class repair', () => {
  it('maps digits back to the letters they were misread from', () => {
    expect(repairLetters('K1G')).toBe('KIG');
    expect(repairLetters('5')).toBe('S');
    expect(repairLetters('8')).toBe('B');
  });

  it('maps letters back to the digits they were misread from', () => {
    expect(repairDigits('l3')).toBe('13');
    expect(repairDigits('2Ol5')).toBe('2015');
    expect(repairDigits('S')).toBe('5');
  });
});

describe('plate token repair', () => {
  it('trusts the separator when OCR kept it', () => {
    expect(repairPlateToken('CHK-9513')).toMatchObject({
      value: 'CHK9513',
      ambiguousSplit: false,
    });
  });

  it('repairs digits misread as letters inside the prefix', () => {
    // 4 for A, 8 for B, 6 for G are the confusions tesseract actually makes.
    expect(repairPlateToken('48G-4512')).toMatchObject({ value: 'ABG4512' });
    expect(repairPlateToken('A8G 4512')).toMatchObject({ value: 'ABG4512' });
  });

  it('repairs letters misread as digits inside the body', () => {
    expect(repairPlateToken('ABG-45l2')).toMatchObject({ value: 'ABG4512' });
    expect(repairPlateToken('LEB-l23')).toMatchObject({ value: 'LEB123' });
  });

  it('flags every split it had to infer', () => {
    // No separator means no way to tell ABG4512 from a misread AB64512.
    expect(repairPlateToken('ABG4512')).toMatchObject({
      value: 'ABG4512',
      ambiguousSplit: true,
    });
  });

  it('refuses long digit runs so an ID number never becomes a plate', () => {
    expect(repairPlateToken('3520298765432')).toBeNull();
    expect(repairPlateToken('3520298765')).toBeNull();
    expect(repairPlateToken('35202-1234567-1')).toBeNull();
  });

  it('handles the long Sindh series', () => {
    expect(repairPlateToken('AAA-123456')).toMatchObject({ value: 'AAA123456' });
  });
});

describe('extracting both fields from a scan', () => {
  it('reads the clean line', () => {
    const r = extractFromOcr(CLEAN_LINE, undefined, NOW);
    expect(r.plate?.value).toBe('CHK9513');
    expect(r.date?.value).toBe('15082026');
    expect(r.plate?.uncertain).toBe(false);
  });

  it('reads a line where the plate and the date are both garbled', () => {
    const r = extractFromOcr('REGN.No: 48G-45l2 DT : l5/08/2O26', undefined, NOW);
    expect(r.plate?.value).toBe('ABG4512');
    expect(r.date?.value).toBe('15082026');
  });

  it('reads a line where the labels themselves are garbled', () => {
    const r = extractFromOcr('RE6N.N0: CHK-9513 0T : 15/08/2026', undefined, NOW);
    expect(r.plate?.value).toBe('CHK9513');
    expect(r.date?.value).toBe('15082026');
  });

  it('is case insensitive', () => {
    const r = extractFromOcr('regn.no: chk-9513 dt : 15/08/2026', undefined, NOW);
    expect(r.plate?.value).toBe('CHK9513');
    expect(r.date?.value).toBe('15082026');
  });

  describe('never returns the CNIC as part of a normal scan', () => {
    /**
     * The NIC printed on a Form G belongs to the registered owner. For a
     * motorcycle the person registering is often someone else, so applying
     * that number would register the wrong person. This function returns the
     * plate and the date and nothing else; the NIC is read separately, by
     * extractOwnerNic, and only ever offered for the user to confirm.
     */
    it('ignores the owner NIC on a full page scan', () => {
      const r = extractFromOcr(FULL_PAGE, undefined, NOW);
      expect(r.plate?.value).toBe('CHK9513');
      expect(r.date?.value).toBe('15082026');
      expect(JSON.stringify(r)).not.toContain('3520298765432');
    });

    it('returns nothing usable from an ID number on its own', () => {
      expect(extractFromOcr('NIC: 3520298765432', undefined, NOW).plate).toBeNull();
      expect(extractFromOcr('35202-1234567-1', undefined, NOW).plate).toBeNull();
    });

    it('exposes no field other than plate and date', () => {
      const r = extractFromOcr(FULL_PAGE, undefined, NOW);
      expect(Object.keys(r).sort()).toEqual(['date', 'plate']);
    });
  });

  describe('failing cleanly rather than confidently', () => {
    /**
     * A blurred or washed-out scan does not return nothing. It returns short
     * confident-looking fragments. Measured against degraded fixtures, the
     * engine produced EE7, LL0, CA1, AT1 and KI6 from an unreadable image.
     * Surfacing any of those as a plate is worse than admitting defeat.
     */
    it.each(['REGN.No: EE7', 'REGN.No: LL0', 'REGN.No: CA1', 'REGN.No: KI6'])(
      'rejects the garbage fragment in %s',
      (text) => {
        expect(extractFromOcr(text, undefined, NOW).plate).toBeNull();
      },
    );

    it('still accepts a real plate with three digits', () => {
      expect(extractFromOcr('REGN.No: LEB-123', undefined, NOW).plate?.value).toBe('LEB123');
    });

    /**
     * Measured against degraded fixtures, a partial read produced bare numbers
     * that each already appear elsewhere on the certificate: the year out of
     * the registration date, half of the plate itself, and a run out of the
     * chassis number. All three would have looked like plausible plates.
     */
    it.each([
      ['the year from the date', 'REGN.No: 2015 DT : 15/08/2026', '2015'],
      ['half the real plate', 'REGN.No: 4731', '4731'],
      ['part of the chassis number', 'REGN.No: 187', '187'],
    ])('rejects %s', (_label, text, leaked) => {
      const r = extractFromOcr(text, undefined, NOW);
      expect(r.plate).toBeNull();
      expect(JSON.stringify(r.plate)).not.toContain(leaked);
    });

    it('reads the real plate rather than the year when both are present', () => {
      const r = extractFromOcr('REGN.No: CHK-9513 DT : 15/08/2026', undefined, NOW);
      expect(r.plate?.value).toBe('CHK9513');
    });

    it('treats a date with no confidence data as uncertain', () => {
      // A wrong date is the failure validation cannot catch: 15082020 parses
      // exactly as well as 15082026. Without evidence it read cleanly, amber.
      const r = extractFromOcr(CLEAN_LINE, undefined, NOW);
      expect(r.date?.value).toBe('15082026');
      expect(r.date?.uncertain).toBe(true);
    });

    it('treats a merely adequate date confidence as uncertain', () => {
      const words = [{ text: '15/08/2026', confidence: 70 }];
      expect(extractFromOcr(CLEAN_LINE, words, NOW).date?.uncertain).toBe(true);
    });
  });

  it('drops a date that cannot be real rather than guessing', () => {
    const r = extractFromOcr('REGN.No: CHK-9513 DT : 45/18/2015', undefined, NOW);
    expect(r.plate?.value).toBe('CHK9513');
    expect(r.date).toBeNull();
  });

  it('drops a date in the future', () => {
    const r = extractFromOcr('REGN.No: CHK-9513 DT : 13/08/2031', undefined, NOW);
    expect(r.date).toBeNull();
  });

  it('flags a date whose day could also be a month', () => {
    const r = extractFromOcr('REGN.No: CHK-9513 DT : 08/12/2015', undefined, NOW);
    expect(r.date?.value).toBe('08122015');
    expect(r.date?.uncertain).toBe(true);
  });

  it('returns nothing from an empty or unreadable scan', () => {
    expect(extractFromOcr('', undefined, NOW)).toEqual({ plate: null, date: null });
    expect(extractFromOcr('~~~ ### ~~~', undefined, NOW)).toEqual({ plate: null, date: null });
  });

  it('carries tesseract confidence through to the caller', () => {
    const words = [
      { text: 'REGN.No:', confidence: 88 },
      { text: 'CHK-9513', confidence: 41 },
      { text: 'DT', confidence: 90 },
      { text: '15/08/2026', confidence: 93 },
    ];
    const r = extractFromOcr(CLEAN_LINE, words, NOW);
    expect(r.plate?.confidence).toBe(41);
    expect(r.plate?.uncertain).toBe(true);
    expect(r.date?.confidence).toBe(93);
    expect(r.date?.uncertain).toBe(false);
  });
});

describe('confidence grading', () => {
  it.each([
    [95, false, 'high'],
    [70, false, 'high'],
    [70, true, 'medium'],
    [50, false, 'medium'],
    [20, false, 'low'],
  ])('grades %s (uncertain=%s) as %s', (confidence, uncertain, expected) => {
    expect(gradeConfidence(confidence as number, uncertain as boolean)).toBe(expected);
  });
});
