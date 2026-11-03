import { CATEGORIES, CATEGORY_LABELS, createClassifier } from '../shared/categories';
import { RequestError, send } from '../shared/messages';
import { DEFAULT_SETTINGS, loadSettings, loadToken, saveSettings, saveToken, type Settings } from '../shared/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let settings: Settings;

function flashSaved(text = 'Saved'): void {
  const el = $('saved');
  el.textContent = `✓ ${text}`;
  clearTimeout((flashSaved as { t?: number }).t);
  (flashSaved as { t?: number }).t = window.setTimeout(() => (el.textContent = ''), 1800);
}

async function persist(): Promise<void> {
  await saveSettings(settings);
  flashSaved();
  updateTester();
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

function setStatus(text: string, tone: 'ok' | 'error' | 'warn' | '' = ''): void {
  const el = $('token-status');
  el.textContent = text;
  el.className = `status ${tone}`;
}

/** Classic-token scopes TrueDiff needs. Anything else on the token is power it never uses. */
const NEEDED_SCOPES = new Set(['repo']);

/** Tests a newly pasted token, or (with no argument) the one already saved. */
async function testToken(token?: string): Promise<void> {
  setStatus('Checking…');
  try {
    const info = await send(token ? { type: 'check-token', token } : { type: 'check-token' });
    if (info.scopes && !info.scopes.includes('repo')) {
      setStatus(`Signed in as ${info.login}, but this classic token has no “repo” scope, so private repos won’t load.`, 'warn');
    } else if (info.scopes && info.scopes.some((s) => !NEEDED_SCOPES.has(s))) {
      const extra = info.scopes.filter((s) => !NEEDED_SCOPES.has(s));
      setStatus(
        `✓ Connected as ${info.login}. This token can also do things TrueDiff never needs (${extra.join(', ')}). ` +
          'If it ever leaked, all of that would be exposed: consider a fine-grained token, or a classic one with only “repo”.',
        'warn',
      );
    } else {
      setStatus(`✓ Connected as ${info.login}. Open any pull request to see its real size.`, 'ok');
    }
  } catch (e) {
    setStatus(e instanceof RequestError ? e.info.message : String(e), 'error');
  }
}

function showSaved(token: string): void {
  // Never put the saved token back on screen; the last 4 characters are enough to recognise it.
  const input = $<HTMLInputElement>('token');
  input.value = '';
  input.placeholder = token ? `Saved token ending in …${token.slice(-4)}. Paste a new one to replace it.` : 'ghp_… or github_pat_…';
}

async function initToken(): Promise<void> {
  const input = $<HTMLInputElement>('token');
  const saved = await loadToken();
  showSaved(saved);
  if (saved) {
    void testToken();
  } else {
    $<HTMLDetailsElement>('token-howto').open = true;
    setStatus('No token yet. TrueDiff can’t do anything until you add one.', 'warn');
  }

  $('token-save').addEventListener('click', async () => {
    const token = input.value.trim();
    if (!token) return (await loadToken()) ? void testToken() : setStatus('Paste a token first.', 'error');
    if (!/^[\x21-\x7e]+$/.test(token)) return setStatus('That doesn’t look like a GitHub token (it has spaces or unusual characters).', 'error');
    await saveToken(token);
    showSaved(token);
    flashSaved('Token saved');
    await testToken();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('token-save').click();
  });
  $('token-clear').addEventListener('click', async () => {
    await saveToken('');
    showSaved('');
    setStatus('Token removed from this computer. To revoke it for good, delete it on GitHub’s token settings page.', 'warn');
  });
}

// ---------------------------------------------------------------------------
// Categories & patterns
// ---------------------------------------------------------------------------

function renderCategories(): void {
  const wrap = $('categories');
  wrap.replaceChildren();
  for (const c of CATEGORIES) {
    const label = document.createElement('label');
    label.className = 'check category';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = settings.enabled[c.id];
    box.addEventListener('change', () => {
      settings.enabled[c.id] = box.checked;
      void persist();
    });

    const text = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'label';
    title.textContent = c.label;
    if (!c.defaultEnabled) {
      const off = document.createElement('span');
      off.className = 'badge-default';
      off.textContent = 'off by default';
      title.append(off);
    }
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = c.description;

    const list = document.createElement('details');
    list.className = 'patterns-list';
    const sum = document.createElement('summary');
    sum.textContent = `${c.patterns.length} patterns`;
    const codes = document.createElement('div');
    for (const p of c.patterns) {
      const code = document.createElement('code');
      code.textContent = p;
      codes.append(code);
    }
    list.append(sum, codes);
    // Clicking the patterns toggle shouldn't toggle the checkbox.
    list.addEventListener('click', (e) => e.stopPropagation());

    text.append(title, hint, list);
    label.append(box, text);
    wrap.append(label);
  }
}

function bindTextarea(id: string, key: 'customNoise' | 'alwaysReview'): void {
  const ta = $<HTMLTextAreaElement>(id);
  ta.value = settings[key].join('\n');
  let t: number | undefined;
  ta.addEventListener('input', () => {
    clearTimeout(t);
    t = window.setTimeout(() => {
      // Keep comment lines so people can annotate their patterns; the matcher skips them.
      settings[key] = ta.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      void persist();
    }, 400);
  });
}

function updateTester(): void {
  const path = $<HTMLInputElement>('test-path').value.trim().replace(/^\/+/, '');
  const out = $('test-result');
  if (!path) {
    out.textContent = '';
    return;
  }
  const kind = createClassifier(settings)(path);
  out.textContent = kind ? `Noise: ${CATEGORY_LABELS[kind]}` : 'Real change';
  out.className = `pill ${kind ? 'noise' : 'real'}`;
}

// ---------------------------------------------------------------------------

function bindToggle(id: string, key: 'autoMarkOnOpen' | 'showListBadges'): void {
  const box = $<HTMLInputElement>(id);
  box.checked = settings[key];
  box.addEventListener('change', () => {
    settings[key] = box.checked;
    void persist();
  });
}

async function main(): Promise<void> {
  settings = await loadSettings();
  await initToken();
  renderCategories();
  bindTextarea('custom-noise', 'customNoise');
  bindTextarea('always-review', 'alwaysReview');
  bindToggle('auto-mark', 'autoMarkOnOpen');
  bindToggle('list-badges', 'showListBadges');
  $('test-path').addEventListener('input', updateTester);

  $('reset').addEventListener('click', async () => {
    settings = {
      ...settings,
      enabled: { ...DEFAULT_SETTINGS.enabled },
      customNoise: [],
      alwaysReview: [],
    };
    renderCategories();
    $<HTMLTextAreaElement>('custom-noise').value = '';
    $<HTMLTextAreaElement>('always-review').value = '';
    await persist();
    flashSaved('Noise settings reset');
  });
}

void main();
