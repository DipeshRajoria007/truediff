// Renders the extension icons (public/icons/icon-*.png) from docs/brand/icon.svg, TrueDiff's mark
// ("the pull-request pair") on a cream tile. Uses Playwright's Chromium, like `npm run e2e`
// (first time: npx playwright install chromium).
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const svg = readFileSync(join(root, 'docs', 'brand', 'icon.svg'), 'utf8');
const browser = await chromium.launch();
try {
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const sized = svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${sized}`);
    await page.screenshot({ path: join(outDir, `icon-${size}.png`), omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`Icons written to ${outDir}`);
