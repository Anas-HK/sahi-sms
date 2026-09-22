/**
 * Turns each real fixture photo into a spread of degraded variants, so the
 * scanner is tuned against the conditions people actually photograph in:
 * a hand-held phone at an angle, poor light, lamination glare, and whatever
 * the camera app's JPEG encoder does to fine print.
 *
 *   npx vite-node tools/augment.ts [fixtureDir]
 *
 * Variants inherit the source's expectation file, so the bench scores them.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { listFixtures } from './fixtures';

const SOURCE_DIR = process.argv[2] ?? join('tests', 'fixtures');
const OUT_DIR = join(SOURCE_DIR, 'generated');

interface Variant {
  suffix: string;
  apply: (img: sharp.Sharp) => sharp.Sharp;
}

const VARIANTS: Variant[] = [
  { suffix: 'base', apply: (i) => i },

  // Hand-held tilt. The guide box keeps this small in practice.
  ...[-8, -4, 4, 8].map((deg) => ({
    suffix: `rot${deg}`,
    apply: (i: sharp.Sharp) => i.rotate(deg, { background: '#e8e8e0' }),
  })),

  // Focus miss and camera shake.
  ...[0.8, 1.6, 2.6].map((sigma) => ({
    suffix: `blur${String(sigma).replace('.', '')}`,
    apply: (i: sharp.Sharp) => i.blur(sigma),
  })),

  // Under and over exposure, and washed-out lamination glare.
  { suffix: 'dark', apply: (i) => i.modulate({ brightness: 0.6 }) },
  { suffix: 'dim', apply: (i) => i.modulate({ brightness: 0.8 }) },
  { suffix: 'bright', apply: (i) => i.modulate({ brightness: 1.35 }) },
  { suffix: 'flat', apply: (i) => i.linear(0.65, 60) },

  // Colour cast from indoor lighting, which matters because the pipeline
  // chooses between the green channel and luma.
  { suffix: 'warmcast', apply: (i) => i.tint({ r: 255, g: 235, b: 200 }) },
  { suffix: 'coolcast', apply: (i) => i.tint({ r: 210, g: 235, b: 255 }) },

  // Low resolution, as produced by an older or cheaper phone.
  { suffix: 'small', apply: (i) => i.resize({ width: 900 }) },
  { suffix: 'tiny', apply: (i) => i.resize({ width: 600 }) },

  // Sensor noise in a dim room.
  { suffix: 'noisy', apply: (i) => i.modulate({ brightness: 0.85 }).sharpen({ sigma: 2 }) },
];

/** Lossy compression, applied on top of every geometric or tonal variant. */
const QUALITIES = [92, 55];

async function main() {
  const fixtures = await listFixtures(SOURCE_DIR);
  if (!fixtures.length) {
    console.error(
      `No fixture images in ${SOURCE_DIR}.\n` +
        'Drop certificate photos there, each with a matching .json holding\n' +
        '{ "plate": "CHK9513", "date": "15082026" }.',
    );
    process.exitCode = 1;
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  let written = 0;

  for (const fixture of fixtures) {
    for (const variant of VARIANTS) {
      for (const quality of QUALITIES) {
        const name = `${fixture.name}__${variant.suffix}__q${quality}`;
        const buffer = await variant
          .apply(sharp(fixture.path).rotate())
          .jpeg({ quality })
          .toBuffer();
        await writeFile(join(OUT_DIR, `${name}.jpg`), buffer);
        if (fixture.expected) {
          await writeFile(
            join(OUT_DIR, `${name}.json`),
            JSON.stringify(fixture.expected, null, 2),
          );
        }
        written++;
      }
    }
  }

  console.log(
    `${written} variants from ${fixtures.length} source photo(s) -> ${OUT_DIR}\n` +
      `Now run: npx vite-node tools/ocr-bench.ts ${OUT_DIR}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
