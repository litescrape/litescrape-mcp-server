import { describe, expect, it } from 'vitest';

import { LitescrapeClient, LitescrapeError, MAX_RETRIES } from '../src/client.js';
import { VERSION } from '../src/version.js';

type Call = { url: string; headers: Record<string, string> };

function jsonResponse(
	status: number,
	body: unknown,
	headers: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', ...headers },
	});
}

function fakeFetch(responses: Array<Response | Error>, calls: Call[] = []) {
	const queue = [...responses];
	const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) } });
		const next = queue.shift();
		if (next === undefined) throw new Error('no more responses');
		if (next instanceof Error) throw next;
		return next;
	}) as typeof fetch;
	return { fetchImpl, calls };
}

const noSleep = async () => {};

describe('LitescrapeClient', () => {
	it('builds the request from the base URL, stringifies values and drops undefined ones', () => {
		const client = new LitescrapeClient({ apiUrl: 'https://example.test/' });
		expect(
			client.url('/api/google/search', { q: 'a b', num: 5, fast_mode: true, gl: undefined }),
		).toBe('https://example.test/api/google/search?q=a+b&num=5&fast_mode=true');
	});

	it('sends the MCP client header and the bearer key only when one is configured', () => {
		const keyless = new LitescrapeClient();
		expect(keyless.keyed).toBe(false);
		expect(keyless.headers()['X-Litescrape-Client']).toBe(`mcp/${VERSION}`);
		expect(keyless.headers()['User-Agent']).toMatch(/^litescrape-mcp-server\//);
		expect(keyless.headers().Authorization).toBeUndefined();

		const keyed = new LitescrapeClient({ apiKey: ' ls_live_x ' });
		expect(keyed.keyed).toBe(true);
		expect(keyed.headers().Authorization).toBe('Bearer ls_live_x');
	});

	it('reads the configuration from the environment', () => {
		const client = LitescrapeClient.fromEnv({
			LITESCRAPE_API_KEY: 'ls_live_x',
			LITESCRAPE_API_URL: 'http://localhost:8000/',
			LITESCRAPE_TIMEOUT_MS: '5000',
		});
		expect(client.keyed).toBe(true);
		expect(client.apiUrl).toBe('http://localhost:8000');
		expect(client.timeoutMs).toBe(5000);
		expect(LitescrapeClient.fromEnv({ LITESCRAPE_TIMEOUT_MS: 'soon' }).timeoutMs).toBe(120_000);
	});

	it('returns the payload with the keyless allowance from the response headers', async () => {
		const { fetchImpl, calls } = fakeFetch([
			jsonResponse(
				200,
				{ organic_results: [] },
				{
					'x-litescrape-keyless-limit': '25',
					'x-litescrape-keyless-remaining': '24',
					'x-request-id': 'r1',
				},
			),
		]);
		const client = new LitescrapeClient({ fetch: fetchImpl, sleep: noSleep });
		const result = await client.get('/api/google/search', { q: 'x' });
		expect(result.payload).toEqual({ organic_results: [] });
		expect(result.keyless).toEqual({ limit: 25, remaining: 24 });
		expect(result.requestId).toBe('r1');
		expect(calls[0]?.headers.Authorization).toBeUndefined();
	});

	it('omits the allowance for keyed responses', async () => {
		const { fetchImpl } = fakeFetch([jsonResponse(200, { organic_results: [] })]);
		const client = new LitescrapeClient({ apiKey: 'k', fetch: fetchImpl, sleep: noSleep });
		expect((await client.get('/api/google/search', { q: 'x' })).keyless).toBeUndefined();
	});

	it('surfaces the daily limit without retrying, keeping the message and Retry-After', async () => {
		const { fetchImpl, calls } = fakeFetch([
			jsonResponse(
				429,
				{
					error: "You've hit Litescrape's free MCP limit for google_search. Fix: get a key.",
					error_code: 'mcp_keyless_daily_limit',
					request_id: 'r2',
					retryable: false,
				},
				{ 'retry-after': '3600' },
			),
		]);
		const client = new LitescrapeClient({ fetch: fetchImpl, sleep: noSleep });
		const error = await client.get('/api/google/search', { q: 'x' }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(LitescrapeError);
		const typed = error as LitescrapeError;
		expect(typed.status).toBe(429);
		expect(typed.errorCode).toBe('mcp_keyless_daily_limit');
		expect(typed.requestId).toBe('r2');
		expect(typed.retryAfterSeconds).toBe(3600);
		expect(typed.message).toContain('Fix: get a key.');
		expect(calls).toHaveLength(1);
	});

	it('waits out the one-call-at-a-time limit and retries', async () => {
		const waits: number[] = [];
		const { fetchImpl, calls } = fakeFetch([
			jsonResponse(
				429,
				{ error: 'one at a time', error_code: 'mcp_keyless_concurrency_limit', retryable: true },
				{ 'retry-after': '5' },
			),
			jsonResponse(200, { organic_results: [{ position: 1 }] }),
		]);
		const client = new LitescrapeClient({
			fetch: fetchImpl,
			sleep: async (ms) => {
				waits.push(ms);
			},
		});
		const result = await client.get('/api/bing/search', { q: 'x' });
		expect(result.payload.organic_results).toHaveLength(1);
		expect(calls).toHaveLength(2);
		expect(waits).toEqual([5000]);
	});

	it('retries retryable failures with backoff and gives up after the limit', async () => {
		const waits: number[] = [];
		const failure = () =>
			jsonResponse(503, { error: 'blocked', error_code: 'service_unavailable', retryable: true });
		const { fetchImpl, calls } = fakeFetch([failure(), failure(), failure(), failure()]);
		const client = new LitescrapeClient({
			fetch: fetchImpl,
			sleep: async (ms) => {
				waits.push(ms);
			},
		});
		await expect(client.get('/api/google/search', { q: 'x' })).rejects.toMatchObject({
			errorCode: 'service_unavailable',
			retryable: true,
		});
		expect(calls).toHaveLength(MAX_RETRIES + 1);
		expect(waits).toEqual([1000, 2000]);
	});

	it('does not retry permanent errors', async () => {
		const { fetchImpl, calls } = fakeFetch([
			jsonResponse(400, { error: 'bad q', error_code: 'invalid_request', retryable: false }),
		]);
		const client = new LitescrapeClient({ fetch: fetchImpl, sleep: noSleep });
		await expect(client.get('/api/google/search', { q: '' })).rejects.toMatchObject({
			status: 400,
			errorCode: 'invalid_request',
		});
		expect(calls).toHaveLength(1);
	});

	it('reports non-JSON error bodies and network failures cleanly', async () => {
		const gateway = () => new Response('<html>', { status: 502 });
		const { fetchImpl, calls } = fakeFetch([gateway(), gateway(), gateway()]);
		const client = new LitescrapeClient({ fetch: fetchImpl, sleep: noSleep });
		await expect(client.get('/api/google/search', { q: 'x' })).rejects.toMatchObject({
			status: 502,
			errorCode: 'http_502',
			retryable: true,
			message: 'Litescrape returned HTTP 502.',
		});
		expect(calls).toHaveLength(MAX_RETRIES + 1);

		const offline = new LitescrapeClient({
			fetch: fakeFetch([new Error('ECONNREFUSED')]).fetchImpl,
			sleep: noSleep,
		});
		await expect(offline.get('/api/google/search', { q: 'x' })).rejects.toMatchObject({
			errorCode: 'network_error',
			retryable: true,
		});
	});

	it('aborts a request that exceeds the timeout', async () => {
		const hanging = ((_input: unknown, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
			})) as typeof fetch;
		const client = new LitescrapeClient({ fetch: hanging, timeoutMs: 10, sleep: noSleep });
		await expect(client.get('/api/google/search', { q: 'x' })).rejects.toMatchObject({
			errorCode: 'timeout',
			retryable: true,
		});
	});
});
