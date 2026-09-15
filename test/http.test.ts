import type { AddressInfo } from 'node:net';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';

import { createHttpServer, FORWARDED_IP_HEADER, PROXY_SECRET_HEADER } from '../src/http.js';

type Recorded = { url: URL; headers: Record<string, string> };

const servers: ReturnType<typeof createHttpServer>[] = [];

afterEach(async () => {
	await Promise.all(
		servers
			.splice(0)
			.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
	);
});

async function listening(options: { proxySecret?: string; edgeSecret?: string } = {}) {
	const recorded: Recorded[] = [];
	const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
		recorded.push({
			url: new URL(String(input)),
			headers: { ...(init?.headers as Record<string, string>) },
		});
		return new Response(
			JSON.stringify({ search_metadata: {}, organic_results: [{ position: 1 }] }),
			{
				status: 200,
				headers: {
					'content-type': 'application/json',
					'x-litescrape-keyless-limit': '25',
					'x-litescrape-keyless-remaining': '24',
				},
			},
		);
	}) as typeof fetch;
	const server = createHttpServer({ ...options, fetch: fetchImpl, sleep: async () => {} });
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	return { origin: `http://127.0.0.1:${port}`, recorded };
}

async function connect(url: string, headers: Record<string, string> = {}) {
	const transport = new StreamableHTTPClientTransport(new URL(url), {
		requestInit: { headers },
	});
	const client = new Client({ name: 'http-test', version: '0.0.0' });
	await client.connect(transport);
	return client;
}

function text(result: CallToolResult): string {
	const block = result.content[0];
	return block && block.type === 'text' ? block.text : '';
}

describe('Streamable HTTP mode', () => {
	it('answers health checks and refuses everything but POST /mcp', async () => {
		const { origin } = await listening();
		const health = await fetch(`${origin}/healthz`);
		expect(health.status).toBe(200);
		expect(await health.json()).toMatchObject({ status: 'ok', mcp: '/mcp' });
		expect((await fetch(`${origin}/mcp`)).status).toBe(405);
		expect((await fetch(`${origin}/nope`)).status).toBe(404);
		const preflight = await fetch(`${origin}/mcp`, { method: 'OPTIONS' });
		expect(preflight.status).toBe(204);
		expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
	});

	it('serves a keyless session and forwards the caller under the shared secret', async () => {
		const { origin, recorded } = await listening({ proxySecret: 'shh' });
		const client = await connect(`${origin}/mcp`);
		try {
			expect(client.getInstructions()).toContain('no Litescrape API key');
			const { tools } = await client.listTools();
			expect(tools.map((tool) => tool.name)).toContain('google_reviews');
			const result = (await client.callTool({
				name: 'google_search',
				arguments: { q: 'x' },
			})) as CallToolResult;
			expect(text(result)).toContain('Free allowance: 24 of 25 google_search calls left today');
		} finally {
			await client.close();
		}
		expect(recorded).toHaveLength(1);
		expect(recorded[0]?.headers[FORWARDED_IP_HEADER]).toBe('127.0.0.1');
		expect(recorded[0]?.headers[PROXY_SECRET_HEADER]).toBe('shh');
		expect(recorded[0]?.headers.Authorization).toBeUndefined();
	});

	it('passes X-Forwarded-For through unchanged for the API to judge', async () => {
		const { origin, recorded } = await listening({ proxySecret: 'shh' });
		const client = await connect(`${origin}/mcp`, {
			'X-Forwarded-For': '203.0.113.7, 10.0.0.1',
		});
		try {
			await client.callTool({ name: 'bing_search', arguments: { q: 'x' } });
		} finally {
			await client.close();
		}
		expect(recorded[0]?.headers[FORWARDED_IP_HEADER]).toBe('203.0.113.7, 10.0.0.1');
	});

	it('reads the caller from CF-Connecting-IP only under the edge secret', async () => {
		const { origin, recorded } = await listening({ proxySecret: 'shh', edgeSecret: 'edge' });
		const relayed = await connect(`${origin}/mcp`, {
			'X-Litescrape-Edge-Secret': 'edge',
			'CF-Connecting-IP': '203.0.113.9',
			'X-Forwarded-For': '172.70.1.1, 203.0.113.9',
		});
		try {
			await relayed.callTool({ name: 'bing_search', arguments: { q: 'x' } });
		} finally {
			await relayed.close();
		}
		expect(recorded[0]?.headers[FORWARDED_IP_HEADER]).toBe('203.0.113.9');
		expect(recorded[0]?.headers[PROXY_SECRET_HEADER]).toBe('shh');

		const bypassing: Record<string, string>[] = [
			{ 'CF-Connecting-IP': '203.0.113.9', 'X-Forwarded-For': '203.0.113.9' },
			{ 'X-Litescrape-Edge-Secret': 'wrong', 'CF-Connecting-IP': '203.0.113.9' },
		];
		for (const headers of bypassing) {
			const direct = await connect(`${origin}/mcp`, headers);
			try {
				await direct.callTool({ name: 'bing_search', arguments: { q: 'x' } });
			} finally {
				await direct.close();
			}
		}
		expect(recorded).toHaveLength(3);
		expect(recorded[1]?.headers[FORWARDED_IP_HEADER]).toBeUndefined();
		expect(recorded[1]?.headers[PROXY_SECRET_HEADER]).toBeUndefined();
		expect(recorded[2]?.headers[FORWARDED_IP_HEADER]).toBeUndefined();
	});

	it('forwards nothing about the caller when no secret is configured', async () => {
		const { origin, recorded } = await listening();
		const client = await connect(`${origin}/mcp`);
		try {
			await client.callTool({ name: 'duckduckgo_search', arguments: { q: 'x' } });
		} finally {
			await client.close();
		}
		expect(recorded[0]?.headers[FORWARDED_IP_HEADER]).toBeUndefined();
		expect(recorded[0]?.headers[PROXY_SECRET_HEADER]).toBeUndefined();
	});

	it('takes the API key from the bearer header or the api_key query parameter', async () => {
		const { origin, recorded } = await listening({ proxySecret: 'shh' });
		const bearer = await connect(`${origin}/mcp`, { Authorization: 'Bearer ls_live_k' });
		try {
			expect(bearer.getInstructions()).toContain('authenticated with a Litescrape API key');
			await bearer.callTool({ name: 'google_ai_overview', arguments: { q: 'x' } });
		} finally {
			await bearer.close();
		}
		const query = await connect(`${origin}/mcp?api_key=ls_live_q`);
		try {
			await query.callTool({ name: 'google_search', arguments: { q: 'x' } });
		} finally {
			await query.close();
		}
		expect(recorded.map((request) => request.headers.Authorization)).toEqual([
			'Bearer ls_live_k',
			'Bearer ls_live_q',
		]);
		expect(recorded[0]?.url.pathname).toBe('/api/google/ai-overview');
	});
});
