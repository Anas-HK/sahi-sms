/**
 * Image preparation for the certificate scan.
 *
 * A Pakistani Form G is close to the worst case for OCR: a green guilloche
 * security pattern printed under the text, lamination that throws glare, a
 * fold across the middle, and a photo taken at an angle in poor light. Feeding
 * that to tesseract raw returns noise. Each step below removes one of those.
 *
 * Everything works on a plain ImageData-shaped object so the same code runs in
 * the browser and headlessly in tools/ocr-bench.mjs.
 */

export interface RgbaImage {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

export interface GrayImage {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

/**
 * Every constant the scan quality depends on, in one place, so the bench tool
 * can sweep them against real fixture photos instead of us guessing.
 */
export interface Tuning {
  /** Tesseract wants roughly 300dpi-equivalent text. Wider is slower, not better. */
  targetWidth: number;
  /** Background estimation window, as a fraction of image width. */
  flatFieldRadiusRatio: number;
  /** Sauvola window, as a fraction of image width. */
  sauvolaWindowRatio: number;
  /** Sauvola sensitivity. Lower keeps more ink, higher keeps more paper. */
  sauvolaK: number;
  /** Horizontal runs longer than this fraction of width are ruling, not text. */
  ruleRunRatio: number;
  /** Deskew search bounds, in degrees. */
  deskewMaxDeg: number;
  deskewStepDeg: number;
  /** Percentile clipped off each end of the histogram before stretching. */
  contrastClipPercent: number;
}

const SHARED = {
  targetWidth: 1800,
  flatFieldRadiusRatio: 1 / 20,
  sauvolaWindowRatio: 1 / 15,
  ruleRunRatio: 0.35,
  deskewMaxDeg: 10,
  deskewStepDeg: 0.5,
  contrastClipPercent: 2,
};

/**
 * Guided capture: one cropped line, which is what the camera path produces.
 *
 * sauvolaK was 0.25 by assumption and read the registration year wrong. The
 * sweep showed 0.34 reading it correctly at every window ratio and at both
 * 1800 and 2400 px, so it is chosen for being stable across its neighbours
 * rather than for winning one cell. It is also Sauvola's own default.
 *
 * Measured: 91.2% on both fields, 0 silently wrong, over 34 degraded variants.
 */
export const TUNING_STRIP: Tuning = { ...SHARED, sauvolaK: 0.34 };

/**
 * Whole page: the file-picker fallback, where the user supplies a photo of the
 * entire certificate.
 *
 * **These must stay separate.** Resampling a whole page to the same width
 * leaves each glyph a fraction of the size it is in a cropped strip, and
 * Sauvola's k interacts with glyph size against the window. Running the strip's
 * 0.34 over whole pages was measured at 2.9%, against 55.9% at 0.25: a setting
 * tuned on one path is actively harmful on the other.
 */
export const TUNING_PAGE: Tuning = { ...SHARED, sauvolaK: 0.25 };

/**
 * Default for callers that do not say which path they are on. The strip is the
 * primary path, so it is the default.
 *
 * Caveat: the fixture set is currently one certificate. Re-run the sweep as
 * more photos arrive and expect these to move.
 */
export const TUNING: Tuning = TUNING_STRIP;

/* ------------------------------------------------------------ channels */

/**
 * Green channel. The security pattern is printed in green ink, which reflects
 * green strongly, so in this channel the guilloche reads near-white while the
 * black print stays dark. This is the single biggest win on a Form G.
 */
export function greenChannel(img: RgbaImage): GrayImage {
  const out = new Uint8ClampedArray(img.width * img.height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = img.data[p + 1];
  return { data: out, width: img.width, height: img.height };
}

/** Standard luma, used as the comparison channel. */
export function lumaChannel(img: RgbaImage): GrayImage {
  const out = new Uint8ClampedArray(img.width * img.height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (img.data[p] * 299 + img.data[p + 1] * 587 + img.data[p + 2] * 114) / 1000;
  }
  return { data: out, width: img.width, height: img.height };
}

/**
 * Otsu between-class variance. Used only as a score: whichever channel
 * separates ink from paper better for this particular photo is the one we
 * keep. Green usually wins on a Form G, luma wins on a plain white document.
 */
export function otsuSeparability(gray: GrayImage): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.data.length; i++) hist[gray.data[i]]++;
  const total = gray.data.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let best = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) best = between;
  }
  return best / (total * total);
}

