// src/data/http.test.ts — the timeout-guarded fetch helper. NO REAL NETWORK.

import { fetchJson } from './http';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('fetchJson', () => {
  it('returns ok with parsed data on 200', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ hi: 1 })) as unknown as typeof fetch;
    const res = await fetchJson<{ hi: number }>('https://x');
    expect(res).toEqual({ ok: true, data: { hi: 1 } });
  });

  it('passes through provided headers', async () => {
    const mock = jest.fn().mockResolvedValue(jsonResponse({}));
    global.fetch = mock as unknown as typeof fetch;
    await fetchJson('https://x', { headers: { 'User-Agent': 'UA' } });
    expect(mock.mock.calls[0][1].headers).toEqual({ 'User-Agent': 'UA' });
  });

  it('maps 403 -> forbidden', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({}, 403)) as unknown as typeof fetch;
    expect(await fetchJson('https://x')).toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('maps 404 -> unsupported-location ONLY when unsupportedOn404 is set', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({}, 404)) as unknown as typeof fetch;
    expect(await fetchJson('https://x', { unsupportedOn404: true })).toEqual({
      ok: false,
      reason: 'unsupported-location',
    });
  });

  it('maps other non-2xx -> http-error', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({}, 500)) as unknown as typeof fetch;
    expect(await fetchJson('https://x')).toEqual({
      ok: false,
      reason: 'http-error',
    });
  });

  it('maps a generic fetch rejection -> network-error', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(
        new TypeError('Network request failed'),
      ) as unknown as typeof fetch;
    expect(await fetchJson('https://x')).toEqual({
      ok: false,
      reason: 'network-error',
    });
  });

  it('maps a JSON parse failure -> bad-response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    }) as unknown as typeof fetch;
    expect(await fetchJson('https://x')).toEqual({
      ok: false,
      reason: 'bad-response',
    });
  });

  it('maps an AbortError (timeout) -> timeout', async () => {
    // Simulate the abort: fetch rejects with an AbortError, as the runtime does
    // when controller.abort() fires.
    global.fetch = jest.fn().mockImplementation(() => {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    }) as unknown as typeof fetch;
    expect(await fetchJson('https://x', { timeoutMs: 5 })).toEqual({
      ok: false,
      reason: 'timeout',
    });
  });

  it('aborts a hung request and returns timeout', async () => {
    // fetch that only rejects when its signal aborts (never resolves otherwise).
    global.fetch = jest.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init.signal as AbortSignal;
        signal.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as unknown as typeof fetch;

    const res = await fetchJson('https://x', { timeoutMs: 10 });
    expect(res).toEqual({ ok: false, reason: 'timeout' });
  });

  it('aborts a fast-headers / hung-body response as timeout', async () => {
    // Headers resolve immediately (response.ok), but json() only settles when the
    // controller aborts — i.e. the body hangs. The timeout must STILL fire and be
    // classified as 'timeout' (it previously escaped: the timer was cleared in
    // finally before json() ran).
    global.fetch = jest.fn((_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      const response = {
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              const err = new Error('Aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }),
      } as unknown as Response;
      return Promise.resolve(response);
    }) as unknown as typeof fetch;

    const res = await fetchJson('https://x', { timeoutMs: 10 });
    expect(res).toEqual({ ok: false, reason: 'timeout' });
  });

  it('maps a non-404 by default; a 404 stays http-error unless opted in', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({}, 404)) as unknown as typeof fetch;
    // No unsupportedOn404 option → a 404 is a generic http-error.
    expect(await fetchJson('https://x')).toEqual({
      ok: false,
      reason: 'http-error',
    });
    // Opt in → 404 becomes unsupported-location (only the NWS /points call does).
    expect(await fetchJson('https://x', { unsupportedOn404: true })).toEqual({
      ok: false,
      reason: 'unsupported-location',
    });
  });
});
