import { PACKAGE_NAME, VERSION } from './version.js';

export const DEFAULT_API_URL = 'https://api.litescrape.com';
export const DEFAULT_TIMEOUT_MS = 120_000;
export const MAX_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 10_000;

export type Params = Record<string, string | number | boolean | undefined>;
export type Payload = Record<string, unknown>;

export interface KeylessAllowance {
	limit: number;
	remaining: number;
}

export interface ApiResult {
	payload: Payload;
	requestId?: string;
	/** Present when the call was served from the keyless allowance. */
	keyless?: KeylessAllowance;
}

export class LitescrapeError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly errorCode: string,
		readonly requestId: string | undefined,
		readonly retryable: boolean,
		readonly retryAfterSeconds?: number,
	) {
		super(message);
		this.name = 'LitescrapeError';
	}
}

export interface ClientOptions {
	apiKey?: string;
	apiUrl?: string;
	timeoutMs?: number;
	fetch?: typeof globalThis.fetch;
	sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

function positiveInteger(value: string | undefined): number | undefined {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export class LitescrapeClient {
	readonly apiUrl: string;
	readonly timeoutMs: number;
	private readonly apiKey: string;
	private readonly fetchImpl: typeof globalThis.fetch;
	private readonly sleep: (ms: number) => Promise<void>;

	constructor(options: ClientOptions = {}) {
		this.apiKey = (options.apiKey ?? '').trim();
		this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.fetchImpl = options.fetch ?? globalThis.fetch;
		this.sleep = options.sleep ?? defaultSleep;
	}

	static fromEnv(env: NodeJS.ProcessEnv): LitescrapeClient {
		return new LitescrapeClient({
			apiKey: env.LITESCRAPE_API_KEY,
			apiUrl: env.LITESCRAPE_API_URL?.trim() || undefined,
			timeoutMs: positiveInteger(env.LITESCRAPE_TIMEOUT_MS),
		});
	}

	get keyed(): boolean {
		return this.apiKey.length > 0;
	}

	get userAgent(): string {
		return `${PACKAGE_NAME}/${VERSION} (node ${process.versions.node}; ${process.platform})`;
	}

	url(path: string, params: Params): string {
		const query = new URLSearchParams();
		for (const [key, value] of Object.entries(params)) {
			if (value === undefined) continue;
			query.set(key, typeof value === 'boolean' ? String(value) : String(value));
		}
		const encoded = query.toString();
		return `${this.apiUrl}${path}${encoded ? `?${encoded}` : ''}`;
	}

	headers(): Record<string, string> {
		const headers: Record<string, string> = {
			Accept: 'application/json',
			'User-Agent': this.userAgent,
			'X-Litescrape-Client': `mcp/${VERSION}`,
		};
		if (this.keyed) headers.Authorization = `Bearer ${this.apiKey}`;
		return headers;
	}

	async get(path: string, params: Params): Promise<ApiResult> {
		for (let attempt = 0; ; attempt += 1) {
			try {
				return await this.once(path, params);
			} catch (error) {
				if (!(error instanceof LitescrapeError) || !error.retryable || attempt >= MAX_RETRIES) {
					throw error;
				}
				const backoff = 1_000 * 2 ** attempt;
				const wait = error.retryAfterSeconds ? error.retryAfterSeconds * 1_000 : backoff;
				await this.sleep(Math.min(wait, MAX_RETRY_WAIT_MS));
			}
		}
	}

	private async once(path: string, params: Params): Promise<ApiResult> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);
		let response: Response;
		try {
			response = await this.fetchImpl(this.url(path, params), {
				method: 'GET',
				headers: this.headers(),
				signal: controller.signal,
			});
		} catch (error) {
			if (controller.signal.aborted) {
				throw new LitescrapeError(
					`The request did not complete within ${this.timeoutMs / 1000} seconds.`,
					0,
					'timeout',
					undefined,
					true,
				);
			}
			const reason = error instanceof Error ? error.message : String(error);
			throw new LitescrapeError(
				`Could not reach ${this.apiUrl}: ${reason}`,
				0,
				'network_error',
				undefined,
				true,
			);
		} finally {
			clearTimeout(timer);
		}

		const requestId = response.headers.get('x-request-id') ?? undefined;
		const body = await response.text();
		let parsed: unknown = null;
		try {
			parsed = body ? JSON.parse(body) : null;
		} catch {
			parsed = null;
		}
		const payload = isRecord(parsed) ? parsed : null;

		if (!response.ok) {
			const message =
				typeof payload?.error === 'string' && payload.error
					? payload.error
					: `Litescrape returned HTTP ${response.status}.`;
			const errorCode =
				typeof payload?.error_code === 'string' && payload.error_code
					? payload.error_code
					: `http_${response.status}`;
			const retryable =
				typeof payload?.retryable === 'boolean'
					? payload.retryable
					: [429, 502, 503, 504].includes(response.status);
			const retryAfter = positiveInteger(response.headers.get('retry-after') ?? undefined);
			throw new LitescrapeError(
				message,
				response.status,
				errorCode,
				typeof payload?.request_id === 'string' ? payload.request_id : requestId,
				retryable,
				retryAfter,
			);
		}
		if (payload === null) {
			throw new LitescrapeError(
				'Litescrape returned a response that is not a JSON object.',
				response.status,
				'invalid_response',
				requestId,
				false,
			);
		}

		const limit = positiveInteger(response.headers.get('x-litescrape-keyless-limit') ?? undefined);
		const remainingHeader = response.headers.get('x-litescrape-keyless-remaining');
		const remaining = remainingHeader === null ? undefined : Number(remainingHeader);
		const keyless =
			limit !== undefined && remaining !== undefined && Number.isInteger(remaining)
				? { limit, remaining }
				: undefined;
		return { payload, requestId, keyless };
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