/** Picks whichever of green or luma gives better ink/paper separation. */
export function bestChannel(img: RgbaImage): { gray: GrayImage; channel: 'green' | 'luma' } {
  const green = greenChannel(img);
  const luma = lumaChannel(img);
  return otsuSeparability(green) >= otsuSeparability(luma)
    ? { gray: green, channel: 'green' }
    : { gray: luma, channel: 'luma' };
}

/* ------------------------------------------------------ contrast stretch */

/**
 * Stretches the middle of the histogram out to the full range.
 *
 * Washed-out captures, whether from glare, overexposure or a low-contrast
 * camera profile, arrive with ink and paper only a few levels apart. The
 * flat-field and Sauvola steps both work on local statistics and cannot
 * recover range that was never there, so this runs first.
 *
 * Percentile clipping rather than min/max, because a single blown highlight
 * or dust speck would otherwise anchor the whole scale.
 */
export function stretchContrast(gray: GrayImage, clipPercent = 2): GrayImage {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.data.length; i++) hist[gray.data[i]]++;

  const total = gray.data.length;
  const cut = Math.floor((total * clipPercent) / 100);

  let low = 0;
  let acc = 0;
  while (low < 255 && acc + hist[low] <= cut) acc += hist[low++];

  let high = 255;
  acc = 0;
  while (high > 0 && acc + hist[high] <= cut) acc += hist[high--];

  // Nothing to stretch, or a degenerate histogram: leave it alone.
  if (high - low < 8) return gray;

  const scale = 255 / (high - low);
  const out = new Uint8ClampedArray(gray.data.length);
  for (let i = 0; i < gray.data.length; i++) {
    out[i] = (gray.data[i] - low) * scale;
  }
  return { data: out, width: gray.width, height: gray.height };
}

/* --------------------------------------------------------- integral sums */

interface Integrals {
  sum: Float64Array;
  sqsum: Float64Array;
  width: number;
  height: number;
}

function integrals(gray: GrayImage): Integrals {
  const { width: w, height: h, data } = gray;
  const sum = new Float64Array((w + 1) * (h + 1));
  const sqsum = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    let rowSq = 0;
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x];
      rowSum += v;
      rowSq += v * v;
      const i = (y + 1) * (w + 1) + (x + 1);
      sum[i] = sum[i - (w + 1)] + rowSum;
      sqsum[i] = sqsum[i - (w + 1)] + rowSq;
    }
  }
  return { sum, sqsum, width: w, height: h };
}

function boxStats(it: Integrals, x0: number, y0: number, x1: number, y1: number) {
  const W = it.width + 1;
  const a = y0 * W + x0;
  const b = y0 * W + x1;
  const c = y1 * W + x0;
  const d = y1 * W + x1;
  const n = (x1 - x0) * (y1 - y0);
  const s = it.sum[d] - it.sum[b] - it.sum[c] + it.sum[a];
  const sq = it.sqsum[d] - it.sqsum[b] - it.sqsum[c] + it.sqsum[a];
  const mean = s / n;
  const variance = Math.max(0, sq / n - mean * mean);
  return { mean, std: Math.sqrt(variance) };
}

/* ----------------------------------------------------------- flat field */

/**
 * Divides out a slowly varying background. This is what removes lamination
 * glare and the bright/dark gradient of a hand-held photo, so a single
 * threshold means the same thing across the whole strip.
 */
export function flatField(gray: GrayImage, radiusRatio = TUNING.flatFieldRadiusRatio): GrayImage {
  const { width: w, height: h } = gray;
  const r = Math.max(4, Math.round(w * radiusRatio));
  const it = integrals(gray);
  const out = new Uint8ClampedArray(w * h);

  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const { mean } = boxStats(it, x0, y0, x1, y1);
      const v = gray.data[y * w + x];
      // Normalise so paper lands near 255 wherever it is in the frame.
      out[y * w + x] = mean <= 1 ? v : Math.min(255, (v / mean) * 200);
    }
  }
  return { data: out, width: w, height: h };
}

