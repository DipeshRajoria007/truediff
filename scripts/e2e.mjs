// End-to-end check of the BUILT extension (run `npm run build` first) in a throwaway Chromium profile.
//
//   npm run e2e            # light theme
//   npm run e2e -- dark    # dark theme
//
// github.com pages are real (viewed logged out, using public facebook/react PRs), so this catches
// GitHub layout changes. The GitHub API is mocked inside the extension's service worker, so no token
// is needed and nothing on GitHub is modified. Screenshots land in e2e-artifacts/.
// First run: `npx playwright install chromium`.
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(root, 'dist');
const OUT = join(root, 'e2e-artifacts');
mkdirSync(OUT, { recursive: true });
const scheme = process.argv[2] === 'dark' ? 'dark' : 'light';
const shot = (name) => join(OUT, `${scheme}-${name}.png`);
const PR = 'https://github.com/react/react/pull/31000';
const LIST = 'https://github.com/react/react/pulls';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

// A made-up PR: 4 real files, 5 test files, 1 lockfile.
const FIXTURE = {
  id: 'PR_fixture',
  headOid: 'deadbeef'.repeat(5), // a real-looking 40-char commit id (the background validates it)
  author: 'someone-else',
  files: [
    ['src/api/users.ts', 120, 30],
    ['src/api/users.test.ts', 400, 10],
    ['src/api/__snapshots__/users.test.ts.snap', 80, 0],
    ['src/db/schema.ts', 40, 5],
    ['src/ui/UserList.tsx', 90, 20],
    ['src/ui/UserList.spec.tsx', 210, 0],
    ['tests/e2e/users.e2e.ts', 150, 0],
    ['server/handlers/users_test.go', 95, 4],
    ['server/handlers/users.go', 60, 12],
    ['package-lock.json', 900, 450],
  ],
};
const REAL = { files: 4, additions: 310, deletions: 67 };
const NOISE_FILES = 6;

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'truediff-e2e-')), {
  channel: 'chromium',
  headless: true,
  colorScheme: scheme,
  viewport: { width: 1360, height: 900 },
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
});

