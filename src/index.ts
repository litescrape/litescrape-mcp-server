#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { LitescrapeClient } from './client.js';
import { createServer } from './server.js';
import { PACKAGE_NAME, VERSION } from './version.js';

async function main(): Promise<void> {
	const client = LitescrapeClient.fromEnv(process.env);
	const server = createServer({ client });
	await server.connect(new StdioServerTransport());
	// stdout carries the protocol; every log line goes to stderr.
	console.error(
		`${PACKAGE_NAME} ${VERSION} ready (${client.keyed ? 'API key' : 'keyless'} mode, ${client.apiUrl})`,
	);
}

main().catch((error: unknown) => {
	console.error(`${PACKAGE_NAME} failed to start:`, error);
	process.exit(1);
});
