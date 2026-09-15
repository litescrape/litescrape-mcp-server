import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import { LitescrapeClient } from '../src/client.js';
import { ACCOUNT_FIX } from '../src/messages.js';
import { createServer } from '../src/server.js';
import { SURFACES } from '../src/surfaces.js';

type Recorded = { url: URL; headers: Record<string, string> };

function connected(options: {
	apiKey?: string;
	responses: Array<[number, unknown, Record<string, string>?]>;
}) {
	const recorded: Recorded[] = [];
	const queue = [...options.responses];
	const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
		recorded.push({
			url: new URL(String(input)),
			headers: { ...(init?.headers as Record<string, string>) },
		});
		const next = queue.shift();
		if (!next) throw new Error('unexpected request');
		const [status, body, headers] = next;
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json', ...(headers ?? {}) },
		});
	}) as typeof fetch;
	const server = createServer({
		client: new LitescrapeClient({
			apiKey: options.apiKey,
			fetch: fetchImpl,
			sleep: async () => {},
		}),
	});
	const client = new Client({ name: 'test', version: '0.0.0' });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const ready = Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	const call = async (name: string, args: Record<string, unknown>) => {
		await ready;
		return (await client.callTool({ name, arguments: args })) as CallToolResult;
	};
	const text = (result: CallToolResult) => {
		const block = result.content[0];
		return block && block.type === 'text' ? block.text : '';
	};
	return { client, ready, call, text, recorded };
}

