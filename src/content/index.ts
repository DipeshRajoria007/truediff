import { createClassifier } from '../shared/categories';
import { parsePrPath } from '../shared/github-url';
import { send } from '../shared/messages';
import { loadSettings, onSettingsChanged, type Settings } from '../shared/settings';
import { ListBadges } from './list-badges';
import { PrPage, type PageContext } from './pr-page';

let ctx: PageContext;
let prPage: PrPage | null = null;
let lists: ListBadges;
let lastHref = '';

const makeContext = (settings: Settings, hasToken: boolean): PageContext => ({
  settings,
  hasToken,
  classify: createClassifier(settings),
});

/** GitHub navigates without full page loads, so we re-check the URL on every DOM change. */
function route(): void {
  if (location.href !== lastHref) {
    lastHref = location.href;
    const loc = parsePrPath(location.pathname);
    if (prPage && (!loc || !prPage.isFor(loc))) {
      prPage.dispose();
      prPage = null;
    }
    if (loc && !prPage) {
      prPage = new PrPage(loc, ctx);
      prPage.start();
    }
  }
  prPage?.sync();
  lists.sync();
}

function throttle(fn: () => void, ms: number): () => void {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      fn();
    }, ms);
  };
}

function applyContext(next: PageContext): void {
  ctx = next;
  prPage?.updateContext(ctx);
  lists.updateContext(ctx);
}

/**
 * This script runs inside github.com tabs, so it never reads the token: it only asks the background
 * worker whether one is saved (storage.local is locked to the extension's own pages anyway).
 */
async function hasToken(): Promise<boolean> {
  try {
    return (await send({ type: 'status' })).hasToken;
  } catch {
    return true; // let the PR strip surface the real error (e.g. "TrueDiff was updated. Reload this page.")
  }
}

async function main(): Promise<void> {
  const [settings, token] = await Promise.all([loadSettings(), hasToken()]);
  ctx = makeContext(settings, token);
  lists = new ListBadges(ctx);
  route();

  const onChange = throttle(route, 200);
  new MutationObserver(onChange).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', onChange);
  document.addEventListener('turbo:load', onChange);

  onSettingsChanged((s) => applyContext(makeContext(s, ctx.hasToken)));
  // Tokens are added or replaced on the settings page, in another tab. Re-check when you come back.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') applyContext(makeContext(ctx.settings, await hasToken()));
  });
}

void main();
