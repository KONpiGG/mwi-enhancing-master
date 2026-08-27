import assert from 'node:assert/strict';
import test from 'node:test';
import { MarketHistoryClient } from '../src/market/history.js';

test('history weights prices by volume, grades liquidity, and deduplicates cached requests', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async url => { calls++; assert.match(String(url), /days=3/); return new Response(JSON.stringify({ data: [{ p: 100, v: 2 }, { p: 130, v: 1 }] })); };
  const client = new MarketHistoryClient(fetcher, 2);
  const [a, b] = await Promise.all([client.valuation('/items/test', 7), client.valuation('/items/test', 7)]);
  assert.deepEqual(a, { expectedPrice: 110, recent72hVolume: 3, liquidityGrade: 'A', expectedSaleWaitHours: 24 });
  assert.deepEqual(b, a); assert.equal(calls, 1);
});

test('history falls back to seven days and marks C or excludes as D', async () => {
  const client = new MarketHistoryClient(async url => new Response(JSON.stringify({ data: String(url).includes('days=3') ? [] : [{ p: 250, v: 2 }] })));
  assert.deepEqual(await client.valuation('/items/slow', 4), { expectedPrice: 250, recent72hVolume: 0, liquidityGrade: 'C', expectedSaleWaitHours: null });
  const empty = new MarketHistoryClient(async () => new Response(JSON.stringify({ data: [] })));
  assert.deepEqual(await empty.valuation('/items/dead', 4), { expectedPrice: null, recent72hVolume: 0, liquidityGrade: 'D', expectedSaleWaitHours: null });
});

test('history limits concurrent requests', async () => {
  let active = 0, maximum = 0;
  const client = new MarketHistoryClient(async () => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return new Response(JSON.stringify({ data: [{ p: 1, v: 12 }] })); }, 2);
  await Promise.all(Array.from({ length: 6 }, (_, i) => client.valuation(`/items/${i}`, 1)));
  assert.equal(maximum, 2);
});
