import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { buildEnhancementTransitions, calculateRankings, evaluateEnhancementStrategy, evaluateProtectionStrategies, rankProfitProjects, rankTrainingProjects } from '../src/enhancing/calculator.js';
import { deriveEnhancingBuffs, type EnhancingPreset, type PresetGameData } from '../src/enhancing/preset.js';
import { enhanceableItems, type EnhanceableItem } from '../src/game-data/catalog.js';
import type { MarketSnapshot } from '../src/market/types.js';
import { presetGameData, presetOptions } from '../src/enhancing/game-preset-data.js';
import { rankingWorkerUrl } from '../src/enhancing/ranking-worker-url.js';

const item: EnhanceableItem = { itemHrid: '/items/sword', name: 'Sword', itemLevel: 10, protectionItemHrids: ['/items/protector'], manufactureMaterials: [{ itemHrid: '/items/dust', quantity: 2 }], steps: Array.from({ length: 7 }, (_, i) => ({ toLevel: i + 1, baseSuccessRate: .5 - i * .04, experience: 1.4 * (i + 1) * 20, materials: [{ itemHrid: '/items/dust', quantity: 2 }] })) };
const quotes = Array.from({ length: 8 }, (_, enhancementLevel) => ({ itemHrid: item.itemHrid, enhancementLevel, ask: 100 + enhancementLevel * 100, bid: 90 + enhancementLevel * 140, hourlyAverage: 100, hourlyVolume: 20 }));
const snapshot: MarketSnapshot = { timestamp: '2026-08-25T12:00:00.000Z', quotes: [...quotes, { itemHrid: '/items/dust', enhancementLevel: 0, ask: 5, bid: 4, hourlyAverage: 5, hourlyVolume: 100 }, { itemHrid: '/items/protector', enhancementLevel: 0, ask: 8, bid: 7, hourlyAverage: 8, hourlyVolume: 100 }] };
const buffs = { playerLevel: 10, success: 0, blessed: 0, experience: 0, speed: 0 };

test('ranking worker URL follows the server runtime extension', () => {
  assert.equal(rankingWorkerUrl('file:///app/src/server.ts').href, 'file:///app/src/enhancing/ranking-worker-runner.js');
  assert.equal(rankingWorkerUrl('file:///app/dist/src/server.js').href, 'file:///app/dist/src/enhancing/ranking-worker.js');
});

test('ranking worker loads from the TypeScript development server', async () => {
  const worker = new Worker(rankingWorkerUrl(new URL('../src/server.ts', import.meta.url).href));
  const result = new Promise<{ rows?: unknown[]; error?: string }>((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
  });
  worker.postMessage({ snapshot, items: [item], buffs, now: snapshot.timestamp, marketFeeRate: .05, hourlyRate: 0, actionSeconds: 12 });
  const message = await result;
  await worker.terminate();
  assert.equal(message.error, undefined);
  assert.equal(message.rows?.length, 28);
});

