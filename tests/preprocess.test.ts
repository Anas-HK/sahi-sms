import { describe, expect, it } from 'vitest';
import {
  bestChannel,
  findSkewDegrees,
  flatField,
  greenChannel,
  preprocessForOcr,
  removeLongHorizontalRuns,
  resizeToWidth,
  sauvola,
  shear,
  stretchContrast,
  type GrayImage,
  type RgbaImage,
} from '../lib/ocr/preprocess';

/* --------------------------------------------------------------- helpers */

function blank(width: number, height: number, rgb: [number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

function fillRect(
  img: RgbaImage,
  x0: number,
  y0: number,
  w: number,
  h: number,
  rgb: [number, number, number],
) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const p = (y * img.width + x) * 4;
      img.data[p] = rgb[0];
      img.data[p + 1] = rgb[1];
      img.data[p + 2] = rgb[2];
    }
  }
}

/**
 * A stand-in for the Form G: pale green paper, a green horizontal guilloche
 * pattern, black glyph-shaped blocks, and a brightness gradient across the
 * frame so the flat-field step has something to remove.
 */
function syntheticCertificate(): RgbaImage {
  const w = 600;
  const h = 120;
  const img = blank(w, h, [214, 234, 216]);

  // Green security ruling.
  for (let y = 0; y < h; y += 4) fillRect(img, 0, y, w, 1, [150, 200, 155]);

  // Black print.
  for (let i = 0; i < 12; i++) fillRect(img, 40 + i * 30, 45, 16, 30, [20, 22, 24]);

  // Uneven lighting, bright on the left, dark on the right.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const factor = 1.25 - (x / w) * 0.55;
      img.data[p] = Math.min(255, img.data[p] * factor);
      img.data[p + 1] = Math.min(255, img.data[p + 1] * factor);
      img.data[p + 2] = Math.min(255, img.data[p + 2] * factor);
    }
  }
  return img;
}

function inkFraction(gray: GrayImage): number {
  let ink = 0;
  for (let i = 0; i < gray.data.length; i++) if (gray.data[i] === 0) ink++;
  return ink / gray.data.length;
}

/* ----------------------------------------------------------------- tests */

describe('channel choice', () => {
  it('reads green ink as bright and black print as dark', () => {
    const img = blank(20, 20, [150, 200, 155]);
    fillRect(img, 5, 5, 5, 5, [20, 22, 24]);
    const g = greenChannel(img);
    expect(g.data[0]).toBeGreaterThan(180); // guilloche
    expect(g.data[6 * 20 + 6]).toBeLessThan(60); // print
  });

  it('prefers the green channel on a green security document', () => {
    expect(bestChannel(syntheticCertificate()).channel).toBe('green');
  });

  it('prefers luma when the ink itself is green', () => {
    // Green ink on white paper is the one case where the green channel is the
    // wrong choice: it sees ink at 150 against paper at 255, while luma sees
    // it at about 88. On neutral black-on-white the two channels are
    // equivalent, so there is nothing to assert there.
    const img = blank(120, 60, [252, 252, 252]);
    fillRect(img, 10, 20, 40, 20, [0, 150, 0]);
    expect(bestChannel(img).channel).toBe('luma');
  });
});

describe('flat field correction', () => {
  it('flattens a brightness gradient across the paper', () => {
    const img = blank(400, 80, [200, 220, 200]);
    for (let y = 0; y < 80; y++) {
      for (let x = 0; x < 400; x++) {
        const p = (y * 400 + x) * 4;
        const factor = 1.3 - (x / 400) * 0.6;
        img.data[p + 1] = Math.min(255, img.data[p + 1] * factor);
      }
    }
    const before = greenChannel(img);
    const after = flatField(before);

    const spread = (g: GrayImage) => {
      const mid = Math.floor(g.height / 2);
      const left = g.data[mid * g.width + 20];
      const right = g.data[mid * g.width + g.width - 20];
      return Math.abs(left - right);
    };
    expect(spread(after)).toBeLessThan(spread(before));
  });
});

describe('contrast stretch', () => {
  it('opens up a washed out image', () => {
    // Everything squeezed into 118..138, which is what an overexposed or
    // low-contrast capture looks like before anything else can work on it.
    const data = new Uint8ClampedArray(200 * 50);
    for (let i = 0; i < data.length; i++) data[i] = 118 + (i % 21);
    const out = stretchContrast({ data, width: 200, height: 50 });

    const range = (d: Uint8ClampedArray) => Math.max(...d) - Math.min(...d);
    expect(range(out.data)).toBeGreaterThan(range(data) * 5);
  });

  it('leaves an image with no range to stretch alone', () => {
    const data = new Uint8ClampedArray(100 * 10).fill(200);
    const out = stretchContrast({ data, width: 100, height: 10 });
    expect(out.data[0]).toBe(200);
  });

  it('ignores a lone blown highlight rather than anchoring to it', () => {
    const data = new Uint8ClampedArray(200 * 50).fill(120);
    for (let i = 0; i < data.length; i += 2) data[i] = 140;
    data[0] = 255; // a single specular dot
    const out = stretchContrast({ data, width: 200, height: 50 });
    // The 120/140 pair should still be pushed apart despite the outlier.
    expect(Math.abs(out.data[1] - out.data[2])).toBeGreaterThan(100);
  });
});

