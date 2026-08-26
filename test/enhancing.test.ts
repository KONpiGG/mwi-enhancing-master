import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEnhancementTransitions, calculateRankings, evaluateEnhancementStrategy, evaluateProtectionStrategies, rankProfitProjects, rankTrainingProjects } from '../src/enhancing/calculator.js';
import { deriveEnhancingBuffs, type EnhancingPreset, type PresetGameData } from '../src/enhancing/preset.js';
import type { EnhanceableItem } from '../src/game-data/catalog.js';
import type { MarketSnapshot } from '../src/market/types.js';
import { presetOptions } from '../src/enhancing/game-preset-data.js';

const item: EnhanceableItem = { itemHrid: '/items/sword', name: 'Sword', itemLevel: 10, protectionItemHrids: ['/items/protector'], steps: Array.from({ length: 7 }, (_, i) => ({ toLevel: i + 1, baseSuccessRate: .5 - i * .04, experience: 0, materials: [{ itemHrid: '/items/dust', quantity: 2 }] })) };
const quotes = Array.from({ length: 8 }, (_, enhancementLevel) => ({ itemHrid: item.itemHrid, enhancementLevel, ask: 100 + enhancementLevel * 100, bid: 90 + enhancementLevel * 140, hourlyAverage: 100, hourlyVolume: 20 }));
const snapshot: MarketSnapshot = { timestamp: '2026-08-25T12:00:00.000Z', quotes: [...quotes, { itemHrid: '/items/dust', enhancementLevel: 0, ask: 5, bid: 4, hourlyAverage: 5, hourlyVolume: 100 }, { itemHrid: '/items/protector', enhancementLevel: 0, ask: 8, bid: 7, hourlyAverage: 8, hourlyVolume: 100 }] };
const buffs = { playerLevel: 10, success: 0, blessed: 0, experience: 0, speed: 0 };

test('one base item is bought regardless of failures and no-protection consumes none', () => {
  const result = evaluateEnhancementStrategy({ snapshot, item, targetLevel: 3, protectLevel: 3, buffs });
  assert.equal(result.baseItemCost, 100); assert.equal(result.expectedProtections, 0); assert.ok(result.expectedActions > 3);
});
test('enumerates every strategy and selects the minimum cash cost', () => {
  const result = evaluateProtectionStrategies({ snapshot, item, targetLevel: 7, buffs })!;
  assert.equal(result.allStrategies.length, 7); assert.equal(result.bestStrategy.cashCost, Math.min(...result.allStrategies.map(x => x.cashCost)));
});
test('failure returns to zero below protection and falls one level at/above it', () => {
  const { q, rates } = buildEnhancementTransitions(item, buffs, 4, 2);
  assert.equal(q[1]![0], rates[1]!.failure); assert.equal(q[2]![1], rates[2]!.failure);
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
test('each enhancing level above item recommendation grants one percent action speed', () => {
  const r = evaluateEnhancementStrategy({ snapshot, item, targetLevel: 1, protectLevel: 1, actionSeconds: 10, buffs: { ...buffs, playerLevel: 15 } });
  assert.ok(Math.abs(r.expectedTime - r.expectedActions * 10 / 1.05) < 1e-10);
});
test('uses material ask, product bid, fee, and rejects missing prices', () => {
  const r = evaluateEnhancementStrategy({ snapshot, item, targetLevel: 1, protectLevel: 1, buffs, marketFeeRate: .05 });
  assert.equal(r.grossRevenue, 230); assert.equal(r.marketFee, 11.5); assert.equal(r.materialCost, r.visits[0]! * 10);
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
test('preset equipment options cover every requested slot with Chinese names', () => {
  assert.deepEqual(new Set(presetOptions.map(option => option.slot)), new Set(['tool', 'charm', 'hands', 'neck', 'earrings', 'ring', 'pouch']));
  assert.ok(presetOptions.every(option => /[\u3400-\u9fff]/u.test(option.name)));
  assert.ok(presetOptions.some(option => option.hrid === '/items/philosophers_earrings' && option.name === '贤者耳环'));
});
test('ranking exposes time, labor, experience rate and Markov attempt variance', () => {
  const row = calculateRankings(snapshot, [item], buffs, new Date(snapshot.timestamp), .05, 360, 10)[0]!;
  assert.equal(row.laborCost, row.expectedTime / 10); assert.ok(row.expectedTime > 0); assert.ok(row.experiencePerHour > 0); assert.ok(row.attemptVariance >= 0);
});
test('rankings enumerate every quoted origin and target pair', () => {
  const rows = calculateRankings(snapshot, [item], buffs, new Date(snapshot.timestamp));
  assert.equal(rows.length, 28); assert.ok(rows.some(row => row.fromLevel === 3 && row.toLevel === 5)); assert.ok(rows.some(row => row.fromLevel === 4 && row.toLevel === 7));
});
test('profit and training rankings reuse the identical best strategy objects', () => {
  const rows = calculateRankings(snapshot, [item], buffs, new Date(snapshot.timestamp)); const profit = rankProfitProjects(rows); const training = rankTrainingProjects(rows);
  for (const row of profit) assert.equal(training.find(x => x.id === row.id)!.bestStrategy, row.bestStrategy);
  assert.deepEqual(profit.map(x => x.profit), profit.map(x => x.profit).sort((a, b) => b - a));
  assert.deepEqual(training.map(x => x.costPerExperience), training.map(x => x.costPerExperience).sort((a, b) => a - b));
});
