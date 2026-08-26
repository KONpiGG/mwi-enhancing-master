import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { calculateRankings } from './enhancing/calculator.js';
import { enhanceableItems } from './game-data/catalog.js';
import { collectSnapshot } from './market/collect.js';
import { SnapshotStore } from './market/store.js';

const port = Number(process.env.PORT ?? 3000);
const store = new SnapshotStore(process.env.MWI_DATA_DIR ?? 'data');
const publicDir = join(import.meta.dirname, 'web');
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (url.pathname === '/api/market/update' && request.method === 'POST') {
      const result = await collectSnapshot({ store });
      return json(response, 200, result);
    }
    if (url.pathname === '/api/rankings') {
      const level = Number(url.searchParams.get('playerLevel') ?? 0);
      const feeRate = Number(url.searchParams.get('feeRate') ?? process.env.MWI_MARKET_FEE_RATE ?? 0);
      if (!Number.isInteger(level) || level < 0 || level > 200) return json(response, 400, { error: '强化等级必须是 0–200 的整数' });
      if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate >= 1) return json(response, 400, { error: '市场手续费率必须在 0（含）到 1（不含）之间' });
      const snapshot = await store.latest();
      if (!snapshot) return json(response, 200, { timestamp: null, rows: [], message: '还没有市场快照，请点击“更新市场数据”。' });
      const percent = (name: string) => Number(url.searchParams.get(name) ?? 0) / 100;
      const profile = {
        level,
        levelBonus: Number(url.searchParams.get('levelBonus') ?? 0),
        equipmentSuccessBonus: percent('equipmentSuccess'), communitySuccessBonus: percent('communitySuccess'),
        achievementSuccessBonus: percent('achievementSuccess'), shrineSuccessBonus: percent('shrineSuccess'),
        experienceBonus: percent('experienceBonus'),
      };
      if (Object.values(profile).some(value => !Number.isFinite(value))) return json(response, 400, { error: '玩家加成必须是有效数字' });
      return json(response, 200, { timestamp: snapshot.timestamp, feeRate, catalogSize: enhanceableItems.length, rows: calculateRankings(snapshot, enhanceableItems, profile, new Date(), feeRate) });
    }
    const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!/^[\w.-]+$/.test(path)) return json(response, 404, { error: 'not found' });
    const body = await readFile(join(publicDir, path));
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }); response.end(body);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return json(response, 404, { error: 'not found' });
    json(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}).listen(port, () => console.log(`强化大师: http://localhost:${port}`));

function json(response: import('node:http').ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value));
}
