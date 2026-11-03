import { describe, expect, it } from 'vitest';
import { classifySender, parseRequest } from '../src/background/validate';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const pr = { owner: 'octo-org', repo: 'octo-repo', number: 6541 };

describe('classifySender', () => {
  it('recognises our settings page and our content script on github.com', () => {
    expect(classifySender({ id: ID, origin: `chrome-extension://${ID}`, url: `chrome-extension://${ID}/options.html` }, ID)).toBe('extension');
    expect(classifySender({ id: ID, origin: 'https://github.com', url: 'https://github.com/o/r/pull/1', tab: {} }, ID)).toBe('github');
    expect(classifySender({ id: ID, url: 'https://github.com/o/r/pull/1', tab: {} }, ID)).toBe('github'); // no origin field
  });

  it('rejects other extensions, other sites and look-alike hosts', () => {
    expect(classifySender({ id: 'someone-else', origin: 'https://github.com', tab: {} }, ID)).toBeNull();
    expect(classifySender({ id: ID, origin: 'https://gist.github.com', tab: {} }, ID)).toBeNull();
    expect(classifySender({ id: ID, origin: 'https://github.com.evil.example', tab: {} }, ID)).toBeNull();
    expect(classifySender({ id: ID, origin: 'http://github.com', tab: {} }, ID)).toBeNull();
    expect(classifySender({ id: ID, origin: 'chrome-extension://other', url: 'chrome-extension://other/x.html' }, ID)).toBeNull();
    expect(classifySender({ id: ID, origin: 'https://github.com' }, ID)).toBeNull(); // not from a tab
    expect(classifySender({ origin: 'https://github.com', tab: {} }, '')).toBeNull();
  });
});

describe('parseRequest', () => {
  it('only lets each sender ask for what it needs', () => {
    expect(parseRequest({ type: 'check-token', token: 'ghp_x' }, 'github')).toBeNull();
    expect(parseRequest({ type: 'check-token', token: 'ghp_x' }, 'extension')).toEqual({ type: 'check-token', token: 'ghp_x' });
    expect(parseRequest({ type: 'set-viewed', pr, prId: 'PR_1', paths: ['a'], viewed: true }, 'extension')).toBeNull();
    expect(parseRequest({ type: 'status' }, 'github')).toEqual({ type: 'status' });
    expect(parseRequest({ type: 'nope' }, 'github')).toBeNull();
    expect(parseRequest(null, 'github')).toBeNull();
    expect(parseRequest('status', 'github')).toBeNull();
  });

  it('rebuilds requests from known fields only', () => {
    expect(parseRequest({ type: 'pr-details', pr: { ...pr, tab: 'files', extra: 1 }, evil: true }, 'github')).toEqual({ type: 'pr-details', pr });
  });

  it('rejects malformed PR references', () => {
    const bad = [
      { ...pr, owner: '' },
      { ...pr, owner: '../x' },
      { ...pr, owner: 'a'.repeat(40) },
      { ...pr, repo: '..' },
      { ...pr, repo: 'a/b' },
      { ...pr, repo: 'a b' },
      { ...pr, number: 0 },
      { ...pr, number: 1.5 },
      { ...pr, number: '1' },
      { owner: 'o', repo: 'r' },
    ];
    for (const p of bad) expect(parseRequest({ type: 'pr-details', pr: p }, 'github')).toBeNull();
    expect(parseRequest({ type: 'pr-details', pr: { ...pr, owner: 'acme_emu', repo: 'a.b_c-d' } }, 'github')).not.toBeNull();
  });

  it('validates set-viewed', () => {
    const ok = { type: 'set-viewed', pr, prId: 'PR_kwDOAbC-1_x', paths: ['tests/a.py'], viewed: true };
    expect(parseRequest(ok, 'github')).toEqual(ok);
    expect(parseRequest({ ...ok, viewed: 'yes' }, 'github')).toBeNull();
    expect(parseRequest({ ...ok, prId: 'PR 1' }, 'github')).toBeNull();
    expect(parseRequest({ ...ok, paths: [] }, 'github')).toBeNull();
    expect(parseRequest({ ...ok, paths: [1] }, 'github')).toBeNull();
    expect(parseRequest({ ...ok, paths: [''] }, 'github')).toBeNull();
    expect(parseRequest({ ...ok, paths: 'tests/a.py' }, 'github')).toBeNull();
    expect(parseRequest({ ...ok, paths: Array(101).fill('a') }, 'github')).toBeNull();
  });

  it('validates pr-sizes and claim-auto-mark', () => {
    expect(parseRequest({ type: 'pr-sizes', prs: [pr, pr] }, 'github')).toEqual({ type: 'pr-sizes', prs: [pr, pr] });
    expect(parseRequest({ type: 'pr-sizes', prs: [pr, { owner: 'x' }] }, 'github')).toBeNull();
    expect(parseRequest({ type: 'pr-sizes', prs: Array(101).fill(pr) }, 'github')).toBeNull();
    const oid = 'a'.repeat(40);
    expect(parseRequest({ type: 'claim-auto-mark', pr, headOid: oid }, 'github')).toEqual({ type: 'claim-auto-mark', pr, headOid: oid });
    expect(parseRequest({ type: 'claim-auto-mark', pr, headOid: 'b'.repeat(64) }, 'github')).not.toBeNull();
    expect(parseRequest({ type: 'claim-auto-mark', pr, headOid: 'xyz' }, 'github')).toBeNull();
  });

  it('validates check-token', () => {
    expect(parseRequest({ type: 'check-token' }, 'extension')).toEqual({ type: 'check-token' });
    expect(parseRequest({ type: 'check-token', token: 5 }, 'extension')).toBeNull();
    expect(parseRequest({ type: 'check-token', token: 'x'.repeat(513) }, 'extension')).toBeNull();
    expect(parseRequest({ type: 'check-token', probe: { owner: 'o', repo: 'r' } }, 'extension')).toEqual({ type: 'check-token', probe: { owner: 'o', repo: 'r' } });
    expect(parseRequest({ type: 'check-token', probe: { owner: 'o', repo: '../x' } }, 'extension')).toBeNull();
  });
});
