/**
 * Measures how well the scanner actually reads certificates, and sweeps the
 * tuning constants against real photos instead of us guessing at them.
 *
 *   npx vite-node tools/ocr-bench.ts [dir]            measure
 *   npx vite-node tools/ocr-bench.ts [dir] --sweep    search the tuning grid
 *
 * Report the number this prints. Do not claim an accuracy figure that has not
 * come out of this tool against real photos.
 */

import { join } from 'node:path';
import { scanCertificate, disposeWorker } from '../lib/ocr/recognize';
import { gradeConfidence, type Grade } from '../lib/ocr/parse';
import { TUNING_PAGE, TUNING_STRIP, type Tuning } from '../lib/ocr/preprocess';
import { encodePng, listFixtures, loadRgba, type Fixture } from './fixtures';

const DIR = process.argv[2] ?? join('tests', 'fixtures');
const SWEEP = process.argv.includes('--sweep');
/** Fixtures that are already cropped to the guide line; default is whole pages. */
const MODE: 'strip' | 'page' = process.argv.includes('--strip') ? 'strip' : 'page';

interface Row {
  name: string;
  plate: string | null;
  date: string | null;
  plateOk: boolean | null;
  dateOk: boolean | null;
  plateGrade: Grade | null;
  dateGrade: Grade | null;
  channel: string;
  skew: number;
  ms: number;
}

interface Score {
  scored: number;
  plateHits: number;
  dateHits: number;
  bothHits: number;
  /**
   * Wrong, and shown to the user as high confidence. This is the only failure
   * that can actually cost someone a registration attempt: everything else is
   * either caught by validation or flagged amber for the user to check.
   */
  silentlyWrong: number;
}

function blank(): Score {
  return { scored: 0, plateHits: 0, dateHits: 0, bothHits: 0, silentlyWrong: 0 };
}

async function runOne(fixture: Fixture, tuning: Partial<Tuning>): Promise<Row> {
  const started = Date.now();
  const image = await loadRgba(fixture.path);
  const result = await scanCertificate(image, { mode: MODE, tuning, encode: encodePng });

  const plate = result.plate?.value ?? null;
  const date = result.date?.value ?? null;
  const expected = fixture.expected;

  return {
    name: fixture.name,
    plate,
    date,
    plateOk: expected?.plate ? plate === expected.plate : null,
    dateOk: expected?.date ? date === expected.date : null,
    plateGrade: result.plate
      ? gradeConfidence(result.plate.confidence, result.plate.uncertain)
      : null,
    dateGrade: result.date
      ? gradeConfidence(result.date.confidence, result.date.uncertain)
      : null,
    channel: result.channel,
    skew: result.skewDegrees,
    ms: Date.now() - started,
  };
}

function tally(rows: Row[]): Score {
  const score = blank();
  for (const row of rows) {
    if (row.plateOk === null && row.dateOk === null) continue;
    score.scored++;
    if (row.plateOk) score.plateHits++;
    if (row.dateOk) score.dateHits++;
    if (row.plateOk && row.dateOk) score.bothHits++;
    if (
      (row.plateOk === false && row.plateGrade === 'high') ||
      (row.dateOk === false && row.dateGrade === 'high')
    ) {
      score.silentlyWrong++;
    }
  }
  return score;
}

function pct(hit: number, total: number): string {
  if (!total) return '  n/a';
  return `${((hit / total) * 100).toFixed(1).padStart(5)}%`;
}

function printScore(label: string, score: Score) {
  console.log(
    `${label.padEnd(34)} plate ${pct(score.plateHits, score.scored)}   ` +
      `date ${pct(score.dateHits, score.scored)}   ` +
      `both ${pct(score.bothHits, score.scored)}   ` +
      `silently wrong ${score.silentlyWrong}   (n=${score.scored})`,
  );
}

/* ------------------------------------------------------------- measure */