test('one base item is bought regardless of failures and no-protection consumes none', () => {
  const result = evaluateEnhancementStrategy({ snapshot, item, targetLevel: 3, protectLevel: 3, buffs });
  assert.equal(result.baseItemCost, 100); assert.equal(result.expectedProtections, 0); assert.ok(result.expectedActions > 3);
});
test('enumerates every strategy and selects the greatest hourly profit', () => {
  const result = evaluateProtectionStrategies({ snapshot, item, targetLevel: 7, buffs })!;
  assert.equal(result.allStrategies.length, 7); assert.equal(result.bestStrategy, result.allStrategies.reduce((a, b) => b.expectedProfit / b.expectedTime > a.expectedProfit / a.expectedTime ? b : a));
});
test('failure returns to zero below protection and falls one level at/above it', () => {
  const { q, rates } = buildEnhancementTransitions(item, buffs, 4, 2);
  assert.equal(q[1]![0], rates[1]!.failure); assert.equal(q[2]![1], rates[2]!.failure);
});
test('Milkonomy reference case has identical success, attempts, cost, and profit', () => {
  // This is the same fundamental-matrix example evaluated by the upstream
  // EnhanceCalculator: Sword, player preset level 10, +0 -> +4, protect at +2.
  const result = evaluateEnhancementStrategy({ snapshot, item, targetLevel: 4, protectLevel: 2, buffs, marketFeeRate: .05, actionSeconds: 12 });
  const expectedVisits = [12.880026152337386, 10.074098289201283, 6.265664160401014, 2.6315789473684266];
  expectedVisits.forEach((value, level) => assert.ok(Math.abs(result.visits[level]! - value) < 1e-12));
  assert.equal(result.steps[0]!.successRate, .5);
  assert.ok(Math.abs(result.expectedActions - 31.851367549308108) < 1e-12);
  assert.ok(Math.abs(result.expectedProtections - 5.2656641604010135) < 1e-12);
  assert.ok(Math.abs(result.cashCost - 100 - result.expectedActions * 10 - result.expectedProtections * 8) < 1e-12);
  assert.ok(Math.abs(result.expectedProfit - (650 * .95 - result.cashCost)) < 1e-12);
});

test('material cost excludes the separately purchased base item', () => {
  const result = evaluateEnhancementStrategy({ snapshot, item, targetLevel: 4, protectLevel: 4, buffs });
  assert.equal(result.expectedProtections, 0);
  assert.ok(Math.abs(result.materialCost - result.expectedActions * 10) < 1e-12);
  assert.ok(Math.abs(result.cashCost - result.baseItemCost - result.materialCost) < 1e-12);
});

test('self manufacture supplies missing or overpriced level-zero equipment', () => {
  const missingBase = structuredClone(snapshot);
  missingBase.quotes = missingBase.quotes.filter(quote => quote.itemHrid !== item.itemHrid || quote.enhancementLevel !== 0);
  assert.equal(calculateRankings(missingBase, [item], buffs, new Date(snapshot.timestamp)).some(row => row.fromLevel === 0), false);
  const manufactured = calculateRankings(missingBase, [item], buffs, new Date(snapshot.timestamp), .05, 0, 12, true);
  assert.equal(manufactured.filter(row => row.fromLevel === 0).length, 7);
  assert.ok(manufactured.filter(row => row.fromLevel === 0).every(row => row.purchaseCost === 10 && row.bestStrategy.baseItemSource === 'manufacture'));

  const overpriced = structuredClone(snapshot);
  overpriced.quotes.find(quote => quote.itemHrid === item.itemHrid && quote.enhancementLevel === 0)!.ask = 11;
  const row = calculateRankings(overpriced, [item], buffs, new Date(snapshot.timestamp), .05, 0, 12, true).find(row => row.fromLevel === 0)!;
  assert.equal(row.purchaseCost, 10);
  assert.equal(row.bestStrategy.manufactureCost, 10);
});

test('self manufacture uses the production recipe rather than one enhancement attempt', () => {
  const bottoms = enhanceableItems.find(entry => entry.itemHrid === '/items/enhancers_bottoms')!;
  const priced: MarketSnapshot = { timestamp: snapshot.timestamp, quotes: [
    { itemHrid: bottoms.itemHrid, enhancementLevel: 0, ask: 400_000_000, bid: 390_000_000, hourlyAverage: 395_000_000, hourlyVolume: 1 },
    { itemHrid: bottoms.itemHrid, enhancementLevel: 1, ask: 450_000_000, bid: 440_000_000, hourlyAverage: 445_000_000, hourlyVolume: 1 },
    { itemHrid: '/items/thread_of_expertise', enhancementLevel: 0, ask: 10_000_000, bid: 9_000_000, hourlyAverage: 9_500_000, hourlyVolume: 1 },
    { itemHrid: '/items/branch_of_insight', enhancementLevel: 0, ask: 20_000_000, bid: 19_000_000, hourlyAverage: 19_500_000, hourlyVolume: 1 },
    { itemHrid: '/items/enhancing_essence', enhancementLevel: 0, ask: 1_000, bid: 900, hourlyAverage: 950, hourlyVolume: 1 },
    { itemHrid: '/items/umbral_leather', enhancementLevel: 0, ask: 40_000, bid: 39_000, hourlyAverage: 39_500, hourlyVolume: 1 },
    { itemHrid: '/items/radiant_fabric', enhancementLevel: 0, ask: 45_000, bid: 44_000, hourlyAverage: 44_500, hourlyVolume: 1 },
  ] };
  const result = evaluateEnhancementStrategy({ snapshot: priced, item: bottoms, targetLevel: 1, protectLevel: 1, buffs: { ...buffs, playerLevel: 90 }, manufactureBase: true });
  assert.equal(result.manufactureCost, 357_000_000);
  assert.equal(result.baseItemCost, 357_000_000);
  assert.equal(result.baseItemSource, 'manufacture');
});

