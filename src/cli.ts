import { collectSnapshot } from './market/collect.js';
import { SnapshotStore } from './market/store.js';

const [command, itemHrid, levelText = '0'] = process.argv.slice(2);
const store = new SnapshotStore(process.env.MWI_DATA_DIR ?? 'data');

if (command === 'collect') {
  const result = await collectSnapshot({ store });
  console.log(`${result.stored ? 'stored' : 'duplicate'} ${result.timestamp} (${result.quoteCount} quotes)`);
} else if (command === 'query') {
  if (!itemHrid) throw new Error('usage: npm run query -- /items/example [enhancement-level]');
  const level = Number(levelText);
  if (!Number.isSafeInteger(level) || level < 0) throw new Error('enhancement level must be a non-negative integer');
  const snapshot = await store.latest();
  if (!snapshot) throw new Error('no saved snapshots; run npm run collect first');
  const quote = snapshot.quotes.find((candidate) => candidate.itemHrid === itemHrid && candidate.enhancementLevel === level);
  if (!quote) throw new Error(`quote not found: ${itemHrid} +${level}`);
  console.log(JSON.stringify({ snapshotTimestamp: snapshot.timestamp, ...quote }, null, 2));
} else {
  throw new Error('usage: npm run collect | npm run query -- /items/example [enhancement-level]');
}