describe('createServer', () => {
	it('registers every surface as a tool with a schema', async () => {
		const { client, ready } = connected({ responses: [] });
		await ready;
		const { tools } = await client.listTools();
		expect(tools.map((tool) => tool.name).sort()).toEqual(
			SURFACES.map((surface) => surface.name).sort(),
		);
		const search = tools.find((tool) => tool.name === 'google_search');
		expect(search?.inputSchema.properties).toHaveProperty('q');
		expect(search?.inputSchema.properties).toHaveProperty('result_groups');
		expect(search?.annotations?.readOnlyHint).toBe(true);
	});

	it('tells a keyless session what is free and how to add a key', async () => {
		const { client, ready } = connected({ responses: [] });
		await ready;
		const instructions = client.getInstructions() ?? '';
		expect(instructions).toContain('google_search (25 calls)');
		expect(instructions).toContain('LITESCRAPE_API_KEY');
	});

	it('returns a summary line, the allowance and the unchanged JSON for a keyless search', async () => {
		const payload = {
			search_metadata: { id: 'abc' },
			search_parameters: { q: 'espresso' },
			organic_results: [
				{ position: 1, title: 'A' },
				{ position: 2, title: 'B' },
			],
			knowledge_graph: { title: 'Espresso' },
		};
		const { call, text, recorded } = connected({
			responses: [
				[
					200,
					payload,
					{ 'x-litescrape-keyless-limit': '25', 'x-litescrape-keyless-remaining': '24' },
				],
			],
		});
		const result = await call('google_search', { q: 'espresso', num: 10, fast_mode: false });
		expect(result.isError).toBeFalsy();
		const [summary, json] = text(result).split('\n\n');
		expect(summary).toBe(
			'Google Search for "espresso": 2 organic results; also knowledge_graph. ' +
				'Free allowance: 24 of 25 google_search calls left today (no API key set).',
		);
		expect(JSON.parse(json ?? '')).toEqual(payload);
		expect(result.structuredContent).toEqual(payload);

		const request = recorded[0];
		expect(request?.url.pathname).toBe('/api/google/search');
		expect(request?.url.searchParams.get('q')).toBe('espresso');
		expect(request?.url.searchParams.get('num')).toBe('10');
		expect(request?.url.searchParams.get('fast_mode')).toBe('false');
		expect(request?.url.searchParams.has('result_groups')).toBe(false);
		expect(request?.headers['X-Litescrape-Client']).toMatch(/^mcp\//);
		expect(request?.headers.Authorization).toBeUndefined();
	});

	it('keeps only the requested result groups plus search_metadata', async () => {
		const payload = {
			search_metadata: { id: 'abc' },
			search_parameters: { q: 'x' },
			organic_results: [{ position: 1 }],
			ads: [{ position: 1 }],
			related_questions: [{ question: '?' }],
		};
		const { call, text } = connected({ responses: [[200, payload]] });
		const result = await call('google_search', { q: 'x', result_groups: ['organic_results'] });
		const json = JSON.parse(text(result).split('\n\n')[1] ?? '');
		expect(Object.keys(json).sort()).toEqual(['organic_results', 'search_metadata']);
	});

	it('runs the generic search tool in fast mode against Google Search', async () => {
		const { call, text, recorded } = connected({
			responses: [[200, { search_metadata: {}, organic_results: [] }]],
		});
		const result = await call('search', { q: 'weather' });
		expect(text(result)).toContain('Google Search (fast mode) for "weather": 0 organic results.');
		expect(recorded[0]?.url.searchParams.get('fast_mode')).toBe('true');
	});

	it('refuses key-only tools locally without an API key and names the fix', async () => {
		const { call, text, recorded } = connected({ responses: [] });
		const result = await call('google_ai_mode', { q: 'why is the sky blue' });
		expect(result.isError).toBe(true);
		expect(text(result)).toContain('google_ai_mode needs a Litescrape API key');
		expect(text(result)).toContain(ACCOUNT_FIX);
		expect(recorded).toHaveLength(0);
	});

	it('serves key-only tools with a key and sends the bearer token', async () => {
		const payload = {
			search_metadata: {},
			text_blocks: [{ type: 'paragraph', snippet: 'Rayleigh scattering.' }],
			references: [{ index: 1, link: 'https://example.com' }],
			subsequent_request_token: 'tok',
		};
		const { call, text, recorded } = connected({
			apiKey: 'ls_live_k',
			responses: [[200, payload]],
		});
		const result = await call('google_ai_mode', { q: 'why is the sky blue', continuable: true });
		expect(result.isError).toBeFalsy();
		expect(text(result)).toContain(
			'Google AI Mode for "why is the sky blue": 1 text blocks, 1 references; follow-up token included.',
		);
		expect(recorded[0]?.headers.Authorization).toBe('Bearer ls_live_k');
		expect(recorded[0]?.url.searchParams.get('continuable')).toBe('true');
	});

	it('relays a limit response as a tool error with the fix text', async () => {
		const message =
			"You've hit Litescrape's free MCP limit for bing_search (50 calls per day, resets at 00:00 UTC). " +
			`To continue without limits, get a Litescrape API key.\n\n${ACCOUNT_FIX}`;
		const { call, text } = connected({
			responses: [
				[
					429,
					{ error: message, error_code: 'mcp_keyless_daily_limit', retryable: false },
					{ 'retry-after': '60' },
				],
			],
		});
		const result = await call('bing_search', { q: 'x' });
		expect(result.isError).toBe(true);
		expect(text(result)).toBe(message);
	});

	it('describes other API errors with their code, status and request id', async () => {
		const { call, text } = connected({
			responses: [
				[
					400,
					{
						error: 'q is required',
						error_code: 'invalid_request',
						request_id: 'r9',
						retryable: false,
					},
				],
			],
		});
		const result = await call('google_maps', { type: 'search' });
		expect(result.isError).toBe(true);
		expect(text(result)).toBe('Litescrape invalid_request (HTTP 400, request r9): q is required');
	});

	it('rejects arguments outside the schema before any request is made', async () => {
		const { call, recorded } = connected({ responses: [] });
		const result = await call('duckduckgo_search', { q: 'x', m: 500 });
		expect(result.isError).toBe(true);
		expect(recorded).toHaveLength(0);
	});

	it("fetches a place's reviews with a key and names the next page", async () => {
		const payload = {
			search_metadata: {},
			place_info: { title: 'Blue Bottle Coffee', rating: 4.4, reviews: 1200 },
			reviews: [
				{ position: 1, rating: 5, snippet: 'Great pour-over.' },
				{ position: 2, rating: 3, snippet: 'Long line.' },
			],
			pagination: { next: 'https://api.litescrape.com/...', next_page_token: 'tok' },
		};
		const { call, text, recorded } = connected({
			apiKey: 'ls_live_k',
			responses: [[200, payload]],
		});
		const result = await call('google_reviews', {
			place_id: 'ChIJT2h1HKZZwokR0kgzEtsa03k',
			sort_by: 'newestFirst',
			num: 2,
		});
		expect(result.isError).toBeFalsy();
		expect(text(result).split('\n\n')[0]).toBe(
			'Google Reviews for Blue Bottle Coffee: 2 reviews; more pages available.',
		);
		expect(recorded[0]?.url.pathname).toBe('/api/google/reviews');
		expect(recorded[0]?.url.searchParams.get('sort_by')).toBe('newestFirst');
		expect(recorded[0]?.headers.Authorization).toBe('Bearer ls_live_k');
	});

	it('refuses google_reviews without a key before any request', async () => {
		const { call, text, recorded } = connected({ responses: [] });
		const result = await call('google_reviews', { place_id: 'ChIJ' });
		expect(result.isError).toBe(true);
		expect(text(result)).toContain('google_reviews needs a Litescrape API key');
		expect(recorded).toHaveLength(0);
	});

	it('sends extra client headers with every request', async () => {
		const recorded: Recorded[] = [];
		const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
			recorded.push({
				url: new URL(String(input)),
				headers: { ...(init?.headers as Record<string, string>) },
			});
			return new Response('{"search_metadata":{}}', {
				headers: { 'content-type': 'application/json' },
			});
		}) as typeof fetch;
		const client = new LitescrapeClient({ fetch: fetchImpl, headers: { 'X-Extra': '1' } });
		await client.get('/api/google/search', { q: 'x' });
		expect(recorded[0]?.headers['X-Extra']).toBe('1');
		expect(recorded[0]?.headers['X-Litescrape-Client']).toMatch(/^mcp\//);
	});
});
