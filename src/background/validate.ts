import type { PrRef } from '../shared/github-url';
import type { Request } from '../shared/messages';

/**
 * Who sent a message to the background worker:
 * - 'extension': our own pages (settings), served from chrome-extension://<our id>
 * - 'github':    our content script running on a github.com tab
 */
export type SenderKind = 'extension' | 'github';

/** What each kind of sender may ask for. The GitHub page side can't test tokens. */
const ALLOWED: Record<SenderKind, ReadonlySet<Request['type']>> = {
  extension: new Set(['check-token', 'status', 'open-options']),
  github: new Set(['pr-details', 'pr-sizes', 'set-viewed', 'status', 'claim-auto-mark', 'open-options']),
};

export interface SenderLike {
  id?: string;
  origin?: string;
  url?: string;
  tab?: unknown;
}

export function classifySender(sender: SenderLike, extensionId: string): SenderKind | null {
  if (!extensionId || sender.id !== extensionId) return null;
  let origin = sender.origin;
  if (!origin && sender.url) {
    try {
      origin = new URL(sender.url).origin;
    } catch {
      return null;
    }
  }
  if (origin === `chrome-extension://${extensionId}`) return 'extension';
  if (origin === 'https://github.com' && sender.tab) return 'github';
  return null;
}

// GitHub's own naming rules, so nothing odd reaches the API.
const OWNER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/; // _ appears in Enterprise Managed User names
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const NODE_ID = /^[A-Za-z0-9_=+/-]{1,200}$/;
const OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const MAX_PRS = 100;
const MAX_PATHS = 100;
const MAX_PATH_LEN = 4096;
const MAX_TOKEN_LEN = 512;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function prRef(v: unknown): PrRef | null {
  if (!isObj(v)) return null;
  const { owner, repo, number } = v;
  if (typeof owner !== 'string' || !OWNER.test(owner)) return null;
  if (typeof repo !== 'string' || !REPO.test(repo) || repo === '.' || repo === '..') return null;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1) return null;
  return { owner, repo, number };
}

/**
 * Checks a message against what its sender may ask for, and rebuilds it from known fields only.
 * Returns null for anything unexpected.
 */
export function parseRequest(raw: unknown, from: SenderKind): Request | null {
  if (!isObj(raw) || typeof raw.type !== 'string') return null;
  const type = raw.type as Request['type'];
  if (!ALLOWED[from].has(type)) return null;

  switch (type) {
    case 'status':
    case 'open-options':
      return { type };

    case 'pr-details': {
      const pr = prRef(raw.pr);
      return pr ? { type, pr } : null;
    }

    case 'pr-sizes': {
      if (!Array.isArray(raw.prs) || raw.prs.length > MAX_PRS) return null;
      const prs = raw.prs.map(prRef);
      return prs.every((p): p is PrRef => p !== null) ? { type, prs } : null;
    }

    case 'set-viewed': {
      const pr = prRef(raw.pr);
      const { prId, paths, viewed } = raw;
      if (!pr || typeof prId !== 'string' || !NODE_ID.test(prId) || typeof viewed !== 'boolean') return null;
      if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_PATHS) return null;
      if (!paths.every((p): p is string => typeof p === 'string' && p.length > 0 && p.length <= MAX_PATH_LEN)) return null;
      return { type, pr, prId, paths, viewed };
    }

    case 'claim-auto-mark': {
      const pr = prRef(raw.pr);
      const { headOid } = raw;
      return pr && typeof headOid === 'string' && OID.test(headOid) ? { type, pr, headOid } : null;
    }

    case 'check-token': {
      const { token, probe } = raw;
      if (token !== undefined && (typeof token !== 'string' || token.length > MAX_TOKEN_LEN)) return null;
      let probeRef: { owner: string; repo: string } | undefined;
      if (probe !== undefined) {
        const p = prRef({ ...(isObj(probe) ? probe : {}), number: 1 });
        if (!p) return null;
        probeRef = { owner: p.owner, repo: p.repo };
      }
      return { type, ...(token !== undefined ? { token } : {}), ...(probeRef ? { probe: probeRef } : {}) };
    }

    default:
      return null;
  }
}