test('self manufacture keeps the market item when it is cheaper or recipe prices are missing', () => {
  const cheap = structuredClone(snapshot);
  cheap.quotes.find(quote => quote.itemHrid === item.itemHrid && quote.enhancementLevel === 0)!.ask = 9;
  let result = evaluateEnhancementStrategy({ snapshot: cheap, item, targetLevel: 1, protectLevel: 1, buffs, manufactureBase: true });
  assert.equal(result.baseItemCost, 9);
  assert.equal(result.baseItemSource, 'market');

  cheap.quotes.find(quote => quote.itemHrid === '/items/dust')!.ask = null;
  result = evaluateEnhancementStrategy({ snapshot: cheap, item, targetLevel: 1, protectLevel: 1, buffs, manufactureBase: true });
  assert.equal(result.baseItemSource, 'market');
});

test('Milkonomy does not replace its upstream rate semantics with generic clamps', () => {
  const { rates } = buildEnhancementTransitions(item, { ...buffs, success: 2, blessed: 1.5 }, 1, 1);
  assert.equal(rates[0]!.success, 1.5);
  assert.equal(rates[0]!.normalUp, -.75);
  assert.equal(rates[0]!.leapUp, 2.25);
  assert.equal(rates[0]!.failure, -.5);
});
test('blessing adds a +2 transition and overflow is absorbed', () => {
  const model = buildEnhancementTransitions(item, { ...buffs, blessed: .25 }, 3, 3);
  assert.ok(model.q[0]![2]! > 0); assert.equal(model.q[2]!.reduce((a, b) => a + b, 0), model.rates[2]!.failure);
});
test('protections only count protected failures', () => {
  const r = evaluateEnhancementStrategy({ snapshot, item, targetLevel: 4, protectLevel: 2, buffs });
  const expected = r.steps.filter(x => x.level >= 2).reduce((sum, x) => sum + x.attempts * x.failureRate, 0);
  assert.ok(Math.abs(r.expectedProtections - expected) < 1e-12);
});
test('experience includes 10% failure experience then the experience buff', () => {
  const r = evaluateEnhancementStrategy({ snapshot, item, targetLevel: 1, protectLevel: 1, buffs: { ...buffs, experience: .5 } });
  assert.ok(Math.abs(r.totalExperience - r.visits[0]! * (.5 + .1 * .5) * 1.4 * 20 * 1.5) < 1e-10);
});
test('experience uses the distinct catalog value for every attempted level', () => {
  const custom = structuredClone(item);
  custom.steps[0]!.experience = 10;
  custom.steps[1]!.experience = 70;
  const r = evaluateEnhancementStrategy({ snapshot, item: custom, targetLevel: 2, protectLevel: 2, buffs });
  assert.ok(Math.abs(r.steps[0]!.experience - r.visits[0]! * (.5 + .1 * .5) * 10) < 1e-10);
  assert.ok(Math.abs(r.steps[1]!.experience - r.visits[1]! * (.46 + .1 * .54) * 70) < 1e-10);
  assert.equal(r.totalExperience, r.steps[0]!.experience + r.steps[1]!.experience);
});
test('each enhancing level above item recommendation grants one percent action speed', () => {
  const r = evaluateEnhancementStrategy({ snapshot, item, targetLevel: 1, protectLevel: 1, actionSeconds: 10, buffs: { ...buffs, playerLevel: 15 } });
  assert.ok(Math.abs(r.expectedTime - r.expectedActions * 10 / 1.05) < 1e-10);
});
test('uses material ask, product bid, fee, and rejects missing prices', () => {
  const r = evaluateEnhancementStrategy({ snapshot, item, targetLevel: 1, protectLevel: 1, buffs, marketFeeRate: .05 });
  assert.equal(r.grossRevenue, 230); assert.equal(r.marketFee, 11.5); assert.equal(r.materialCost, r.visits[0]! * 10);
  assert.deepEqual(r.materialPurchases, [{ itemHrid: '/items/dust', quantity: r.visits[0]! * 2 }]);
  const broken = structuredClone(snapshot); broken.quotes.find(q => q.itemHrid === '/items/dust')!.ask = null;
  assert.equal(evaluateProtectionStrategies({ snapshot: broken, item, targetLevel: 1, buffs }), null);
});
test('preset equipment levels and every source derive only declared attributes', () => {
  const preset: EnhancingPreset = { id: 'p', name: 'p', enhancing: { playerLevel: 50, tool: { hrid: 'tool', enhanceLevel: 1 }, charm: {}, teas: ['tea'] }, specialEquipment: { hands: {}, body: {}, legs: {}, back: {}, neck: {}, earrings: {}, ring: {}, pouch: {} }, seals: ['seal'], communityBuffs: { c: { hrid: 'community', level: 2 } }, achievementBuffs: { achievement: { enabled: true } }, shrines: { shrine: { level: 3 } } };
  const data: PresetGameData = { equipment: { tool: [{ attribute: 'Success', value: .1 }] }, consumables: { tea: [{ attribute: 'Speed', value: .1 }] }, seals: { seal: [{ attribute: 'Blessed', value: .01 }] }, communityBuffs: { community: [{ attribute: 'Success', value: .02 }] }, achievements: { achievement: [{ attribute: 'Experience', value: .2 }] }, shrines: { shrine: [{ attribute: 'Experience', value: .01 }] }, enhancementLevelTotalBonusMultiplierTable: [1, 2] };
  const result = deriveEnhancingBuffs(preset, data); assert.ok(Math.abs(result.success - .14) < 1e-12); assert.deepEqual({ ...result, success: .14 }, { playerLevel: 50, success: .14, blessed: .01, experience: .23, speed: .1 });
});
test('reference community and achievement buffs use their official enhancement factors', () => {
  const preset: EnhancingPreset = { id: 'p', name: 'p', enhancing: { playerLevel: 100, tool: {}, charm: {}, teas: [] }, specialEquipment: { hands: {}, body: {}, legs: {}, back: {}, neck: {}, earrings: {}, ring: {}, pouch: {} }, seals: [], communityBuffs: { speed: { hrid: 'speed', level: 3 }, moo: { hrid: 'moo', level: 1 } }, achievementBuffs: { champion: { enabled: true } }, shrines: {} };
  const data: PresetGameData = { equipment: {}, consumables: {}, seals: {}, communityBuffs: { speed: [{ attribute: 'Speed', value: .2, perEnhanceLevel: .005, levelMode: 'base-plus' }], moo: [{ attribute: 'Experience', value: .05 }] }, achievements: { champion: [{ attribute: 'Success', value: .002 }] }, shrines: {} };
  const result = deriveEnhancingBuffs(preset, data); assert.deepEqual({ ...result, speed: Number(result.speed.toFixed(3)) }, { playerLevel: 100, success: .002, blessed: 0, experience: .05, speed: .21 });
});
test('Milkonomy house, enhancing armor, cape, and shrines derive the reference buffs', () => {
  const preset = createReferencePreset();
  const result = deriveEnhancingBuffs(preset, presetGameData);
  assert.ok(Math.abs(result.success - .002) < 1e-12);
  assert.ok(Math.abs(result.speed - .305) < 1e-12);
  assert.ok(Math.abs(result.experience - .122) < 1e-12);
});
test('preset equipment options cover every requested slot with Chinese names', () => {
  assert.deepEqual(new Set(presetOptions.map(option => option.slot)), new Set(['tool', 'charm', 'hands', 'body', 'legs', 'back', 'neck', 'earrings', 'ring', 'pouch']));
  assert.ok(presetOptions.every(option => /[\u3400-\u9fff]/u.test(option.name)));
  assert.ok(presetOptions.some(option => option.hrid === '/items/philosophers_earrings' && option.name === '贤者耳环'));
});

