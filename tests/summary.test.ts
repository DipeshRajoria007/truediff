import { describe, expect, it } from 'vitest';
import { createClassifier } from '../src/shared/categories';
import { parsePrLink, parsePrPath, prKey } from '../src/shared/github-url';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { formatCompact, sizeLabel, summarize, type PrFile } from '../src/shared/summary';

// A typical backend PR: 17 files of code, 12 files of tests.
const TYPICAL_PR: PrFile[] = [
  ['orders/serializers.py', 6, 2],
  ['invoices/serializers.py', 8, 3],
  ['common/error_codes.py', 25, 0],
  ['common/integrations/payments/payments_client.py', 40, 4],
  ['subscriptions/serializers.py', 6, 2],
  ['app/settings.py', 3, 0],
  ['audit_logs/models.py', 8, 3],
  ['audit_logs/serializers.py', 15, 10],
  ['audit_logs/tests/test_permission_validation.py', 75, 0],
  ['audit_logs/utils.py', 33, 0],
  ['accounts/admin_views.py', 12, 3],
  ['accounts/tests/test_listing_token.py', 150, 0],
  ['partners/serializers.py', 7, 7],
  ['media/config.py', 19, 0],
  ['media/migrations/0022_alter_mediafile_type.py', 18, 0],
  ['media/tests/media_test_utils.py', 93, 0],
  ['media/tests/test_clip_forms_db.py', 217, 0],
  ['media/tests/test_error_codes.py', 28, 0],
  ['media/tests/test_forms.py', 272, 0],
  ['media/tests/test_reissue.py', 164, 0],
  ['media/tests/test_payments_client.py', 101, 0],
  ['media/tests/test_legacy_routes.py', 76, 0],
  ['media/tests/test_report_permissions_db.py', 295, 0],
  ['media/tests/test_report_permissions_field.py', 157, 0],
  ['media/tests/test_type_choices.py', 20, 0],
  ['media/throttles.py', 5, 0],
  ['media/urls.py', 3, 0],
  ['media/utils.py', 57, 3],
  ['media/views.py', 142, 6],
].map(([path, additions, deletions]) => ({ path: path as string, additions: additions as number, deletions: deletions as number, viewerViewedState: 'UNVIEWED' }));

describe('summarize', () => {
  const classify = createClassifier(DEFAULT_SETTINGS);

  it('splits a typical PR into real code and tests', () => {
    const s = summarize(TYPICAL_PR, classify);
    expect(s.total).toEqual({ files: 29, additions: 2055, deletions: 43 });
    expect(s.real).toEqual({ files: 17, additions: 407, deletions: 43 });
    expect(s.noise).toEqual({ files: 12, additions: 1648, deletions: 0 });
    expect(s.byKind).toEqual({ tests: { files: 12, additions: 1648, deletions: 0 } });
    expect(s.noiseToMark).toHaveLength(12);
    expect(s.size).toBe('L');
  });

  it('only asks to mark files that are unviewed or changed since viewing', () => {
    const files: PrFile[] = [
      { path: 'tests/a.py', additions: 1, deletions: 0, viewerViewedState: 'VIEWED' },
      { path: 'tests/b.py', additions: 1, deletions: 0, viewerViewedState: 'DISMISSED' },
      { path: 'tests/c.py', additions: 1, deletions: 0, viewerViewedState: 'UNVIEWED' },
      { path: 'src/d.py', additions: 1, deletions: 0, viewerViewedState: 'UNVIEWED' },
    ];
    expect(summarize(files, classify).noiseToMark.map((f) => f.path)).toEqual(['tests/b.py', 'tests/c.py']);
  });

  it('never asks to mark anything when viewed state is unknown (list pages)', () => {
    const s = summarize([{ path: 'tests/a.py', additions: 5, deletions: 0 }], classify);
    expect(s.noise.files).toBe(1);
    expect(s.noiseToMark).toEqual([]);
  });

  it('handles an empty PR', () => {
    const s = summarize([], classify);
    expect(s.real).toEqual({ files: 0, additions: 0, deletions: 0 });
    expect(s.size).toBe('XS');
  });
});

describe('formatting', () => {
  it('labels sizes by real changed lines', () => {
    expect([0, 10, 11, 100, 101, 400, 401, 1000, 1001].map(sizeLabel)).toEqual(['XS', 'XS', 'S', 'S', 'M', 'M', 'L', 'L', 'XL']);
  });
  it('compacts big numbers', () => {
    expect([0, 999, 1000, 1648, 9999, 12345].map(formatCompact)).toEqual(['0', '999', '1k', '1.6k', '10k', '12k']);
  });
});

describe('GitHub URLs', () => {
  it('parses PR pages and tabs', () => {
    expect(parsePrPath('/octo-org/octo-repo/pull/6541')).toEqual({ owner: 'octo-org', repo: 'octo-repo', number: 6541, tab: 'conversation' });
    expect(parsePrPath('/o/r/pull/1/files')?.tab).toBe('files');
    expect(parsePrPath('/o/r/pull/1/changes')?.tab).toBe('files');
    expect(parsePrPath('/o/r/pull/1/commits')?.tab).toBe('commits');
    expect(parsePrPath('/o/r/pull/1/checks')?.tab).toBe('checks');
    expect(parsePrPath('/o/r/pulls')).toBeNull();
    expect(parsePrPath('/o/r/issues/1')).toBeNull();
  });

  it('parses only plain PR links', () => {
    expect(parsePrLink('https://github.com/o/r/pull/12')).toEqual({ owner: 'o', repo: 'r', number: 12 });
    expect(parsePrLink('/o/r/pull/12')).toEqual({ owner: 'o', repo: 'r', number: 12 });
    expect(parsePrLink('https://github.com/o/r/pull/12/files')).toBeNull();
    expect(parsePrLink('https://example.com/o/r/pull/12')).toBeNull();
    expect(parsePrLink('https://github.com/o/r/issues/12')).toBeNull();
  });

  it('builds case-insensitive keys', () => {
    expect(prKey({ owner: 'Octo-Org', repo: 'Octo-Repo', number: 1 })).toBe('octo-org/octo-repo#1');
  });
});
