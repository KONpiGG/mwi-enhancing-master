import { parseMarketplaceSnapshot } from './parse.js';
import { SnapshotStore } from './store.js';

export const DEFAULT_MARKETPLACE_URL = 'https://www.milkywayidle.com/game_data/marketplace.json';

export async function collectSnapshot(options: {
  store: SnapshotStore;
  url?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}): Promise<{ stored: boolean; timestamp: string; quoteCount: number }> {
  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('maxAttempts must be a positive integer');
  }
  const retryDelayMs = options.retryDelayMs ?? 500;
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
    throw new Error('retryDelayMs must be a non-negative finite number');
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const payload = await fetchMarketplacePayload(options);
      // Invalid official data is not transient: never retry or persist it.
      const snapshot = parseMarketplaceSnapshot(payload);
      const result = await options.store.save(snapshot);
      return { stored: result.stored, timestamp: snapshot.timestamp, quoteCount: snapshot.quotes.length };
    } catch (error) {
      if (!(error instanceof RetryableRequestError)) throw error;
      lastError = error.cause;
      if (attempt < maxAttempts) await delay(retryDelayMs * attempt);
    }
  }
  throw new Error(`marketplace request failed after ${maxAttempts} attempts`, { cause: lastError });
}

async function fetchMarketplacePayload(options: {
  url?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const response = await (options.fetcher ?? fetch)(options.url ?? DEFAULT_MARKETPLACE_URL, {
      headers: { accept: 'application/json', 'user-agent': 'mwi-enhancing-master/0.1' },
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(`marketplace request failed with HTTP ${response.status}`);
      if (response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500) {
        throw new RetryableRequestError(error);
      }
      throw new PermanentRequestError(error);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof RetryableRequestError) throw error;
    if (error instanceof PermanentRequestError) throw error.cause;
    if (error instanceof SyntaxError) throw new Error('marketplace response is not valid JSON', { cause: error });
    throw new RetryableRequestError(error);
  } finally {
    clearTimeout(timer);
  }
}

class RetryableRequestError extends Error {
  constructor(readonly cause: unknown) {
    super('transient marketplace request failure', { cause });
  }
}

class PermanentRequestError extends Error {
  constructor(readonly cause: Error) {
    super('permanent marketplace request failure', { cause });
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
