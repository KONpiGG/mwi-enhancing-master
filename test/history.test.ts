import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateActiveVolumes, MarketHistoryClient } from '../src/market/history.js';

test('active-side estimates use daily median quotes, tolerance bands, and whole-item proportional fallback', () => {
  const points = [
    { t: '2026-08-28T01:00:00Z', p: 100, v: 4, a: 120, b: 80 },
    { t: '2026-08-28T12:00:00Z', p: 116, v: 3, a: 120, b: 80 },
    { t: '2026-08-28T23:00:00Z', p: 84, v: 2, a: 999, b: 1 },
  ];
  assert.deepEqual(estimateActiveVolumes(points, .05), [
    { activeBuyVolume: 2, activeSellVolume: 2 },
    { activeBuyVolume: 3, activeSellVolume: 0 },
    { activeBuyVolume: 0, activeSellVolume: 2 },
  ]);
});

test('a traded average near the ask attributes all volume to direct buying despite listing movement', () => {
  const points = [
    { t: '2026-08-25T04:06:00Z', p: 98_200_000, v: 3, a: 98_400_000, b: 89_000_000 },
    { t: '2026-08-25T12:06:00Z', p: 0, v: 0, a: 98_200_000, b: 89_000_000 },
  ];
  assert.deepEqual(estimateActiveVolumes(points, .02)[0], { activeBuyVolume: 3, activeSellVolume: 0 });
});

test('active-side estimates partition every traded item even when quote sides are missing', () => {
  const points = [
    { t: '2026-08-25', p: 90, v: 5, a: 100, b: -1 },
    { t: '2026-08-26', p: 110, v: 3, a: -1, b: 100 },
    { t: '2026-08-27', p: 100, v: 7, a: -1, b: -1 },
  ];
  const estimates = estimateActiveVolumes(points, .02);
  assert.deepEqual(estimates, [
    { activeBuyVolume: 0, activeSellVolume: 5 },
    { activeBuyVolume: 3, activeSellVolume: 0 },
    { activeBuyVolume: 4, activeSellVolume: 3 },
  ]);
  points.forEach((point, index) => assert.equal(estimates[index]!.activeBuyVolume + estimates[index]!.activeSellVolume, point.v));
});

test('history uses one seven-day request, filters outliers, weights by volume, and caches requests', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async url => {
    calls++;
    assert.equal(new URL(String(url)).searchParams.get('days'), '7');
    return new Response(JSON.stringify({ data: [
      { p: 90, v: 1 }, { p: 100, v: 2 }, { p: 110, v: 3 },
      { p: 200, v: 100 }, // More than 35% above the median and therefore ignored.
      { p: 0, v: 20 }, { p: 100, v: 0 },
    ] }));
  };
  const client = new MarketHistoryClient(fetcher, 2);
  const [a, b] = await Promise.all([client.valuation('/items/test', 7), client.valuation('/items/test', 7)]);
  assert.deepEqual(a, { expectedPrice: 103, averageDailyVolume7d: 6 / 7, volume: 6, activeBuyVolume7d: 4, activeSellVolume7d: 2, windowDays: 7, liquidityGrade: 'B', expectedSaleWaitHours: 28 });
  assert.deepEqual(b, a);
  assert.equal(calls, 1);
});

test('valuation side volumes use the same outlier-filtered trades as total volume', async () => {
  const client = new MarketHistoryClient(async () => new Response(JSON.stringify({ data: [
    { t: 1, p: 90, v: 1, a: 91, b: 80 },
    { t: 2, p: 100, v: 2, a: 101, b: 90 },
    { t: 3, p: 110, v: 3, a: 111, b: 100 },
    { t: 4, p: 200, v: 100, a: 201, b: 190 },
  ] })));
  const valuation = await client.valuation('/items/partitioned', 1);
  assert.equal(valuation.volume, 6);
  assert.equal(valuation.activeBuyVolume7d + valuation.activeSellVolume7d, valuation.volume);
});

