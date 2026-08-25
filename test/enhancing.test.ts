import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateRankings } from '../src/enhancing/calculator.js';
import type { EnhanceableItem } from '../src/game-data/catalog.js';
import type { MarketSnapshot } from '../src/market/types.js';

const items: EnhanceableItem[] = [{ itemHrid: '/items/test_sword', name: '测试剑', steps: [
  { toLevel: 1, baseSuccessRate: 0.5, experience: 10, materials: [{ itemHrid: '/items/dust', quantity: 2 }] },
  { toLevel: 2, baseSuccessRate: 0.25, experience: 20, materials: [] },
] }];
const snapshot: MarketSnapshot = { timestamp: '2026-08-25T12:00:00.000Z', quotes: [
  { itemHrid: '/items/test_sword', enhancementLevel: 0, ask: 100, bid: 80, hourlyAverage: 90, hourlyVolume: 3 },
  { itemHrid: '/items/test_sword', enhancementLevel: 1, ask: 260, bid: 250, hourlyAverage: 255, hourlyVolume: 2 },
  { itemHrid: '/items/test_sword', enhancementLevel: 2, ask: 700, bid: 500, hourlyAverage: 600, hourlyVolume: 9 },
  { itemHrid: '/items/dust', enhancementLevel: 0, ask: 5, bid: 4, hourlyAverage: 4.5, hourlyVolume: 100 },
] };

test('computes a profitable case with conservative ask/bid and material breakdown', () => {
  const row = calculateRankings(snapshot, items, 0, new Date(snapshot.timestamp)).find(r => r.fromLevel === 0 && r.toLevel === 1)!;
  assert.equal(row.expectedAttempts, 2);
  assert.equal(row.purchaseCost, 200);
  assert.equal(row.materialCost, 20);
  assert.equal(row.saleRevenue, 250);
  assert.equal(row.profit, 30);
  assert.equal(row.totalExperience, 20);
  assert.equal(row.costPerExperience, 11);
  assert.ok(row.risks.includes('低成交量'));
});

test('computes a loss and applies player skill to each explicit base chance', () => {
  const row = calculateRankings(snapshot, items, 100, new Date(snapshot.timestamp)).find(r => r.fromLevel === 1 && r.toLevel === 2)!;
  assert.equal(row.successRate, 0.35);
  assert.ok(Math.abs(row.purchaseCost - 742.8571428571429) < 1e-9);
  assert.ok(Math.abs(row.profit + 242.8571428571429) < 1e-9);
});

test('excludes projects with either side of the required quote missing', () => {
  const broken = structuredClone(snapshot);
  broken.quotes.find(q => q.enhancementLevel === 1)!.bid = null;
  const rows = calculateRankings(broken, items, 0, new Date(snapshot.timestamp));
  assert.equal(rows.some(r => r.fromLevel === 0 && r.toLevel === 1), false);
  assert.equal(rows.some(r => r.fromLevel === 1), true, 'an ask and a different target bid are still usable');
});

test('recurses backwards so one +2 requires four +2 and eight +1 attempts', () => {
  const row = calculateRankings(snapshot, items, 0, new Date(snapshot.timestamp)).find(r => r.fromLevel === 0 && r.toLevel === 2)!;
  assert.deepEqual(row.steps.map(step => step.attempts), [8, 4]);
  assert.equal(row.expectedAttempts, 8);
});

test('deducts a configurable market fee and exposes pre-tax and after-tax profit', () => {
  const row = calculateRankings(snapshot, items, 0, new Date(snapshot.timestamp), 0.05).find(r => r.fromLevel === 0 && r.toLevel === 1)!;
  assert.equal(row.grossSaleRevenue, 250);
  assert.equal(row.marketFee, 12.5);
  assert.equal(row.saleRevenue, 237.5);
  assert.equal(row.preTaxProfit, 30);
  assert.equal(row.profit, 17.5);
});
