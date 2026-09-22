/**
 * Shared fixture plumbing for the augment and bench tools.
 *
 * Fixture photos are real vehicle papers with real names, addresses and ID
 * numbers on them. They are gitignored, they stay on disk only, and nothing
 * here uploads anything.
 */

import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import sharp from 'sharp';
import type { RgbaImage } from '../lib/ocr/preprocess';

export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export interface Expectation {
  /** Normalised plate as it should end up in the SMS, e.g. CHK9513. */
  plate?: string;
  /** DDMMYYYY as it should end up in the SMS, e.g. 15082026. */
  date?: string;
  /** Free-text note about the document, for the report. */
  note?: string;
}

export interface Fixture {
  path: string;
  name: string;
  expected: Expectation | null;
}

export async function listFixtures(dir: string): Promise<Fixture[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const out: Fixture[] = [];
  for (const entry of entries.sort()) {
    const ext = extname(entry).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) continue;
    const name = basename(entry, ext);
    let expected: Expectation | null = null;
    try {
      expected = JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8')) as Expectation;
    } catch {
      // No expectation file: the image still gets scanned, just not scored.
    }
    out.push({ path: join(dir, entry), name, expected });
  }
  return out;
}

/** Decodes any supported image to the RGBA shape the pipeline works on. */
export async function loadRgba(path: string, maxWidth = 2400): Promise<RgbaImage> {
  const pipeline = sharp(path).rotate(); // honour EXIF orientation
  const meta = await pipeline.metadata();
  const resized =
    meta.width && meta.width > maxWidth ? pipeline.resize({ width: maxWidth }) : pipeline;

  const { data, info } = await resized
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Copy rather than view: sharp's buffer may be pooled, and the pipeline
  // holds on to this array across async boundaries.
  const pixels = new Uint8ClampedArray(data.byteLength);
  pixels.set(data);

  return { data: pixels, width: info.width, height: info.height };
}

/** Tesseract cannot read our raw buffer in Node, so hand it a PNG. */
export async function encodePng(image: RgbaImage): Promise<Buffer> {
  return sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .png()
    .toBuffer();
}
