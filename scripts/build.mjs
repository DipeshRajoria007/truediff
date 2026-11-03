// Builds the extension into dist/. `--watch` rebuilds on change.
import * as esbuild from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');

async function copyStatic() {
  await cp(join(root, 'public'), dist, { recursive: true });
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  await writeFile(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

const common = {
  bundle: true,
  target: 'chrome110',
  sourcemap: watch ? 'inline' : false,
  minify: false, // keep the shipped code readable for reviewers of the extension
  legalComments: 'none',
  logLevel: 'info',
};

const builds = [
  { entryPoints: [join(root, 'src/background/index.ts')], outfile: join(dist, 'background.js'), format: 'esm' },
  { entryPoints: [join(root, 'src/content/index.ts')], outfile: join(dist, 'content.js'), format: 'iife' },
  { entryPoints: [join(root, 'src/options/options.ts')], outfile: join(dist, 'options.js'), format: 'iife' },
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await copyStatic();

if (watch) {
  const ctxs = await Promise.all(builds.map((b) => esbuild.context({ ...common, ...b })));
  await Promise.all(ctxs.map((c) => c.watch()));
  const { watch: fsWatch } = await import('node:fs');
  fsWatch(join(root, 'public'), { recursive: true }, () => copyStatic().catch(console.error));
  fsWatch(join(root, 'manifest.json'), () => copyStatic().catch(console.error));
  console.log('Watching… reload the extension in chrome://extensions after changes.');
} else {
  await Promise.all(builds.map((b) => esbuild.build({ ...common, ...b })));
}
