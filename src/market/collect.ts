import { parseMarketplaceSnapshot } from './parse.js';
import { SnapshotStore } from './store.js';

export const DEFAULT_MARKETPLACE_URL = 'https://www.milkywayidle.com/game_data/marketplace.json';

export async function collectSnapshot(options: {
  store: SnapshotStore;
  url?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ stored: boolean; timestamp: string; quoteCount: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const response = await (options.fetcher ?? fetch)(options.url ?? DEFAULT_MARKETPLACE_URL, {
      headers: { accept: 'application/json', 'user-agent': 'mwi-enhancing-master/0.1' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`marketplace request failed with HTTP ${response.status}`);
    const snapshot = parseMarketplaceSnapshot(await response.json());
    const result = await options.store.save(snapshot);
    return { stored: result.stored, timestamp: snapshot.timestamp, quoteCount: snapshot.quotes.length };
  } finally {
    clearTimeout(timer);
  }
}
