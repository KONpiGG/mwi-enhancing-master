import assert from 'node:assert/strict';
import test from 'node:test';
import { MarketHistoryClient } from '../src/market/history.js';

test('history weights prices by volume, grades liquidity, and deduplicates cached requests', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async url => { calls++; const data = String(url).includes('days=3') ? [{ p: 100, v: 2 }, { p: 130, v: 1 }] : [{ p: 105, v: 14 }]; return new Response(JSON.stringify({ data })); };
  const client = new MarketHistoryClient(fetcher, 2);
  const [a, b] = await Promise.all([client.valuation('/items/test', 7), client.valuation('/items/test', 7)]);
  assert.deepEqual(a, { expectedPrice: 110, recent72hVolume: 3, averageDailyVolume7d: 2, volume: 3, windowDays: 3, liquidityGrade: 'A', expectedSaleWaitHours: 24 });
  assert.deepEqual(b, a); assert.equal(calls, 2);
});

test('history falls back to seven days and marks C or excludes as D', async () => {
  const client = new MarketHistoryClient(async url => new Response(JSON.stringify({ data: String(url).includes('days=3') ? [] : [{ p: 250, v: 2 }] })));
  assert.deepEqual(await client.valuation('/items/slow', 4), { expectedPrice: 250, recent72hVolume: 0, averageDailyVolume7d: 2 / 7, volume: 0, windowDays: 3, liquidityGrade: 'C', expectedSaleWaitHours: 84 });
  const empty = new MarketHistoryClient(async () => new Response(JSON.stringify({ data: [] })));
  assert.deepEqual(await empty.valuation('/items/dead', 4), { expectedPrice: null, recent72hVolume: 0, averageDailyVolume7d: 0, volume: 0, windowDays: 3, liquidityGrade: 'D', expectedSaleWaitHours: null });
});

test('history retries a failed request without poisoning the item cache', async () => {
  let calls = 0;
  const client = new MarketHistoryClient(async () => ++calls === 1 ? new Response('', { status: 429 }) : new Response(JSON.stringify({ data: [{ p: 80, v: 1 }] })), 1, 1_000, Date.now, 100, 2);
  assert.equal((await client.valuation('/items/retry', 2)).expectedPrice, 80);
  assert.equal(calls, 3);
});

test('history limits concurrent requests', async () => {
  let active = 0, maximum = 0;
  const client = new MarketHistoryClient(async () => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return new Response(JSON.stringify({ data: [{ p: 1, v: 12 }] })); }, 2);
  await Promise.all(Array.from({ length: 6 }, (_, i) => client.valuation(`/items/${i}`, 1)));
  assert.equal(maximum, 2);
});
