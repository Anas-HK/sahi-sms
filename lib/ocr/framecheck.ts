/**
 * Cheap "is this frame worth reading?" gate for auto-capture.
 *
 * A full OCR pass costs well over a second, far too slow to run on every
 * camera frame. These checks run on a small downscale in a fraction of a
 * millisecond and reject the frames that could never produce a read: an empty
 * desk, a blurred swing of the phone, a hand still moving.
 *
 * None of this decides what the text says. It only decides whether to spend
 * the engine on it.
 */

import type { RgbaImage } from './preprocess';

export interface FrameStats {
  /** Gradient energy. Low means out of focus or nothing there. */
  sharpness: number;
  /** Mean absolute difference from the previous frame. Low means held still. */
  motion: number;
  /** Fraction of pixels darker than the local average, so roughly "ink". */
  inkFraction: number;
}

export interface GateResult extends FrameStats {
  ready: boolean;
  /** Which check failed first, for the on-screen hint. */
  reason: 'ok' | 'empty' | 'blurry' | 'moving';
}

export const GATE = {
  /** Below this the strip is out of focus or blank. */
  minSharpness: 6,
  /** Above this the phone is still moving. */
  maxMotion: 9,
  /** A line of text covers a few percent of the strip; both extremes are wrong. */
  minInk: 0.015,
  maxInk: 0.45,
} as const;

/** Grayscale downscale, nearest neighbour. Speed matters more than quality. */
export function toSmallGray(image: RgbaImage, targetWidth = 240): {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
} {
  const tw = Math.max(1, Math.min(targetWidth, image.width));
  const th = Math.max(1, Math.round((image.height * tw) / image.width));
  const out = new Uint8ClampedArray(tw * th);
  const sx = image.width / tw;
  const sy = image.height / th;
  for (let y = 0; y < th; y++) {
    const srcY = Math.min(image.height - 1, (y * sy) | 0);
    for (let x = 0; x < tw; x++) {
      const srcX = Math.min(image.width - 1, (x * sx) | 0);
      const p = (srcY * image.width + srcX) * 4;
      // Green channel, same reasoning as the main pipeline: the certificate's
      // security pattern is green ink, so it reads bright here.
      out[y * tw + x] = image.data[p + 1];
    }
  }
  return { data: out, width: tw, height: th };
}

/**
 * Mean absolute horizontal gradient. Sharp glyph edges score high, a blurred
 * or empty frame scores near zero.
 */
export function sharpness(gray: { data: Uint8ClampedArray; width: number; height: number }): number {
  const { data, width: w, height: h } = gray;
  let total = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 1; x < w; x++) {
      total += Math.abs(data[y * w + x] - data[y * w + x - 1]);
      n++;
    }
  }
  return n ? total / n : 0;
}

/** Mean absolute difference between two same-sized frames. */
export function motion(
  a: { data: Uint8ClampedArray },
  b: { data: Uint8ClampedArray } | null,
): number {
  if (!b || a.data.length !== b.data.length) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let i = 0; i < a.data.length; i++) total += Math.abs(a.data[i] - b.data[i]);
  return total / a.data.length;
}

/** Fraction of pixels meaningfully darker than the frame mean. */
export function inkFraction(gray: { data: Uint8ClampedArray }): number {
  const { data } = gray;
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  const mean = sum / data.length;
  const threshold = mean * 0.75;
  let ink = 0;
  for (let i = 0; i < data.length; i++) if (data[i] < threshold) ink++;
  return ink / data.length;
}

/**
 * Decides whether a frame is worth an OCR pass, and says why not when it is
 * not, so the UI can tell the user what to change.
 */
export function gateFrame(
  current: { data: Uint8ClampedArray; width: number; height: number },
  previous: { data: Uint8ClampedArray } | null,
  gate: typeof GATE = GATE,
): GateResult {
  const stats: FrameStats = {
    sharpness: sharpness(current),
    motion: motion(current, previous),
    inkFraction: inkFraction(current),
  };

  // Order matters: report the most actionable problem. "Nothing in the box"
  // is more useful than "hold still" when the box is pointed at a wall.
  if (stats.inkFraction < gate.minInk || stats.inkFraction > gate.maxInk) {
    return { ...stats, ready: false, reason: 'empty' };
  }
  if (stats.sharpness < gate.minSharpness) {
    return { ...stats, ready: false, reason: 'blurry' };
  }
  if (stats.motion > gate.maxMotion) {
    return { ...stats, ready: false, reason: 'moving' };
  }
  return { ...stats, ready: true, reason: 'ok' };
}
