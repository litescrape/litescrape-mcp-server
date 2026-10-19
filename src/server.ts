import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

import {
	LitescrapeClient,
	LitescrapeError,
	isRecord,
	type KeylessAllowance,
	type Params,
	type Payload,
} from './client.js';
import { ALWAYS_ON } from './catalog.js';
import { instructions, keyRequiredMessage } from './messages.js';
import { summarize } from './summaries.js';
import {
	CALL_TOOL,
	DEFAULT_FIND_LIMIT,
	FIND_TOOLS,
	findTools,
	listed,
	lookupTools,
	MAX_FIND_LIMIT,
	type CatalogTool,
} from './tools.js';
import { PACKAGE_NAME, VERSION } from './version.js';

export { ALWAYS_ON } from './catalog.js';
export { LitescrapeClient, LitescrapeError } from './client.js';
export type { CatalogTool } from './tools.js';

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

/** The arguments as a JSON body: arrays and objects kept, result_groups and unset values dropped. */
export function toBody(args: Record<string, unknown>): Payload {
	const body: Payload = {};
	for (const [key, value] of Object.entries(args)) {
		if (value === undefined || value === null || key === 'result_groups') continue;
		body[key] = value;
	}
	return body;
}

// Longer values (continuation tokens, long prompts) go in a JSON body rather than the URL.
const MAX_QUERY_VALUE = 2048;

/** True when an argument cannot travel in a GET query string: an array, an object or a long value. */
export function needsBody(args: Record<string, unknown>): boolean {
	return Object.entries(args).some(
		([key, value]) =>
			key !== 'result_groups' &&
			((typeof value === 'object' && value !== null) ||
				(typeof value === 'string' && value.length > MAX_QUERY_VALUE)),
	);
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

export function allowanceLine(name: string, allowance: KeylessAllowance): string {
	return `Free allowance: ${allowance.remaining} of ${allowance.limit} ${name} calls left today (no API key set).`;
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

/** Call one Litescrape endpoint and lead its unchanged JSON with a one-line summary. */
async function run(
	client: LitescrapeClient,
	tool: CatalogTool,
	args: Record<string, unknown>,
): Promise<CallToolResult> {
	if (!client.keyed && !tool.keyless) {
		return textResult(keyRequiredMessage(tool.name), undefined, true);
	}
	const { payload, keyless } =
		tool.method === 'POST' || needsBody(args)
			? await client.post(tool.path, toBody(args))
			: await client.get(tool.path, toParams(args));
	const selected = selectGroups(payload, args.result_groups);
	const line = summarize(tool.name, tool.title, payload, args);
	const summary = keyless ? `${line} ${allowanceLine(tool.name, keyless)}` : line;
	return textResult(
		`${summary}

${JSON.stringify(selected)}`,
		selected,
	);
}

/** A find result: the input schema only for the tools the caller is likely to run. */
function found(tool: CatalogTool, withSchema: boolean): Payload {
	const entry: Payload = {
		name: tool.name,
		title: tool.title,
		description: tool.description,
		keyless: tool.keyless,
	};
	if (withSchema) entry.input_schema = tool.input_schema;
	return entry;
}

async function find(
	client: LitescrapeClient,
	args: Record<string, unknown>,
): Promise<CallToolResult> {
	const { q, names, limit = DEFAULT_FIND_LIMIT } = args;
	if (Array.isArray(names) && names.length) {
		if (!names.every((name) => typeof name === 'string' && name.trim())) {
			return textResult('names must be a list of tool names.', undefined, true);
		}
		const tools = await lookupTools(
			client,
			names.map((name: string) => name.trim()),
		);
		const listedNames = tools.map((tool) => tool.name).join(', ');
		const payload = { tools: tools.map((tool) => found(tool, true)) };
		return textResult(
			`Litescrape tools: ${listedNames}.

${JSON.stringify(payload)}`,
			payload,
		);
	}
	if (typeof q !== 'string' || q.trim().length < 3) {
		return textResult(
			'Describe the task in q (at least 3 characters), or pass names.',
			undefined,
			true,
		);
	}
	if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_FIND_LIMIT) {
		return textResult(`limit must be an integer from 1 to ${MAX_FIND_LIMIT}.`, undefined, true);
	}
	const tools = await findTools(client, q.trim(), limit as number);
	const payload = { tools: tools.map((tool) => found(tool, tool.best_match === true)) };
	const listedNames = tools.length ? tools.map((tool) => tool.name).join(', ') : 'none';
	return textResult(
		`Litescrape tools for "${q.trim()}": ${listedNames}. Fetch a schema that is not shown with ` +
			`find_tools names.

${JSON.stringify(payload)}`,
		payload,
	);
}

/** Run a catalog tool by name, looking up its definition when this process has not seen it. */
async function call(
	client: LitescrapeClient,
	name: unknown,
	args: unknown,
): Promise<CallToolResult> {
	if (typeof name !== 'string' || !name.trim()) {
		return textResult('Pass the name of a tool from find_tools.', undefined, true);
	}
	if (args !== undefined && !isRecord(args)) {
		return textResult("arguments must be an object of the tool's parameters.", undefined, true);
	}
	const [tool] = await lookupTools(client, [name.trim()]);
	if (!tool)
		return textResult(`Unknown tool ${name}. Use find_tools to find one.`, undefined, true);
	return run(client, tool, args ?? {});
}

export interface ServerOptions {
	client: LitescrapeClient;
}

export function createServer({ client }: ServerOptions): Server {
	const server = new Server(
		{ name: PACKAGE_NAME, version: VERSION },
		{ instructions: instructions(client.keyed), capabilities: { tools: {} } },
	);
	const tools = [...ALWAYS_ON.map(listed), FIND_TOOLS, CALL_TOOL];

	server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name } = request.params;
		const args = request.params.arguments ?? {};
		try {
			if (name === FIND_TOOLS.name) return await find(client, args);
			if (name === CALL_TOOL.name) return await call(client, args.name, args.arguments);
			// A listed tool, or a catalog tool called by name directly: both run the same way.
			return await call(client, name, args);
		} catch (error) {
			if (error instanceof LitescrapeError) return textResult(formatError(error), undefined, true);
			throw error;
		}
	});

	return server;
}
