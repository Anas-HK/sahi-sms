/**
 * Turning a noisy OCR string into two trustworthy fields.
 *
 * The scanner only ever reads the plate and the registration date. It must
 * never read the CNIC off a vehicle certificate: the NIC printed there is the
 * registered owner's, and for motorcycles and three-wheelers the person
 * registering is frequently not the registered owner. Using it would silently
 * send someone else's CNIC.
 *
 * Target line, as printed on a Sindh Form G:
 *   REGN.No:  CHK-9513   DT : 15/08/2026
 */

import { checkRegDate, isValidPlate, normalizePlate, toDDMMYYYY } from '../format';

/* --------------------------------------------------- confusion repair */

/** Characters tesseract emits for digits when the true glyph is a letter. */
const TO_LETTER: Record<string, string> = {
  '0': 'O',
  '1': 'I',
  '2': 'Z',
  '4': 'A',
  '5': 'S',
  '6': 'G',
  '7': 'T',
  '8': 'B',
};

/** Characters tesseract emits for letters when the true glyph is a digit. */
const TO_DIGIT: Record<string, string> = {
  O: '0',
  Q: '0',
  D: '0',
  U: '0',
  I: '1',
  L: '1',
  '|': '1',
  Z: '2',
  A: '4',
  S: '5',
  G: '6',
  T: '7',
  B: '8',
};

export function repairLetters(s: string): string {
  return s
    .toUpperCase()
    .split('')
    .map((c) => TO_LETTER[c] ?? c)
    .join('');
}

export function repairDigits(s: string): string {
  return s
    .toUpperCase()
    .split('')
    .map((c) => TO_DIGIT[c] ?? c)
    .join('');
}

/* ------------------------------------------------------ plate recovery */

export interface PlateGuess {
  value: string;
  raw: string;
  /**
   * True when the letter/digit boundary had to be inferred because OCR lost
   * the separator. The UI shows these amber: the split is a guess.
   */
  ambiguousSplit: boolean;
}

const PLATE_SEPARATOR = /[-–—‑_.\s]+/;

/**
 * Repairs one plate token. When a separator survived OCR we trust it, because
 * the certificate prints one and it removes the only real ambiguity. Without
 * one we score every possible split by how many characters are already the
 * right class, and flag the result as a guess.
 */
export function repairPlateToken(token: string): PlateGuess | null {
  const raw = token.trim();
  if (!raw) return null;

  // No Pakistani plate carries more than six digits. A longer digit run is a
  // CNIC, a chassis number or a form serial, and repairing it into letters
  // would manufacture a plausible-looking plate out of someone's ID number.
  const nativeDigits = (raw.match(/\d/g) ?? []).length;
  if (nativeDigits > 6) return null;

  const pieces = raw.split(PLATE_SEPARATOR).filter(Boolean);
  if (pieces.length >= 2) {
    const letters = repairLetters(pieces[0]).replace(/[^A-Z]/g, '');
    const digits = repairDigits(pieces.slice(1).join('')).replace(/\D/g, '');
    const value = `${letters}${digits}`;
    if (!isValidPlate(value)) return null;
    return { value, raw, ambiguousSplit: false };
  }

  const flat = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (flat.length < 3 || flat.length > 10) return null;

  let best: { split: number; score: number } | null = null;
  const maxPrefix = Math.min(4, flat.length - 1);
  for (let split = 0; split <= maxPrefix; split++) {
    const prefix = flat.slice(0, split);
    const suffix = flat.slice(split);
    if (suffix.length < 1 || suffix.length > 6) continue;
    const score =
      [...prefix].filter((c) => /[A-Z]/.test(c)).length +
      [...suffix].filter((c) => /[0-9]/.test(c)).length;
    // Tie goes to the longer letter prefix: a leading letter group is the
    // common shape and a wrongly short prefix mangles more characters.
    if (!best || score > best.score) best = { split, score };
  }
  if (!best) return null;

  const letters = repairLetters(flat.slice(0, best.split)).replace(/[^A-Z]/g, '');
  const digits = repairDigits(flat.slice(best.split)).replace(/\D/g, '');
  const value = `${letters}${digits}`;
  if (!isValidPlate(value)) return null;

  // Always a guess. The certificate prints a separator; if OCR lost it there
  // is no way to tell "CHK9513" from a misread "CH69513", and the two differ
  // by one character that costs a failed registration. Flag it and let the
  // user check it against the paper in their hand.
  return { value, raw, ambiguousSplit: true };
}

