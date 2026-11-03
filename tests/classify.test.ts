import { describe, expect, it } from 'vitest';
import { createClassifier, type ClassifierConfig } from '../src/shared/categories';
import { compileGlob } from '../src/shared/glob';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings';

const match = (pattern: string, path: string) => compileGlob(pattern)!(path);

describe('compileGlob', () => {
  it('matches basenames anywhere when the pattern has no slash', () => {
    expect(match('*.test.*', 'src/a/b.test.js')).toBe(true);
    expect(match('*.test.*', 'b.test.ts')).toBe(true);
    expect(match('*.test.*', 'src/test.js')).toBe(false);
    expect(match('conftest.py', 'a/b/conftest.py')).toBe(true);
    expect(match('conftest.py', 'a/b/myconftest.py')).toBe(false);
  });

  it('treats a trailing slash as "anything inside a folder with this name"', () => {
    expect(match('tests/', 'media/tests/test_forms.py')).toBe(true);
    expect(match('tests/', 'tests/components/x.test.js')).toBe(true);
    expect(match('tests/', 'src/tests.js')).toBe(false);
    expect(match('tests/', 'src/contests/views.py')).toBe(false);
    expect(match('alembic/versions/', 'alembic/versions/0001_schema.py')).toBe(true);
  });

  it('anchors to the repo root with a leading slash', () => {
    expect(match('/scripts/', 'scripts/a.sh')).toBe(true);
    expect(match('/scripts/', 'common/scripts/a.sh')).toBe(false);
  });

  it('supports *, **, ?, {a,b} and [a-z]', () => {
    expect(match('src/*/x.js', 'src/a/x.js')).toBe(true);
    expect(match('src/*/x.js', 'src/a/b/x.js')).toBe(false);
    expect(match('src/**/x.js', 'src/a/b/x.js')).toBe(true);
    expect(match('src/**/x.js', 'src/x.js')).toBe(true);
    expect(match('file?.txt', 'file1.txt')).toBe(true);
    expect(match('*.{js,ts}', 'a/b.ts')).toBe(true);
    expect(match('*.{js,ts}', 'a/b.py')).toBe(false);
    expect(match('[0-9]*.py', 'migrations/0001_init.py')).toBe(true);
    expect(match('[0-9]*.py', 'migrations/__init__.py')).toBe(false);
  });

  it('is case-sensitive and escapes regex characters', () => {
    expect(match('*Test.java', 'src/FooTest.java')).toBe(true);
    expect(match('*Test.java', 'src/Latest.java')).toBe(false);
    expect(match('a+b.txt', 'a+b.txt')).toBe(true);
    expect(match('a+b.txt', 'aab.txt')).toBe(false);
    expect(match('(x).js', '(x).js')).toBe(true);
  });

  it('ignores blanks, comments and broken patterns', () => {
    expect(compileGlob('')).toBeNull();
    expect(compileGlob('   ')).toBeNull();
    expect(compileGlob('# comment')).toBeNull();
    expect(compileGlob('/')).toBeNull();
    expect(() => compileGlob('[')).not.toThrow();
    expect(() => compileGlob('{a,b')).not.toThrow();
  });
});

describe('default classifier on common paths', () => {
  const classify = createClassifier(DEFAULT_SETTINGS);

  it.each([
    ['media/tests/test_forms.py', 'tests'],
    ['media/tests/media_test_utils.py', 'tests'],
    ['audit_logs/tests/test_permission_validation.py', 'tests'],
    ['tests/components/Checkout/paymentModes.test.js', 'tests'],
    ['src/components/forms/date-of-birth.test.mjs', 'tests'],
    ['jest.config.js', 'tests'],
    ['pkg/server/handler_test.go', 'tests'],
    ['app/src/test/java/com/x/FooTest.java', 'tests'],
    ['spec/models/user_spec.rb', 'tests'],
    ['web/src/app.spec.ts', 'tests'],
    ['package-lock.json', 'lockfiles'],
    ['uv.lock', 'lockfiles'],
    ['bun.lock', 'lockfiles'],
    ['src/routeTree.gen.ts', 'generated'],
    ['static/admin/js/vendor/jquery/jquery.min.js', 'generated'],
    ['src/components/forms/__fixtures__/multistep-events.json', 'snapshots'],
    ['src/__tests__/__snapshots__/App.test.js.snap', 'snapshots'],
  ])('%s is noise (%s)', (path, kind) => {
    expect(classify(path)).toBe(kind);
  });

  it.each([
    // Product code is full of "contest", "latest" and "test case" paths. None of these are tests.
    'contests/views.py',
    'src/containers/Contest/index.js',
    'src/components/editor/test-cases-table.js',
    'src/features/code-runner/components/test-cases.js',
    'src/features/exam/sections/test-day.tsx',
    'pages/course/[courseId]/placement-test.js',
    'app/templates/admissions/eligibility_test.html',
    'docs/api.spec.yaml',
    'openapi_spec.json',
    'attestation/views.py',
    'src/utils/latest.ts',
    // Migrations are real code by default.
    'audit_logs/migrations/0035_add_attestation.py',
    'alembic/versions/0001_schema_v0.py',
  ])('%s is real code', (path) => {
    expect(classify(path)).toBeNull();
  });
});

describe('classifier configuration', () => {
  const base: ClassifierConfig = { ...DEFAULT_SETTINGS };

  it('respects disabled categories', () => {
    const classify = createClassifier({ ...base, enabled: { ...base.enabled, tests: false } });
    expect(classify('media/tests/test_a.py')).toBeNull();
    expect(classify('package-lock.json')).toBe('lockfiles');
  });

  it('enables migrations when asked', () => {
    const classify = createClassifier({ ...base, enabled: { ...base.enabled, migrations: true } });
    expect(classify('audit_logs/migrations/0035_add_attestation.py')).toBe('migrations');
    expect(classify('alembic/versions/0001_schema_v0.py')).toBe('migrations');
    expect(classify('db/migrate/20240101_add_users.rb')).toBe('migrations');
  });

  it('adds custom noise patterns', () => {
    const classify = createClassifier({ ...base, customNoise: ['# synthetic checks', 'smoke_checks/suites/'] });
    expect(classify('smoke_checks/suites/login/login_with_wrong_otp.py')).toBe('custom');
  });

  it('lets "always review" win over every category', () => {
    const classify = createClassifier({ ...base, alwaysReview: ['grading/test_case_validation.py'] });
    expect(classify('app/grading/test_case_validation.py')).toBeNull();
    expect(classify('assignments/tests/test_other.py')).toBe('tests');
  });

  it('reports the most specific category first', () => {
    const classify = createClassifier(base);
    expect(classify('tests/fixtures/data.json')).toBe('snapshots');
  });
});

describe('normalizeSettings', () => {
  it('fills defaults for missing or junk values', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    const s = normalizeSettings({ enabled: { tests: false }, customNoise: ['a/', 3, null], autoMarkOnOpen: 'yes' });
    expect(s.enabled.tests).toBe(false);
    expect(s.enabled.lockfiles).toBe(true);
    expect(s.enabled.migrations).toBe(false);
    expect(s.customNoise).toEqual(['a/']);
    expect(s.autoMarkOnOpen).toBe(false);
  });
});
