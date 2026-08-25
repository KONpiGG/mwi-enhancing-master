import type { MarketQuote, MarketSnapshot } from './types.js';

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function finiteOrNull(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative finite number or null`);
  }
  return value;
}

function parseTimestamp(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('timestamp must be an ISO string or Unix timestamp');
  }
  const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
  if (Number.isNaN(date.valueOf())) throw new Error('timestamp is invalid');
  return date.toISOString();
}

function parseQuote(itemHrid: string, value: unknown, index: number): MarketQuote {
  const raw = record(value, `quote ${itemHrid}[${index}]`);
  const enhancement = raw.enhancementLevel ?? raw.level ?? index;
  if (!Number.isSafeInteger(enhancement) || (enhancement as number) < 0) {
    throw new Error(`enhancement level for ${itemHrid} must be a non-negative integer`);
  }
  const volume = finiteOrNull(raw.v, `${itemHrid}.v`) ?? 0;
  return {
    itemHrid,
    enhancementLevel: enhancement as number,
    ask: finiteOrNull(raw.a, `${itemHrid}.a`),
    bid: finiteOrNull(raw.b, `${itemHrid}.b`),
    hourlyAverage: finiteOrNull(raw.p, `${itemHrid}.p`),
    hourlyVolume: volume,
  };
}

/** Converts the compact official payload into an explicit, calculation-safe model. */
export function parseMarketplaceSnapshot(payload: unknown): MarketSnapshot {
  const root = record(payload, 'marketplace payload');
  const timestamp = parseTimestamp(root.timestamp);
  const market = record(root.marketData ?? root.data ?? root.marketplace, 'market data');
  const quotes: MarketQuote[] = [];

  for (const [itemHrid, levels] of Object.entries(market)) {
    if (!itemHrid.startsWith('/items/')) throw new Error(`invalid item HRID: ${itemHrid}`);
    const entries = Array.isArray(levels) ? levels : [levels];
    entries.forEach((quote, index) => {
      if (quote !== null) quotes.push(parseQuote(itemHrid, quote, index));
    });
  }
  if (quotes.length === 0) throw new Error('market snapshot contains no quotes');
  return { timestamp, quotes };
}