/* ------------------------------------------------------------ anchors */

/** "REGN.No", "REGN No", "REG N0", with the usual glyph slippage. */
const RE_REGN_ANCHOR = /R\s*E\s*[G6]\s*[NM]\s*\.?\s*[NM]?\s*[O0]?\s*\.?\s*:?/;
/** "DT :" and the common "0T" / "D7" misreads. */
const RE_DT_ANCHOR = /\b[D0]\s*[T7]\s*\.?\s*:?/;

const RE_DATE = /([0-9OILSBGZ]{1,2})\s*[/\-.]\s*([0-9OILSBGZ]{1,2})\s*[/\-.]\s*([0-9OILSBGZ]{4})/;
const RE_PLATE_TOKEN = /[A-Z0-9]{2,4}\s*[-–—‑]\s*[A-Z0-9]{1,6}|[A-Z0-9]{3,10}/g;

/**
 * The floor for a plate recovered from OCR. Every real Pakistani plate has at
 * least three digits; a two-letter-one-digit fragment is what a failed read
 * looks like, not what a plate looks like.
 */
const MIN_OCR_PLATE_DIGITS = /\d{3,}/;

/** Label noise that would otherwise be mistaken for a plate. */
const LABEL_WORDS = new Set([
  'REGN',
  'REG',
  'NO',
  'N0',
  'DT',
  'FORM',
  'NIC',
  'CNIC',
  'SEE',
  'SECTION',
  'DATE',
  'CERTIFICATE',
  'REGISTRATION',
]);