describe('binarisation', () => {
  it('keeps the print and drops the paper', () => {
    const gray = flatField(greenChannel(syntheticCertificate()));
    const bin = sauvola(gray);
    const values = new Set(Array.from(bin.data));
    expect([...values].sort()).toEqual([0, 255]);
    // 12 glyph blocks over a 600x120 frame is a few percent of the pixels.
    const ink = inkFraction(bin);
    expect(ink).toBeGreaterThan(0.01);
    expect(ink).toBeLessThan(0.35);
  });
});

describe('ruling removal', () => {
  it('erases a full width line but keeps short glyph strokes', () => {
    const w = 200;
    const h = 40;
    const data = new Uint8ClampedArray(w * h).fill(255);
    for (let x = 0; x < w; x++) data[10 * w + x] = 0; // ruling
    for (let x = 50; x < 60; x++) data[20 * w + x] = 0; // glyph stroke
    const out = removeLongHorizontalRuns({ data, width: w, height: h });

    expect(out.data[10 * w + 100]).toBe(255);
    expect(out.data[20 * w + 55]).toBe(0);
  });
});

describe('deskew', () => {
  /** Glyph-shaped blocks with gaps, which is what a text line actually is. */
  function textLine(w: number, h: number, baseline: number, tiltDeg: number): GrayImage {
    const data = new Uint8ClampedArray(w * h).fill(255);
    const tan = Math.tan((tiltDeg * Math.PI) / 180);
    for (let g = 0; g < 18; g++) {
      const gx = 20 + g * 20;
      for (let x = gx; x < gx + 12; x++) {
        if (x >= w) break;
        const base = baseline + Math.round((x - w / 2) * tan);
        for (let dy = -7; dy <= 7; dy++) {
          const y = base + dy;
          if (y >= 0 && y < h) data[y * w + x] = 0;
        }
      }
    }
    return { data, width: w, height: h };
  }

  it('leaves straight text alone', () => {
    expect(findSkewDegrees(textLine(400, 120, 60, 0))).toBe(0);
  });

  it('leaves a featureless strip alone rather than shearing it', () => {
    // A blank or near-blank capture scores the same at every angle. Returning
    // the edge of the sweep here would wreck an otherwise fine image.
    const data = new Uint8ClampedArray(400 * 120).fill(255);
    expect(findSkewDegrees({ data, width: 400, height: 120 })).toBe(0);
  });

  it.each([5, -3, 8])('detects a %s degree slant', (tilt) => {
    const found = findSkewDegrees(textLine(400, 160, 80, tilt));
    expect(found).toBeCloseTo(tilt, 0);
  });

  it('straightens what it detected', () => {
    const tilted = textLine(400, 160, 80, 5);
    const straightened = shear(tilted, findSkewDegrees(tilted));
    // Once corrected there should be no skew left to find.
    expect(findSkewDegrees(straightened)).toBe(0);

    // And the ink should now sit in far fewer rows.
    const rowsWithInk = (g: typeof tilted) => {
      let n = 0;
      for (let y = 0; y < g.height; y++) {
        for (let x = 0; x < g.width; x++) {
          if (g.data[y * g.width + x] === 0) {
            n++;
            break;
          }
        }
      }
      return n;
    };
    expect(rowsWithInk(straightened)).toBeLessThan(rowsWithInk(tilted));
  });
});

describe('resize', () => {
  it('resamples to the target width and keeps the aspect ratio', () => {
    const out = resizeToWidth(blank(600, 120, [10, 20, 30]), 300);
    expect(out.width).toBe(300);
    expect(out.height).toBe(60);
    expect(out.data[1]).toBeCloseTo(20, -1);
  });
});

describe('the whole pipeline', () => {
  it('turns a synthetic certificate into clean black on white', () => {
    const result = preprocessForOcr(syntheticCertificate(), { targetWidth: 900 });
    expect(result.channel).toBe('green');
    expect(result.image.width).toBe(900);

    const values = new Set<number>();
    for (let i = 0; i < result.image.data.length; i += 4) values.add(result.image.data[i]);
    expect([...values].sort((a, b) => a - b)).toEqual([0, 255]);
  });

  it('accepts a tuning override', () => {
    const a = preprocessForOcr(syntheticCertificate(), { targetWidth: 600, sauvolaK: 0.1 });
    const b = preprocessForOcr(syntheticCertificate(), { targetWidth: 600, sauvolaK: 0.6 });
    const ink = (img: RgbaImage) => {
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4) if (img.data[i] === 0) n++;
      return n;
    };
    // Higher k keeps less ink, which is the knob the bench tool sweeps.
    expect(ink(b.image)).toBeLessThanOrEqual(ink(a.image));
  });
});
