import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { round, signed, validateRows, filterRows, summarize, monthlyAverages, chartDomain } from '../dist/data-utils.mjs';

const snapshot = JSON.parse(await readFile(new URL('../dist/data/oil-prices-2026.json', import.meta.url), 'utf8'));
const rows = validateRows(snapshot.data.filter(row => row.brent !== null && row.wti !== null));

test('EIA snapshot preserves missing quotes and pairs only matching dates', () => {
  assert.equal(snapshot.data.length, 171);
  assert.equal(rows.length, 164);
  assert.equal(snapshot.data.find(row => row.date === '2026-08-31').brent, null);
  assert.equal(rows.some(row => row.date === '2026-08-31'), false);
  for (const row of snapshot.data) {
    if (row.wti === null || row.brent === null) assert.equal(row.brentMinusWti, null);
    else assert.equal(round(row.brent - row.wti), row.brentMinusWti);
  }
  assert.ok(rows.every(row => row.date <= snapshot.metadata.lastCommonObservation));
});

test('latest, first, extreme spreads match independently checked EIA source values', () => {
  const stats = summarize(rows);
  assert.deepEqual(stats.latest, { date: '2026-09-01', brent: 96.02, wti: 91.48, spread: 4.54 });
  assert.equal(stats.first.spread, 4.77);
  assert.equal(round(stats.latest.spread - stats.first.spread), -0.23);
  assert.equal(round(stats.latest.spread - rows.at(-2).spread), -0.64);
  assert.equal(stats.min.date, '2026-06-22');
  assert.equal(stats.min.spread, -2.45);
  assert.equal(stats.max.date, '2026-04-08');
  assert.equal(stats.max.spread, 25.94);
  assert.equal(round(stats.average), 7.46);
});

test('recent month ranges end at the latest observation and handle short months', () => {
  assert.equal(filterRows(rows, 'ytd'), rows);
  assert.equal(filterRows(rows, '1m')[0].date, '2026-08-03');
  assert.equal(filterRows(rows, '3m')[0].date, '2026-06-01');
  assert.equal(filterRows(rows, '1m').at(-1).date, '2026-09-01');
  const endOfMarch = ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-31'].map(date => ({date}));
  assert.deepEqual(filterRows(endOfMarch, '1m').map(row => row.date), ['2026-02-28', '2026-03-01', '2026-03-31']);
});

test('monthly statistics are weighted by actual paired observations', () => {
  const months = monthlyAverages(rows);
  assert.equal(months.length, 9);
  assert.equal(months.at(-1).count, 1);
  assert.equal(months.at(-1).average, 4.54);
  assert.equal(months.reduce((sum, month) => sum + month.count, 0), rows.length);
  const weighted = months.reduce((sum, month) => sum + month.average * month.count, 0) / rows.length;
  assert.ok(Math.abs(weighted - summarize(rows).average) < 1e-10);
});

test('chart scales retain negative spreads and flat-series visibility', () => {
  const mixed = chartDomain([-2.45, 25.94]);
  assert.ok(mixed.min < -2.45 && mixed.max > 25.94);
  const flat = chartDomain([4.54, 4.54]);
  assert.ok(flat.min < 4.54 && flat.max > 4.54);
  assert.equal(signed(-0.23), '−0.23');
  assert.equal(signed(0), '0.00');
});

test('invalid, unordered, and duplicate observations fail rather than corrupting a chart', () => {
  assert.throws(() => validateRows([]));
  assert.throws(() => validateRows([{date:'2026-01-02',brent:null,wti:50}]));
  assert.throws(() => validateRows([{date:'2025-12-31',brent:60,wti:50}]));
  assert.throws(() => validateRows([rows[0], rows[0]]));
  assert.throws(() => validateRows([rows[1], rows[0]]));
});