async function measure(fixtures: Fixture[]) {
  const rows: Row[] = [];
  for (const fixture of fixtures) {
    rows.push(await runOne(fixture, {}));
    process.stdout.write('.');
  }
  console.log('\n');

  const mark = (ok: boolean | null) => (ok === null ? '-' : ok ? 'ok' : 'MISS');
  console.log(
    'name'.padEnd(38) +
      'plate'.padEnd(13) +
      'p/grade'.padEnd(12) +
      'date'.padEnd(11) +
      'd/grade'.padEnd(12) +
      'chan'.padEnd(7) +
      'skew'.padEnd(7) +
      'ms',
  );
  console.log('-'.repeat(100));
  for (const row of rows) {
    console.log(
      row.name.slice(0, 36).padEnd(38) +
        (row.plate ?? '--').padEnd(13) +
        `${mark(row.plateOk)}/${row.plateGrade ?? '-'}`.padEnd(12) +
        (row.date ?? '--').padEnd(11) +
        `${mark(row.dateOk)}/${row.dateGrade ?? '-'}`.padEnd(12) +
        row.channel.padEnd(7) +
        `${row.skew}`.padEnd(7) +
        row.ms,
    );
  }

  console.log('');
  printScore('OVERALL', tally(rows));

  // Per-condition breakdown, using the augmenter's naming.
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const condition = row.name.split('__')[1] ?? 'source';
    groups.set(condition, [...(groups.get(condition) ?? []), row]);
  }
  if (groups.size > 1) {
    console.log('\nBy condition');
    for (const [condition, group] of [...groups].sort()) {
      printScore(`  ${condition}`, tally(group));
    }
  }

  const misses = rows.filter((r) => r.plateOk === false || r.dateOk === false);
  if (misses.length) {
    console.log(`\n${misses.length} miss(es). Worst offenders first:`);
    for (const row of misses.slice(0, 15)) {
      console.log(
        `  ${row.name}: plate=${row.plate ?? '--'}(${row.plateGrade ?? '-'}) ` +
          `date=${row.date ?? '--'}(${row.dateGrade ?? '-'})`,
      );
    }
  }
}

/* --------------------------------------------------------------- sweep */

const GRID: Partial<Tuning>[] = [];
for (const targetWidth of [1200, 1800, 2400]) {
  for (const sauvolaK of [0.15, 0.2, 0.25, 0.34, 0.45]) {
    for (const sauvolaWindowRatio of [1 / 25, 1 / 15, 1 / 8]) {
      GRID.push({ targetWidth, sauvolaK, sauvolaWindowRatio });
    }
  }
}

async function sweep(fixtures: Fixture[]) {
  console.log(`Sweeping ${GRID.length} settings over ${fixtures.length} images.\n`);
  const results: { tuning: Partial<Tuning>; score: Score }[] = [];

  for (const tuning of GRID) {
    const rows: Row[] = [];
    for (const fixture of fixtures) rows.push(await runOne(fixture, tuning));
    const score = tally(rows);
    results.push({ tuning, score });
    printScore(
      `w=${tuning.targetWidth} k=${tuning.sauvolaK} win=1/${Math.round(1 / (tuning.sauvolaWindowRatio ?? 1))}`,
      score,
    );
  }

  // Rank by correctness, but never accept a setting that hands the user a
  // confidently wrong answer in exchange for a higher hit rate.
  results.sort(
    (a, b) =>
      a.score.silentlyWrong - b.score.silentlyWrong || b.score.bothHits - a.score.bothHits,
  );
  console.log('\nBest settings found:');
  console.log(JSON.stringify(results[0]?.tuning, null, 2));
  console.log('\nCurrent defaults in lib/ocr/preprocess.ts:');
  console.log(JSON.stringify(MODE === 'strip' ? TUNING_STRIP : TUNING_PAGE, null, 2));
  console.log('\nIf they differ, update TUNING and re-run without --sweep to confirm.');
}

/* ---------------------------------------------------------------- main */

async function main() {
  const fixtures = await listFixtures(DIR);
  if (!fixtures.length) {
    console.error(
      `No images in ${DIR}.\n\n` +
        'Put certificate photos there, each beside a .json like:\n' +
        '  { "plate": "CHK9513", "date": "15082026", "note": "Sindh Form G 2015" }\n\n' +
        'Then: npx vite-node tools/augment.ts && npx vite-node tools/ocr-bench.ts tests/fixtures/generated',
    );
    process.exitCode = 1;
    return;
  }

  const unscored = fixtures.filter((f) => !f.expected).length;
  if (unscored) {
    console.log(`${unscored} image(s) have no expectation file and will be shown, not scored.\n`);
  }

  console.log(`Mode: ${MODE}${MODE === 'page' ? '  (pass --strip for guide-box crops)' : ''}
`);
  if (SWEEP) await sweep(fixtures);
  else await measure(fixtures);

  await disposeWorker();
}

main().catch(async (error) => {
  console.error(error);
  await disposeWorker().catch(() => undefined);
  process.exitCode = 1;
});
