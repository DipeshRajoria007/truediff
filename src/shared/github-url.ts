export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

export type PrTab = 'conversation' | 'commits' | 'checks' | 'files' | 'other';

export interface PrLocation extends PrRef {
  tab: PrTab;
}

const PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/([^/?#]*))?/;

/** Parses /owner/repo/pull/123[/files|/changes|/commits|...] */
export function parsePrPath(pathname: string): PrLocation | null {
  const m = PR_PATH.exec(pathname);
  if (!m) return null;
  const sub = m[4] ?? '';
  let tab: PrTab;
  if (sub === '') tab = 'conversation';
  else if (sub === 'files' || sub === 'changes') tab = 'files';
  else if (sub === 'commits') tab = 'commits';
  else if (sub === 'checks') tab = 'checks';
  else tab = 'other';
  return { owner: m[1]!, repo: m[2]!, number: Number(m[3]), tab };
}

/** Matches only a PR's own URL (no tab suffix), e.g. links in PR lists. */
export function parsePrLink(href: string): PrRef | null {
  let url: URL;
  try {
    url = new URL(href, 'https://github.com');
  } catch {
    return null;
  }
  if (url.hostname !== 'github.com') return null;
  const m = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/.exec(url.pathname);
  return m ? { owner: m[1]!, repo: m[2]!, number: Number(m[3]) } : null;
}

export const prKey = (pr: PrRef): string => `${pr.owner}/${pr.repo}#${pr.number}`.toLowerCase();
