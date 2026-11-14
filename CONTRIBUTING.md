# Contributing to TrueDiff

Thanks for helping. Bug reports, fixes for GitHub UI changes and noise patterns for more languages are the most
useful contributions.

## Reporting a bug

[Open an issue](https://github.com/DipeshRajoria007/truediff/issues/new/choose) with the bug report form.

**GitHub changes its pages often, and that's the most common way TrueDiff breaks.** GitHub also shows different
people different versions of the same page, so please include:

- the kind of page (a PR's Overview/Conversation tab, Files changed, a PR list, search…)
- whether the PR title has a **Preview** badge next to it (GitHub's newer PR page)
- a screenshot, with anything private blurred out

For security problems, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## Setting up

You need Node.js 20 or newer and Chrome.

```sh
npm install
npm run build        # builds the extension into dist/
```

Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick `dist/`. After each
rebuild (or with `npm run watch`), click the reload icon on TrueDiff's card and refresh the GitHub tab.

## Testing

```sh
npm run check        # typecheck + unit tests + build: run this before every pull request
npm run e2e          # the built extension in a throwaway Chromium against live github.com (API mocked)
                     # first time: npx playwright install chromium
```

`npm run e2e` loads real GitHub pages logged out, so it catches layout changes that unit tests can't. GitHub only
shows some page versions to signed-in users; for those, the e2e script rebuilds the page in place (see "2b" in
`scripts/e2e.mjs`). If you fix a new GitHub layout, add a check like that one so it stays fixed. CI runs both
commands on every pull request and once a week.

## Changing what counts as noise

The built-in patterns live in `src/shared/categories.ts`. When you add one, add test cases to
`tests/classify.test.ts` for both sides: paths it should match, and real code it must **not** match. Product code
is full of names like `contest`, `latest.ts` or `test-cases.js`, so avoid loose patterns such as `*test*`.

## Ground rules

- **No new permissions** without discussing it in an issue first. TrueDiff needs `storage` and `api.github.com`,
  nothing more.
- **No runtime dependencies and no remote code.** Everything that runs in the browser is in this repo.
- **Text, never HTML.** Insert data from GitHub with `textContent` or the `h()` helper in `src/content/dom.ts`,
  never `innerHTML`.
- **Keep the token out of github.com.** Only the background worker and the settings page may read it.
- Update the README when behaviour or settings change.

## Pull requests

Keep each pull request to one change, describe what you tested, and make sure `npm run check` passes.
By contributing, you agree that your work is released under the [MIT license](LICENSE).
