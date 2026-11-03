import { prKey, type PrRef } from '../shared/github-url';
import type { Request, Response, ResponseMap } from '../shared/messages';
import { loadToken, onTokenChanged, restrictTokenStorage } from '../shared/settings';
import {
  ApiError,
  checkRepoAccess,
  checkToken,
  fetchPrDetails,
  fetchPrSizes,
  setFilesViewed,
  type PrSize,
} from './github';
import { classifySender, parseRequest } from './validate';

// First thing on every start: keep storage.local (where the token lives) away from github.com tabs.
const ready = restrictTokenStorage();

// Short-lived cache so scrolling around a PR list or flipping between tabs doesn't
// refetch the same PRs. The service worker may be killed at any time; that's fine.
const SIZE_TTL_MS = 3 * 60 * 1000;
const sizeCache = new Map<string, { at: number; value: PrSize }>();

function cacheSize(pr: PrRef, value: PrSize): void {
  sizeCache.set(prKey(pr), { at: Date.now(), value });
  if (sizeCache.size > 500) {
    const oldest = [...sizeCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100);
    for (const [k] of oldest) sizeCache.delete(k);
  }
}

// Auto-mark runs once per PR head commit. Claims are serialized so two tabs can't both win.
const AUTO_KEY = 'autoMarked';
const AUTO_MAX = 300;
let autoQueue: Promise<unknown> = Promise.resolve();

function claimAutoMark(pr: PrRef, headOid: string): Promise<boolean> {
  const run = autoQueue.then(async () => {
    const key = prKey(pr);
    const store = await chrome.storage.local.get(AUTO_KEY);
    const raw = store[AUTO_KEY];
    const seen: Record<string, string> = raw && typeof raw === 'object' ? { ...(raw as Record<string, string>) } : {};
    if (seen[key] === headOid) return false;
    delete seen[key]; // re-insert so it counts as the newest entry
    seen[key] = headOid;
    const keys = Object.keys(seen);
    for (const k of keys.slice(0, Math.max(0, keys.length - AUTO_MAX))) delete seen[k];
    await chrome.storage.local.set({ [AUTO_KEY]: seen });
    return true;
  });
  autoQueue = run.catch(() => undefined);
  return run;
}

async function handle(req: Request): Promise<ResponseMap[Request['type']]> {
  switch (req.type) {
    case 'status':
      return { hasToken: Boolean(await loadToken()) };

    case 'claim-auto-mark':
      return claimAutoMark(req.pr, req.headOid);

    case 'open-options':
      await chrome.runtime.openOptionsPage();
      return null;

    case 'check-token': {
      const token = req.token ?? (await loadToken());
      const info = await checkToken({ token });
      const probeOk = req.probe ? await checkRepoAccess({ token }, req.probe.owner, req.probe.repo).catch(() => false) : undefined;
      return { ...info, probeOk };
    }

    case 'pr-details': {
      const token = await loadToken();
      const details = await fetchPrDetails({ token }, req.pr);
      cacheSize(req.pr, { changedFiles: details.changedFiles, files: details.files });
      return details;
    }

    case 'pr-sizes': {
      const token = await loadToken();
      const now = Date.now();
      const out: Array<PrSize | null> = new Array(req.prs.length).fill(null);
      const missing: number[] = [];
      req.prs.forEach((pr, i) => {
        const hit = sizeCache.get(prKey(pr));
        if (hit && now - hit.at < SIZE_TTL_MS) out[i] = hit.value;
        else missing.push(i);
      });
      if (missing.length) {
        const fetched = await fetchPrSizes(
          { token },
          missing.map((i) => req.prs[i]!),
        );
        fetched.forEach((value, j) => {
          const i = missing[j]!;
          out[i] = value;
          if (value) cacheSize(req.prs[i]!, value);
        });
      }
      return out;
    }

    case 'set-viewed': {
      const token = await loadToken();
      const result = await setFilesViewed({ token }, req.prId, req.paths, req.viewed);
      sizeCache.delete(prKey(req.pr));
      return result;
    }
  }
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse: (r: Response<unknown>) => void) => {
  // Only our own settings page and our own content script on github.com may talk to us, and each
  // only about what it needs. Anything else is dropped without touching the token.
  const from = classifySender(sender, chrome.runtime.id);
  const req = from ? parseRequest(raw, from) : null;
  if (!req) {
    sendResponse({ ok: false, error: { code: 'UNKNOWN', message: 'TrueDiff ignored an unexpected request.' } });
    return false;
  }
  ready.then(() => handle(req)).then(
    (data) => sendResponse({ ok: true, data }),
    (err: unknown) =>
      sendResponse({
        ok: false,
        error: err instanceof ApiError ? err.toJSON() : { code: 'UNKNOWN', message: (err as Error)?.message ?? String(err) },
      }),
  );
  return true; // keep the channel open for the async response
});

// A different token may see different PRs: drop sizes fetched with the old one.
onTokenChanged(() => sizeCache.clear());

// Clicking the toolbar icon opens settings (there is no popup).
chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install' && !(await loadToken())) await chrome.runtime.openOptionsPage();
});
