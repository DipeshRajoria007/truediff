import type { PrRef } from '../shared/github-url';
import type { PrFile, ViewedState } from '../shared/summary';

const GRAPHQL_URL = 'https://api.github.com/graphql';

/**
 * Applied to every request that carries the token: never follow a redirect (so the token can't be
 * forwarded anywhere but api.github.com), never attach browser cookies, never cache responses.
 */
export const SAFE_FETCH: RequestInit = { credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' };

export type ApiErrorCode = 'NO_TOKEN' | 'BAD_TOKEN' | 'SSO' | 'NOT_FOUND' | 'RATE_LIMITED' | 'NETWORK' | 'UNKNOWN';

export interface ApiErrorInfo {
  code: ApiErrorCode;
  message: string;
  /** For SSO errors: where to authorize the token for the org. */
  url?: string;
}

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public url?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  toJSON(): ApiErrorInfo {
    return { code: this.code, message: this.message, ...(this.url ? { url: this.url } : {}) };
  }
}

interface GraphQLErrorItem {
  type?: string;
  message?: string;
  path?: Array<string | number>;
}

interface GraphQLResult<T> {
  data: T | null;
  errors: GraphQLErrorItem[];
  /** Raw X-GitHub-SSO header, if GitHub sent one. */
  sso: string | null;
}

type FetchLike = typeof fetch;

export interface ClientOptions {
  token: string;
  fetch?: FetchLike;
}

