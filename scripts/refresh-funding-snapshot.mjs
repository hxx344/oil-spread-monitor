import { mkdir, writeFile, rename } from 'node:fs/promises';
import { fetchFundingSnapshot } from '../dist/funding-history.mjs';

const snapshot = await fetchFundingSnapshot();
const directory = new URL('../dist/data/', import.meta.url);
await mkdir(directory, { recursive: true });
const temp = new URL('hyperliquid-funding-2026.json.tmp', directory);
await writeFile(temp, JSON.stringify(snapshot) + '\n');
await rename(temp, new URL('hyperliquid-funding-2026.json', directory));
console.log(JSON.stringify(snapshot.metadata, null, 2));
