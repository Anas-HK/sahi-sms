/**
 * Tesseract driving, kept behind one narrow interface.
 *
 * The engine is loaded lazily and only when the user taps "scan", so the first
 * page load stays small for people on slow connections and metered data, and
 * so nothing OCR related runs for the majority who just type four fields.
 *
 * The image never leaves the device. There is no upload path in this file and
 * there is no server in this project to upload to.
 */

import type { ExtractResult, FieldGuess, OcrWord } from './parse';
import { extractFromOcr } from './parse';
import type { RgbaImage } from './preprocess';
import { TUNING_PAGE, TUNING_STRIP, preprocessForOcr, type Tuning } from './preprocess';

/** Anything the certificate line can legitimately contain. */
export const CHAR_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:./- ';

const PSM_SINGLE_LINE = '7';
const PSM_SINGLE_BLOCK = '6';

export interface OcrPass {
  psm: string;
  text: string;
  words: OcrWord[];
  meanConfidence: number;
}

export interface ScanResult extends ExtractResult {
  passes: OcrPass[];
  channel: 'green' | 'luma';
  skewDegrees: number;
  /** The preprocessed strip, so the UI can show what the engine actually saw. */
  processed: RgbaImage;
}

type AnyWorker = {
  setParameters(params: Record<string, unknown>): Promise<unknown>;
  recognize(
    image: unknown,
    options?: unknown,
    output?: unknown,
  ): Promise<{ data: { text: string; blocks: unknown } }>;
  terminate(): Promise<unknown>;
};

let workerPromise: Promise<AnyWorker> | null = null;

/** One worker per session. Spinning it up costs a few megabytes and a second. */
async function getWorker(): Promise<AnyWorker> {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then((m) =>
      m.createWorker('eng'),
    ) as unknown as Promise<AnyWorker>;
  }
  return workerPromise;
}

export async function disposeWorker(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  workerPromise = null;
  await worker.terminate();
}

/**
 * Walks the block tree for words. Tesseract.js v6 only returns them when the
 * blocks output is requested, and never as a flat list.
 */
function collectWords(blocks: unknown): OcrWord[] {
  const out: OcrWord[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node.text === 'string' && typeof node.confidence === 'number' && !node.lines && !node.paragraphs && !node.words) {
      out.push({ text: node.text, confidence: node.confidence });
      return;
    }
    walk(node.paragraphs);
    walk(node.lines);
    walk(node.words);
  };
  walk(blocks);
  return out;
}

async function runPass(worker: AnyWorker, image: unknown, psm: string): Promise<OcrPass> {
  await worker.setParameters({
    tessedit_pageseg_mode: psm,
    tessedit_char_whitelist: CHAR_WHITELIST,
    preserve_interword_spaces: '1',
    // The preprocessed strip carries no DPI metadata, and tesseract guesses
    // badly without it. We resample to roughly 300dpi-equivalent, so say so.
    user_defined_dpi: '300',
  });
  const { data } = await worker.recognize(image, undefined, { text: true, blocks: true });
  const words = collectWords(data.blocks);
  const meanConfidence = words.length
    ? words.reduce((a, w) => a + w.confidence, 0) / words.length
    : 0;
  return { psm, text: data.text ?? '', words, meanConfidence };
}

/**
 * Which framing the image came from. This is not cosmetic: the two need
 * different binarisation, and using one path's constants on the other was
 * measured at 2.9% against 55.9%.
 */
export type ScanMode = 'strip' | 'page';

export interface ScanOptions {
  /** 'strip' for a guided capture of one line, 'page' for a whole certificate. */
  mode?: ScanMode;
  /** Overrides on top of the mode's preset, for the bench tool's sweep. */
  tuning?: Partial<Tuning>;
  now?: Date;
  /**
   * Converts the preprocessed image into something tesseract accepts. The
   * browser paints it into a canvas; the headless bench passes a PNG encoder,
   * since there is no DOM in Node.
   */
  encode?: (image: RgbaImage) => unknown | Promise<unknown>;
}

/**
 * Two passes over the same preprocessed image, then a cross-check.
 *
 * The first treats it as a single line, which is what a guided capture of the
 * REGN.No row produces and gives tesseract the least room to invent layout.
 * The second reads it as a block, which recovers certificate layouts that do
 * not put the plate and the date on one line. Both always run, because their
 * agreement is the strongest signal available that a read is correct.
 */
export async function scanCertificate(
  input: RgbaImage,
  opts: ScanOptions = {},
): Promise<ScanResult> {
  const preset = opts.mode === 'page' ? TUNING_PAGE : TUNING_STRIP;
  const { image, channel, skewDegrees } = preprocessForOcr(input, {
    ...preset,
    ...(opts.tuning ?? {}),
  });
  const worker = await getWorker();
  const canvasLike = opts.encode ? await opts.encode(image) : toImageLike(image);

  const first = await runPass(worker, canvasLike, PSM_SINGLE_LINE);
  const second = await runPass(worker, canvasLike, PSM_SINGLE_BLOCK);
  const passes = [first, second];

  const a = extractFromOcr(first.text, first.words, opts.now);
  const b = extractFromOcr(second.text, second.words, opts.now);

  return {
    plate: reconcile(a.plate, b.plate),
    date: reconcile(a.date, b.date),
    passes,
    channel,
    skewDegrees,
    processed: image,
  };
}

/**
 * Cross-checks the two passes against each other.
 *
 * The passes segment the image differently, so when they independently land on
 * the same string that is real evidence the read is right, worth more than any
 * confidence threshold we could pick. When they disagree, or only one of them
 * found anything, the field is a guess and is flagged so the user checks it.
 *
 * This matters most for the date. A misread date is the one failure validation
 * cannot catch, because 15082029 is every bit as valid a date as 15082026 and
 * sails through to fail at 9771 instead.
 */
export function reconcile<T>(a: FieldGuess<T> | null, b: FieldGuess<T> | null): FieldGuess<T> | null {
  if (!a && !b) return null;
  if (!a) return { ...b!, uncertain: true };
  if (!b) return { ...a, uncertain: true };

  if (a.value === b.value) {
    // Both segmentations agree. Keep the better-evidenced confidence and let
    // the existing per-field rules decide whether it is still a guess.
    const confidence = Math.max(a.confidence ?? 0, b.confidence ?? 0) || null;
    return { ...a, confidence, uncertain: a.uncertain && b.uncertain };
  }

  // They disagree. Show the more confident reading, but never as a sure thing.
  const better = (b.confidence ?? 0) > (a.confidence ?? 0) ? b : a;
  return { ...better, uncertain: true };
}

/**
 * Browser path. Node callers supply their own encoder via ScanOptions.
 *
 * Tesseract's ImageLike is `string | HTMLImageElement | HTMLCanvasElement |
 * HTMLVideoElement`. **ImageData is not in that list**: handing one over gets
 * as far as the wasm core and then fails with "Image file /input cannot be
 * read", because the worker tries to sniff a file format out of raw pixels.
 * So paint the pixels into a canvas and pass the canvas.
 */
function toImageLike(image: RgbaImage): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('no DOM in this environment: pass an encode() option');
  }
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('could not get a 2d context to hand the image to tesseract');
  ctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  return canvas;
}
