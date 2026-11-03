/**
 * Live check of the GitHub API layer against real PRs.
 *
 *   GITHUB_TOKEN=$(gh auth token) bun scripts/smoke.ts owner/repo#123 [more PRs...]
 *   ... --roundtrip   also marks one unviewed noise file viewed, then unmarks it again
 */
import { fetchPrDetails, fetchPrSizes, setFilesViewed } from '../src/background/github';
import { createClassifier } from '../src/shared/categories';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { summarize } from '../src/shared/summary';
import type { PrRef } from '../src/shared/github-url';

const token = process.env.GITHUB_TOKEN ?? '';
const args = process.argv.slice(2);
const roundtrip = args.includes('--roundtrip');
const prs: PrRef[] = args
  .filter((a) => !a.startsWith('--'))
  .map((a) => {
    const m = /^([^/]+)\/([^#]+)#(\d+)$/.exec(a);
    if (!m) throw new Error(`Bad PR ref: ${a} (want owner/repo#123)`);
    return { owner: m[1]!, repo: m[2]!, number: Number(m[3]) };
  });

const classify = createClassifier(DEFAULT_SETTINGS);
const opts = { token };

const first = prs[0]!;
const t0 = Date.now();
const details = await fetchPrDetails(opts, first);
const s = summarize(details.files, classify);
console.log(`details ${first.owner}/${first.repo}#${first.number} in ${Date.now() - t0}ms`);
console.log(`  files fetched ${details.files.length}/${details.changedFiles}, viewer=${details.viewerLogin}, author=${details.authorLogin}`);
console.log(`  total +${s.total.additions} -${s.total.deletions} in ${s.total.files} files`);
console.log(`  REAL  +${s.real.additions} -${s.real.deletions} in ${s.real.files} files (size ${s.size})`);
console.log(`  noise +${s.noise.additions} -${s.noise.deletions} in ${s.noise.files} files`, JSON.stringify(s.byKind));
console.log(`  noise still to mark: ${s.noiseToMark.length}`);

const t1 = Date.now();
const sizes = await fetchPrSizes(opts, [...prs, { owner: first.owner, repo: 'definitely-not-a-repo-xyz', number: 1 }]);
console.log(`\nsizes for ${prs.length + 1} PRs (last one bogus) in ${Date.now() - t1}ms`);
sizes.forEach((sz, i) => {
  const pr = prs[i];
  if (!sz) return console.log(`  ${pr ? `${pr.repo}#${pr.number}` : 'bogus'}: null`);
  const sum = summarize(sz.files, classify);
  console.log(`  ${pr!.repo}#${pr!.number}: ${sz.files.length}/${sz.changedFiles} files, real +${sum.real.additions} -${sum.real.deletions} (${sum.size}), noise ${sum.noise.files} files`);
});

if (roundtrip) {
  const target = s.noiseFiles.find((f) => f.viewerViewedState === 'UNVIEWED');
  if (!target) {
    console.log('\nroundtrip: no UNVIEWED noise file to test with, skipping');
  } else {
    console.log(`\nroundtrip on ${target.path}`);
    const marked = await setFilesViewed(opts, details.id, [target.path], true);
    const after = (await fetchPrDetails(opts, first)).files.find((f) => f.path === target.path)?.viewerViewedState;
    const unmarked = await setFilesViewed(opts, details.id, [target.path], false);
    const restored = (await fetchPrDetails(opts, first)).files.find((f) => f.path === target.path)?.viewerViewedState;
    console.log(`  mark -> ${JSON.stringify(marked)} state=${after}`);
    console.log(`  unmark -> ${JSON.stringify(unmarked)} state=${restored}`);
    if (after !== 'VIEWED' || restored !== 'UNVIEWED') {
      console.error('  ROUNDTRIP FAILED');
      process.exit(1);
    }
    console.log('  roundtrip OK');
  }
}
