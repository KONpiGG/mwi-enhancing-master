import assert from 'node:assert/strict';
import test from 'node:test';
import { enhanceableItems } from '../src/game-data/catalog.js';

test('ships the attributed enhanceable catalog instead of an empty placeholder', () => {
  assert.equal(enhanceableItems.length, 498);
  assert.ok(enhanceableItems.every(item => item.steps.length === 20));
  assert.ok(enhanceableItems.every(item => item.steps.every(step => step.materials.length > 0)));
});
