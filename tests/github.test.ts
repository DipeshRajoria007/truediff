import { describe, expect, it, vi } from 'vitest';
import { ApiError, checkToken, fetchPrDetails, fetchPrSizes, SAFE_FETCH, setFilesViewed, SIZE_BATCH, ssoUrlFrom } from '../src/background/github';

type Handler = (body: { query: string; variables: Record<string, unknown> }) => {
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
};

function fakeFetch(handler: Handler) {
  const calls: Array<{ query: string; variables: Record<string, unknown>; url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ ...body, url: String(url), init });
    const r = handler(body);
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: r.headers });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const file = (path: string, additions = 1, deletions = 0) => ({ path, additions, deletions, viewerViewedState: 'UNVIEWED' });

describe('fetchPrDetails', () => {
  it('pages through all files', async () => {
    const { fetch, calls } = fakeFetch(({ variables }) => {
      const page = variables.cursor ? 2 : 1;
      return {
        json: {
          data: {
            viewer: { login: 'me' },
            repository: {
              pullRequest: {
                id: 'PR_1',
                headRefOid: 'abc',
                changedFiles: 150,
                author: { login: 'them' },
                files: {
                  totalCount: 150,
                  pageInfo: { hasNextPage: page === 1, endCursor: page === 1 ? 'c1' : null },
                  nodes: Array.from({ length: page === 1 ? 100 : 50 }, (_, i) => file(`f${page}-${i}.py`)),
                },
              },
            },
          },
        },
      };
    });
    const d = await fetchPrDetails({ token: 't', fetch }, { owner: 'o', repo: 'r', number: 1 });
    expect(d.files).toHaveLength(150);
    expect(d).toMatchObject({ id: 'PR_1', headOid: 'abc', viewerLogin: 'me', authorLogin: 'them' });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.variables.cursor).toBe('c1');
  });

  it('turns a missing PR into NOT_FOUND', async () => {
    const { fetch } = fakeFetch(() => ({
      json: { data: { viewer: { login: 'me' }, repository: null }, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }] },
    }));
    await expect(fetchPrDetails({ token: 't', fetch }, { owner: 'o', repo: 'r', number: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('errors', () => {
  const pr = { owner: 'o', repo: 'r', number: 1 };

  it('needs a token', async () => {
    await expect(fetchPrDetails({ token: '' }, pr)).rejects.toMatchObject({ code: 'NO_TOKEN' });
  });

  it('maps 401 to BAD_TOKEN', async () => {
    const { fetch } = fakeFetch(() => ({ status: 401, json: { message: 'Bad credentials' } }));
    await expect(fetchPrDetails({ token: 't', fetch }, pr)).rejects.toMatchObject({ code: 'BAD_TOKEN' });
  });

  it('maps SAML enforcement to SSO with the authorize URL', async () => {
    const { fetch } = fakeFetch(() => ({
      status: 403,
      headers: { 'x-github-sso': 'required; url=https://github.com/orgs/acme/sso?authorization_request=XYZ' },
      json: { message: 'Resource protected by organization SAML enforcement.' },
    }));
    const err = await fetchPrDetails({ token: 't', fetch }, pr).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('SSO');
    expect(err.url).toBe('https://github.com/orgs/acme/sso?authorization_request=XYZ');
  });

  it('ignores an SSO URL that is not on github.com', async () => {
    const { fetch } = fakeFetch(() => ({ status: 403, headers: { 'x-github-sso': 'required; url=javascript:alert(1)' }, json: {} }));
    const err = await fetchPrDetails({ token: 't', fetch }, pr).catch((e) => e);
    expect(err.code).toBe('SSO');
    expect(err.url).toBeUndefined();
  });

  it('maps SAML errors inside a 200 GraphQL response to SSO', async () => {
    const { fetch } = fakeFetch(() => ({
      json: { data: null, errors: [{ type: 'FORBIDDEN', message: 'Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.' }] },
    }));
    await expect(fetchPrDetails({ token: 't', fetch }, pr)).rejects.toMatchObject({ code: 'SSO' });
  });

  it('maps an exhausted rate limit', async () => {
    const { fetch } = fakeFetch(() => ({ status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' }, json: {} }));
    await expect(fetchPrDetails({ token: 't', fetch }, pr)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('maps network failures', async () => {
    const fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof globalThis.fetch;
    await expect(fetchPrDetails({ token: 't', fetch }, pr)).rejects.toMatchObject({ code: 'NETWORK' });
  });
});

describe('fetchPrSizes', () => {
  it('batches PRs into aliased queries and returns null for PRs it cannot see', async () => {
    const prs = Array.from({ length: SIZE_BATCH + 3 }, (_, i) => ({ owner: 'o', repo: 'r', number: i + 1 }));
    const { fetch, calls } = fakeFetch(({ variables }) => {
      const data: Record<string, unknown> = {};
      const errors: unknown[] = [];
      for (let i = 0; variables[`n${i}`] !== undefined; i++) {
        const n = variables[`n${i}`] as number;
        if (n === 2) {
          data[`p${i}`] = null;
          errors.push({ type: 'NOT_FOUND', path: [`p${i}`], message: 'nope' });
        } else {
          data[`p${i}`] = {
            pullRequest: {
              changedFiles: 2,
              files: { totalCount: 2, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [file('src/a.py', n), file('tests/test_a.py', 10)] },
            },
          };
        }
      }
      return { json: { data, errors: errors.length ? errors : undefined } };
    });

    const sizes = await fetchPrSizes({ token: 't', fetch }, prs);
    expect(calls).toHaveLength(2);
    expect(Object.keys(calls[0]!.variables)).toHaveLength(SIZE_BATCH * 3);
    expect(sizes).toHaveLength(prs.length);
    expect(sizes[1]).toBeNull();
    expect(sizes[0]!.files[0]).toEqual({ path: 'src/a.py', additions: 1, deletions: 0 });
    expect(sizes[SIZE_BATCH + 2]!.files[0]!.additions).toBe(SIZE_BATCH + 3);
  });

  it('follows pagination for PRs with more than 100 files', async () => {
    const { fetch, calls } = fakeFetch(({ query, variables }) => {
      if (query.includes('TrueDiffMoreFiles')) {
        return {
          json: { data: { repository: { pullRequest: { files: { totalCount: 101, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [file('last.py')] } } } } },
        };
      }
      expect(variables.n0).toBe(7);
      return {
        json: {
          data: {
            p0: {
              pullRequest: {
                changedFiles: 101,
                files: { totalCount: 101, pageInfo: { hasNextPage: true, endCursor: 'c' }, nodes: Array.from({ length: 100 }, (_, i) => file(`f${i}.py`)) },
              },
            },
          },
        },
      };
    });
    const [size] = await fetchPrSizes({ token: 't', fetch }, [{ owner: 'o', repo: 'r', number: 7 }]);
    expect(size!.files).toHaveLength(101);
    expect(calls).toHaveLength(2);
  });

  it('throws when nothing in the batch is visible, so the user learns why', async () => {
    const { fetch } = fakeFetch(() => ({
      json: { data: { p0: null }, errors: [{ type: 'FORBIDDEN', message: 'Resource protected by organization SAML enforcement.' }] },
    }));
    await expect(fetchPrSizes({ token: 't', fetch }, [{ owner: 'o', repo: 'r', number: 1 }])).rejects.toMatchObject({ code: 'SSO' });
  });
});

describe('setFilesViewed', () => {
  it('sends batched aliased mutations and reports partial failures', async () => {
    const paths = Array.from({ length: 30 }, (_, i) => `tests/t${i}.py`);
    const { fetch, calls } = fakeFetch(({ variables }) => {
      const data: Record<string, unknown> = {};
      const errors: unknown[] = [];
      for (let i = 0; variables[`f${i}`] !== undefined; i++) {
        if (variables[`f${i}`] === 'tests/t3.py') {
          data[`m${i}`] = null;
          errors.push({ type: 'FORBIDDEN', path: [`m${i}`], message: 'Resource not accessible by personal access token' });
        } else data[`m${i}`] = { clientMutationId: null };
      }
      return { json: { data, errors: errors.length ? errors : undefined } };
    });
    const progress: number[] = [];
    const res = await setFilesViewed({ token: 't', fetch }, 'PR_1', paths, true, (done) => progress.push(done));
    expect(calls).toHaveLength(2);
    expect(calls[0]!.query).toContain('markFileAsViewed');
    expect(calls[0]!.variables.pr).toBe('PR_1');
    expect(res.done).toHaveLength(29);
    expect(res.failed).toEqual(['tests/t3.py']);
    expect(res.error?.message).toContain('not accessible');
    expect(progress).toEqual([25, 30]);
  });

  it('uses unmarkFileAsViewed to unmark', async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: { data: { m0: { clientMutationId: null } } } }));
    await setFilesViewed({ token: 't', fetch }, 'PR_1', ['a'], false);
    expect(calls[0]!.query).toContain('unmarkFileAsViewed');
  });
});

describe('checkToken', () => {
  it('reads login and classic scopes', async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ login: 'me' }), { headers: { 'x-oauth-scopes': 'repo, read:org' } })) as unknown as typeof globalThis.fetch;
    expect(await checkToken({ token: 't', fetch })).toEqual({ login: 'me', scopes: ['repo', 'read:org'] });
  });

  it('reports null scopes for fine-grained tokens', async () => {
    const fetch = (async () => new Response(JSON.stringify({ login: 'me' }))) as unknown as typeof globalThis.fetch;
    expect((await checkToken({ token: 't', fetch })).scopes).toBeNull();
  });
});

describe('token safety', () => {
  it('sends the token only to api.github.com, without cookies, redirects or caching', async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: { data: { m0: { clientMutationId: null } } } }));
    await setFilesViewed({ token: 'secret', fetch }, 'PR_1', ['a'], true);
    expect(calls[0]!.url).toBe('https://api.github.com/graphql');
    expect(calls[0]!.init).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' });
    expect(SAFE_FETCH.redirect).toBe('error');

    let userInit: RequestInit | undefined;
    let userUrl = '';
    const userFetch = (async (url: string, init: RequestInit) => {
      userUrl = url;
      userInit = init;
      return new Response(JSON.stringify({ login: 'me' }));
    }) as unknown as typeof globalThis.fetch;
    await checkToken({ token: 'secret', fetch: userFetch });
    expect(userUrl).toBe('https://api.github.com/user');
    expect(userInit).toMatchObject({ credentials: 'omit', redirect: 'error' });
  });

  it('never puts the token in an error message', async () => {
    const { fetch } = fakeFetch(() => ({ status: 500, json: {} }));
    const err = await fetchPrDetails({ token: 'ghp_SECRET123', fetch }, { owner: 'o', repo: 'r', number: 1 }).catch((e) => e);
    expect(JSON.stringify(err.toJSON())).not.toContain('SECRET');
  });

  it('only turns real https://github.com SSO URLs into links', () => {
    expect(ssoUrlFrom('required; url=https://github.com/orgs/acme/sso?x=1')).toBe('https://github.com/orgs/acme/sso?x=1');
    for (const bad of [
      'required; url=javascript:alert(1)',
      'required; url=http://github.com/orgs/acme/sso',
      'required; url=https://github.com.evil.example/sso',
      'required; url=https://github.com@evil.example/sso',
      'required; url=https://user:pw@github.com/sso',
      'required; url=//evil.example',
      'required',
    ]) {
      expect(ssoUrlFrom(bad)).toBeUndefined();
    }
    expect(ssoUrlFrom(null)).toBeUndefined();
  });
});
