import assert from 'node:assert/strict';
import test from 'node:test';
import { MarketHistoryClient } from '../src/market/history.js';

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
  assert.deepEqual(a, { expectedPrice: 310 / 3, averageDailyVolume7d: 6 / 7, volume: 6, windowDays: 7, liquidityGrade: 'B', expectedSaleWaitHours: 28 });
  assert.deepEqual(b, a);
  assert.equal(calls, 1);
});

test('history computes the median for an even number of prices and retains the 35% boundary', async () => {
  const client = new MarketHistoryClient(async () => new Response(JSON.stringify({ data: [
    { p: 65, v: 1 }, { p: 100, v: 1 }, { p: 100, v: 1 }, { p: 135, v: 1 },
  ] })));
  assert.equal((await client.valuation('/items/boundary', 4)).expectedPrice, 100);
});

test('history marks seven days without positive price and volume as D', async () => {
  const empty = new MarketHistoryClient(async () => new Response(JSON.stringify({ data: [{ p: 0, v: 2 }, { p: 250, v: 0 }] })));
  assert.deepEqual(await empty.valuation('/items/dead', 4), { expectedPrice: null, averageDailyVolume7d: 0, volume: 0, windowDays: 7, liquidityGrade: 'D', expectedSaleWaitHours: null });
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
    { time: 1000, average: null, volume: 0, ask: null, bid: null },
    { time: 2000, average: 125, volume: 3, ask: 140, bid: 110 },
  ]);
  assert.equal((await client.valuation('/items/chart', 2)).currentAsk, 140);
  await assert.rejects(client.history('/items/chart', 2, 2), /unsupported history range/);
});
