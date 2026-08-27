import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { enhanceableItems } from '../src/game-data/catalog.js';

test('ships the attributed enhanceable catalog instead of an empty placeholder', () => {
  assert.equal(enhanceableItems.length, 498);
  assert.ok(enhanceableItems.every(item => item.steps.length === 20));
  assert.ok(enhanceableItems.every(item => item.steps.every(step => step.materials.length > 0)));
});

test('keeps manufacturing recipes separate from enhancement costs', () => {
  const bottoms = enhanceableItems.find(item => item.itemHrid === '/items/enhancers_bottoms')!;
  assert.deepEqual(bottoms.manufactureMaterials, [
    { itemHrid: '/items/thread_of_expertise', quantity: 8 },
    { itemHrid: '/items/branch_of_insight', quantity: 6 },
    { itemHrid: '/items/enhancing_essence', quantity: 140000 },
    { itemHrid: '/items/umbral_leather', quantity: 200 },
    { itemHrid: '/items/radiant_fabric', quantity: 200 },
  ]);
  assert.notDeepEqual(bottoms.manufactureMaterials, bottoms.steps[0]!.materials);
});

interface MilkonomyItem {
  hrid: string;
  name: string;
  itemLevel: number;
  isTradable: boolean;
  enhancementCosts?: Array<{ itemHrid: string; count: number }>;
  protectionItemHrids?: string[];
}

test('every catalog field matches the vendored Milkonomy game-data export', () => {
  const reference = JSON.parse(fs.readFileSync(new URL('../Milkonomy-main_ref/scripts/trans-convert/data.json', import.meta.url), 'utf8')) as {
    enhancementLevelSuccessRateTable: number[];
    itemDetailMap: Record<string, MilkonomyItem>;
  };
  const expected = Object.values(reference.itemDetailMap).filter(item => item.isTradable && item.enhancementCosts);
  assert.equal(enhanceableItems.length, expected.length);

  const actualByHrid = new Map(enhanceableItems.map(item => [item.itemHrid, item]));
  for (const item of expected) {
    const actual = actualByHrid.get(item.hrid);
    assert.ok(actual, `missing Milkonomy item ${item.hrid}`);
    assert.equal(actual.englishName, item.name, `${item.hrid} name`);
    assert.equal(actual.itemLevel, item.itemLevel, `${item.hrid} item level`);
    assert.deepEqual(actual.protectionItemHrids, item.protectionItemHrids, `${item.hrid} protection items`);
    assert.equal(actual.steps.length, reference.enhancementLevelSuccessRateTable.length, `${item.hrid} step count`);
    actual.steps.forEach((step, index) => {
      assert.equal(step.toLevel, index + 1, `${item.hrid} +${index + 1} level`);
      assert.equal(step.baseSuccessRate, reference.enhancementLevelSuccessRateTable[index], `${item.hrid} +${index + 1} success rate`);
      assert.equal(step.experience, 1.4 * (index + 1) * (10 + item.itemLevel), `${item.hrid} +${index + 1} experience`);
      assert.deepEqual(step.materials, item.enhancementCosts!.map(material => ({ itemHrid: material.itemHrid, quantity: material.count })), `${item.hrid} +${index + 1} materials`);
    });
  }
});
