import { CATEGORIES, type CategoryId, type ClassifierConfig } from './categories';

export interface Settings extends ClassifierConfig {
  /** Mark noise files viewed automatically when you open a PR's "Files changed" tab. */
  autoMarkOnOpen: boolean;
  /** Show the real size next to PRs in pull request lists. */
  showListBadges: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: Object.fromEntries(CATEGORIES.map((c) => [c.id, c.defaultEnabled])) as Record<CategoryId, boolean>,
  customNoise: [],
  alwaysReview: [],
  autoMarkOnOpen: false,
  showListBadges: true,
};

const SETTINGS_KEY = 'settings';
// The token lives in storage.local, never storage.sync, so it stays on this machine.
const TOKEN_KEY = 'githubToken';

/**
 * Chrome lets content scripts (our code running inside github.com tabs) read storage.local by
 * default. Locking it to trusted contexts (the background worker and the settings page) means the
 * token never enters a github.com tab, and those tabs don't even get change events for it.
 * Called by the background worker on every start and by the settings page before saving a token.
 */
export async function restrictTokenStorage(): Promise<void> {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch {
    // Very old Chrome without setAccessLevel: content scripts still never ask for the token.
  }
}

/** Fills in anything missing (new categories added in later versions, etc.). */
export function normalizeSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    enabled: { ...DEFAULT_SETTINGS.enabled, ...(s.enabled ?? {}) },
    customNoise: strings(s.customNoise),
    alwaysReview: strings(s.alwaysReview),
    autoMarkOnOpen: typeof s.autoMarkOnOpen === 'boolean' ? s.autoMarkOnOpen : DEFAULT_SETTINGS.autoMarkOnOpen,
    showListBadges: typeof s.showListBadges === 'boolean' ? s.showListBadges : DEFAULT_SETTINGS.showListBadges,
  };
}

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.sync.get(SETTINGS_KEY);
  return normalizeSettings(got[SETTINGS_KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
}

export async function loadToken(): Promise<string> {
  const got = await chrome.storage.local.get(TOKEN_KEY);
  const token = got[TOKEN_KEY];
  return typeof token === 'string' ? token : '';
}

export async function saveToken(token: string): Promise<void> {
  await restrictTokenStorage();
  if (token) await chrome.storage.local.set({ [TOKEN_KEY]: token });
  else await chrome.storage.local.remove(TOKEN_KEY);
}

export function onSettingsChanged(cb: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[SETTINGS_KEY]) cb(normalizeSettings(changes[SETTINGS_KEY].newValue));
  });
}

/** Background worker only: content scripts can't see storage.local. */
export function onTokenChanged(cb: () => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[TOKEN_KEY]) cb();
  });
}
