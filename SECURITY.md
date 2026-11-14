# Security policy

TrueDiff holds a GitHub token, so security reports are taken seriously.

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Report it privately instead:

1. Go to the [Security tab](https://github.com/DipeshRajoria007/truediff/security) of this repo.
2. Click **Report a vulnerability** (or go straight to [the form](https://github.com/DipeshRajoria007/truediff/security/advisories/new)).

Include what an attacker could do, the steps to reproduce it, and the TrueDiff and Chrome versions you used.
You can expect a first reply within 7 days. Once a fix is released, the advisory is published with credit to you,
unless you'd rather stay anonymous.

## Supported versions

Only the [latest release](https://github.com/DipeshRajoria007/truediff/releases/latest) gets security fixes.

## What's in scope

Anything that breaks the promises in the README's [Security & privacy](README.md#security--privacy) section, for example:

- a github.com page (or any other site) reading the token, or making TrueDiff send it anywhere but `api.github.com`
- a page or another extension getting TrueDiff to change anything on GitHub without a real click from the user
- HTML or script injection through file paths, PR data or API errors
- TrueDiff changing anything on GitHub other than a file's "Viewed" state

Out of scope: attacks that need malware on the computer or full access to the Chrome profile (the token is stored
there unencrypted, like all extension data), and problems in GitHub itself.