/* ------------------------------------------------------------- Sauvola */

/**
 * Sauvola local binarisation, not Otsu. A global threshold fails on exactly
 * this kind of document: the guilloche, the fold shadow and the glare all
 * shift the local mean, and one cut-off cannot serve all of them.
 *
 * Returns 0 for ink, 255 for paper.
 */
export function sauvola(
  gray: GrayImage,
  windowRatio = TUNING.sauvolaWindowRatio,
  k = TUNING.sauvolaK,
): GrayImage {
  const { width: w, height: h } = gray;
  const r = Math.max(3, Math.round((w * windowRatio) / 2));
  const it = integrals(gray);
  const out = new Uint8ClampedArray(w * h);
  const R = 128; // dynamic range of the standard deviation

  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const { mean, std } = boxStats(it, x0, y0, x1, y1);
      const threshold = mean * (1 + k * (std / R - 1));
      out[y * w + x] = gray.data[y * w + x] <= threshold ? 0 : 255;
    }
  }
  return { data: out, width: w, height: h };
}

/* ------------------------------------------------------- ruling removal */

/**
 * Wipes horizontal ink runs longer than any glyph could be. Whatever survives
 * the green-channel step of the printed ruling pattern goes here.
 */
export function removeLongHorizontalRuns(
  bin: GrayImage,
  runRatio = TUNING.ruleRunRatio,
): GrayImage {
  const { width: w, height: h } = bin;
  const minRun = Math.max(20, Math.round(w * runRatio));
  const out = new Uint8ClampedArray(bin.data);

  for (let y = 0; y < h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const ink = x < w && out[y * w + x] === 0;
      if (ink && start === -1) start = x;
      if (!ink && start !== -1) {
        if (x - start >= minRun) {
          for (let i = start; i < x; i++) out[y * w + i] = 255;
        }
        start = -1;
      }
    }
  }
  return { data: out, width: w, height: h };
}

/* -------------------------------------------------------------- deskew */

/**
 * Horizontal projection after shearing each column vertically by a function
 * of x. The shear has to move pixels between rows: shifting rows sideways
 * leaves every row's ink count untouched and measures nothing at all.
 *
 * At the true skew angle a text line collapses into a few dense rows, so the
 * variance of the row profile peaks there.
 */
function projectionScore(bin: GrayImage, tan: number): number {
  const { width: w, height: h, data } = bin;
  const mid = w / 2;
  const rows = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    const shift = Math.round((x - mid) * tan);
    for (let y = 0; y < h; y++) {
      const sy = y + shift;
      if (sy < 0 || sy >= h) continue;
      if (data[sy * w + x] === 0) rows[y]++;
    }
  }
  let mean = 0;
  for (let y = 0; y < h; y++) mean += rows[y];
  mean /= h;
  let variance = 0;
  for (let y = 0; y < h; y++) variance += (rows[y] - mean) ** 2;
  return variance / h;
}

/**
 * How much better than straight a candidate angle has to score before we
 * believe it. Without this, a strip with little horizontal structure scores
 * almost identically at every angle and the search returns whichever end of
 * the sweep it happened to visit first, shearing a perfectly straight capture
 * by the full search bound.
 */
const DESKEW_MARGIN = 1.02;

/**
 * Finds the skew angle by shearing rather than rotating. Over the few degrees
 * a guided capture can produce, a shear aligns text lines just as well and
 * costs a fraction of a resample.
 *
 * Straight is the default and has to be beaten, not merely tied.
 */
