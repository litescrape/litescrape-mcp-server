import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
	getDefaultEnvironment,
	StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('stdio entry point', () => {
	it('starts over stdio, announces itself and lists the tools', async () => {
		const env: Record<string, string> = {
			...getDefaultEnvironment(),
			LITESCRAPE_API_URL: 'http://127.0.0.1:9',
		};
		delete env.LITESCRAPE_API_KEY;
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: ['--import', 'tsx', 'src/index.ts'],
			cwd: root,
			env,
			stderr: 'pipe',
		});
		const banner: string[] = [];
		transport.stderr?.on('data', (chunk: Buffer) => banner.push(chunk.toString()));
		const client = new Client({ name: 'stdio-test', version: '0.0.0' });
		try {
			await client.connect(transport);
			const { tools } = await client.listTools();
			expect(tools.map((tool) => tool.name)).toContain('google_search');
			expect(client.getServerVersion()?.name).toBe('litescrape-mcp-server');
			expect(client.getInstructions()).toContain('no Litescrape API key');
		} finally {
			await client.close();
		}
		expect(banner.join('')).toContain('keyless mode');
	}, 30_000);
});
