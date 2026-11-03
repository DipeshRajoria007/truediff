import type { ApiErrorInfo, PrDetails } from '../background/github';
import { CATEGORIES, CATEGORY_LABELS, type Classifier, type NoiseKind } from '../shared/categories';
import { prKey, type PrLocation } from '../shared/github-url';
import { RequestError, send } from '../shared/messages';
import type { Settings } from '../shared/settings';
import { formatCount, plural, summarize, type NoiseFile, type PrSummary, type ViewedState } from '../shared/summary';
import { debounce, h, hasUnsavedText, icon, userClick } from './dom';
import { injectStyles } from './styles';

export interface PageContext {
  settings: Settings;
  classify: Classifier;
  hasToken: boolean;
}

type Note = { text: string; tone: 'ok' | 'error'; offerReload?: boolean };

type State =
  | { kind: 'loading' }
  | { kind: 'no-token' }
  | { kind: 'error'; error: ApiErrorInfo }
  | { kind: 'ready'; details: PrDetails; summary: PrSummary };

const MARK_CHUNK = 25;
const FLOAT_GRACE_MS = 2000;
const FLASH_KEY = 'truediff:flash';

// Last result per PR, so switching tabs renders instantly while we refetch in the background.
const lastDetails = new Map<string, PrDetails>();
function rememberDetails(key: string, details: PrDetails): void {
  lastDetails.delete(key);
  lastDetails.set(key, details);
  if (lastDetails.size > 30) lastDetails.delete(lastDetails.keys().next().value!);
}

const KIND_ORDER: NoiseKind[] = [...CATEGORIES.map((c) => c.id), 'custom'];

export class PrPage {
  private root: HTMLElement = h('div', { className: 'td-root td-strip', 'data-truediff': 'strip' });
  private state: State = { kind: 'loading' };
  private note: Note | null = null;
  private busy: string | null = null;
  private panelOpen = false;
  private disposed = false;
  private autoTried = false;
  private startedAt = 0;
  private readonly key: string;
  private readonly onDocClick = (e: MouseEvent) => this.watchGithubViewedClicks(e);
  private readonly refreshSoon = debounce(() => void this.refresh(), 1500);

  constructor(
    private readonly loc: PrLocation,
    private ctx: PageContext,
  ) {
    this.key = prKey(loc);
  }

  start(): void {
    this.startedAt = Date.now();
    injectStyles();
    this.consumeFlash();
    const cached = lastDetails.get(this.key);
    if (!this.ctx.hasToken) this.state = { kind: 'no-token' };
    else if (cached) this.setReady(cached);
    this.render();
    this.sync();
    document.addEventListener('click', this.onDocClick, true);
    if (this.ctx.hasToken) void this.refresh();
    // If GitHub's layout never shows up, sync() falls back to a floating strip after a grace period.
    setTimeout(() => this.sync(), FLOAT_GRACE_MS + 100);
  }

  dispose(): void {
    this.disposed = true;
    document.removeEventListener('click', this.onDocClick, true);
    this.root.remove();
  }

  isFor(loc: PrLocation): boolean {
    return prKey(loc) === this.key && loc.tab === this.loc.tab;
  }

  updateContext(ctx: PageContext): void {
    const tokenAdded = ctx.hasToken && !this.ctx.hasToken;
    this.ctx = ctx;
    if (!ctx.hasToken) this.state = { kind: 'no-token' };
    else if (this.state.kind === 'ready') this.setReady(this.state.details);
    this.render();
    if (tokenAdded || (ctx.hasToken && this.state.kind !== 'ready')) void this.refresh();
  }