export function findSkewDegrees(
  bin: GrayImage,
  maxDeg = TUNING.deskewMaxDeg,
  stepDeg = TUNING.deskewStepDeg,
): number {
  const straightScore = projectionScore(bin, 0);
  let best = 0;
  let bestScore = straightScore * DESKEW_MARGIN;

  for (let deg = -maxDeg; deg <= maxDeg + 1e-9; deg += stepDeg) {
    if (Math.abs(deg) < 1e-9) continue;
    const score = projectionScore(bin, Math.tan((deg * Math.PI) / 180));
    // Strictly greater, so a tie between two angles keeps the smaller one we
    // already hold rather than drifting outward across the sweep.
    if (score > bestScore) {
      bestScore = score;
      best = deg;
    }
  }
  return best;
}

/**
 * Applies the shear the score found, sampling the same way so the angle that
 * scored best is the angle that gets straightened.
 */
export function shear(bin: GrayImage, deg: number): GrayImage {
  if (Math.abs(deg) < 1e-6) return bin;
  const { width: w, height: h, data } = bin;
  const tan = Math.tan((deg * Math.PI) / 180);
  const mid = w / 2;
  const out = new Uint8ClampedArray(w * h).fill(255);
  for (let x = 0; x < w; x++) {
    const shift = Math.round((x - mid) * tan);
    for (let y = 0; y < h; y++) {
      const sy = y + shift;
      if (sy < 0 || sy >= h) continue;
      out[y * w + x] = data[sy * w + x];
    }
  }
  return { data: out, width: w, height: h };
}

/* -------------------------------------------------------------- resize */

/** Bilinear resample to a target width, preserving aspect ratio. */
export function resizeToWidth(img: RgbaImage, targetWidth: number): RgbaImage {
  const { width: w, height: h } = img;
  if (w === targetWidth) return img;
  const tw = Math.max(1, Math.round(targetWidth));
  const th = Math.max(1, Math.round((h * tw) / w));
  const out = new Uint8ClampedArray(tw * th * 4);
  const sx = w / tw;
  const sy = h / th;

  for (let y = 0; y < th; y++) {
    const fy = Math.min(h - 1, (y + 0.5) * sy - 0.5);
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(h - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < tw; x++) {
      const fx = Math.min(w - 1, (x + 0.5) * sx - 0.5);
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(w - 1, x0 + 1);
      const wx = fx - x0;
      const o = (y * tw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = img.data[(y0 * w + x0) * 4 + c];
        const p01 = img.data[(y0 * w + x1) * 4 + c];
        const p10 = img.data[(y1 * w + x0) * 4 + c];
        const p11 = img.data[(y1 * w + x1) * 4 + c];
        const top = p00 + (p01 - p00) * wx;
        const bot = p10 + (p11 - p10) * wx;
        out[o + c] = top + (bot - top) * wy;
      }
    }
  }
  return { data: out, width: tw, height: th };
}

/** Grayscale back to RGBA, which is what tesseract and canvas want. */
export function grayToRgba(gray: GrayImage): RgbaImage {
  const out = new Uint8ClampedArray(gray.width * gray.height * 4);
  for (let i = 0, p = 0; i < gray.data.length; i++, p += 4) {
    out[p] = out[p + 1] = out[p + 2] = gray.data[i];
    out[p + 3] = 255;
  }
  return { data: out, width: gray.width, height: gray.height };
}

/* ------------------------------------------------------------ pipeline */

export interface PreprocessResult {
  image: RgbaImage;
  channel: 'green' | 'luma';
  skewDegrees: number;
}

/** The whole chain, in the order each step needs the previous one's output. */
export function preprocessForOcr(
  input: RgbaImage,
  tuning: Partial<Tuning> = {},
): PreprocessResult {
  const t = { ...TUNING, ...tuning };

  const scaled = resizeToWidth(input, t.targetWidth);
  const { gray, channel } = bestChannel(scaled);
  const stretched = stretchContrast(gray, t.contrastClipPercent);
  const flat = flatField(stretched, t.flatFieldRadiusRatio);
  const bin = sauvola(flat, t.sauvolaWindowRatio, t.sauvolaK);
  const ruled = removeLongHorizontalRuns(bin, t.ruleRunRatio);
  const skewDegrees = findSkewDegrees(ruled, t.deskewMaxDeg, t.deskewStepDeg);
  const straight = shear(ruled, skewDegrees);

  return { image: grayToRgba(straight), channel, skewDegrees };
}
