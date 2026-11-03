import type { ApiErrorInfo, PrSize } from '../background/github';
import { CATEGORIES, CATEGORY_LABELS, type NoiseKind } from '../shared/categories';
import { parsePrLink, prKey, type PrRef } from '../shared/github-url';
import { RequestError, send } from '../shared/messages';
import { formatCompact, formatCount, plural, summarize } from '../shared/summary';
import { debounce, h } from './dom';
import type { PageContext } from './pr-page';
import { injectStyles } from './styles';

/** PR title links in GitHub's PR lists (repo /pulls, the /pulls dashboard, search, classic lists). */
const TITLE_LINKS = [
  'a[data-testid="listitem-title-link"][data-hovercard-type="pull_request"]',
  'a.js-navigation-open[data-hovercard-type="pull_request"]',
  'a[id^="issue_"][id$="_link"][data-hovercard-type="pull_request"]',
  // github.com/search?type=pullrequests
  '.search-title a[href*="/pull/"]',
].join(',');

const BADGE = '[data-truediff="badge"]';
const KIND_ORDER: NoiseKind[] = [...CATEGORIES.map((c) => c.id), 'custom'];
const MAX_PER_REQUEST = 60;
const MAX_CACHED = 300;

export class ListBadges {
  /** undefined = not fetched yet, null = can't see this PR. */
  private sizes = new Map<string, PrSize | null>();
  private refs = new Map<string, PrRef>();
  private pending = new Set<string>();
  private inFlight = new Set<string>();
  private error: ApiErrorInfo | null = null;
  private version = 0;
  private readonly fetchSoon = debounce(() => void this.fetchPending(), 100);

  constructor(private ctx: PageContext) {}

  updateContext(ctx: PageContext): void {
    const tokenChanged = ctx.hasToken !== this.ctx.hasToken;
    this.ctx = ctx;
    if (tokenChanged || this.error) {
      this.sizes.clear();
      this.error = null;
    }
    this.version++;
    this.sync();
  }

  sync(): void {
    if (!this.ctx.hasToken || !this.ctx.settings.showListBadges) {
      document.querySelectorAll(BADGE).forEach((b) => b.remove());
      return;
    }
    const links = document.querySelectorAll<HTMLAnchorElement>(TITLE_LINKS);
    if (!links.length) return;
    injectStyles();

    let errorShown = false;
    for (const link of links) {
      const ref = parsePrLink(link.href);
      if (!ref) continue;
      const key = prKey(ref);
      this.refs.set(key, ref);

      let status: string;
      if (this.sizes.has(key)) status = this.sizes.get(key) ? 'ready' : 'none';
      else if (this.error) status = errorShown ? 'none' : 'error';
      else {
        status = 'loading';
        if (!this.inFlight.has(key)) this.pending.add(key);
      }
      if (status === 'error') errorShown = true;

      const existing = link.nextElementSibling?.matches(BADGE) ? link.nextElementSibling : null;
      const stamp = `${key}|${status}|${this.version}`;
      if (existing?.getAttribute('data-stamp') === stamp) continue;

      const badge = this.renderBadge(key, status);
      if (badge) badge.setAttribute('data-stamp', stamp);
      if (existing && badge) existing.replaceWith(badge);
      else if (existing) existing.remove();
      else if (badge) link.insertAdjacentElement('afterend', badge);
    }
    if (this.pending.size) this.fetchSoon();
  }

  private async fetchPending(): Promise<void> {
    const keys = [...this.pending].slice(0, MAX_PER_REQUEST);
    if (!keys.length) return;
    keys.forEach((k) => {
      this.pending.delete(k);
      this.inFlight.add(k);
    });
    try {
      const result = await send({ type: 'pr-sizes', prs: keys.map((k) => this.refs.get(k)!) });
      keys.forEach((k, i) => this.sizes.set(k, result[i] ?? null));
      // Long GitHub sessions never reload the page; keep memory bounded.
      for (const k of this.sizes.keys()) {
        if (this.sizes.size <= MAX_CACHED) break;
        this.sizes.delete(k);
      }
    } catch (e) {
      this.error = e instanceof RequestError ? e.info : { code: 'UNKNOWN', message: String(e) };
    } finally {
      keys.forEach((k) => this.inFlight.delete(k));
    }
    this.sync();
  }

  private renderBadge(key: string, status: string): HTMLElement | null {
    if (status === 'none') return null;
    if (status === 'loading') {
      return h('span', { className: 'td-root td-badge td-badge-loading', 'data-truediff': 'badge', 'aria-hidden': 'true', title: 'TrueDiff: counting…' });
    }
    if (status === 'error') {
      const err = this.error!;
      const hint = err.code === 'SSO' ? 'Authorize your token for SSO in GitHub settings.' : err.code === 'NO_TOKEN' ? 'Add a token in TrueDiff settings.' : '';
      return h('span', { className: 'td-root td-badge td-badge-error', 'data-truediff': 'badge', title: `TrueDiff couldn’t load PR sizes: ${err.message} ${hint}`.trim() }, 'TrueDiff: error');
    }

    const size = this.sizes.get(key)!;
    const s = summarize(size.files, this.ctx.classify);
    const kinds = KIND_ORDER.filter((k) => s.byKind[k]);
    const noiseLines = s.noise.additions + s.noise.deletions;
    const onlyTests = kinds.length === 1 && kinds[0] === 'tests';

    const tooltip = [
      `Real change: ${plural(s.real.files, 'file')}, +${formatCount(s.real.additions)} −${formatCount(s.real.deletions)} (size ${s.size})`,
      s.noise.files
        ? `Tests & noise: ${plural(s.noise.files, 'file')}, +${formatCount(s.noise.additions)} −${formatCount(s.noise.deletions)} (${kinds.map((k) => `${CATEGORY_LABELS[k]} ${s.byKind[k]!.files}`).join(', ')})`
        : 'No tests or other noise',
      `GitHub shows: ${plural(s.total.files, 'file')}, +${formatCount(s.total.additions)} −${formatCount(s.total.deletions)}`,
      size.files.length < size.changedFiles ? `(Only the first ${formatCount(size.files.length)} of ${formatCount(size.changedFiles)} files are available from GitHub.)` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return h(
      'span',
      { className: 'td-root td-badge', 'data-truediff': 'badge', title: tooltip },
      h('span', { className: `td-size td-size-${s.size}` }, s.size),
      h('span', { className: 'td-add' }, `+${formatCompact(s.real.additions)}`),
      h('span', { className: 'td-del' }, `−${formatCompact(s.real.deletions)}`),
      noiseLines > 0 ? h('span', { className: 'td-hidden' }, `· ${onlyTests ? 'tests' : 'noise'} ${formatCompact(noiseLines)}`) : null,
    );
  }
}