function createReferencePreset(): EnhancingPreset {
  return { id: 'reference', name: 'reference', enhancing: { playerLevel: 100, houseLevel: 4, tool: {}, charm: {}, teas: [] },
    specialEquipment: { hands: {}, body: { hrid: '/items/enhancers_top', enhanceLevel: 0 }, legs: { hrid: '/items/enhancers_bottoms', enhanceLevel: 0 }, back: { hrid: '/items/chance_cape', enhanceLevel: 0 }, neck: {}, earrings: {}, ring: {}, pouch: {} },
    seals: [], communityBuffs: {}, achievementBuffs: {}, shrines: { rhythm: { level: 3 }, scholar: { level: 10 } } };
}
test('ranking exposes unified cost, hourly profit, experience efficiency and exact variance risk', () => {
  const rows = calculateRankings(snapshot, [item], buffs, new Date(snapshot.timestamp), .05, 0, 10); const row = rows[0]!;
  assert.equal(row.totalCost, row.purchaseCost + row.materialCost + row.protectionCost + row.marketFee);
  assert.equal(row.profit, row.grossSaleRevenue - row.totalCost);
  assert.equal(row.hourlyProfit, row.profit * 3600 / row.expectedTime);
  assert.ok(row.expectedAttempts > row.toLevel-row.fromLevel); assert.ok(row.expectedTime > 0);
  assert.ok(row.experiencePerHour! > 0); assert.ok(row.experiencePerGold! > 0); assert.ok(row.experienceEfficiency! >= 0 && row.experienceEfficiency! <= 100);
  assert.equal(row.simulationRuns, 0); assert.ok(row.lossProbability >= 0 && row.lossProbability <= 1); assert.ok(row.profitP10 <= row.profitP50 && row.profitP50 <= row.profitP90);
  assert.equal(row.recent72hVolume, null);
});
test('risk simulation efficiently samples very long level-zero failure streaks', () => {
  const difficult: EnhanceableItem = { itemHrid: '/items/difficult', name: 'Difficult', itemLevel: 100, steps: [{ toLevel: 1, baseSuccessRate: .000001, experience: 0, materials: [{ itemHrid: '/items/dust', quantity: 1 }] }] };
  const difficultSnapshot: MarketSnapshot = { timestamp: snapshot.timestamp, quotes: [
    { itemHrid: difficult.itemHrid, enhancementLevel: 0, ask: 100, bid: 90, hourlyAverage: 100, hourlyVolume: 20 },
    { itemHrid: difficult.itemHrid, enhancementLevel: 1, ask: 200, bid: 180, hourlyAverage: 190, hourlyVolume: 20 },
    snapshot.quotes.find(q => q.itemHrid === '/items/dust')!,
  ] };
  const [row] = calculateRankings(difficultSnapshot, [difficult], { ...buffs, playerLevel: 1 }, new Date(difficultSnapshot.timestamp));
  assert.equal(row!.simulationRuns, 0); assert.ok(Number.isFinite(row!.profitP10)); assert.ok(row!.profitP10 <= row!.profitP50 && row!.profitP50 <= row!.profitP90);
});
test('losses stay negative and zero-duration rates stay unavailable', () => {
  const poor = structuredClone(snapshot); poor.quotes.find(q => q.itemHrid === item.itemHrid && q.enhancementLevel === 1)!.bid = 1;
  const loss = calculateRankings(poor, [item], buffs, new Date(poor.timestamp), .05, 0, 10).find(r => r.fromLevel === 0 && r.toLevel === 1)!;
  assert.ok(loss.profit < 0); assert.ok(loss.profitRate < 0); assert.ok(loss.hourlyProfit! < 0);
  assert.equal(loss.marketFee, loss.grossSaleRevenue * .05); assert.equal(loss.totalCost, loss.bestStrategy.cashCost + loss.marketFee);
  const timeless = calculateRankings(poor, [item], buffs, new Date(poor.timestamp), .05, 0, 0)[0]!;
  assert.equal(timeless.hourlyProfit, null); assert.equal(timeless.experiencePerHour, null); assert.equal(timeless.experienceEfficiency, null);
});
test('rankings enumerate every quoted origin and target pair', () => {
  const rows = calculateRankings(snapshot, [item], buffs, new Date(snapshot.timestamp));
  assert.equal(rows.length, 28); assert.ok(rows.some(row => row.fromLevel === 3 && row.toLevel === 5)); assert.ok(rows.some(row => row.fromLevel === 4 && row.toLevel === 7));
});
test('ranking never drops projects using a market-only shortlist', () => {
  const rows = calculateRankings(snapshot, [item], buffs, new Date(snapshot.timestamp), .05, 0, 12);
  assert.equal(rows.length, 28);
  assert.ok(rows.every(row => row.simulationRuns === 0));
});
test('profit and training rankings reuse the identical best strategy objects', () => {
  const rows = calculateRankings(snapshot, [item], buffs, new Date(snapshot.timestamp)); const profit = rankProfitProjects(rows); const training = rankTrainingProjects(rows);
  for (const row of profit) assert.equal(training.find(x => x.id === row.id)!.bestStrategy, row.bestStrategy);
  assert.deepEqual(profit.map(x => x.hourlyProfit), profit.map(x => x.hourlyProfit).sort((a, b) => b! - a!));
  assert.deepEqual(training.map(x => x.costPerExperience), training.map(x => x.costPerExperience).sort((a, b) => a - b));
});

