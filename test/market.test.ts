import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectSnapshot } from '../src/market/collect.js';
import { parseMarketplaceSnapshot } from '../src/market/parse.js';
import { SnapshotStore } from '../src/market/store.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/marketplace.json', import.meta.url), 'utf8')) as unknown;

test('parses official item and enhancement-level maps', () => {
  const snapshot = parseMarketplaceSnapshot(fixture);
  assert.equal(snapshot.timestamp, '2026-08-25T12:00:00.000Z');
  assert.equal(snapshot.quotes.length, 4);
  assert.deepEqual(snapshot.quotes.filter(({ itemHrid }) => itemHrid === '/items/healing_book')
    .map(({ enhancementLevel }) => enhancementLevel), [0, 3, 7]);
  assert.deepEqual(snapshot.quotes[1], {
    itemHrid: '/items/healing_book', enhancementLevel: 3,
    ask: 1800, bid: null, hourlyAverage: 1750, hourlyVolume: 4,
  });
  assert.deepEqual(snapshot.quotes[2], {
    itemHrid: '/items/healing_book', enhancementLevel: 7,
    ask: null, bid: 6400, hourlyAverage: null, hourlyVolume: 0,
  });
});

test('rejects malformed timestamps, enhancement levels, and prices', () => {
  assert.throws(() => parseMarketplaceSnapshot({ timestamp: 'bad', marketData: {} }), /timestamp is invalid/);
  assert.throws(() => parseMarketplaceSnapshot({
    timestamp: 1_777_000_000,
    marketData: { '/items/example': { bad: { a: 1 } } },
  }), /enhancement level/);
  assert.throws(() => parseMarketplaceSnapshot({
    timestamp: 1_777_000_000,
    marketData: { '/items/example': { 0: { a: '1' } } },
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

test('collector retries transient failures and eventually stores the snapshot', async () => {
  const directory = join(tmpdir(), `mwi-market-retry-${process.pid}-${Date.now()}`);
  const store = new SnapshotStore(directory);
  let attempts = 0;
  const fetcher: typeof fetch = async () => {
    attempts += 1;
    if (attempts === 1) return new Response(null, { status: 503 });
    if (attempts === 2) throw new TypeError('temporary network failure');
    return new Response(JSON.stringify(fixture), { status: 200 });
  };
  try {
    const result = await collectSnapshot({ store, fetcher, retryDelayMs: 0 });
    assert.equal(result.stored, true);
    assert.equal(attempts, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('collector does not retry permanent HTTP or payload errors', async () => {
  const store = new SnapshotStore(join(tmpdir(), `mwi-market-invalid-${process.pid}-${Date.now()}`));
  let attempts = 0;
  const notFound: typeof fetch = async () => {
    attempts += 1;
    return new Response(null, { status: 404 });
  };
  await assert.rejects(collectSnapshot({ store, fetcher: notFound, retryDelayMs: 0 }), /HTTP 404/);
  assert.equal(attempts, 1);

  const invalidJson: typeof fetch = async () => {
    attempts += 1;
    return new Response('{');
  };
  await assert.rejects(collectSnapshot({ store, fetcher: invalidJson, retryDelayMs: 0 }), /not valid JSON/);
  assert.equal(attempts, 2);
});
