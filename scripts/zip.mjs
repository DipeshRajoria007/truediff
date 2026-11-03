// Packs dist/ into truediff-<version>.zip for sharing or uploading to the Chrome Web Store.
import { execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const out = join(root, `truediff-${version}.zip`);
await rm(out, { force: true });
execFileSync('zip', ['-r', '-q', '-X', out, '.'], { cwd: join(root, 'dist'), stdio: 'inherit' });
console.log(`Wrote ${out}`);
