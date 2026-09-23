import { describe, expect, it } from 'vitest';
import { extractOwnerNic } from '../lib/ocr/parse';

/**
 * The NIC on a vehicle certificate is the registered owner's. 9771 matches the
 * CNIC against the SIM the message arrives from, and on a motorcycle the
 * person registering is frequently not the owner, so this number can only ever
 * be a suggestion the user accepts. These tests pin the two things that make
 * that safe: it reads the right number when one is there, and it invents
 * nothing when one is not.
 */

const FULL_PAGE = [
  'Form G',
  'REGN.No:  CHK-9513   DT : 15/08/2026',
  'NIC:  3520298765432',
  "Owner's Name: OWNER NAME HERE",
  'Chassis number: XYZ-456789',
].join(' ');

describe('reading the owner NIC', () => {
  it('reads the number that follows the NIC label', () => {
    expect(extractOwnerNic(FULL_PAGE)?.value).toBe('3520298765432');
  });

  it('copes with the label and digits being garbled', () => {
    expect(extractOwnerNic('N1C: 352O298765432')?.value).toBe('3520298765432');
  });

  it('accepts a number printed with dashes', () => {
    expect(extractOwnerNic('NIC: 35202-9876543-2')?.value).toBe('3520298765432');
  });

  /**
   * Always. Not because the read is doubtful, but because whose number it is
   * cannot be decided from the paper. The UI shows it amber and requires a
   * tick before it is used.
   */
  it('is always marked uncertain', () => {
    expect(extractOwnerNic(FULL_PAGE)?.uncertain).toBe(true);
  });
});

describe('inventing nothing', () => {
  it('returns nothing when there is no NIC label', () => {
    expect(extractOwnerNic('REGN.No: CHK-9513 DT : 15/08/2026')).toBeNull();
  });

  it('returns nothing from an empty scan', () => {
    expect(extractOwnerNic('')).toBeNull();
  });

  it('will not turn the owner name into a number', () => {
    // Every character here is a letter the digit repair would happily convert.
    expect(extractOwnerNic("NIC: OWNER'S NAME GOES HERE")).toBeNull();
  });

  it('refuses a run that is too short to be a CNIC', () => {
    expect(extractOwnerNic('NIC: 35202987')).toBeNull();
  });

  it('refuses a number that is not shaped like a CNIC', () => {
    expect(extractOwnerNic('NIC: 0000000000000')).toBeNull();
  });

  it('does not reach into the next field when the NIC line is blank', () => {
    // A blank NIC field must not borrow the number from whatever follows it.
    // Note that leading whitespace collapses before the zone is measured, so
    // the guard has to be the next label rather than a character count.
    expect(extractOwnerNic('NIC:   Chassis number: 3520298765432')).toBeNull();
    expect(extractOwnerNic('NIC: Form serial: 3520298765432')).toBeNull();
  });
});
