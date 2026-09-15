#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { LitescrapeClient } from './client.js';
import { createHttpServer, MCP_PATH } from './http.js';
import { createServer } from './server.js';
import { PACKAGE_NAME, VERSION } from './version.js';

function flag(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	return index === -1 ? undefined : (args[index + 1] ?? '');
}

async function stdio(): Promise<void> {
	const client = LitescrapeClient.fromEnv(process.env);
	const server = createServer({ client });
	await server.connect(new StdioServerTransport());
	// stdout carries the protocol; every log line goes to stderr.
	console.error(
		`${PACKAGE_NAME} ${VERSION} ready (${client.keyed ? 'API key' : 'keyless'} mode, ${client.apiUrl})`,
	);
}

function http(args: string[]): void {
	const port = Number(flag(args, '--port') ?? process.env.PORT ?? 8080);
	const host = flag(args, '--host') ?? process.env.HOST ?? '0.0.0.0';
	const proxySecret = process.env.LITESCRAPE_KEYLESS_PROXY_SECRET?.trim() || undefined;
	const apiUrl = process.env.LITESCRAPE_API_URL?.trim() || undefined;
	const timeoutMs = Number(process.env.LITESCRAPE_TIMEOUT_MS) || undefined;
	const server = createHttpServer({ proxySecret, apiUrl, timeoutMs, log: console.error });
	server.listen(port, host, () => {
		console.error(
			`${PACKAGE_NAME} ${VERSION} listening on http://${host}:${port}${MCP_PATH} ` +
				`(API key per request, caller forwarding ${proxySecret ? 'on' : 'off'})`,
		);
	});
	const stop = () => server.close(() => process.exit(0));
	process.on('SIGTERM', stop);
	process.on('SIGINT', stop);
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.includes('--http') || process.env.LITESCRAPE_MCP_TRANSPORT === 'http') {
		http(args);
		return;
	}
	await stdio();
}

main().catch((error: unknown) => {
	console.error(`${PACKAGE_NAME} failed to start:`, error);
	process.exit(1);
});
