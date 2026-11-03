import type { Classifier, NoiseKind } from './categories';

export type ViewedState = 'VIEWED' | 'UNVIEWED' | 'DISMISSED';

export interface PrFile {
  path: string;
  additions: number;
  deletions: number;
  /** Only known on the PR page query; list badges don't fetch it. */
  viewerViewedState?: ViewedState;
}

export interface Tally {
  files: number;
  additions: number;
  deletions: number;
}

export interface NoiseFile extends PrFile {
  kind: NoiseKind;
}

export interface PrSummary {
  total: Tally;
  real: Tally;
  noise: Tally;
  byKind: Partial<Record<NoiseKind, Tally>>;
  noiseFiles: NoiseFile[];
  /** Noise files you still have to mark (unviewed, or changed since you viewed them). */
  noiseToMark: NoiseFile[];
  size: SizeLabel;
}

export type SizeLabel = 'XS' | 'S' | 'M' | 'L' | 'XL';

const emptyTally = (): Tally => ({ files: 0, additions: 0, deletions: 0 });

function add(t: Tally, f: PrFile): void {
  t.files += 1;
  t.additions += f.additions;
  t.deletions += f.deletions;
}

/** Size of the code a reviewer actually has to read (additions + deletions of real files). */
export function sizeLabel(changedLines: number): SizeLabel {
  if (changedLines <= 10) return 'XS';
  if (changedLines <= 100) return 'S';
  if (changedLines <= 400) return 'M';
  if (changedLines <= 1000) return 'L';
  return 'XL';
}

export function summarize(files: readonly PrFile[], classify: Classifier): PrSummary {
  const total = emptyTally();
  const real = emptyTally();
  const noise = emptyTally();
  const byKind: PrSummary['byKind'] = {};
  const noiseFiles: NoiseFile[] = [];

  for (const f of files) {
    add(total, f);
    const kind = classify(f.path);
    if (!kind) {
      add(real, f);
      continue;
    }
    add(noise, f);
    add((byKind[kind] ??= emptyTally()), f);
    noiseFiles.push({ ...f, kind });
  }

  return {
    total,
    real,
    noise,
    byKind,
    noiseFiles,
    noiseToMark: noiseFiles.filter((f) => f.viewerViewedState !== undefined && f.viewerViewedState !== 'VIEWED'),
    size: sizeLabel(real.additions + real.deletions),
  };
}

const nf = new Intl.NumberFormat('en-US');
export const formatCount = (n: number): string => nf.format(n);

/** 1234 -> "1.2k", 999 -> "999". For tight spaces like list badges. */
export function formatCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return (Math.round(n / 100) / 10).toFixed(1).replace(/\.0$/, '') + 'k';
  return Math.round(n / 1000) + 'k';
}

export const plural = (n: number, word: string): string => `${formatCount(n)} ${word}${n === 1 ? '' : 's'}`;
