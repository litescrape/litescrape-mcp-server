import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { ALWAYS_ON } from './catalog.js';
import { isRecord, type LitescrapeClient, type Payload } from './client.js';

/** One Litescrape API endpoint as /api/tools describes it. */
export interface CatalogTool {
	name: string;
	title: string;
	description: string;
	method: 'GET' | 'POST';
	path: string;
	/** Served without an API key from the per-network daily allowance. */
	keyless: boolean;
	input_schema: Record<string, unknown>;
	/** Set on find results: one of the closest matches for the use case. */
	best_match?: boolean;
}

export const TOOLS_PATH = '/api/tools';
export const DEFAULT_FIND_LIMIT = 5;
export const MAX_FIND_LIMIT = 25;

export const KEYLESS_TOOLS = ALWAYS_ON.map((tool) => tool.name);

const ANNOTATIONS = { readOnlyHint: true, idempotentHint: false, openWorldHint: true };

const RESULT_GROUPS = {
	type: 'array',
	items: { type: 'string', minLength: 1 },
	description:
		'Return only these top-level result groups, e.g. ["organic_results", "knowledge_graph"]; ' +
		'omit for the complete response. search_metadata is always kept',
};

/** The MCP listing of a catalog tool: its API schema plus result_groups, applied by this server. */
export function listed(tool: CatalogTool): Tool {
	const schema = tool.input_schema;
	const properties = isRecord(schema.properties) ? schema.properties : {};
	return {
		name: tool.name,
		title: tool.title,
		description: tool.description,
		inputSchema: {
			...schema,
			type: 'object',
			properties: { ...properties, result_groups: RESULT_GROUPS },
		},
		annotations: ANNOTATIONS,
	};
}

export const FIND_TOOLS: Tool = {
	name: 'find_tools',
	title: 'Find Litescrape tools',
	description:
		'Find the Litescrape tools for a task beyond the ones listed here: AI answers, maps details ' +
		'and reviews, app stores, retailers, real estate, jobs, social media, web pages and more. ' +
		'Describe the task in q to get the best matches first, or pass names to fetch specific ' +
		'tools. Each tool comes with its description and whether it works without an API key; ' +
		'best matches and named tools also carry their input schema. Run one with call_tool.',
	inputSchema: {
		type: 'object',
		properties: {
			q: {
				type: 'string',
				minLength: 3,
				maxLength: 500,
				description: 'The task, in plain language, e.g. "track competitor prices on Amazon"',
			},
			names: {
				type: 'array',
				items: { type: 'string', minLength: 1 },
				minItems: 1,
				maxItems: MAX_FIND_LIMIT,
				description: 'Tool names to fetch with their input schemas, instead of q',
			},
			limit: {
				type: 'integer',
				minimum: 1,
				maximum: MAX_FIND_LIMIT,
				description: `Most tools to return for q; default ${DEFAULT_FIND_LIMIT}`,
			},
		},
	},
	annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
};

export const CALL_TOOL: Tool = {
	name: 'call_tool',
	title: 'Call a Litescrape tool',
	description:
		'Run a Litescrape tool found with find_tools. Pass its name and arguments matching its ' +
		'input schema; arguments may also take result_groups to keep only some top-level groups.',
	inputSchema: {
		type: 'object',
		properties: {
			name: { type: 'string', minLength: 1, description: 'Tool name from find_tools' },
			arguments: {
				type: 'object',
				description: 'Arguments for the tool, matching its input schema; {} when it needs none',
			},
		},
		required: ['name'],
	},
	annotations: ANNOTATIONS,
};

function catalogTool(value: unknown): CatalogTool | undefined {
	if (!isRecord(value) || typeof value.name !== 'string' || typeof value.path !== 'string') {
		return undefined;
	}
	return value as unknown as CatalogTool;
}

function toolsOf(payload: Payload): CatalogTool[] {
	const tools = Array.isArray(payload.tools) ? payload.tools : [];
	return tools.map(catalogTool).filter((tool): tool is CatalogTool => tool !== undefined);
}

// Tool definitions change only with an API release, so every session in the process shares them.
const known = new Map<string, CatalogTool>(ALWAYS_ON.map((tool) => [tool.name, tool]));

/** Forget every tool looked up so far; for tests. */
export function forgetLookups(): void {
	known.clear();
	for (const tool of ALWAYS_ON) known.set(tool.name, tool);
}

/** The catalog's tools for a use case, best matches first. */
export async function findTools(
	client: LitescrapeClient,
	query: string,
	limit: number,
): Promise<CatalogTool[]> {
	const { payload } = await client.get(TOOLS_PATH, { q: query, limit });
	const tools = toolsOf(payload);
	for (const tool of tools) known.set(tool.name, tool);
	return tools;
}

/** The named tools, from memory where possible; the API rejects an unknown name. */
export async function lookupTools(
	client: LitescrapeClient,
	names: string[],
): Promise<CatalogTool[]> {
	const missing = names.filter((name) => !known.has(name));
	if (missing.length) {
		const { payload } = await client.get(TOOLS_PATH, { names: missing.join(',') });
		for (const tool of toolsOf(payload)) known.set(tool.name, tool);
	}
	return names.map((name) => known.get(name)).filter((tool): tool is CatalogTool => !!tool);
}
