import { describe, expect, it } from 'vitest';
import { reconcile } from '../lib/ocr/recognize';
import type { FieldGuess } from '../lib/ocr/parse';

const guess = (
  value: string,
  confidence: number | null = 90,
  uncertain = false,
): FieldGuess<string> => ({ value, raw: value, confidence, uncertain });

/**
 * Two page-segmentation passes read the same image independently. Agreement
 * between them is stronger evidence than any confidence threshold we could
 * pick, and disagreement is the clearest possible signal to ask the user.
 */
describe('cross-pass reconciliation', () => {
  it('trusts a reading both passes arrived at', () => {
    const r = reconcile(guess('15082026', 70), guess('15082026', 88));
    expect(r).toMatchObject({ value: '15082026', confidence: 88, uncertain: false });
  });

  it('flags a reading the passes disagree on, and shows the better one', () => {
    // This is the real failure: 15082029 instead of 15082026. Both parse as
    // valid dates, so nothing downstream can catch it. Disagreement can.
    const r = reconcile(guess('15082029', 62), guess('15082026', 85));
    expect(r).toMatchObject({ value: '15082026', uncertain: true });
  });

  it('flags a reading only one pass found', () => {
    expect(reconcile(guess('CHK9513'), null)).toMatchObject({ uncertain: true });
    expect(reconcile(null, guess('CHK9513'))).toMatchObject({ uncertain: true });
  });

  it('returns nothing when neither pass found anything', () => {
    expect(reconcile(null, null)).toBeNull();
  });

  it('keeps an agreed reading uncertain when both passes were already unsure', () => {
    const r = reconcile(guess('CHK9513', 50, true), guess('CHK9513', 55, true));
    expect(r?.uncertain).toBe(true);
  });

  it('clears uncertainty when one confident pass corroborates an unsure one', () => {
    const r = reconcile(guess('CHK9513', 50, true), guess('CHK9513', 92, false));
    expect(r?.uncertain).toBe(false);
  });
});