export function ssoUrlFrom(header: string | null): string | undefined {
  // X-GitHub-SSO: required; url=https://github.com/orgs/acme/sso?authorization_request=...
  const m = header && /url=(\S+)/.exec(header);
  if (!m?.[1]) return undefined;
  // It ends up as a link in the page, so only ever accept an https://github.com URL.
  try {
    const url = new URL(m[1]);
    return url.origin === 'https://github.com' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function errorFromItems(items: GraphQLErrorItem[], ssoHeader: string | null): ApiError {
  const first = items[0] ?? {};
  const msg = first.message ?? 'GitHub returned an error.';
  if (ssoHeader || /SAML|SSO/i.test(msg)) {
    return new ApiError('SSO', 'Your token is not authorized for this organization’s SSO.', ssoUrlFrom(ssoHeader));
  }
  if (first.type === 'RATE_LIMITED' || /rate limit/i.test(msg)) return new ApiError('RATE_LIMITED', msg);
  if (first.type === 'NOT_FOUND') return new ApiError('NOT_FOUND', msg);
  return new ApiError('UNKNOWN', msg);
}

/**
 * Low-level GraphQL call. Returns partial data alongside errors (GitHub does this when
 * one aliased repository in a batch is inaccessible) instead of throwing.
 */
export async function graphqlRaw<T>(
  opts: ClientOptions,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<GraphQLResult<T>> {
  if (!opts.token) throw new ApiError('NO_TOKEN', 'Add a GitHub token in TrueDiff settings.');
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(GRAPHQL_URL, {
      ...SAFE_FETCH,
      method: 'POST',
      headers: {
        Authorization: `bearer ${opts.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new ApiError('NETWORK', `Could not reach GitHub (${(e as Error).message}).`);
  }

  const ssoHeader = res.headers.get('x-github-sso');
  if (res.status === 401) throw new ApiError('BAD_TOKEN', 'GitHub rejected the token. It may be expired or revoked.');
  if (res.status === 403 || res.status === 429) {
    if (ssoHeader) throw errorFromItems([], ssoHeader);
    if (res.headers.get('x-ratelimit-remaining') === '0' || res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      const when = reset ? ` Try again after ${new Date(reset * 1000).toLocaleTimeString()}.` : '';
      throw new ApiError('RATE_LIMITED', `GitHub API rate limit reached.${when}`);
    }
    throw new ApiError('UNKNOWN', `GitHub refused the request (HTTP ${res.status}).`);
  }
  if (!res.ok) throw new ApiError('UNKNOWN', `GitHub API error (HTTP ${res.status}).`);

  const body = (await res.json()) as { data?: T | null; errors?: GraphQLErrorItem[] };
  const errors = body.errors ?? [];
  if (!body.data && errors.length) throw errorFromItems(errors, ssoHeader);
  return { data: body.data ?? null, errors, sso: ssoHeader };
}

/** GraphQL call that throws on any error. */
export async function graphql<T>(opts: ClientOptions, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const { data, errors, sso } = await graphqlRaw<T>(opts, query, variables);
  if (errors.length || !data) throw errorFromItems(errors, sso);
  return data;
}

// ---------------------------------------------------------------------------
// PR details (PR page): every file with your viewed state.
// ---------------------------------------------------------------------------

export interface PrDetails {
  id: string;
  headOid: string;
  authorLogin: string | null;
  viewerLogin: string;
  changedFiles: number;
  files: PrFile[];
}

interface FilesPage<N> {
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: N[] | null;
}

interface DetailFileNode {
  path: string;
  additions: number;
  deletions: number;
  viewerViewedState: ViewedState;
}

const DETAILS_QUERY = /* GraphQL */ `
  query TrueDiffPr($owner: String!, $name: String!, $number: Int!, $cursor: String) {
    viewer { login }
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        id
        headRefOid
        changedFiles
        author { login }
        files(first: 100, after: $cursor) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes { path additions deletions viewerViewedState }
        }
      }
    }
  }
`;

interface DetailsData {
  viewer: { login: string };
  repository: {
    pullRequest: {
      id: string;
      headRefOid: string;
      changedFiles: number;
      author: { login: string } | null;
      files: FilesPage<DetailFileNode> | null;
    } | null;
  } | null;
}

const MAX_PAGES = 40; // GitHub caps PR files at 3,000 (30 pages of 100).

export async function fetchPrDetails(opts: ClientOptions, pr: PrRef): Promise<PrDetails> {
  let cursor: string | null = null;
  let details: PrDetails | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: DetailsData = await graphql<DetailsData>(opts, DETAILS_QUERY, {
      owner: pr.owner,
      name: pr.repo,
      number: pr.number,
      cursor,
    });
    const p = data.repository?.pullRequest;
    if (!p) throw new ApiError('NOT_FOUND', `Can’t see ${pr.owner}/${pr.repo}#${pr.number} with this token.`);
    details ??= {
      id: p.id,
      headOid: p.headRefOid,
      authorLogin: p.author?.login ?? null,
      viewerLogin: data.viewer.login,
      changedFiles: p.changedFiles,
      files: [],
    };
    for (const n of p.files?.nodes ?? []) {
      details.files.push({ path: n.path, additions: n.additions, deletions: n.deletions, viewerViewedState: n.viewerViewedState });
    }
    if (!p.files?.pageInfo.hasNextPage) break;
    cursor = p.files.pageInfo.endCursor;
  }
  return details!;
}

// ---------------------------------------------------------------------------
// PR sizes (list pages): many PRs per request using aliases.
// ---------------------------------------------------------------------------

export interface PrSize {
  changedFiles: number;
  files: PrFile[];
}

export const SIZE_BATCH = 20;

interface SizeFileNode {
  path: string;
  additions: number;
  deletions: number;
}

interface SizePr {
  changedFiles: number;
  files: FilesPage<SizeFileNode> | null;
}

function buildSizesQuery(count: number): string {
  const vars: string[] = [];
  const fields: string[] = [];
  for (let i = 0; i < count; i++) {
    vars.push(`$o${i}: String!, $r${i}: String!, $n${i}: Int!`);
    fields.push(
      `p${i}: repository(owner: $o${i}, name: $r${i}) { pullRequest(number: $n${i}) { changedFiles files(first: 100) { totalCount pageInfo { hasNextPage endCursor } nodes { path additions deletions } } } }`,
    );
  }
  return `query TrueDiffSizes(${vars.join(', ')}) {\n${fields.join('\n')}\n}`;
}

const MORE_FILES_QUERY = /* GraphQL */ `
  query TrueDiffMoreFiles($owner: String!, $name: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        files(first: 100, after: $cursor) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes { path additions deletions }
        }
      }
    }
  }
`;

interface MoreFilesData {
  repository: { pullRequest: { files: FilesPage<SizeFileNode> | null } | null } | null;
}

/**
 * Fetches file lists for many PRs. PRs the token can't see come back as null
 * rather than failing the whole batch. Auth/SSO/rate-limit problems still throw.
 */
export async function fetchPrSizes(opts: ClientOptions, prs: readonly PrRef[]): Promise<Array<PrSize | null>> {
  const out: Array<PrSize | null> = new Array(prs.length).fill(null);

  for (let start = 0; start < prs.length; start += SIZE_BATCH) {
    const chunk = prs.slice(start, start + SIZE_BATCH);
    const variables: Record<string, unknown> = {};
    chunk.forEach((pr, i) => {
      variables[`o${i}`] = pr.owner;
      variables[`r${i}`] = pr.repo;
      variables[`n${i}`] = pr.number;
    });
    const { data, errors, sso } = await graphqlRaw<Record<string, { pullRequest: SizePr | null } | null>>(
      opts,
      buildSizesQuery(chunk.length),
      variables,
    );
    // Per-PR failures (another org, SSO, deleted repo) only blank out that PR's badge.
    // If nothing at all came back, surface the error so the user can fix the token.
    const gotAny = chunk.some((_, i) => data?.[`p${i}`]?.pullRequest);
    if (!data || (!gotAny && errors.length)) throw errorFromItems(errors, sso);

    await Promise.all(
      chunk.map(async (pr, i) => {
        const p = data[`p${i}`]?.pullRequest;
        if (!p || !p.files) return;
        const files: PrFile[] = (p.files.nodes ?? []).map((n) => ({ path: n.path, additions: n.additions, deletions: n.deletions }));
        let pageInfo = p.files.pageInfo;
        for (let page = 1; pageInfo.hasNextPage && page < MAX_PAGES; page++) {
          const more: MoreFilesData = await graphql<MoreFilesData>(opts, MORE_FILES_QUERY, {
            owner: pr.owner,
            name: pr.repo,
            number: pr.number,
            cursor: pageInfo.endCursor,
          });
          const f = more.repository?.pullRequest?.files;
          if (!f) break;
          for (const n of f.nodes ?? []) files.push({ path: n.path, additions: n.additions, deletions: n.deletions });
          pageInfo = f.pageInfo;
        }
        out[start + i] = { changedFiles: p.changedFiles, files };
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mark / unmark files as viewed.
// ---------------------------------------------------------------------------

export const VIEWED_BATCH = 25;

export interface SetViewedResult {
  done: string[];
  failed: string[];
  /** First error GitHub gave for a failed file, if any. */
  error?: ApiErrorInfo;
}

function buildViewedMutation(count: number, viewed: boolean): string {
  const op = viewed ? 'markFileAsViewed' : 'unmarkFileAsViewed';
  const vars: string[] = ['$pr: ID!'];
  const fields: string[] = [];
  for (let i = 0; i < count; i++) {
    vars.push(`$f${i}: String!`);
    fields.push(`m${i}: ${op}(input: { pullRequestId: $pr, path: $f${i} }) { clientMutationId }`);
  }
  return `mutation TrueDiffViewed(${vars.join(', ')}) {\n${fields.join('\n')}\n}`;
}

export async function setFilesViewed(
  opts: ClientOptions,
  prId: string,
  paths: readonly string[],
  viewed: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<SetViewedResult> {
  const result: SetViewedResult = { done: [], failed: [] };
  for (let start = 0; start < paths.length; start += VIEWED_BATCH) {
    const chunk = paths.slice(start, start + VIEWED_BATCH);
    const variables: Record<string, unknown> = { pr: prId };
    chunk.forEach((p, i) => (variables[`f${i}`] = p));
    const { data, errors, sso } = await graphqlRaw<Record<string, unknown>>(opts, buildViewedMutation(chunk.length, viewed), variables);
    if (!data) throw errorFromItems(errors, sso);
    chunk.forEach((p, i) => (data[`m${i}`] ? result.done : result.failed).push(p));
    if (errors.length && !result.error) result.error = errorFromItems(errors, sso).toJSON();
    onProgress?.(result.done.length + result.failed.length, paths.length);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Token check (options page).
// ---------------------------------------------------------------------------

export interface TokenInfo {
  login: string;
  /** Classic tokens report scopes; fine-grained tokens don't (null). */
  scopes: string[] | null;
}

export async function checkToken(opts: ClientOptions): Promise<TokenInfo> {
  if (!opts.token) throw new ApiError('NO_TOKEN', 'Paste a token first.');
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch('https://api.github.com/user', {
      ...SAFE_FETCH,
      headers: { Authorization: `bearer ${opts.token}`, Accept: 'application/vnd.github+json' },
    });
  } catch (e) {
    throw new ApiError('NETWORK', `Could not reach GitHub (${(e as Error).message}).`);
  }
  if (res.status === 401) throw new ApiError('BAD_TOKEN', 'GitHub rejected the token. It may be mistyped, expired or revoked.');
  if (!res.ok) throw new ApiError('UNKNOWN', `GitHub API error (HTTP ${res.status}).`);
  const user = (await res.json()) as { login: string };
  const scopeHeader = res.headers.get('x-oauth-scopes');
  return {
    login: user.login,
    scopes: scopeHeader === null ? null : scopeHeader.split(',').map((s) => s.trim()).filter(Boolean),
  };
}

/** Probes one repo to tell "token works but can't see this org's repos" apart. */
export async function checkRepoAccess(opts: ClientOptions, owner: string, repo: string): Promise<boolean> {
  const { data } = await graphqlRaw<{ repository: { id: string } | null }>(
    opts,
    'query($o: String!, $r: String!) { repository(owner: $o, name: $r) { id } }',
    { o: owner, r: repo },
  );
  return Boolean(data?.repository);
}