function stripLabels(zone: string): string {
  return zone
    .replace(RE_REGN_ANCHOR, ' ')
    .replace(/\bN\s*[O0]\s*\.?\s*:?/g, ' ')
    .replace(RE_DT_ANCHOR, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ----------------------------------------------------------- extraction */

export interface OcrWord {
  text: string;
  confidence: number;
}

export interface FieldGuess<T> {
  value: T;
  raw: string;
  /** Mean tesseract confidence of the contributing words, 0-100, or null. */
  confidence: number | null;
  uncertain: boolean;
}

/**
 * Below this, a date is shown amber even though it parsed cleanly. Set high on
 * purpose: see the comment where it is used.
 */
export const DATE_CONFIDENCE_FLOOR = 80;

export interface ExtractResult {
  plate: FieldGuess<string> | null;
  /** DDMMYYYY, ready for the SMS. */
  date: FieldGuess<string> | null;
}

function confidenceFor(raw: string, words: OcrWord[] | undefined): number | null {
  if (!words?.length) return null;
  const needle = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!needle) return null;
  const hits = words.filter((w) => {
    const t = w.text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return t.length > 0 && (needle.includes(t) || t.includes(needle));
  });
  if (!hits.length) return null;
  return hits.reduce((a, w) => a + w.confidence, 0) / hits.length;
}

/**
 * Pulls the plate and the registration date out of an OCR pass.
 *
 * Anchors on the REGN.No and DT labels when tesseract found them, because that
 * splits the line into two unambiguous zones. Falls back to scanning the whole
 * string when it did not, which is what happens on certificate layouts that
 * do not put both fields on one line.
 */
export function extractFromOcr(
  text: string,
  words?: OcrWord[],
  now: Date = new Date(),
): ExtractResult {
  const flat = (text ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!flat) return { plate: null, date: null };

  const regnMatch = RE_REGN_ANCHOR.exec(flat);
  const dtMatch = RE_DT_ANCHOR.exec(flat);

  // Only trust the DT anchor when it sits after the REGN one, otherwise a
  // stray "D7" earlier in the line would cut the plate zone to nothing.
  const dtUsable =
    dtMatch !== null && (regnMatch === null || dtMatch.index > regnMatch.index);

  const plateZone = stripLabels(
    regnMatch
      ? flat.slice(regnMatch.index + regnMatch[0].length, dtUsable ? dtMatch!.index : undefined)
      : dtUsable
        ? flat.slice(0, dtMatch!.index)
        : flat,
  );

  const dateZone = dtUsable ? flat.slice(dtMatch!.index + dtMatch![0].length) : flat;

  /* plate */
  let plate: FieldGuess<string> | null = null;
  for (const token of plateZone.match(RE_PLATE_TOKEN) ?? []) {
    const bare = token.replace(/[^A-Z0-9]/g, '');
    if (LABEL_WORDS.has(bare)) continue;
    const guess = repairPlateToken(token);
    if (!guess) continue;
    // Digits-only plates do exist in some provinces, but a bare number read
    // off a certificate is far more often something else on the page. Measured
    // against degraded fixtures this rule alone removed 2015 (the year, out of
    // the registration date), 4731 (half the real plate) and 187 (out of the
    // chassis number XYZ-456789), each of which would have looked plausible.
    // Typed input is unaffected; this bar applies only to OCR output.
    if (!/[A-Z]/.test(guess.value)) continue;
    // A badly blurred or washed-out scan does not fail cleanly: it returns a
    // short confident-looking fragment like "EE7" or "CA1". Real plates carry
    // at least three digits, so anything shorter is noise, not a reading.
    if (!MIN_OCR_PLATE_DIGITS.test(guess.value)) continue;
    const confidence = confidenceFor(guess.raw, words);
    plate = {
      value: normalizePlate(guess.value),
      raw: guess.raw,
      confidence,
      uncertain: guess.ambiguousSplit || (confidence !== null && confidence < 65),
    };
    break;
  }

  /* date */
  let date: FieldGuess<string> | null = null;
  const dm = RE_DATE.exec(dateZone) ?? RE_DATE.exec(flat);
  if (dm) {
    const dd = repairDigits(dm[1]).replace(/\D/g, '');
    const mm = repairDigits(dm[2]).replace(/\D/g, '');
    const yyyy = repairDigits(dm[3]).replace(/\D/g, '');
    const candidate = `${dd}/${mm}/${yyyy}`;
    const check = checkRegDate(candidate, now);
    if (check.ok) {
      const confidence = confidenceFor(dm[0], words);
      date = {
        value: toDDMMYYYY(candidate, now),
        raw: dm[0],
        confidence,
        // A misread date is the one failure validation cannot catch: 15082020
        // is every bit as valid a date as 15082026, so a wrong one sails
        // through and fails at 9771 instead. It gets a higher bar than the
        // plate, where a bad read usually produces something obviously wrong.
        uncertain:
          check.ambiguous || confidence === null || confidence < DATE_CONFIDENCE_FLOOR,
      };
    }
  }

  return { plate, date };
}

/* ------------------------------------------------------ confidence gate */

export type Grade = 'high' | 'medium' | 'low';

/**
 * Thresholds are the starting point, not a measured result. They get tuned
 * against tests/fixtures once real certificate photos are in; see
 * tools/ocr-bench.mjs.
 */
export function gradeConfidence(confidence: number | null, uncertain: boolean): Grade {
  if (confidence === null) return uncertain ? 'medium' : 'medium';
  if (confidence >= 65 && !uncertain) return 'high';
  if (confidence >= 45) return 'medium';
  return 'low';
}
