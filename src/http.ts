import {
	createServer as createNodeServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { LitescrapeClient, type ClientOptions } from './client.js';
import { createServer } from './server.js';
import { PACKAGE_NAME, VERSION } from './version.js';

export const MCP_PATH = '/mcp';
export const HEALTH_PATH = '/healthz';
// The Litescrape API reads the forwarded address only together with the
// shared secret, and only when it holds exactly one address.
export const FORWARDED_IP_HEADER = 'X-Litescrape-Keyless-Ip';
export const PROXY_SECRET_HEADER = 'X-Litescrape-Keyless-Secret';

export interface HttpOptions {
	/**
	 * Secret shared with the Litescrape API. When set, every upstream request
	 * carries the caller's address under it, so keyless metering applies to the
	 * caller rather than to this server's own address.
	 */
	proxySecret?: string;
	apiUrl?: string;
	timeoutMs?: number;
	fetch?: ClientOptions['fetch'];
	sleep?: ClientOptions['sleep'];
	log?: (line: string) => void;
}

function requestUrl(req: IncomingMessage): URL {
	return new URL(req.url ?? '/', 'http://localhost');
}

export function bearerToken(req: IncomingMessage): string | undefined {
	const header = req.headers.authorization;
	const match = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
	if (match?.[1]) return match[1].trim();
	const fromQuery = requestUrl(req).searchParams.get('api_key')?.trim();
	return fromQuery || undefined;
}

/**
 * The caller as the ingress reports it. X-Forwarded-For is passed through
 * unchanged: the API meters it only when it holds exactly one address, so a
 * crafted multi-hop value is refused there instead of being trusted here.
 */
export function callerAddress(req: IncomingMessage): string | undefined {
	const forwarded = req.headers['x-forwarded-for'];
	const value = (Array.isArray(forwarded) ? forwarded.join(', ') : forwarded)?.trim();
	if (value) return value;
	return req.socket?.remoteAddress || undefined;
}

export function clientForRequest(req: IncomingMessage, options: HttpOptions): LitescrapeClient {
	const headers: Record<string, string> = {};
	const caller = options.proxySecret ? callerAddress(req) : undefined;
	if (options.proxySecret && caller) {
		headers[FORWARDED_IP_HEADER] = caller;
		headers[PROXY_SECRET_HEADER] = options.proxySecret;
	}
	return new LitescrapeClient({
		apiKey: bearerToken(req),
		apiUrl: options.apiUrl,
		timeoutMs: options.timeoutMs,
		headers,
		fetch: options.fetch,
		sleep: options.sleep,
	});
}

function json(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers':
		'Content-Type, Authorization, Accept, Mcp-Session-Id, Mcp-Protocol-Version',
	'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
	'Access-Control-Max-Age': '86400',
};

export async function handleRequest(
	req: IncomingMessage,
	res: ServerResponse,
	options: HttpOptions,
): Promise<void> {
	for (const [name, value] of Object.entries(CORS_HEADERS)) res.setHeader(name, value);
	const { pathname } = requestUrl(req);
	if (req.method === 'OPTIONS') {
		res.writeHead(204);
		res.end();
		return;
	}
	if (pathname === HEALTH_PATH || (pathname === '/' && req.method === 'GET')) {
		json(res, 200, { status: 'ok', name: PACKAGE_NAME, version: VERSION, mcp: MCP_PATH });
		return;
	}
	if (pathname !== MCP_PATH) {
		json(res, 404, { error: `Not found. The MCP endpoint is POST ${MCP_PATH}.` });
		return;
	}
	if (req.method !== 'POST') {
		res.setHeader('Allow', 'POST, OPTIONS');
		json(res, 405, {
			error: `This server is stateless: POST each JSON-RPC message to ${MCP_PATH}.`,
		});
		return;
	}
	// One server and transport per request: nothing is shared between callers,
	// and the client built from this request's own credentials goes with it.
	const server = createServer({ client: clientForRequest(req, options) });
	const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
	res.on('close', () => {
		void transport.close();
		void server.close();
	});
	await server.connect(transport);
	await transport.handleRequest(req, res);
}

export function createHttpServer(options: HttpOptions = {}): Server {
	return createNodeServer((req, res) => {
		handleRequest(req, res, options).catch((error: unknown) => {
			options.log?.(`${req.method ?? ''} ${req.url ?? ''} failed: ${String(error)}`);
			if (res.headersSent) {
				res.end();
			} else {
				json(res, 500, { error: 'Internal server error.' });
			}
		});
	});
}
