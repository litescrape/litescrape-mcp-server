import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
	LitescrapeClient,
	LitescrapeError,
	type KeylessAllowance,
	type Params,
	type Payload,
} from './client.js';
import { instructions, keyRequiredMessage } from './messages.js';
import { SURFACES, type Surface } from './surfaces.js';
import { PACKAGE_NAME, VERSION } from './version.js';

export { LitescrapeClient, LitescrapeError } from './client.js';
export { SURFACES } from './surfaces.js';

// Error codes whose message already carries the "Fix:" line for the caller.
const SELF_EXPLANATORY = new Set([
	'mcp_keyless_daily_limit',
	'mcp_keyless_concurrency_limit',
	'mcp_keyless_capacity_limit',
	'mcp_api_key_required',
	'mcp_keyless_network_unknown',
]);

export function toParams(args: Record<string, unknown>): Params {
	const params: Params = {};
	for (const [key, value] of Object.entries(args)) {
		if (value === undefined || value === null || key === 'result_groups') continue;
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			params[key] = value;
		}
	}
	return params;
}

export function selectGroups(payload: Payload, groups: unknown): Payload {
	if (!Array.isArray(groups) || groups.length === 0) return payload;
	const wanted = new Set(groups.filter((group): group is string => typeof group === 'string'));
	wanted.add('search_metadata');
	const selected: Payload = {};
	for (const [key, value] of Object.entries(payload)) {
		if (wanted.has(key)) selected[key] = value;
	}
	return selected;
}

export function allowanceLine(surface: Surface, allowance: KeylessAllowance): string {
	return `Free allowance: ${allowance.remaining} of ${allowance.limit} ${surface.name} calls left today (no API key set).`;
}

export function formatError(error: LitescrapeError): string {
	if (SELF_EXPLANATORY.has(error.errorCode)) return error.message;
	const request = error.requestId ? `, request ${error.requestId}` : '';
	const retry = error.retryable ? ' The call was not charged; retrying may succeed.' : '';
	return `Litescrape ${error.errorCode} (HTTP ${error.status}${request}): ${error.message}${retry}`;
}

function textResult(text: string, structured?: Payload, isError = false): CallToolResult {
	const result: CallToolResult = { content: [{ type: 'text', text }] };
	if (structured !== undefined) result.structuredContent = structured;
	if (isError) result.isError = true;
	return result;
}

export interface ServerOptions {
	client: LitescrapeClient;
}

export function createServer({ client }: ServerOptions): McpServer {
	const server = new McpServer(
		{ name: PACKAGE_NAME, version: VERSION },
		{ instructions: instructions(client.keyed), capabilities: { tools: {} } },
	);

	for (const surface of SURFACES) {
		server.registerTool(
			surface.name,
			{
				title: surface.title,
				description: surface.description,
				inputSchema: surface.inputSchema,
				annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
			},
			async (args: Record<string, unknown>) => {
				if (!client.keyed && !surface.keyless) {
					return textResult(keyRequiredMessage(surface.name), undefined, true);
				}
				const params: Params = { ...toParams(args), ...surface.defaults };
				try {
					const { payload, keyless } = await client.get(surface.path, params);
					const selected = selectGroups(payload, args.result_groups);
					const summary = keyless
						? `${surface.summarize(payload, args)} ${allowanceLine(surface, keyless)}`
						: surface.summarize(payload, args);
					return textResult(`${summary}\n\n${JSON.stringify(selected)}`, selected);
				} catch (error) {
					if (error instanceof LitescrapeError)
						return textResult(formatError(error), undefined, true);
					throw error;
				}
			},
		);
	}

	return server;
}