test('valuation derives one side from total volume so aggregate counts are conserved exactly', async () => {
  const client = new MarketHistoryClient(async () => new Response(JSON.stringify({ data: [
    { t: '2026-08-25T01:00:00Z', p: 100, v: .1, a: 120, b: 80 },
    { t: '2026-08-25T02:00:00Z', p: 110, v: .2, a: 120, b: 80 },
    { t: '2026-08-25T03:00:00Z', p: 90, v: .3, a: 120, b: 80 },
  ] })));
  const valuation = await client.valuation('/items/conserved', 0);
  assert.equal(valuation.activeSellVolume7d, valuation.volume - valuation.activeBuyVolume7d);
  assert.equal(valuation.activeBuyVolume7d + valuation.activeSellVolume7d, valuation.volume);
});

test('history computes the median for an even number of prices and retains the 35% boundary', async () => {
  const client = new MarketHistoryClient(async () => new Response(JSON.stringify({ data: [
    { p: 65, v: 1 }, { p: 100, v: 1 }, { p: 100, v: 1 }, { p: 135, v: 1 },
  ] })));
  assert.equal((await client.valuation('/items/boundary', 4)).expectedPrice, 100);
});

test('history marks seven days without positive price and volume as D', async () => {
  const empty = new MarketHistoryClient(async () => new Response(JSON.stringify({ data: [{ p: 0, v: 2 }, { p: 250, v: 0 }] })));
  assert.deepEqual(await empty.valuation('/items/dead', 4), { expectedPrice: null, averageDailyVolume7d: 0, volume: 0, activeBuyVolume7d: 0, activeSellVolume7d: 0, windowDays: 7, liquidityGrade: 'D', expectedSaleWaitHours: null });
});

test('history retries a failed request without poisoning the item cache', async () => {
  let calls = 0;
  const client = new MarketHistoryClient(async () => ++calls === 1 ? new Response('', { status: 429 }) : new Response(JSON.stringify({ data: [{ p: 80, v: 1 }] })), 1, 1_000, Date.now, 100, 2);
  assert.equal((await client.valuation('/items/retry', 2)).expectedPrice, 80);
  assert.equal(calls, 2);
});

test('history limits concurrent requests', async () => {
  let active = 0, maximum = 0;
  const client = new MarketHistoryClient(async () => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return new Response(JSON.stringify({ data: [{ p: 1, v: 12 }] })); }, 2);
  await Promise.all(Array.from({ length: 6 }, (_, i) => client.valuation(`/items/${i}`, 1)));
  assert.equal(maximum, 2);
});

test('history preserves no-trade and no-order semantics for charts', async () => {
  const client = new MarketHistoryClient(async () => new Response(JSON.stringify({ data: [
    { t: 1000, p: 0, v: 0, a: -1, b: -1 },
    { t: 2000, p: 125, v: 3, a: 140, b: 110 },
  ] })));
  assert.deepEqual(await client.history('/items/chart', 2, 7), [
    { time: 1000, average: null, volume: 0, ask: null, bid: null, activeBuyVolume: 0, activeSellVolume: 0 },
    { time: 2000, average: 125, volume: 3, ask: 140, bid: 110, activeBuyVolume: 2, activeSellVolume: 1 },
  ]);
  assert.equal((await client.valuation('/items/chart', 2)).currentAsk, 140);
  await assert.rejects(client.history('/items/chart', 2, 2), /unsupported history range/);
});

test('history rejects zero prices and abnormal order listings', async () => {
  const client = new MarketHistoryClient(async () => new Response(JSON.stringify({ data: [
    { t: 1, p: -5, v: 2, a: 100, b: 80 },
    { t: 2, p: 100, v: 3, a: 102, b: 82 },
    { t: 3, p: 101, v: 4, a: 0, b: 0 },
    { t: 4, p: 102, v: 5, a: 10_000, b: 8_000 },
  ] })));
  assert.deepEqual(await client.history('/items/outlier', 0, 7), [
    { time: 1, average: null, volume: 0, ask: 100, bid: 80, activeBuyVolume: 0, activeSellVolume: 0 },
    { time: 2, average: 100, volume: 3, ask: 102, bid: 82, activeBuyVolume: 3, activeSellVolume: 0 },
    { time: 3, average: 101, volume: 4, ask: null, bid: null, activeBuyVolume: 4, activeSellVolume: 0 },
    { time: 4, average: 102, volume: 5, ask: null, bid: null, activeBuyVolume: 5, activeSellVolume: 0 },
  ]);
  assert.equal((await client.valuation('/items/outlier', 0)).currentAsk, 102);
});
