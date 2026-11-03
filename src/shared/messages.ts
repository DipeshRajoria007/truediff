import type { ApiErrorInfo, PrDetails, PrSize, SetViewedResult, TokenInfo } from '../background/github';
import type { PrRef } from './github-url';

export type Request =
  | { type: 'pr-details'; pr: PrRef }
  | { type: 'pr-sizes'; prs: PrRef[] }
  | { type: 'set-viewed'; pr: PrRef; prId: string; paths: string[]; viewed: boolean }
  | { type: 'check-token'; token?: string; probe?: { owner: string; repo: string } }
  | { type: 'status' }
  | { type: 'claim-auto-mark'; pr: PrRef; headOid: string }
  | { type: 'open-options' };

export interface ResponseMap {
  'pr-details': PrDetails;
  'pr-sizes': Array<PrSize | null>;
  'set-viewed': SetViewedResult;
  'check-token': TokenInfo & { probeOk?: boolean };
  /** Whether a token is saved. Pages on github.com never get the token itself. */
  status: { hasToken: boolean };
  /** True the first time it's asked for a given PR head commit, false after that. */
  'claim-auto-mark': boolean;
  'open-options': null;
}

export type Response<T> = { ok: true; data: T } | { ok: false; error: ApiErrorInfo };

export class RequestError extends Error {
  constructor(public info: ApiErrorInfo) {
    super(info.message);
    this.name = 'RequestError';
  }
}

/** Sends a request to the background worker and unwraps the result (throws RequestError). */
export async function send<R extends Request>(req: R): Promise<ResponseMap[R['type']]> {
  let res: Response<ResponseMap[R['type']]> | undefined;
  try {
    res = await chrome.runtime.sendMessage(req);
  } catch (e) {
    // Happens after the extension is reloaded/updated while the tab stays open.
    throw new RequestError({ code: 'UNKNOWN', message: 'TrueDiff was updated. Reload this page.' });
  }
  if (!res) throw new RequestError({ code: 'UNKNOWN', message: 'No response from TrueDiff background.' });
  if (!res.ok) throw new RequestError(res.error);
  return res.data;
}