test('Milkonomy special protection list replaces the base item instead of extending it', () => {
  const specialItem: EnhanceableItem = { ...item, protectionItemHrids: ['/items/protector'] };
  const cheapBase = structuredClone(snapshot);
  cheapBase.quotes.find(quote => quote.itemHrid === item.itemHrid && quote.enhancementLevel === 0)!.ask = 1;
  const result = evaluateEnhancementStrategy({ snapshot: cheapBase, item: specialItem, targetLevel: 2, protectLevel: 1, buffs });
  assert.ok(result.expectedProtections > 0);
  assert.equal(result.protectionItemHrid, '/items/protector');
  assert.equal(result.protectionCost, result.expectedProtections * 8);
});

test('protection defaults to the cheapest quoted allowed material', () => {
  const specialItem: EnhanceableItem = { ...item, protectionItemHrids: ['/items/expensive_protector', '/items/protector'] };
  const priced = structuredClone(snapshot);
  priced.quotes.push({ itemHrid: '/items/expensive_protector', enhancementLevel: 0, ask: 80, bid: 70, hourlyAverage: 75, hourlyVolume: 10 });
  const result = evaluateEnhancementStrategy({ snapshot: priced, item: specialItem, targetLevel: 2, protectLevel: 1, buffs });
  assert.equal(result.protectionItemHrid, '/items/protector');
  assert.equal(result.protectionCost, result.expectedProtections * 8);
});
