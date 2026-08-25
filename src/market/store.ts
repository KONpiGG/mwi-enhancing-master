import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { MarketSnapshot, StoredSnapshot } from './types.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export class SnapshotStore {
  readonly #manifestPath: string;
  readonly #snapshotDir: string;

  constructor(readonly dataDir = 'data') {
    this.#manifestPath = join(dataDir, 'manifest.json');
    this.#snapshotDir = join(dataDir, 'snapshots');
  }

  async list(): Promise<StoredSnapshot[]> {
    try {
      return JSON.parse(await readFile(this.#manifestPath, 'utf8')) as StoredSnapshot[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async save(snapshot: MarketSnapshot): Promise<{ stored: boolean; entry: StoredSnapshot }> {
    const current = await this.list();
    const duplicate = current.find((entry) => entry.timestamp === snapshot.timestamp);
    if (duplicate) return { stored: false, entry: duplicate };

    const filename = `${snapshot.timestamp.replaceAll(':', '-')}.json.gz`;
    const relativePath = join('snapshots', filename);
    const entry = { timestamp: snapshot.timestamp, path: relativePath, quoteCount: snapshot.quotes.length };
    await mkdir(this.#snapshotDir, { recursive: true });
    await atomicWrite(join(this.dataDir, relativePath), await gzipAsync(JSON.stringify(snapshot)));
    const updated = [...current, entry].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    await atomicWrite(this.#manifestPath, `${JSON.stringify(updated, null, 2)}\n`);
    return { stored: true, entry };
  }

  async latest(): Promise<MarketSnapshot | null> {
    const entries = await this.list();
    const latest = entries.at(-1);
    if (!latest) return null;
    return JSON.parse((await gunzipAsync(await readFile(join(this.dataDir, latest.path)))).toString()) as MarketSnapshot;
  }
}

async function atomicWrite(path: string, contents: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents);
  await rename(temporary, path);
}