  /** Keeps the strip in the page. Called on every (debounced) DOM mutation. */
  sync(): void {
    if (this.disposed) return;
    const anchor = findAnchor();
    if (anchor) {
      const { el, where } = anchor;
      const placed = where === 'afterend' ? el.nextElementSibling === this.root : el.lastElementChild === this.root;
      if (!placed) {
        this.root.classList.remove('td-floating');
        el.insertAdjacentElement(where, this.root);
      }
    } else if (!this.root.isConnected && Date.now() - this.startedAt > FLOAT_GRACE_MS) {
      // Unknown GitHub layout: float in the corner rather than not showing up at all.
      this.root.classList.add('td-floating');
      document.body.appendChild(this.root);
    }
  }

  // ---------------------------------------------------------------------------

  private async refresh(): Promise<void> {
    if (!this.ctx.hasToken) return;
    try {
      const details = await send({ type: 'pr-details', pr: this.loc });
      if (this.disposed) return;
      rememberDetails(this.key, details);
      this.setReady(details);
      this.render();
      void this.maybeAutoMark();
    } catch (e) {
      if (this.disposed) return;
      const error = e instanceof RequestError ? e.info : { code: 'UNKNOWN' as const, message: String(e) };
      if (this.state.kind === 'ready') this.note = { text: error.message, tone: 'error' };
      else this.state = { kind: 'error', error };
      this.render();
    }
  }

  private setReady(details: PrDetails): void {
    this.state = { kind: 'ready', details, summary: summarize(details.files, this.ctx.classify) };
  }

  private async maybeAutoMark(): Promise<void> {
    if (this.autoTried || !this.ctx.settings.autoMarkOnOpen || this.loc.tab !== 'files') return;
    if (this.state.kind !== 'ready') return;
    this.autoTried = true;
    const { details, summary } = this.state;
    if (!summary.noiseToMark.length) return;
    if (details.authorLogin && details.authorLogin === details.viewerLogin) return; // your own PR

    // Auto-mark once per PR head commit. If you unmark a test file to read it, we leave it
    // alone until someone pushes again. The background worker keeps that record.
    const first = await send({ type: 'claim-auto-mark', pr: this.loc, headOid: details.headOid }).catch(() => false);
    if (!first || this.disposed) return;

    await this.setViewed(summary.noiseToMark, true, true);
  }

  private async setViewed(files: readonly NoiseFile[], viewed: boolean, auto = false): Promise<void> {
    if (this.busy || this.state.kind !== 'ready' || !files.length) return;
    const { details } = this.state;
    const paths = files.map((f) => f.path);
    const done = new Set<string>();
    let error: ApiErrorInfo | undefined;
    this.note = null;

    try {
      for (let i = 0; i < paths.length; i += MARK_CHUNK) {
        this.busy = `${viewed ? 'Marking' : 'Unmarking'} ${Math.min(i + MARK_CHUNK, paths.length)}/${paths.length}…`;
        this.render();
        const chunk = paths.slice(i, i + MARK_CHUNK);
        const res = await send({ type: 'set-viewed', pr: this.loc, prId: details.id, paths: chunk, viewed });
        res.done.forEach((p) => done.add(p));
        error ??= res.error;
      }
    } catch (e) {
      error = e instanceof RequestError ? e.info : { code: 'UNKNOWN', message: String(e) };
    } finally {
      this.busy = null;
    }
    if (this.disposed) return;

    // Reflect the new state locally.
    const newState: ViewedState = viewed ? 'VIEWED' : 'UNVIEWED';
    const updated: PrDetails = {
      ...details,
      files: details.files.map((f) => (done.has(f.path) ? { ...f, viewerViewedState: newState } : f)),
    };
    rememberDetails(this.key, updated);
    this.setReady(updated);

    const what = doneText(done.size, viewed);
    // Counts both per-file failures and chunks we never got to (a network error mid-way).
    const missed = paths.length - done.size;
    if (missed > 0) {
      this.note = { text: `${done.size ? what + '. ' : ''}Couldn’t update ${plural(missed, 'file')}: ${error?.message ?? 'unknown error'}`, tone: 'error' };
    } else if (done.size && this.loc.tab === 'files') {
      // GitHub's diff view doesn't know about API changes until it reloads.
      if (!hasUnsavedText()) {
        // github.com's sessionStorage is shared with the page, so store facts, not display text.
        sessionStorage.setItem(FLASH_KEY, JSON.stringify({ key: this.key, count: done.size, viewed, auto }));
        location.reload();
        return;
      }
      this.note = { text: `${what}. Reload to collapse them (you have unsaved text, so TrueDiff didn’t reload).`, tone: 'ok', offerReload: true };
    } else if (done.size) {
      this.note = { text: `${what}.`, tone: 'ok' };
    }
    this.render();
  }

