import { parentPort } from 'node:worker_threads';
import { calculateRankingBatch, simulateRankingRisk, type RankingRow } from './calculator.js';
import type { EnhanceableItem } from '../game-data/catalog.js';
import type { MarketSnapshot } from '../market/types.js';
import type { EnhancingBuffs } from './preset.js';

interface RankingJob {
  snapshot: MarketSnapshot;
  items: EnhanceableItem[];
  buffs: EnhancingBuffs;
  now: string;
  marketFeeRate: number;
  hourlyRate: number;
  actionSeconds: number;
}

if (!parentPort) throw new Error('ranking worker must run in a worker thread');
parentPort.once('message', (job: RankingJob | { riskRow: RankingRow; runs: number }) => {
  try {
    if ('riskRow' in job) parentPort!.postMessage(simulateRankingRisk(job.riskRow, job.runs));
    else parentPort!.postMessage(calculateRankingBatch(job.snapshot, job.items, job.buffs, new Date(job.now), job.marketFeeRate, job.hourlyRate, job.actionSeconds));
  } catch (error) {
    parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
});
