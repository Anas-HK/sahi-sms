import { describe, expect, it } from 'vitest';
import { GATE, gateFrame, inkFraction, motion, sharpness, toSmallGray } from '../lib/ocr/framecheck';
import type { RgbaImage } from '../lib/ocr/preprocess';

/** A strip of green paper with dark glyph-shaped blocks on it. */
function strip({ glyphs = 14, blur = false, bg = 210 } = {}): RgbaImage {
  const w = 640;
  const h = 90;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = bg - 40;
    data[i * 4 + 1] = bg;
    data[i * 4 + 2] = bg - 35;
    data[i * 4 + 3] = 255;
  }
  for (let g = 0; g < glyphs; g++) {
    const gx = 20 + g * 42;
    for (let x = gx; x < gx + 22 && x < w; x++) {
      for (let y = 30; y < 62; y++) {
        const p = (y * w + x) * 4;
        // A blurred glyph barely differs from the paper.
        const v = blur ? bg - 25 : 25;
        data[p] = v;
        data[p + 1] = v;
        data[p + 2] = v;
      }
    }
  }
  return { data, width: w, height: h };
}

const gray = (img: RgbaImage) => toSmallGray(img);

describe('frame gate', () => {
  it('fires on a sharp, still frame with text in it', () => {
    const a = gray(strip());
    const result = gateFrame(a, gray(strip()));
    expect(result.reason).toBe('ok');
    expect(result.ready).toBe(true);
  });

  it('refuses an empty frame rather than spending an OCR pass on it', () => {
    const blank = gray(strip({ glyphs: 0 }));
    expect(gateFrame(blank, blank).reason).toBe('empty');
  });

  it('refuses a blurred frame', () => {
    const blurred = gray(strip({ blur: true }));
    const result = gateFrame(blurred, blurred);
    expect(result.ready).toBe(false);
    // Either there is not enough ink left to see, or the edges are too soft.
    expect(['empty', 'blurry']).toContain(result.reason);
  });

  it('refuses a frame while the phone is still moving', () => {
    // Same content, shifted: a swing of the hand between frames.
    const now = gray(strip());
    const before = gray(strip({ glyphs: 6 }));
    expect(gateFrame(now, before).reason).toBe('moving');
  });

  it('refuses the very first frame, having nothing to compare against', () => {
    expect(gateFrame(gray(strip()), null).reason).toBe('moving');
  });
});

describe('the individual measures', () => {
  it('scores sharp edges above soft ones', () => {
    expect(sharpness(gray(strip()))).toBeGreaterThan(sharpness(gray(strip({ blur: true }))));
  });

  it('scores a held frame below a moving one', () => {
    const a = gray(strip());
    expect(motion(a, gray(strip()))).toBeLessThan(motion(a, gray(strip({ glyphs: 4 }))));
  });

  it('puts a line of text inside the plausible ink band', () => {
    const ink = inkFraction(gray(strip()));
    expect(ink).toBeGreaterThan(GATE.minInk);
    expect(ink).toBeLessThan(GATE.maxInk);
  });

  it('downscales while keeping the aspect ratio', () => {
    const small = toSmallGray(strip(), 160);
    expect(small.width).toBe(160);
    expect(small.height).toBe(Math.round((90 * 160) / 640));
  });
});