  private consumeFlash(): void {
    const raw = sessionStorage.getItem(FLASH_KEY);
    if (!raw) return;
    sessionStorage.removeItem(FLASH_KEY);
    try {
      const flash = JSON.parse(raw) as { key?: unknown; count?: unknown; viewed?: unknown; auto?: unknown };
      const { count } = flash;
      if (flash.key === this.key && typeof count === 'number' && Number.isInteger(count) && count > 0 && count <= 10000) {
        const what = doneText(count, flash.viewed !== false);
        const text = flash.auto === true ? `Auto-${what.toLowerCase()}.` : `${what}.`;
        this.note = { text, tone: 'ok' };
        setTimeout(() => {
          if (this.note?.text === text) {
            this.note = null;
            this.render();
          }
        }, 8000);
      }
    } catch {
      /* ignore */
    }
  }

  /** When you click GitHub's own "Viewed" toggle, refresh our counts. */
  private watchGithubViewedClicks(e: MouseEvent): void {
    const target = e.target as Element | null;
    if (!target || this.root.contains(target) || this.state.kind !== 'ready') return;
    const control = target.closest('button, label, input[type="checkbox"]');
    if (!control) return;
    const text = `${control.textContent ?? ''} ${control.getAttribute('aria-label') ?? ''} ${control.getAttribute('name') ?? ''}`;
    if (/viewed/i.test(text)) this.refreshSoon();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  private render(): void {
    if (this.disposed) return;
    const details = this.root.querySelector('details');
    if (details) this.panelOpen = details.open;
    this.root.replaceChildren(...this.renderBody());
  }

  private renderBody(): Node[] {
    const brand = h('span', { className: 'td-brand', title: 'TrueDiff: the real size of this PR, without tests and other noise' }, icon('filter'), 'TrueDiff');
    const s = this.state;

    if (s.kind === 'no-token') {
      return [
        brand,
        h('span', { className: 'td-muted' }, 'Add a GitHub token to see the real size of this PR, without the tests.'),
        h('span', { className: 'td-spacer' }),
        h('button', { className: 'td-btn td-btn-primary', type: 'button', onClick: userClick(() => void send({ type: 'open-options' })) }, 'Set up TrueDiff'),
      ];
    }
    if (s.kind === 'loading') {
      return [brand, h('span', { className: 'td-muted' }, 'Counting the real changes…')];
    }
    if (s.kind === 'error') return [brand, ...this.renderError(s.error)];

    const { summary } = s;
    const nodes: Node[] = [brand];

    nodes.push(
      h(
        'span',
        { className: 'td-group', title: `The code you actually need to review. GitHub’s total: ${plural(summary.total.files, 'file')}, +${formatCount(summary.total.additions)} −${formatCount(summary.total.deletions)}` },
        h('span', { className: `td-size td-size-${summary.size}` }, summary.size),
        h('span', { className: 'td-label' }, 'Real change'),
        h('span', { className: 'td-add' }, `+${formatCount(summary.real.additions)}`),
        h('span', { className: 'td-del' }, `−${formatCount(summary.real.deletions)}`),
        h('span', { className: 'td-muted' }, `in ${plural(summary.real.files, 'file')}`),
      ),
    );

    const { files, changedFiles } = s.details;
    if (files.length < changedFiles) {
      nodes.push(h('span', { className: 'td-muted', title: 'GitHub’s API lists at most 3,000 files per pull request.' }, `(first ${formatCount(files.length)} of ${formatCount(changedFiles)} files)`));
    }

    if (summary.noise.files === 0) {
      nodes.push(h('span', { className: 'td-sep' }), h('span', { className: 'td-muted' }, 'No tests or other noise in this PR'));
    } else {
      nodes.push(h('span', { className: 'td-sep' }), this.renderNoiseDropdown(summary));
    }

    nodes.push(h('span', { className: 'td-spacer' }));
    nodes.push(this.renderActions(summary));
    return nodes;
  }

  private renderNoiseDropdown(summary: PrSummary): HTMLElement {
    const kinds = KIND_ORDER.filter((k) => summary.byKind[k]);
    const kindText = kinds.map((k) => `${CATEGORY_LABELS[k]} ${summary.byKind[k]!.files}`).join(', ');
    const viewed = summary.noiseFiles.filter((f) => f.viewerViewedState === 'VIEWED');

    const panel = h('div', { className: 'td-panel', role: 'dialog', 'aria-label': 'Noise files' });
    for (const kind of kinds) {
      const files = summary.noiseFiles.filter((f) => f.kind === kind);
      const t = summary.byKind[kind]!;
      panel.append(
        h('h4', {}, h('span', {}, `${CATEGORY_LABELS[kind]} · ${plural(t.files, 'file')}`), h('span', { className: 'td-num' }, `+${formatCount(t.additions)} −${formatCount(t.deletions)}`)),
        h(
          'ul',
          {},
          ...files.map((f) =>
            h(
              'li',
              { title: f.path },
              h(
                'span',
                { className: 'td-state', title: stateTitle(f.viewerViewedState) },
                f.viewerViewedState === 'VIEWED' ? icon('check') : f.viewerViewedState === 'DISMISSED' ? '•' : '',
              ),
              h('span', { className: 'td-path' }, h('bdi', { dir: 'ltr' }, f.path)),
              h('span', { className: 'td-add' }, `+${formatCount(f.additions)}`),
              h('span', { className: 'td-del' }, `−${formatCount(f.deletions)}`),
            ),
          ),
        ),
      );
    }
    panel.append(
      h(
        'div',
        { className: 'td-panel-foot' },
        viewed.length
          ? h('button', { className: 'td-link', type: 'button', onClick: userClick(() => void this.setViewed(viewed, false)) }, `Unmark ${plural(viewed.length, 'file')}`)
          : null,
        h('button', { className: 'td-link', type: 'button', onClick: userClick(() => void send({ type: 'open-options' })) }, 'Change what counts as noise'),
      ),
    );

    return h(
      'details',
      { className: 'td-details', open: this.panelOpen },
      h(
        'summary',
        { title: `${kindText}. Click to see the files.` },
        h('span', { className: 'td-label' }, 'Tests & noise'),
        h('span', { className: 'td-add' }, `+${formatCount(summary.noise.additions)}`),
        h('span', { className: 'td-del' }, `−${formatCount(summary.noise.deletions)}`),
        h('span', { className: 'td-muted' }, `in ${plural(summary.noise.files, 'file')}`),
        icon('triangleDown', 'td-caret'),
      ),
      panel,
    );
  }

  private renderActions(summary: PrSummary): HTMLElement {
    const actions = h('span', { className: 'td-actions' });
    if (this.note) {
      actions.append(h('span', { className: this.note.tone === 'error' ? 'td-error' : 'td-flash' }, this.note.text));
      if (this.note.offerReload) actions.append(h('button', { className: 'td-btn', type: 'button', onClick: () => location.reload() }, 'Reload'));
    }
    if (summary.noise.files === 0) return actions;

    if (this.busy) {
      actions.append(h('button', { className: 'td-btn td-btn-primary', type: 'button', disabled: true }, this.busy));
    } else if (summary.noiseToMark.length) {
      const n = summary.noiseToMark.length;
      const changed = summary.noiseToMark.filter((f) => f.viewerViewedState === 'DISMISSED').length;
      actions.append(
        h(
          'button',
          {
            className: 'td-btn td-btn-primary',
            type: 'button',
            title: changed ? `${plural(changed, 'file')} changed since you last viewed ${changed === 1 ? 'it' : 'them'}` : 'Marks these files as viewed on GitHub so you’re left with the real changes',
            onClick: userClick(() => void this.setViewed(summary.noiseToMark, true)),
          },
          icon('eye'),
          `Mark ${plural(n, 'noise file')} viewed`,
        ),
      );
    } else if (!this.note) {
      actions.append(h('span', { className: 'td-done' }, icon('check'), 'All noise viewed'));
    }
    return actions;
  }

  private renderError(error: ApiErrorInfo): Node[] {
    const retry = h('button', { className: 'td-btn', type: 'button', onClick: () => { this.state = { kind: 'loading' }; this.render(); void this.refresh(); } }, 'Retry');
    const settings = h('button', { className: 'td-btn', type: 'button', onClick: userClick(() => void send({ type: 'open-options' })) }, 'Settings');
    let text = error.message;
    const extra: Node[] = [];
    switch (error.code) {
      case 'SSO':
        text = `Your token isn’t authorized for ${this.loc.owner}’s single sign-on.`;
        if (error.url) extra.push(h('a', { className: 'td-btn td-btn-primary', href: error.url, target: '_blank', rel: 'noopener' }, 'Authorize token'));
        else extra.push(h('a', { className: 'td-btn td-btn-primary', href: 'https://github.com/settings/tokens', target: '_blank', rel: 'noopener' }, 'Configure SSO for the token'));
        break;
      case 'NOT_FOUND':
        text = `Your token can’t see ${this.loc.owner}/${this.loc.repo}. A fine-grained token needs this repo (or all of ${this.loc.owner}’s repos) selected.`;
        break;
      case 'BAD_TOKEN':
        text = 'GitHub rejected your token. It may have expired.';
        break;
    }
    return [h('span', { className: 'td-error' }, text), h('span', { className: 'td-spacer' }), h('span', { className: 'td-actions' }, ...extra, settings, retry)];
  }
}

function doneText(count: number, viewed: boolean): string {
  return `${viewed ? 'Marked' : 'Unmarked'} ${plural(count, 'noise file')} as ${viewed ? 'viewed' : 'not viewed'}`;
}

function stateTitle(state: ViewedState | undefined): string {
  if (state === 'VIEWED') return 'Viewed';
  if (state === 'DISMISSED') return 'Changed since you viewed it';
  return 'Not viewed';
}

/** Where the strip goes: right under the PR header/tabs, in both the new and classic GitHub UIs. */
function findAnchor(): { el: Element; where: InsertPosition } | null {
  // New React UI (2025+): <nav aria-label="Pull request navigation"> inside a Primer PageHeader.
  const nav = document.querySelector('nav[aria-label="Pull request navigation"]');
  if (nav) return { el: nav.closest('[data-component="PageHeader"]') ?? nav, where: 'afterend' };
  // Classic UI (still used for "Files changed" when you opt out of the new view, and when logged out):
  // <nav class="tabnav-tabs" aria-label="Pull request tabs"> in a wrapper row that also holds the diffstat.
  const classic =
    document.querySelector('nav[aria-label="Pull request tabs"]') ??
    document.querySelector('a.tabnav-tab[href*="/pull/"][href$="/commits"]')?.closest('nav');
  if (classic) return { el: classic.closest('.tabnav') ?? classic.parentElement ?? classic, where: 'afterend' };
  return null;
}
