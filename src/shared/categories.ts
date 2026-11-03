import { compileGlobs, type PathMatcher } from './glob';

export type CategoryId = 'tests' | 'lockfiles' | 'snapshots' | 'generated' | 'migrations';
export type NoiseKind = CategoryId | 'custom';

export interface Category {
  id: CategoryId;
  label: string;
  description: string;
  defaultEnabled: boolean;
  patterns: readonly string[];
}

/**
 * Built-in noise categories. Order matters: a file is reported under the first
 * enabled category that matches it, so the more specific ones come first
 * (tests/__snapshots__/x.snap shows up as "Snapshots & fixtures", not "Tests").
 *
 * Avoid bare substrings like "*test*": plenty of real product code has "contest",
 * "latest", "attestation" or "test cases" in its paths.
 */
export const CATEGORIES: readonly Category[] = [
  {
    id: 'lockfiles',
    label: 'Lockfiles',
    description: 'package-lock.json, yarn.lock, poetry.lock and friends',
    defaultEnabled: true,
    patterns: [
      'package-lock.json',
      'npm-shrinkwrap.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'bun.lock',
      'bun.lockb',
      'poetry.lock',
      'Pipfile.lock',
      'uv.lock',
      'pdm.lock',
      'Gemfile.lock',
      'composer.lock',
      'Cargo.lock',
      'go.sum',
      'Podfile.lock',
      'Package.resolved',
      'pubspec.lock',
      'mix.lock',
      'flake.lock',
      'packages.lock.json',
      'gradle.lockfile',
    ],
  },
  {
    id: 'generated',
    label: 'Generated / build output',
    description: 'Minified files, source maps, codegen output, dist/',
    defaultEnabled: true,
    patterns: [
      '*.min.js',
      '*.min.css',
      '*.js.map',
      '*.css.map',
      '*.generated.*',
      '*.gen.*',
      '*_pb2.py',
      '*_pb2.pyi',
      '*_pb2_grpc.py',
      '*.pb.go',
      '*.g.dart',
      '*.freezed.dart',
      'generated/',
      '__generated__/',
      'dist/',
    ],
  },
  {
    id: 'snapshots',
    label: 'Snapshots & fixtures',
    description: '__snapshots__/, *.snap, fixtures/, __mocks__/',
    defaultEnabled: true,
    patterns: ['__snapshots__/', '*.snap', 'fixtures/', '__fixtures__/', '__mocks__/', 'cassettes/'],
  },
  {
    id: 'migrations',
    label: 'Database migrations',
    description: 'Django/Prisma migrations/, Alembic versions/, Rails db/migrate/. Off by default: migrations are often worth a look.',
    defaultEnabled: false,
    patterns: ['migrations/', 'alembic/versions/', 'db/migrate/'],
  },
  {
    id: 'tests',
    label: 'Tests',
    description: 'tests/, __tests__/, *.test.*, *.spec.*, test_*.py, *_test.go, e2e/, cypress/ and test config',
    defaultEnabled: true,
    patterns: [
      // Directories
      'test/',
      'tests/',
      'Tests/',
      '__tests__/',
      'e2e/',
      'cypress/',
      'testdata/',
      'androidTest/',
      // JS / TS
      '*.test.*',
      // Not plain "*.spec.*": api.spec.yaml / openapi_spec.json are real API specs.
      '*.spec.{js,jsx,ts,tsx,mjs,cjs,mts,cts,vue,svelte}',
      '*.test-d.ts',
      'setupTests.*',
      '{jest,vitest,playwright,cypress,karma}.config.*',
      '{jest,vitest}.setup.*',
      // Python
      'test_*.py',
      '*_test.py',
      'conftest.py',
      'pytest.ini',
      // Go, Elixir, C/C++, Dart... (foo_test.go, foo_test.exs, foo_test.cc). Code extensions only:
      // Templates like eligibility_test.html are often real product pages.
      '*_test.{go,rb,exs,cc,cpp,c,rs,dart,js,jsx,ts,tsx,mjs,cjs,kt,java,swift,php,scala}',
      // RSpec and friends
      '*_spec.{rb,js,ts,exs,cr,lua}',
      // JVM, .NET, Swift, PHP
      '*{Test,Tests,IT}.{java,kt,scala,cs,swift,php}',
    ],
  },
];

export const CATEGORY_LABELS: Record<NoiseKind, string> = {
  ...(Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])) as Record<CategoryId, string>),
  custom: 'Your patterns',
};

export interface ClassifierConfig {
  enabled: Record<CategoryId, boolean>;
  customNoise: readonly string[];
  alwaysReview: readonly string[];
}

export type Classifier = (path: string) => NoiseKind | null;

/** Builds a function that returns the noise kind of a path, or null for real code. */
export function createClassifier(config: ClassifierConfig): Classifier {
  const alwaysReview = compileGlobs(config.alwaysReview);
  const active: Array<[NoiseKind, PathMatcher]> = CATEGORIES.filter((c) => config.enabled[c.id]).map((c) => [
    c.id,
    compileGlobs(c.patterns),
  ]);
  if (config.customNoise.length) active.push(['custom', compileGlobs(config.customNoise)]);

  return (path) => {
    if (alwaysReview(path)) return null;
    for (const [kind, matches] of active) if (matches(path)) return kind;
    return null;
  };
}
