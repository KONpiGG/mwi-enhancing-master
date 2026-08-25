import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectSnapshot } from '../src/market/collect.js';
import { parseMarketplaceSnapshot } from '../src/market/parse.js';
import { SnapshotStore } from '../src/market/store.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/marketplace.json', import.meta.url), 'utf8')) as unknown;

test('parses compact quote fields and explicit enhancement levels', () => {
  const snapshot = parseMarketplaceSnapshot(fixture);
  assert.equal(snapshot.timestamp, '2026-08-25T12:00:00.000Z');
  assert.equal(snapshot.quotes.length, 3);
  assert.deepEqual(snapshot.quotes[1], {
    itemHrid: '/items/healing_book', enhancementLevel: 1,
    ask: 1800, bid: null, hourlyAverage: 1750, hourlyVolume: 4,
  });
});

test('rejects malformed or unsafe market values', () => {
  assert.throws(() => parseMarketplaceSnapshot({ timestamp: 'bad', marketData: {} }), /timestamp is invalid/);
  assert.throws(() => parseMarketplaceSnapshot({
    timestamp: 1_777_000_000,
    marketData: { '/items/example': { a: -1, b: 2, p: 2, v: 1 } },
  }), /non-negative/);
});

test('collector stores gzip snapshots atomically and deduplicates timestamps', async () => {
  const directory = join(tmpdir(), `mwi-market-${process.pid}-${Date.now()}`);
  const store = new SnapshotStore(directory);
  const fetcher: typeof fetch = async () => new Response(JSON.stringify(fixture), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
  try {
    assert.equal((await collectSnapshot({ store, fetcher })).stored, true);
    assert.equal((await collectSnapshot({ store, fetcher })).stored, false);
    assert.equal((await store.list()).length, 1);
    assert.deepEqual(await store.latest(), parseMarketplaceSnapshot(fixture));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
