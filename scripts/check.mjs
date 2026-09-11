import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root = process.cwd();
for (const directory of ['server', 'dist', 'scripts']) {
  for (const entry of await readdir(path.join(root, directory))) {
    if (!entry.endsWith('.mjs')) continue;
    const result = spawnSync(process.execPath, ['--check', path.join(root, directory, entry)], { stdio: 'inherit' });
    if (result.status) process.exit(result.status);
  }
}
const html = await readFile('dist/index.html', 'utf8');
for (const match of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g)) await readFile(path.join('dist', match[1]));
console.log('JavaScript syntax and HTML assets checked.');
