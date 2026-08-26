import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { RankingBatch } from './enhancing/calculator.js';
import { presetGameData, presetOptions } from './enhancing/game-preset-data.js';
import { createPreset, deriveEnhancingBuffs } from './enhancing/preset.js';
import { rankingWorkerUrl } from './enhancing/ranking-worker-url.js';
import { enhanceableItems } from './game-data/catalog.js';
import { collectSnapshot } from './market/collect.js';
import { SnapshotStore } from './market/store.js';

const port = Number(process.env.PORT ?? 3000);
const store = new SnapshotStore(process.env.MWI_DATA_DIR ?? 'data');
const publicDir = join(import.meta.dirname, 'web');
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const rankingCache = new Map<string, RankingBatch>();

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (url.pathname === '/api/market/update' && request.method === 'POST') {
      const result = await collectSnapshot({ store, timeoutMs: 12_000, maxAttempts: 1 });
      return json(response, 200, result);
    }
    if (url.pathname === '/api/market') {
      const snapshot = await store.latest();
      if (!snapshot) return json(response, 200, { timestamp: null, marketItems: [], message: '还没有市场快照，请点击“更新市场数据”。' });
      const names = new Map(enhanceableItems.map(item => [item.itemHrid, item.name]));
      const marketItems = snapshot.quotes.map(quote => ({ ...quote, itemName: names.get(quote.itemHrid) ?? quote.itemHrid.split('/').at(-1)!.replaceAll('_', ' ') }));
      return json(response, 200, { timestamp: snapshot.timestamp, marketItems });
    }
    if (url.pathname === '/api/rankings') {
      const level = Number(url.searchParams.get('playerLevel') ?? 0);
      const feeRate = .05;
      const hourlyRate = Number(url.searchParams.get('hourlyRate') ?? 0);
      if (!Number.isInteger(level) || level < 0 || level > 200) return json(response, 400, { error: '强化等级必须是 0–200 的整数' });
      if (!Number.isFinite(hourlyRate) || hourlyRate < 0) return json(response, 400, { error: '每小时工时费必须是非负数' });
      const snapshot = await store.latest();
      const catalogItems = enhanceableItems.map(({ itemHrid, name }) => ({ itemHrid, itemName: name }));
      if (!snapshot) return json(response, 200, { timestamp: null, rows: [], marketItems: [], catalogItems, presetOptions, message: '还没有市场快照，请点击“更新市场数据”。' });
      const preset = createPreset(); preset.enhancing.playerLevel = level;
      const equipment = JSON.parse(url.searchParams.get('equipment') ?? '{}') as Record<string, {hrid?: string; enhanceLevel?: number}>;
      preset.enhancing.tool = equipment.tool ?? {}; preset.enhancing.charm = equipment.charm ?? {};
      for (const slot of ['hands','neck','earrings','ring','pouch'] as const) preset.specialEquipment[slot] = equipment[slot] ?? {};
      preset.enhancing.teas = (url.searchParams.get('teas') ?? '').split(',').filter(Boolean);
      const community = JSON.parse(url.searchParams.get('communityBuffs') ?? '{}') as Record<string, number>;
      for (const [hrid, buffLevel] of Object.entries(community)) preset.communityBuffs[hrid] = { hrid, level: buffLevel };
      const achievements = (url.searchParams.get('achievements') ?? '').split(',').filter(Boolean);
      for (const hrid of achievements) preset.achievementBuffs[hrid] = { enabled: true };
      const teaLevel = preset.enhancing.teas.includes('/items/ultra_enhancing_tea') ? 8 : preset.enhancing.teas.includes('/items/super_enhancing_tea') ? 6 : preset.enhancing.teas.includes('/items/enhancing_tea') ? 3 : 0;
      const profile = deriveEnhancingBuffs(preset, presetGameData); profile.playerLevel += teaLevel;
      if (Object.values(profile).some(value => !Number.isFinite(value))) return json(response, 400, { error: '玩家加成必须是有效数字' });
      const names = new Map(enhanceableItems.map(item => [item.itemHrid, item.name]));
      const marketItems = snapshot.quotes.map(quote => ({ ...quote, itemName: names.get(quote.itemHrid) ?? quote.itemHrid.split('/').at(-1)!.replaceAll('_', ' ') }));
      const cacheKey = `${snapshot.timestamp}:${level}:${hourlyRate}:${url.searchParams}`;
      let batch = rankingCache.get(cacheKey);
      if (!batch) {
        batch = await runRankingWorker(request, { snapshot, items: enhanceableItems, buffs: profile, now: new Date().toISOString(), marketFeeRate: feeRate, hourlyRate, actionSeconds: 12 });
        rankingCache.set(cacheKey, batch);
        if (rankingCache.size > 20) rankingCache.delete(rankingCache.keys().next().value!);
      }
      return json(response, 200, { timestamp: snapshot.timestamp, feeRate, profile, presetOptions, catalogSize: enhanceableItems.length, catalogItems, quoteCount: snapshot.quotes.length,
        marketItemCount: new Set(snapshot.quotes.map(quote => quote.itemHrid)).size, marketItems,
        candidateCount: batch.candidateCount, evaluatedProjectCount: batch.successCount,
        excludedMissingPriceCount: batch.excludedMissingPriceCount, exactCalculationMs: batch.exactCalculationMs,
        riskCalculationMs: batch.riskCalculationMs, rows: batch.rows });
    }
    if (url.pathname === '/api/risk' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const started = performance.now();
      const risk = await runRankingWorker(request, { riskRow: body.row, runs: 1_000 }) as unknown as Record<string, unknown>;
      return json(response, 200, { ...risk, riskCalculationMs: performance.now() - started });
    }
    const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!/^[\w.-]+$/.test(path)) return json(response, 404, { error: 'not found' });
    const body = await readFile(join(publicDir, path));
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' }); response.end(body);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return json(response, 404, { error: 'not found' });
    json(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}).listen(port, () => console.log(`强化大师: http://localhost:${port}`));

function json(response: import('node:http').ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value));
}

async function readJsonBody(request: import('node:http').IncomingMessage): Promise<{ row: unknown }> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 2_000_000) throw new Error('request body too large'); chunks.push(chunk); }
  const value = JSON.parse(Buffer.concat(chunks).toString()) as { row?: unknown };
  if (!value.row || typeof value.row !== 'object') throw new Error('missing ranking row');
  return { row: value.row };
}

function runRankingWorker(request: import('node:http').IncomingMessage, job: unknown): Promise<RankingBatch> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(rankingWorkerUrl(import.meta.url));
    let settled = false;
    const cancel = () => { if (!settled) { settled = true; void worker.terminate(); reject(new Error('ranking calculation cancelled')); } };
    request.once('aborted', cancel);
    request.once('close', () => { if (!request.complete) cancel(); });
    worker.once('message', (message: RankingBatch & { error?: string }) => {
      if (settled) return;
      settled = true; request.off('aborted', cancel);
      void worker.terminate();
      if (message.error) reject(new Error(message.error)); else resolve(message);
    });
    worker.once('error', error => { if (!settled) { settled = true; reject(error); } });
    worker.postMessage(job);
  });
}
