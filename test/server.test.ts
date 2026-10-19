import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { beforeEach, describe, expect, it } from 'vitest';

import { LitescrapeClient } from '../src/client.js';
import { ACCOUNT_FIX } from '../src/messages.js';
import { ALWAYS_ON, createServer } from '../src/server.js';
import { forgetLookups } from '../src/tools.js';

/** A catalog entry as /api/tools returns it. */
function tool(name: string, path: string, overrides: Record<string, unknown> = {}) {
	return {
		name,
		title: name,
		description: `The ${name} tool.`,
		method: 'GET',
		path,
		keyless: false,
		input_schema: { type: 'object', properties: { q: { type: 'string' } } },
		...overrides,
	};
}

/** The /api/tools answer to a names lookup. */
function lookup(...tools: ReturnType<typeof tool>[]): [number, unknown] {
	return [200, { tools }];
}

type Recorded = { url: URL; method: string; headers: Record<string, string>; body?: unknown };

function connected(options: {
	apiKey?: string;
	responses: Array<[number, unknown, Record<string, string>?]>;
}) {
	const recorded: Recorded[] = [];
	const queue = [...options.responses];
	const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
		recorded.push({
			url: new URL(String(input)),
			method: init?.method ?? 'GET',
			headers: { ...(init?.headers as Record<string, string>) },
			body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
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
	beforeEach(() => forgetLookups());

	it('lists the free tools with their API schemas, plus find_tools and call_tool', async () => {
		const { client, ready } = connected({ responses: [] });
		await ready;
		const { tools } = await client.listTools();
		expect(tools.map((listed) => listed.name)).toEqual([
			...ALWAYS_ON.map((free) => free.name),
			'find_tools',
			'call_tool',
		]);
		const search = tools.find((listed) => listed.name === 'google_search');
		const catalog = ALWAYS_ON.find((free) => free.name === 'google_search');
		expect(search?.description).toBe(catalog?.description);
		expect(search?.inputSchema.properties).toHaveProperty('q');
		expect(search?.inputSchema.properties).toHaveProperty('fast_mode');
		expect(search?.inputSchema.properties).toHaveProperty('result_groups');
		expect(search?.annotations?.readOnlyHint).toBe(true);
	});

	it('tells a keyless session what is free, how to find more tools and how to add a key', async () => {
		const { client, ready } = connected({ responses: [] });
		await ready;
		const instructions = client.getInstructions() ?? '';
		expect(instructions).toContain('google_search (25 calls)');
		expect(instructions).toContain('find_tools');
		expect(instructions).toContain('call_tool');
		expect(instructions).toContain('LITESCRAPE_API_KEY');
		expect(instructions).not.toContain('Alpha');
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
		const result = await call('google_search', { q: 'espresso', num: 10, fast_mode: true });
		expect(result.isError).toBeFalsy();
		const [summary, json] = text(result).split('\n\n');
		expect(summary).toBe(
			'Google Search for "espresso": 2 organic results; also knowledge_graph. ' +
				'Free allowance: 24 of 25 google_search calls left today (no API key set).',
		);
		expect(JSON.parse(json ?? '')).toEqual(payload);
		expect(result.structuredContent).toEqual(payload);

		expect(recorded).toHaveLength(1);
		const request = recorded[0];
		expect(request?.url.pathname).toBe('/api/google/search');
		expect(request?.url.searchParams.get('q')).toBe('espresso');
		expect(request?.url.searchParams.get('num')).toBe('10');
		expect(request?.url.searchParams.get('fast_mode')).toBe('true');
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

	it('finds tools for a task, with schemas for the best matches only', async () => {
		const product = tool('amazon_product', '/api/amazon/product', { best_match: true });
		const search = tool('amazon_search', '/api/amazon/search', { best_match: false });
		const { call, text, recorded } = connected({
			responses: [[200, { query: 'amazon prices', tools: [product, search] }]],
		});
		const result = await call('find_tools', { q: ' amazon prices ' });
		expect(result.isError).toBeFalsy();
		const [summary, json] = text(result).split('\n\n');
		expect(summary).toContain(
			'Litescrape tools for "amazon prices": amazon_product, amazon_search.',
		);
		const found = JSON.parse(json ?? '').tools;
		expect(found[0]).toEqual({
			name: 'amazon_product',
			title: 'amazon_product',
			description: 'The amazon_product tool.',
			keyless: false,
			input_schema: product.input_schema,
		});
		expect(found[1]).not.toHaveProperty('input_schema');
		expect(recorded[0]?.url.pathname).toBe('/api/tools');
		expect(recorded[0]?.url.searchParams.get('q')).toBe('amazon prices');
		expect(recorded[0]?.url.searchParams.get('limit')).toBe('5');
	});

	it('fetches named tools with their schemas once per process', async () => {
		const { call, text, recorded } = connected({
			responses: [lookup(tool('zillow_property', '/api/zillow/property'))],
		});
		const first = await call('find_tools', { names: ['zillow_property', 'google_maps'] });
		const [summary, json] = text(first).split('\n\n');
		expect(summary).toBe('Litescrape tools: zillow_property, google_maps.');
		expect(JSON.parse(json ?? '').tools[1]).toHaveProperty('input_schema');
		expect(recorded).toHaveLength(1);
		expect(recorded[0]?.url.searchParams.get('names')).toBe('zillow_property');
		await call('find_tools', { names: ['zillow_property'] });
		expect(recorded).toHaveLength(1);
	});

	it('asks for a task or names before searching', async () => {
		const { call, recorded } = connected({ responses: [] });
		expect((await call('find_tools', {})).isError).toBe(true);
		expect((await call('find_tools', { q: 'x' })).isError).toBe(true);
		expect((await call('find_tools', { q: 'amazon', limit: 26 })).isError).toBe(true);
		expect(recorded).toHaveLength(0);
	});

	it('refuses key-only tools without an API key after only the free lookup', async () => {
		for (const [name, path] of [
			['google_ai_mode', '/api/google/ai-mode'],
			['amazon_product', '/api/amazon/product'],
			['web_fetch', '/api/web/fetch'],
		] as const) {
			const { call, text, recorded } = connected({ responses: [lookup(tool(name, path))] });
			const result = await call('call_tool', { name, arguments: { q: 'x' } });
			expect(result.isError).toBe(true);
			expect(text(result)).toContain(`${name} needs a Litescrape API key`);
			expect(text(result)).toContain(ACCOUNT_FIX);
			expect(recorded.map((request) => request.url.pathname)).toEqual(['/api/tools']);
		}
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
			responses: [lookup(tool('google_ai_mode', '/api/google/ai-mode')), [200, payload]],
		});
		const result = await call('call_tool', {
			name: 'google_ai_mode',
			arguments: { q: 'why is the sky blue', continuable: true },
		});
		expect(result.isError).toBeFalsy();
		expect(text(result)).toContain(
			'Google AI Mode for "why is the sky blue": 1 text blocks, 1 references; follow-up token included.',
		);
		expect(recorded[1]?.url.pathname).toBe('/api/google/ai-mode');
		expect(recorded[1]?.headers.Authorization).toBe('Bearer ls_live_k');
		expect(recorded[1]?.url.searchParams.get('continuable')).toBe('true');
	});

	it('runs a catalog tool called by name directly, as call_tool would', async () => {
		const payload = {
			search_metadata: {},
			search_parameters: {},
			jobs_results: [{ title: 'Engineer' }, { title: 'Designer' }],
			pagination: { next_page: 2, next_page_token: 'tok' },
		};
		const { call, text, recorded } = connected({
			apiKey: 'ls_live_k',
			responses: [lookup(tool('glassdoor_search', '/api/glassdoor/search')), [200, payload]],
		});
		const result = await call('glassdoor_search', { q: 'engineer', remote: true, page: 1 });
		expect(result.isError).toBeFalsy();
		expect(text(result).split('\n\n')[0]).toBe(
			'Glassdoor for "engineer": 2 jobs; more pages available.',
		);
		const request = recorded[1];
		expect(request?.method).toBe('GET');
		expect(request?.url.pathname).toBe('/api/glassdoor/search');
		expect(request?.url.searchParams.get('remote')).toBe('true');
		expect(request?.url.searchParams.get('page')).toBe('1');
	});

	it('summarizes a tool without its own summary by its result groups', async () => {
		const { call, text } = connected({
			apiKey: 'ls_live_k',
			responses: [
				lookup(tool('new_tool', '/api/new/tool', { title: 'New Tool' })),
				[200, { search_metadata: {}, items: [], pagination: { next_cursor: 'c' } }],
			],
		});
		const result = await call('call_tool', { name: 'new_tool', arguments: { q: 'x' } });
		expect(text(result).split('\n\n')[0]).toBe('New Tool for "x": items; more pages available.');
	});

	it('reports an unknown tool name from the API', async () => {
		const { call, text } = connected({
			responses: [
				[
					400,
					{
						error: 'Unknown tool: nope. Search with q to find tool names.',
						error_code: 'invalid_request',
						retryable: false,
					},
				],
			],
		});
		const result = await call('call_tool', { name: 'nope', arguments: {} });
		expect(result.isError).toBe(true);
		expect(text(result)).toContain('Unknown tool: nope');
	});

	it('requires a tool name and object arguments for call_tool', async () => {
		const { call, recorded } = connected({ responses: [] });
		expect((await call('call_tool', {})).isError).toBe(true);
		expect((await call('call_tool', { name: 'google_maps', arguments: [1] })).isError).toBe(true);
		expect(recorded).toHaveLength(0);
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
			responses: [lookup(tool('google_reviews', '/api/google/reviews')), [200, payload]],
		});
		const result = await call('call_tool', {
			name: 'google_reviews',
			arguments: { place_id: 'ChIJT2h1HKZZwokR0kgzEtsa03k', sort_by: 'newestFirst', num: 2 },
		});
		expect(result.isError).toBeFalsy();
		expect(text(result).split('\n\n')[0]).toBe(
			'Google Reviews for Blue Bottle Coffee: 2 reviews; more pages available.',
		);
		expect(recorded[1]?.url.pathname).toBe('/api/google/reviews');
		expect(recorded[1]?.url.searchParams.get('sort_by')).toBe('newestFirst');
	});

	it('fetches a web page with a key and reports the site status', async () => {
		const payload = {
			url: 'https://example.com',
			title: 'Example Domain',
			content: '# Example Domain',
			status_code: 200,
		};
		const { call, text, recorded } = connected({
			apiKey: 'ls_live_k',
			responses: [lookup(tool('web_fetch', '/api/web/fetch')), [200, payload]],
		});
		const result = await call('call_tool', {
			name: 'web_fetch',
			arguments: { url: 'https://example.com', target_selector: 'main', with_shadow_dom: true },
		});
		expect(result.isError).toBeFalsy();
		expect(text(result).split('\n\n')[0]).toBe(
			'Fetched "Example Domain", site status 200, 16 characters.',
		);
		expect(recorded[1]?.url.pathname).toBe('/api/web/fetch');
		expect(recorded[1]?.url.searchParams.get('target_selector')).toBe('main');
		expect(recorded[1]?.url.searchParams.get('with_shadow_dom')).toBe('true');
	});

	it('sends array arguments as a JSON POST body', async () => {
		const { call, recorded } = connected({
			apiKey: 'ls_live_k',
			responses: [
				lookup(tool('glassdoor_search', '/api/glassdoor/search')),
				[200, { search_metadata: {}, jobs_results: [] }],
			],
		});
		const result = await call('call_tool', {
			name: 'glassdoor_search',
			arguments: { q: 'engineer', company_sizes: [4, 5], result_groups: ['jobs_results'] },
		});
		expect(result.isError).toBeFalsy();
		const request = recorded[1];
		expect(request?.method).toBe('POST');
		expect(request?.url.pathname).toBe('/api/glassdoor/search');
		expect(request?.url.search).toBe('');
		expect(request?.headers['Content-Type']).toBe('application/json');
		expect(request?.body).toEqual({ q: 'engineer', company_sizes: [4, 5] });
	});

	it('moves a value too long for a query string into a POST body', async () => {
		const token = 'a'.repeat(3000);
		const { call, recorded } = connected({
			apiKey: 'ls_live_k',
			responses: [[200, { search_metadata: {}, organic_results: [] }]],
		});
		await call('google_search', { page_token: token });
		expect(recorded[0]?.method).toBe('POST');
		expect(recorded[0]?.body).toEqual({ page_token: token });
	});

	it('always POSTs to a body-only route', async () => {
		const payload = {
			id: 'c1',
			object: 'chat.completion',
			choices: [{ index: 0, message: { role: 'assistant', content: 'Hello there' } }],
			citations: [{ url: 'https://example.com' }],
		};
		const { call, text, recorded } = connected({
			apiKey: 'ls_live_k',
			responses: [
				lookup(
					tool('copilot_chat_completions', '/api/copilot/chat/completions', { method: 'POST' }),
				),
				[200, payload],
			],
		});
		const result = await call('call_tool', {
			name: 'copilot_chat_completions',
			arguments: { messages: [{ role: 'user', content: 'Say hello' }], country: 'US' },
		});
		expect(result.isError).toBeFalsy();
		expect(text(result).split('\n\n')[0]).toBe('Copilot answered: 11 characters, 1 citations.');
		expect(recorded[1]?.method).toBe('POST');
		expect(recorded[1]?.body).toEqual({
			messages: [{ role: 'user', content: 'Say hello' }],
			country: 'US',
		});
	});

	it('sends extra client headers with every request', async () => {
		const recorded: Recorded[] = [];
		const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
			recorded.push({
				url: new URL(String(input)),
				method: init?.method ?? 'GET',
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