try {
  let sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;

  /** (Re)installs the API mock. The worker can be restarted at any time, so call before each step. */
  async function mockApi() {
    sw = ctx.serviceWorkers().find((w) => w.url().includes(extId)) ?? sw;
    await sw.evaluate((fx) => {
      if (globalThis.__tdMocked) return;
      globalThis.__tdMocked = true;
      globalThis.__tdViewed ??= {};
      const realFetch = globalThis.fetch;
      const json = (body, headers = {}) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', ...headers } });
      const filesPage = (nodes) => ({ totalCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes });
      globalThis.fetch = async (url, init) => {
        const u = String(url);
        if (u === 'https://api.github.com/user') return json({ login: 'tester' }, { 'x-oauth-scopes': 'repo' });
        if (u !== 'https://api.github.com/graphql') return realFetch(url, init);
        const { query, variables } = JSON.parse(init.body);
        await new Promise((r) => setTimeout(r, 150));
        if (query.includes('TrueDiffPr')) {
          const nodes = fx.files.map(([path, additions, deletions]) => ({ path, additions, deletions, viewerViewedState: globalThis.__tdViewed[path] ?? 'UNVIEWED' }));
          return json({ data: { viewer: { login: 'tester' }, repository: { pullRequest: { id: fx.id, headRefOid: fx.headOid, changedFiles: nodes.length, author: { login: fx.author }, files: filesPage(nodes) } } } });
        }
        if (query.includes('TrueDiffSizes')) {
          const data = {};
          for (let i = 0; variables[`n${i}`] !== undefined; i++) {
            const n = variables[`n${i}`];
            const nodes = [
              { path: 'src/a.js', additions: (n % 500) + 5, deletions: n % 40 },
              { path: 'src/a.test.js', additions: (n % 3) * 400, deletions: 0 },
            ];
            data[`p${i}`] = { pullRequest: { changedFiles: 2, files: filesPage(nodes) } };
          }
          return json({ data });
        }
        if (query.includes('TrueDiffViewed')) {
          const viewed = query.includes(' markFileAsViewed');
          const data = {};
          for (let i = 0; variables[`f${i}`] !== undefined; i++) {
            globalThis.__tdViewed[variables[`f${i}`]] = viewed ? 'VIEWED' : 'UNVIEWED';
            data[`m${i}`] = { clientMutationId: null };
          }
          return json({ data });
        }
        return json({ errors: [{ message: 'unmocked query' }] });
      };
    }, FIXTURE);
  }
  const setSettings = (patch) =>
    sw.evaluate((patch) => chrome.storage.sync.get('settings').then(({ settings }) => chrome.storage.sync.set({ settings: { ...(settings ?? {}), ...patch } })), patch);
  const stripText = (page) => page.evaluate(() => document.querySelector('[data-truediff="strip"]')?.innerText.replace(/\s+/g, ' ') ?? null);
  const stripPlacement = (page) =>
    page.evaluate(() => {
      const s = document.querySelector('[data-truediff="strip"]');
      return s ? (s.classList.contains('td-floating') ? 'floating' : 'inline') : 'missing';
    });

  // 1. Install opens settings; saving a token verifies it.
  await new Promise((r) => setTimeout(r, 1500));
  let options = ctx.pages().find((p) => p.url().includes('options.html'));
  check('settings page opens on install', Boolean(options));
  if (!options) {
    options = await ctx.newPage();
    await options.goto(`chrome-extension://${extId}/options.html`);
  }
  await options.waitForSelector('#categories label');
  await mockApi();
  await options.fill('#token', 'not-a-real-token');
  await options.click('#token-save');
  await options.waitForFunction(() => /Connected/.test(document.querySelector('#token-status')?.textContent ?? ''), null, { timeout: 10000 });
  check('token check goes through the background worker', true);
  await options.fill('#test-path', 'contests/views.py');
  check('path tester: contests/views.py is real code', (await options.textContent('#test-result')) === 'Real change');
  await options.fill('#test-path', 'app/tests/test_forms.py');
  check('path tester: tests/ is noise', (await options.textContent('#test-result')) === 'Noise: Tests');
  await options.screenshot({ path: shot('settings'), fullPage: true });

  // 2. PR conversation tab: strip, numbers, dropdown, manual mark.
  const page = await ctx.newPage();
  page.on('pageerror', (e) => check(`no page errors`, false, e.message));
  await mockApi();
  await page.goto(PR, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-truediff="strip"] .td-group', { timeout: 20000 });
  check('strip sits under the PR tabs (new UI)', (await stripPlacement(page)) === 'inline');
  const text = await stripText(page);
  check('real size excludes noise', text.includes(`+${REAL.additions} −${REAL.deletions} in ${REAL.files} files`), text);
  check('mark button counts noise files', text.includes(`Mark ${NOISE_FILES} noise files viewed`), text);
  await page.click('[data-truediff="strip"] summary');
  const panelRows = await page.locator('[data-truediff="strip"] .td-panel li').count();
  check('dropdown lists every noise file', panelRows === NOISE_FILES, `${panelRows} rows`);
  await page.screenshot({ path: shot('pr-dropdown'), clip: { x: 0, y: 0, width: 1360, height: 700 } });
  await page.click('[data-truediff="strip"] summary');

  // 2a. Security: the github.com tab must not be able to reach the token or drive the extension.
  const cdp = await ctx.newCDPSession(page);
  const worlds = [];
  cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context));
  await cdp.send('Runtime.enable'); // reports existing contexts
  const csWorld = worlds.find((c) => c.auxData?.type === 'isolated' && c.origin === `chrome-extension://${extId}`);
  check('found the content script world', Boolean(csWorld));
  const inContentScript = async (expression) =>
    (await cdp.send('Runtime.evaluate', { expression, contextId: csWorld.id, awaitPromise: true, returnByValue: true })).result.value;
  const csRead = await inContentScript(`chrome.storage.local.get(null).then((v) => JSON.stringify(v), (e) => 'ERR ' + e.message)`);
  check('content script cannot read the token storage', String(csRead).startsWith('ERR') && !String(csRead).includes('not-a-real-token'), csRead);
  const forged = await inContentScript(`Promise.all([
      chrome.runtime.sendMessage({ type: 'check-token', token: 'attacker' }),
      chrome.runtime.sendMessage({ type: 'set-viewed', pr: { owner: 'react', repo: 'react', number: 31000 }, prId: 'PR_x', paths: 'all', viewed: true }),
      chrome.runtime.sendMessage({ type: 'status' }),
    ]).then((r) => JSON.stringify(r.map((x) => x.ok)))`);
  check('background rejects forbidden and malformed requests from the page side', forged === '[false,false,true]', forged);
  const pageSees = await page.evaluate(() => ({ html: document.documentElement.outerHTML.includes('not-a-real-token'), chrome: typeof globalThis.chrome?.runtime?.sendMessage }));
  check('token never appears in the github.com page', !pageSees.html, JSON.stringify(pageSees));
  await page.evaluate(() => document.querySelector('[data-truediff="strip"] .td-btn-primary')?.click());
  await page.waitForTimeout(1200);
  const afterSynthetic = await sw.evaluate(() => Object.keys(globalThis.__tdViewed).length);
  check('a page script clicking "Mark" does nothing', afterSynthetic === 0, `${afterSynthetic} marked`);
  await cdp.detach();

  await page.click('[data-truediff="strip"] .td-btn-primary');
  await page.waitForSelector('[data-truediff="strip"] .td-flash', { timeout: 10000 });
  const viewedCount = await sw.evaluate(() => Object.values(globalThis.__tdViewed).filter((v) => v === 'VIEWED').length);
  check('marking calls the API for exactly the noise files', viewedCount === NOISE_FILES, `${viewedCount} marked`);
  await page.screenshot({ path: shot('pr-marked'), clip: { x: 0, y: 0, width: 1360, height: 420 } });

  // 3. Files tab with auto-mark: marks, reloads, shows a confirmation.
  await sw.evaluate(() => (globalThis.__tdViewed = {}));
  await setSettings({ autoMarkOnOpen: true });
  await page.goto(`${PR}/files`, { waitUntil: 'domcontentloaded' });
  const flashed = await page.waitForSelector('[data-truediff="strip"] .td-flash', { timeout: 25000 }).then(() => true, () => false);
  check('auto-mark on "Files changed" marks and reloads', flashed, await stripText(page));
  check('strip sits under the tabs on the classic files view', (await stripPlacement(page)) === 'inline');
  await page.screenshot({ path: shot('pr-files'), clip: { x: 0, y: 0, width: 1360, height: 480 } });
  await setSettings({ autoMarkOnOpen: false });

  // 3a. Security: text planted in github.com's sessionStorage can't put words in TrueDiff's mouth.
  await page.evaluate(() => sessionStorage.setItem('truediff:flash', JSON.stringify({ key: 'react/react#31000', text: 'PLANTED TEXT', count: 'x' })));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-truediff="strip"] .td-group', { timeout: 20000 });
  check('planted flash text is ignored', !(await stripText(page)).includes('PLANTED'));

  // 4. PR list badges.
  await mockApi();
  await page.goto(LIST, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-truediff="badge"]:not(.td-badge-loading)', { timeout: 20000 });
  await page.waitForTimeout(500);
  const badges = await page.locator('[data-truediff="badge"]:not(.td-badge-loading)').count();
  const titles = await page.locator('a[data-testid="listitem-title-link"]').count();
  check('every PR in the list gets a badge', badges > 0 && badges === titles, `${badges}/${titles}`);
  await page.screenshot({ path: shot('list'), clip: { x: 0, y: 0, width: 1360, height: 700 } });
  // Search results use different markup.
  await page.goto('https://github.com/search?q=repo%3Areact%2Freact+is%3Apr+is%3Aopen&type=pullrequests', { waitUntil: 'domcontentloaded' });
  const searchBadges = await page
    .waitForSelector('.search-title [data-truediff="badge"]:not(.td-badge-loading)', { timeout: 20000 })
    .then(() => page.locator('.search-title [data-truediff="badge"]').count(), () => 0);
  check('PR search results get badges', searchBadges > 0, `${searchBadges} badges`);
  await page.screenshot({ path: shot('search'), clip: { x: 0, y: 0, width: 1360, height: 600 } });

  await setSettings({ showListBadges: false });
  await page.waitForTimeout(600);
  check('turning badges off removes them live', (await page.locator('[data-truediff="badge"]').count()) === 0);
} finally {
  await ctx.close();
}

console.log(failures ? `\n${failures} check(s) failed. Screenshots in ${OUT}` : `\nAll checks passed. Screenshots in ${OUT}`);
process.exit(failures ? 1 : 0);
