import { z } from 'zod';

import { isRecord, type Params, type Payload } from './client.js';

export interface Surface {
	name: string;
	title: string;
	description: string;
	path: string;
	/** Served without an API key from the per-network daily allowance. */
	keyless: boolean;
	inputSchema: z.ZodRawShape;
	/** Fixed query parameters the caller cannot override. */
	defaults?: Params;
	/** The route accepts only a JSON POST body. Other surfaces POST only when an argument is an array or object. */
	post?: boolean;
	summarize: (payload: Payload, args: Record<string, unknown>) => string;
}

const device = z
	.enum(['desktop', 'tablet', 'mobile'])
	.optional()
	.describe('Layout to request; default desktop');
const gl = z
	.string()
	.length(2)
	.optional()
	.describe('Two-letter country for localization, e.g. "us"');
const hl = z
	.string()
	.min(2)
	.max(10)
	.optional()
	.describe('Language code such as "en" or "en-GB"; default en');
const googleDomain = z
	.string()
	.optional()
	.describe('Google domain such as google.co.uk; default google.com');
const location = z
	.string()
	.max(512)
	.optional()
	.describe('Named search origin such as "Austin, Texas"; conflicts with uule and lat/lon');
const uule = z
	.string()
	.max(2048)
	.optional()
	.describe('Pre-encoded Google location token; conflicts with location');
const lat = z.number().min(-90).max(90).optional().describe('Latitude; supply together with lon');
const lon = z
	.number()
	.min(-180)
	.max(180)
	.optional()
	.describe('Longitude; supply together with lat');
const resultGroups = z
	.array(z.string().min(1))
	.optional()
	.describe(
		'Return only these top-level result groups, e.g. ["organic_results", "knowledge_graph"]; ' +
			'omit for the complete response. search_metadata is always kept',
	);

const googleSearchBase = {
	q: z
		.string()
		.min(1)
		.max(2048)
		.optional()
		.describe('Search query; required unless ludocid or kgmid is supplied'),
	ludocid: z.string().optional().describe('Google CID of a local entity, for a targeted lookup'),
	kgmid: z.string().optional().describe('Knowledge Graph machine ID such as /m/0k8z'),
	location,
	uule,
	lat,
	lon,
	radius: z
		.number()
		.min(1)
		.max(1000)
		.optional()
		.describe(
			'Radius in meters around the location or coordinates: 1-199 on desktop, up to 1000 on ' +
				'tablet or mobile',
		),
	google_domain: googleDomain,
	gl,
	hl,
	cr: z.string().optional().describe('Country restrict such as countryUS|countryCA'),
	lr: z.string().optional().describe('Language restrict such as lang_en|lang_fr'),
	tbs: z
		.string()
		.max(4096)
		.optional()
		.describe('Google search-filter string, e.g. qdr:w for the past week'),
	tbm: z
		.enum(['lcl', 'vid', 'nws', 'shop', 'pts'])
		.optional()
		.describe('Vertical: lcl local, vid videos, nws news, shop shopping, pts patents'),
	safe: z.enum(['active', 'off']).optional().describe('SafeSearch'),
	nfpr: z.enum(['0', '1']).optional().describe('1 disables spelling auto-correction'),
	filter: z.enum(['0', '1']).optional().describe('0 disables duplicate-content filtering'),
	as_sitesearch: z.string().max(253).optional().describe('Restrict results to this hostname'),
	as_qdr: z
		.string()
		.optional()
		.describe('Date range: d, w, m or y with an optional count, e.g. d7 for the past week'),
	start: z.number().int().min(0).optional().describe('Result offset for pagination'),
	num: z
		.number()
		.int()
		.min(1)
		.max(10)
		.optional()
		.describe('Requested result count, 1-10; Google may return fewer'),
	device,
};

function count(payload: Payload, key: string): number | undefined {
	const value = payload[key];
	return Array.isArray(value) ? value.length : undefined;
}

function presentGroups(payload: Payload, skip: string[]): string[] {
	return Object.keys(payload).filter(
		(key) => !skip.includes(key) && key !== 'search_metadata' && key !== 'search_parameters',
	);
}

function quoted(args: Record<string, unknown>, key: string | null = 'q'): string {
	const value = key === null ? undefined : args[key];
	return typeof value === 'string' ? ` for "${value}"` : '';
}

// Group names that page or describe a response rather than carry results.
const PAGING = ['search_information', 'pagination', 'litescrape_pagination'];

function more(payload: Payload): string {
	const pagination = isRecord(payload.pagination) ? payload.pagination : {};
	const next =
		payload.has_more === true ||
		typeof payload.next_max_id === 'string' ||
		typeof pagination.next === 'string' ||
		typeof pagination.next_page_token === 'string' ||
		typeof pagination.continuation_token === 'string' ||
		typeof pagination.next_cursor === 'string';
	return next ? '; more pages available' : '';
}

function summarizeSerp(engine: string, key: string | null = 'q'): Surface['summarize'] {
	return (payload, args) => {
		const organic = count(payload, 'organic_results') ?? 0;
		const others = presentGroups(payload, ['organic_results', ...PAGING]);
		const also = others.length ? `; also ${others.join(', ')}` : '';
		return `${engine}${quoted(args, key)}: ${organic} organic results${also}.`;
	};
}

/** "<label> for "<query>": <n> <noun>", for responses built around one list. */
function summarizeCount(
	label: string,
	group: string,
	noun: string,
	key: string | null = 'q',
): Surface['summarize'] {
	return (payload, args) => {
		const found = count(payload, group) ?? 0;
		return `${label}${quoted(args, key)}: ${found} ${noun}${more(payload)}.`;
	};
}

const NAMES = ['title', 'name', 'nickname', 'unique_id', 'username', 'screen_name', 'address'];

/** "<label>: <name>", for responses built around one record (the whole payload when group is omitted). */
function summarizeRecord(label: string, group?: string): Surface['summarize'] {
	return (payload) => {
		const record = group === undefined ? payload : payload[group];
		if (!isRecord(record)) return `${label}: not found.`;
		const name = NAMES.map((field) => record[field]).find(
			(value): value is string => typeof value === 'string' && value.length > 0,
		);
		return `${label}: ${name ?? 'found'}.`;
	};
}

/** "<label> for "<query>": <groups>", for responses whose groups vary by request. */
function summarizeGroups(label: string, key: string | null = 'q'): Surface['summarize'] {
	return (payload, args) => {
		const groups = presentGroups(payload, PAGING);
		const listed = groups.length ? groups.join(', ') : 'no result groups';
		return `${label}${quoted(args, key)}: ${listed}${more(payload)}.`;
	};
}

/** Generated answers with text blocks, references and an optional follow-up token. */
function summarizeAnswer(label: string, token?: string, key = 'q'): Surface['summarize'] {
	return (payload, args) => {
		const blocks = count(payload, 'text_blocks') ?? 0;
		const references = count(payload, 'references') ?? 0;
		const followUp =
			token !== undefined && typeof payload[token] === 'string' ? '; follow-up token included' : '';
		return `${label}${quoted(args, key)}: ${blocks} text blocks, ${references} references${followUp}.`;
	};
}

/** Plain-text replies such as Gemini's. */
function summarizeText(label: string, field: string, key: string): Surface['summarize'] {
	return (payload, args) => {
		const value = payload[field];
		const size = typeof value === 'string' ? `${value.length} characters` : 'no text';
		const followUp =
			typeof payload.subsequent_request_token === 'string' ? '; follow-up token included' : '';
		return `${label}${quoted(args, key)}: ${size}${followUp}.`;
	};
}

export const SURFACES: Surface[] = [
	{
		name: 'search',
		title: 'Web search',
		description:
			'Search the web through Google and return ranked organic results (title, link, snippet) ' +
			'as JSON. Fast mode: no Knowledge Graph, ads or AI modules; use google_search for the ' +
			'full results page. Free without an API key (shares the google_search allowance).',
		path: '/api/google/search',
		keyless: true,
		inputSchema: {
			q: z.string().min(1).max(2048).describe('What to search for'),
			gl,
			hl,
			location,
			num: z
				.number()
				.int()
				.min(1)
				.max(10)
				.optional()
				.describe('Requested result count, 1-10; Google may return fewer'),
			start: z.number().int().min(0).optional().describe('Result offset for pagination'),
			result_groups: resultGroups,
		},
		defaults: { fast_mode: true },
		summarize: summarizeSerp('Google Search (fast mode)'),
	},
	{
		name: 'google_search',
		title: 'Google Search',
		description:
			'Fetch a first-party Google Search results page as JSON: organic_results plus whichever ' +
			'modules Google served (knowledge_graph, answer_box, ai_overview, ads, related_questions, ' +
			'related_searches, local_results, top_stories, inline_videos and more). Supports ' +
			'localization, verticals (news, videos, local, shopping, patents), date filters and site ' +
			'restriction. Free without an API key: 25 calls per network per day.',
		path: '/api/google/search',
		keyless: true,
		inputSchema: {
			...googleSearchBase,
			page_token: z
				.string()
				.max(32768)
				.optional()
				.describe(
					'pagination.next_page_token from a previous response; send it alone (no q) for the ' +
						'next page with the original parameters. Expires after 5 minutes; not for tbm verticals',
				),
			fast_mode: z
				.boolean()
				.optional()
				.describe(
					'true returns only organic_results (faster and smaller); skips AI Overview, ' +
						'Knowledge Graph, ads and every other module',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeSerp('Google Search'),
	},
	{
		name: 'bing_search',
		title: 'Bing Search',
		description:
			'Fetch a Bing web search results page as JSON: organic_results plus the modules Bing ' +
			'served (answer_box, knowledge_graph, copilot_answer, ads, related_questions, ' +
			'inline_videos, top_stories and more). Free without an API key: 50 calls per network ' +
			'per day.',
		path: '/api/bing/search',
		keyless: true,
		inputSchema: {
			q: z.string().min(1).max(2048).describe('Search query; Bing operators are preserved'),
			location: z.string().max(256).optional().describe('City-level search origin'),
			lat,
			lon,
			mkt: z.string().optional().describe('Market such as en-US; conflicts with cc'),
			cc: z.string().length(2).optional().describe('Two-letter country code; conflicts with mkt'),
			first: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe('One-based organic result offset for pagination; default 1'),
			safeSearch: z.enum(['off', 'moderate', 'strict']).optional().describe('Default moderate'),
			filters: z.string().max(8192).optional().describe('Native Bing display or date filters'),
			device,
			result_groups: resultGroups,
		},
		summarize: summarizeSerp('Bing'),
	},
	{
		name: 'duckduckgo_search',
		title: 'DuckDuckGo Search',
		description:
			'Fetch ranked DuckDuckGo web results (organic_results with title, link, snippet) with ' +
			'region, safety and date controls. Free without an API key: 50 calls per network per day.',
		path: '/api/duckduckgo/search',
		keyless: true,
		inputSchema: {
			q: z.string().min(1).max(500).describe('Search query'),
			kl: z.string().max(32).optional().describe('Region and language token such as us-en'),
			search_assist: z.boolean().optional().describe('Default true; cannot be combined with m'),
			safe: z
				.enum(['1', '-1', '-2'])
				.optional()
				.describe('1 strict, -1 moderate (default), -2 off'),
			df: z.string().optional().describe('Date filter: d, w, m, y, or YYYY-MM-DD..YYYY-MM-DD'),
			start: z.number().int().min(0).max(10000).optional().describe('Result offset'),
			m: z
				.number()
				.int()
				.min(1)
				.max(50)
				.optional()
				.describe('Result count 1-50; cannot be combined with search_assist'),
			result_groups: resultGroups,
		},
		summarize: summarizeSerp('DuckDuckGo'),
	},
	{
		name: 'google_maps',
		title: 'Google Maps',
		description:
			'Search Google Maps for places (local_results with name, address, rating, reviews, ' +
			'hours, phone, website, coordinates) or fetch one exact place (place_results) by ' +
			'place_id, data_cid or data sequence. Filter by price, rating and opening hours. Free ' +
			'without an API key: 50 calls per network per day.',
		path: '/api/google/maps',
		keyless: true,
		inputSchema: {
			q: z.string().optional().describe('Search text; required for type=search'),
			type: z
				.enum(['search', 'place'])
				.optional()
				.describe(
					'search (default) for a query, or place for one exact place identified by ' +
						'place_id, data_cid or data',
				),
			ll: z.string().optional().describe('Viewport as @lat,lon,14z or @lat,lon,5000m'),
			location,
			lat,
			lon,
			z: z.number().min(3).max(30).optional().describe('Zoom 3-30; use with location or lat/lon'),
			m: z.number().min(1).optional().describe('Radius in meters; use with location or lat/lon'),
			nearby: z.boolean().optional().describe('Restrict results to places near the viewport'),
			place_id: z.string().optional().describe('Exact place by Google place ID'),
			data_cid: z.string().optional().describe('Exact place by decimal Google CID'),
			data: z.string().max(8192).optional().describe('Exact place by Google Maps data sequence'),
			start: z.number().int().min(0).optional().describe('Native Maps result offset'),
			hl,
			gl,
			google_domain: googleDomain,
			min_price: z.number().int().min(0).optional().describe('Price level lower bound'),
			max_price: z.number().int().min(0).optional().describe('Price level upper bound'),
			min_rating: z
				.enum(['2.0', '2.5', '3.0', '3.5', '4.0', '4.5'])
				.optional()
				.describe('Minimum rating preference'),
			open_state: z
				.enum(['now', '24h'])
				.optional()
				.describe('Open now, or open 24 hours; cannot combine with open_on_day'),
			open_on_day: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']).optional(),
			open_at_hour: z
				.number()
				.int()
				.min(0)
				.max(23)
				.optional()
				.describe('Hour 0-23; requires open_on_day'),
			result_groups: resultGroups,
		},
		summarize: (payload, args) => {
			const place = payload.place_results;
			if (isRecord(place)) {
				const title = typeof place.title === 'string' ? place.title : 'one place';
				return `Google Maps place: ${title}.`;
			}
			const places = count(payload, 'local_results') ?? 0;
			return `Google Maps${quoted(args)}: ${places} places.`;
		},
	},
	{
		name: 'google_ai_overview',
		title: 'Google AI Overview',
		description:
			'Return only the AI Overview Google generates for a search (ai_overview with ordered ' +
			'text_blocks and cited references), or null when Google shows none. Accepts the ' +
			'google_search parameters. Requires an API key.',
		path: '/api/google/ai-overview',
		keyless: false,
		inputSchema: { ...googleSearchBase, result_groups: resultGroups },
		summarize: (payload, args) => {
			const overview = payload.ai_overview;
			if (!isRecord(overview)) return `Google served no AI Overview${quoted(args)}.`;
			if (isRecord(overview.error)) return `Google AI Overview${quoted(args)}: unavailable.`;
			const blocks = count(overview, 'text_blocks') ?? 0;
			const references = count(overview, 'references') ?? 0;
			return `Google AI Overview${quoted(args)}: ${blocks} text blocks, ${references} references.`;
		},
	},
	{
		name: 'google_ai_mode',
		title: 'Google AI Mode',
		description:
			'Ask Google AI Mode a question and return its generated answer (ordered text_blocks: ' +
			'paragraphs, headings, lists, tables, code) with the sources it cited (references). ' +
			'Set continuable to get a token for follow-up questions; image_url adds a picture to ' +
			'the prompt. Slow: answers are generated per request. Requires an API key.',
		path: '/api/google/ai-mode',
		keyless: false,
		inputSchema: {
			q: z.string().min(1).max(2048).describe('The question to ask'),
			location,
			uule,
			google_domain: googleDomain,
			gl,
			hl,
			device,
			continuable: z
				.boolean()
				.optional()
				.describe('Return a subsequent_request_token so the conversation can continue'),
			subsequent_request_token: z
				.string()
				.optional()
				.describe(
					'Token from a previous continuable answer; send with a new q. Expires after ' +
						'30 minutes; cannot combine with image_url',
				),
			image_url: z
				.string()
				.url()
				.optional()
				.describe('Public http(s) image to include in the prompt; cannot combine with a token'),
			result_groups: resultGroups,
		},
		summarize: (payload, args) => {
			const blocks = count(payload, 'text_blocks') ?? 0;
			const references = count(payload, 'references') ?? 0;
			const token =
				typeof payload.subsequent_request_token === 'string' ? '; follow-up token included' : '';
			return `Google AI Mode${quoted(args)}: ${blocks} text blocks, ${references} references${token}.`;
		},
	},
	{
		name: 'google_shopping',
		title: 'Google Shopping',
		description:
			'Search Google Shopping and return the product grid (shopping_results with title, ' +
			'price, source, rating, thumbnail), category blocks, sponsored listings and the ' +
			'refinement chips Google renders (filters). Price bounds, sale, shipping and small ' +
			'business refinements are mutually exclusive; sort_by combines with one of them. ' +
			'Requires an API key.',
		path: '/api/google/shopping',
		keyless: false,
		inputSchema: {
			q: z
				.string()
				.min(1)
				.max(2048)
				.optional()
				.describe('Product query; required unless shoprs is supplied'),
			location,
			uule,
			google_domain: googleDomain,
			gl,
			hl,
			shoprs: z
				.string()
				.max(4096)
				.optional()
				.describe("Refinement token from a previous response's filters"),
			min_price: z.number().min(0).optional().describe('Lower price bound'),
			max_price: z.number().min(0).optional().describe('Upper price bound'),
			sort_by: z
				.enum(['1', '2', '3', '4'])
				.optional()
				.describe('1 price low to high, 2 price high to low, 3 rating, 4 relevance'),
			free_shipping: z.boolean().optional(),
			on_sale: z.boolean().optional(),
			small_business: z.boolean().optional(),
			start: z.number().int().min(0).max(1000).optional().describe('Result offset'),
			num: z.number().int().min(1).max(100).optional().describe('Product count, 1-100'),
			device,
			result_groups: resultGroups,
		},
		summarize: (payload, args) => {
			const products = count(payload, 'shopping_results') ?? 0;
			const categories = count(payload, 'categorized_shopping_results') ?? 0;
			const sponsored = count(payload, 'inline_shopping_results') ?? 0;
			return (
				`Google Shopping${quoted(args)}: ${products} products, ${categories} category blocks, ` +
				`${sponsored} sponsored listings.`
			);
		},
	},
	{
		name: 'google_reviews',
		title: 'Google Reviews',
		description:
			'Return the Google Maps reviews of one place (reviews with rating, snippet, author, ' +
			'date, likes, owner response, guided details and dining subratings) plus place_info. ' +
			'Identify the place by place_id or data_id from a google_maps result. Sort, filter by ' +
			'topic or text, and follow pagination.next_page_token for more. Requires an API key.',
		path: '/api/google/reviews',
		keyless: false,
		inputSchema: {
			place_id: z
				.string()
				.optional()
				.describe('Google place ID such as ChIJ...; exactly one of place_id and data_id'),
			data_id: z
				.string()
				.optional()
				.describe('Google data ID such as 0x89c2...:0x...; exactly one of place_id and data_id'),
			hl,
			gl,
			sort_by: z
				.enum(['qualityScore', 'newestFirst', 'ratingHigh', 'ratingLow'])
				.optional()
				.describe(
					'Order: qualityScore (most relevant, default), newestFirst, ratingHigh, ratingLow',
				),
			topic_id: z
				.string()
				.optional()
				.describe('Keep reviews on one Google review topic; conflicts with query'),
			query: z
				.string()
				.optional()
				.describe('Keep reviews mentioning this text; conflicts with topic_id'),
			num: z
				.number()
				.int()
				.min(1)
				.max(100)
				.optional()
				.describe(
					'Reviews to return: 1-100 on a first unfiltered request (default 8), 1-20 with ' +
						'topic_id, query or next_page_token (default 10)',
				),
			next_page_token: z
				.string()
				.optional()
				.describe(
					'pagination.next_page_token from the previous response; keep the same place, sort and filters',
				),
			source_metadata: z
				.boolean()
				.optional()
				.describe('Add review-provider icon and scale metadata when available'),
			result_groups: resultGroups,
		},
		summarize: (payload) => {
			const reviews = count(payload, 'reviews') ?? 0;
			const place = isRecord(payload.place_info) ? payload.place_info : {};
			const name = typeof place.title === 'string' ? ` for ${place.title}` : '';
			const pagination = isRecord(payload.pagination) ? payload.pagination : {};
			const more = typeof pagination.next_page_token === 'string' ? '; more pages available' : '';
			return `Google Reviews${name}: ${reviews} reviews${more}.`;
		},
	},
	{
		name: 'web_fetch',
		title: 'Fetch a web page',
		description:
			'Fetch one public web page and return it as Markdown (default: the main content), ' +
			'whole-page Markdown, HTML or plain text, with url, title, description, content and ' +
			'metadata. Narrow the content with target_selector or remove_selector, apply a preset, ' +
			'or cap it with max_tokens; engine picks plain HTTP or a full browser. Use ' +
			'web_screenshot for an image of the page. Alpha. Requires an API key.',
		path: '/api/web/fetch',
		keyless: false,
		inputSchema: {
			url: z
				.string()
				.min(1)
				.max(8192)
				.describe(
					'Public HTTP(S) URL to capture, 1-8,192 characters. Include http:// or https://; bare ' +
						'domains are rejected. The host must be public, on port 80 or 443, without embedded ' +
						'credentials',
				),
			remove_overlay: z
				.boolean()
				.optional()
				.describe('Remove modal and cookie-banner overlays from the page'),
			detach_invisibles: z
				.boolean()
				.optional()
				.describe('Drop display:none elements from the page'),
			wait_for_selector: z
				.union([z.string().min(1).max(2048), z.array(z.string().min(1).max(2048)).min(1).max(16)])
				.optional()
				.describe(
					'CSS selector to wait for after navigation, 1-2,048 characters. Also accepts a list of ' +
						'1-16 selectors',
				),
			set_cookies: z
				.array(z.string().min(3).max(4096))
				.min(1)
				.max(100)
				.optional()
				.describe(
					'1-100 cookies in Set-Cookie syntax (name=value; Path=/; Domain=...), one line each, up ' +
						'to 4,096 characters',
				),
			user_agent: z
				.string()
				.min(1)
				.max(1024)
				.optional()
				.describe(
					'User-Agent for the page request, 1-1,024 characters without control characters. Defaults ' +
						"to the browser's own",
				),
			inject_page_script: z
				.array(z.string().min(1).max(8192))
				.min(1)
				.max(8)
				.optional()
				.describe(
					'1-8 scripts (source, or a URL to a script), up to 8,192 characters each, run in the main ' +
						'frame',
				),
			inject_frame_script: z
				.array(z.string().min(1).max(8192))
				.min(1)
				.max(8)
				.optional()
				.describe(
					'1-8 scripts (source, or a URL to a script), up to 8,192 characters each, run in every ' +
						'frame',
				),
			page_timeout: z
				.number()
				.int()
				.min(1)
				.max(180)
				.optional()
				.describe(
					'Seconds from 1 through 180 for page loading and browser operations. Cannot extend the ' +
						'total request budget set by timeout',
				),
			locale: z
				.string()
				.min(2)
				.max(64)
				.optional()
				.describe(
					"Browser locale as a language tag, 2-64 characters. Defaults to the browser's own",
				),
			referer: z.string().min(1).max(8192).optional().describe('HTTP(S) URL sent as the Referer'),
			assert_status_code: z
				.number()
				.int()
				.min(100)
				.max(599)
				.optional()
				.describe(
					'Expected origin HTTP status, 100-599. A different status is rejected; otherwise a ' +
						'rendered error page is a successful capture',
				),
			viewport: z
				.object({
					width: z
						.number()
						.int()
						.min(1)
						.max(4096)
						.describe('Viewport width in CSS pixels, 1-4,096. Required'),
					height: z
						.number()
						.int()
						.min(1)
						.max(4096)
						.describe('Viewport height in CSS pixels, 1-4,096. Required'),
					device_scale_factor: z
						.number()
						.gt(0)
						.max(4)
						.optional()
						.describe('Device pixel ratio, greater than 0 and at most 4'),
					is_mobile: z.boolean().optional().describe('Emulate a mobile device'),
					is_landscape: z.boolean().optional().describe('Use landscape orientation'),
					has_touch: z.boolean().optional().describe('Emulate touch support'),
				})
				.optional()
				.describe('Browser viewport; width and height are required. Default: 1280 x 1280'),
			robots_txt: z
				.string()
				.min(1)
				.max(256)
				.optional()
				.describe(
					"User agent, 1-256 characters, to check against the site's robots.txt; disallowed URLs " +
						'are rejected',
				),
			respond_timing: z
				.enum([
					'html',
					'visible-content',
					'mutation-idle',
					'resource-idle',
					'media-idle',
					'network-idle',
				])
				.optional()
				.describe('Page readiness condition to reach before responding'),
			respond_with: z
				.string()
				.min(3)
				.max(64)
				.optional()
				.describe(
					'Output format: content (default; main content as Markdown, or the whole page when ' +
						'extraction keeps too little), markdown (whole page as Markdown), html, text, frontmatter ' +
						"(content plus front matter), or a '+' combination such as markdown+frontmatter. For " +
						'screenshots use web_screenshot',
				),
			with_links_summary: z
				.union([z.boolean(), z.literal('all')])
				.optional()
				.describe('true, false or all: add a links list to the response'),
			with_images_summary: z.boolean().optional().describe('Add an images list to the response'),
			retain_images: z
				.enum(['none', 'all', 'alt'])
				.optional()
				.describe('Images to keep: all (default), alt (alt text only) or none'),
			retain_links: z
				.enum(['none', 'all', 'text', 'gpt-oss'])
				.optional()
				.describe(
					'Links to keep: all (default), text (link text only), none, or gpt-oss (citation format ' +
						'with a links summary)',
				),
			retain_media: z
				.enum(['none', 'text', 'link', 'image', 'html'])
				.optional()
				.describe(
					'How video, audio and embedded video appear: none, text, link (default), image or html',
				),
			preset: z
				.enum(['reader', 'index', 'research', 'agent', 'spider'])
				.optional()
				.describe('Option preset. Fills only the options the request leaves unset'),
			no_gfm: z
				.union([z.boolean(), z.literal('table')])
				.optional()
				.describe('true, false or table: disable GitHub-flavored Markdown, or only its tables'),
			target_selector: z
				.union([z.string().min(1).max(2048), z.array(z.string().min(1).max(2048)).min(1).max(16)])
				.optional()
				.describe(
					'CSS selector to extract, 1-2,048 characters; also accepts a list of 1-16 selectors. ' +
						'Implies waiting for the selector. Match-all selectors are rejected',
				),
			remove_selector: z
				.union([z.string().min(1).max(2048), z.array(z.string().min(1).max(2048)).min(1).max(16)])
				.optional()
				.describe(
					'CSS selector removed before extraction, 1-2,048 characters; also accepts a list of 1-16 ' +
						'selectors',
				),
			keep_img_data_url: z.boolean().optional().describe('Keep inline data: images in Markdown'),
			with_iframe: z
				.union([z.boolean(), z.literal('quoted')])
				.optional()
				.describe('true, false or quoted: include iframe content before extraction'),
			with_shadow_dom: z
				.boolean()
				.optional()
				.describe('Include open shadow DOM content before extraction'),
			engine: z
				.enum(['auto', 'browser', 'curl'])
				.optional()
				.describe(
					'auto (default; lightweight HTTP first, a browser when needed), browser, or curl (no ' +
						'JavaScript)',
				),
			token_budget: z
				.number()
				.int()
				.min(1)
				.max(10000000)
				.optional()
				.describe('Integer 1-10,000,000. Reject the page when its token count exceeds the budget'),
			markdown: z
				.object({
					heading_style: z
						.enum(['setext', 'atx'])
						.optional()
						.describe('Markdown heading style: setext (underlined) or atx (# prefixed)'),
					hr: z
						.string()
						.min(1)
						.max(128)
						.optional()
						.describe('Markdown used for horizontal rules, 1-128 characters'),
					bullet_list_marker: z
						.enum(['-', '+', '*'])
						.optional()
						.describe('Marker for bulleted list items'),
					em_delimiter: z.enum(['_', '*']).optional().describe('Delimiter for emphasis'),
					strong_delimiter: z
						.enum(['__', '**'])
						.optional()
						.describe('Delimiter for strong emphasis'),
					link_style: z
						.enum(['inlined', 'referenced', 'discarded'])
						.optional()
						.describe('How links are written: inlined, referenced (reference-style) or discarded'),
					link_reference_style: z
						.enum(['full', 'collapsed', 'shortcut', 'discarded'])
						.optional()
						.describe('Reference format when link_style is referenced'),
				})
				.optional()
				.describe('Markdown formatting options'),
			markdown_chunking: z
				.enum(['true', 'h1', 'h2', 'h3', 'h4', 'h5', 'structured', 's1', 's2', 's3', 's4', 's5'])
				.optional()
				.describe('true, h1-h5, structured or s1-s5: split the Markdown and return chunks'),
			max_tokens: z
				.number()
				.int()
				.min(500)
				.max(10000000)
				.optional()
				.describe('Integer 500-10,000,000. Trim content to this many tokens'),
			base: z
				.enum(['initial', 'final'])
				.optional()
				.describe(
					'Resolve relative links against the requested URL (initial, default) or the final URL ' +
						'after redirects (final)',
				),
		},
		summarize: (payload) => {
			const title = typeof payload.title === 'string' && payload.title ? ` "${payload.title}"` : '';
			const status =
				typeof payload.status_code === 'number' ? `, site status ${payload.status_code}` : '';
			const size =
				typeof payload.content === 'string' ? `, ${payload.content.length} characters` : '';
			return `Fetched${title}${status}${size}.`;
		},
	},
	// The rest of the Litescrape catalog, in the API's route order. Each needs an API key.
	{
		name: 'google_jobs',
		title: 'Google Jobs',
		description:
			'Search Google Jobs by country, interface language, location or coordinates, and search ' +
			"refinements. Set include_filters to see available filters; use each filter's q and uds " +
			'values together. Use tbs for time filters. Use next_page_token with next_page and ' +
			'unchanged parameters to continue. Requires an API key.',
		path: '/api/google/jobs',
		keyless: false,
		inputSchema: {
			q: z
				.string()
				.min(1)
				.max(512)
				.describe('Job search query, for example software engineer jobs in New York'),
			page: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe('One-based results page. Use next_page from the response to continue'),
			page_token: z
				.string()
				.min(1)
				.max(32768)
				.optional()
				.describe(
					'Copy next_page_token with next_page and the same query to fetch the next batch directly',
				),
			hl: z
				.string()
				.optional()
				.describe('Google interface language, for example en, de, fr, es or pt-BR'),
			gl: z.string().optional().describe('Two-letter country code'),
			location: z
				.string()
				.min(1)
				.max(512)
				.optional()
				.describe(
					'Canonical Google location, such as London,England,United Kingdom. Use one of location, ' +
						'uule or lat/lon',
				),
			uule: z
				.string()
				.min(1)
				.max(2048)
				.optional()
				.describe(
					'Explicit Google UULE location value. Mutually exclusive with location and coordinates',
				),
			lat: z
				.number()
				.min(-90)
				.max(90)
				.optional()
				.describe('Latitude of the search origin. Requires lon'),
			lon: z
				.number()
				.min(-180)
				.max(180)
				.optional()
				.describe('Longitude of the search origin. Requires lat'),
			radius: z
				.number()
				.min(1)
				.max(199)
				.optional()
				.describe(
					'Coordinate accuracy radius in meters, requiring lat/lon. This locates the search origin; ' +
						'it is not a job-distance filter',
				),
			uds: z
				.string()
				.min(1)
				.max(16384)
				.optional()
				.describe(
					'Opaque Google refinement value returned in available_filters. Copy its q and uds ' +
						'together; filter choices vary by query and market',
				),
			tbs: z
				.string()
				.min(1)
				.max(2048)
				.optional()
				.describe(
					'Google search refinement string, for example qdr:w for the past week. Keep it unchanged ' +
						'through pagination',
				),
			include_filters: z
				.boolean()
				.optional()
				.describe(
					'Return available Google Jobs filters with the q and uds parameters needed to apply each ' +
						'one',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Google Jobs', 'jobs_results', 'jobs'),
	},
	{
		name: 'google_images',
		title: 'Google Images',
		description:
			'Image search results with original image URLs, thumbnails, dimensions, titles and source ' +
			'pages. Filter by country, language, SafeSearch and Google image filters. Requires an API ' +
			'key.',
		path: '/api/google/images',
		keyless: false,
		inputSchema: {
			q: z.string().min(1).max(2048).describe('Image search query, up to 2,048 characters'),
			hl: z.string().optional().describe('Language of the Google Images interface'),
			gl: z.string().optional().describe('Two-letter country code used to localize results'),
			safe: z
				.enum(['active', 'off'])
				.optional()
				.describe('Set active to filter explicit images, or off to disable SafeSearch'),
			tbs: z
				.string()
				.max(4096)
				.optional()
				.describe(
					'Google image filters, such as isz:l for large images, itp:photo for photographs, or ' +
						'ic:trans for transparent images',
				),
			start: z
				.number()
				.int()
				.min(0)
				.max(1000)
				.optional()
				.describe(
					"Google's page offset. For the next page, use pagination.next_start from the response and " +
						'keep the same query and filters. This offset is independent of num and the number of ' +
						'returned images',
				),
			num: z
				.number()
				.int()
				.min(1)
				.max(100)
				.optional()
				.describe(
					'Maximum number of images returned from this page, from 1 to 100. This limits the parsed ' +
						'response; Google may supply fewer images',
				),
			device: z
				.enum(['desktop', 'tablet', 'mobile'])
				.optional()
				.describe('Device profile used for the image search'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Google Images', 'images_results', 'images'),
	},
	{
		name: 'google_ads',
		title: 'Google Ads',
		description:
			'Text ads, local ads and shopping ads for any query, named location, language and device, ' +
			'with the rest of the Google results page. Alpha. Requires an API key.',
		path: '/api/google/ads',
		keyless: false,
		inputSchema: {
			q: z.string().describe('Google Ads search query, up to 2,048 characters with no controls'),
			location: z
				.string()
				.describe(
					'Human-readable location where the ad search originates, up to 63 UTF-8 bytes once ' +
						'Google-encoded. Example: Austin, Texas, United States',
				),
			hl: z
				.string()
				.optional()
				.describe('Google interface and result language, such as en, en-GB, or de'),
			safe: z.enum(['active', 'off']).optional().describe('Google adult-content filtering'),
			nfpr: z
				.enum(['0', '1'])
				.optional()
				.describe('Google spelling auto-correction control. Set 1 to exclude corrected queries'),
			device: z
				.enum(['desktop', 'tablet', 'mobile'])
				.optional()
				.describe('Google returns its real layout for the selected device'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Google Ads', 'ads', 'ads'),
	},
	{
		name: 'google_gemini',
		title: 'Gemini Chat',
		description:
			'Ask Google Gemini a question and return its completed text reply. Set continuable to get ' +
			'a subsequent_request_token for a follow-up turn. Requires an API key.',
		path: '/api/google/gemini',
		keyless: false,
		inputSchema: {
			prompt: z
				.string()
				.min(1)
				.max(32000)
				.describe(
					'Text prompt for a new or continued Gemini conversation, up to 32,000 characters. Text ' +
						'only. Use subsequent_request_token to continue a conversation. Uploads, Google account ' +
						'cookies and model selection are not accepted',
				),
			hl: z
				.string()
				.optional()
				.describe(
					'Gemini web interface language code. Defaults to en; request a reply language in the ' +
						'prompt',
				),
			continuable: z
				.boolean()
				.optional()
				.describe(
					'Return a subsequent_request_token for continuing this conversation. Defaults to false. ' +
						'Set to true on the first request and on each follow-up that needs another token',
				),
			subsequent_request_token: z
				.string()
				.min(1)
				.max(32768)
				.optional()
				.describe(
					'Token from the previous reply. Send it with your next prompt using the same API key. Use ' +
						'the newest token for each follow-up. Tokens expire one hour after they are issued; an ' +
						'upstream conversation can become unavailable sooner. Treat tokens as sensitive',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeText('Gemini', 'text', 'prompt'),
	},
	{
		name: 'google_local',
		title: 'Google Local',
		description:
			"Google's local results with rating, reviews, category, address, hours and place IDs, for " +
			'any query and location. Requires an API key.',
		path: '/api/google/local',
		keyless: false,
		inputSchema: {
			q: z.string().describe('Google Local query, up to 2,048 characters with no controls'),
			location: z
				.string()
				.optional()
				.describe('Human-readable location, up to 512 characters. Cannot be combined with uule'),
			uule: z
				.string()
				.optional()
				.describe(
					'Canonical Google named-location token, up to 2,048 characters. Cannot be combined with ' +
						'location',
				),
			google_domain: z
				.string()
				.optional()
				.describe('Validated Google domain. Examples: google.com, google.co.uk, google.fr'),
			gl: z.string().optional().describe('Country localization normalized to lowercase'),
			hl: z.string().optional().describe('Google interface and result language'),
			ludocid: z.string().optional().describe('Google local CID, up to 128 digits'),
			tbs: z
				.string()
				.optional()
				.describe(
					'Google compatibility token forwarded unchanged; the provider may leave ranking unchanged',
				),
			start: z
				.number()
				.int()
				.optional()
				.describe(
					'Local-result offset through 10,000; source-exhausted offsets above 1,000 return empty',
				),
			device: z
				.enum(['desktop', 'tablet', 'mobile'])
				.optional()
				.describe('Compatibility value over device-invariant Maps data'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Google Local', 'local_results', 'places'),
	},
	{
		name: 'google_contributor_reviews',
		title: 'Google Contributor Reviews',
		description:
			'Up to 200 reviews by one Google Maps contributor with place, rating, text, date and ' +
			'likes, plus the Local Guide profile. Requires an API key.',
		path: '/api/google/contributor-reviews',
		keyless: false,
		inputSchema: {
			contributor_id: z
				.string()
				.describe('Required 10 to 32 digit ID from a Google Maps contributor URL'),
			hl: z.string().optional().describe('Review and interface language such as en, en-US, or fr'),
			gl: z.string().optional().describe('Two-letter country localization'),
			limit: z
				.number()
				.int()
				.optional()
				.describe('Review count from 1 through the anonymous source maximum of 200'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Google contributor reviews', 'reviews', 'reviews', null),
	},
	{
		name: 'google_maps_posts',
		title: 'Google Maps Posts',
		description:
			'Return the posts a business published on its Google Maps profile, by the data_id of a ' +
			'google_maps result; follow pagination.next_page_token for more. Requires an API key.',
		path: '/api/google/maps/posts',
		keyless: false,
		inputSchema: {
			data_id: z
				.string()
				.describe(
					'Required hexadecimal Maps feature ID. Follow posts_link from a Maps place response',
				),
			hl: z.string().optional().describe('Google interface and result language'),
			gl: z.string().optional().describe('Two-letter country localization code'),
			google_domain: z
				.string()
				.optional()
				.describe('A Google domain such as google.com or google.co.uk'),
			next_page_token: z
				.string()
				.optional()
				.describe('Continue a posts response with its opaque token'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Google Maps posts', 'posts', 'posts', null),
	},
	{
		name: 'google_maps_photo_meta',
		title: 'Google Maps Photo Metadata',
		description:
			'Return the place, contributor and capture date of one Google Maps photo, identified by ' +
			'its data_id. Requires an API key.',
		path: '/api/google/maps/photo-meta',
		keyless: false,
		inputSchema: {
			data_id: z
				.string()
				.describe(
					'Required Google Maps photo ID. Follow photo_meta_link from a Maps place response',
				),
			hl: z.string().optional().describe('Google interface and result language'),
			gl: z.string().optional().describe('Two-letter country localization code'),
			google_domain: z
				.string()
				.optional()
				.describe('A Google domain such as google.com or google.co.uk'),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Google Maps photo', 'location'),
	},
	{
		name: 'google_maps_popular_times',
		title: 'Google Maps Popular Times',
		description:
			"Return a place's popular times from Google Maps: how busy it is by hour and right now, " +
			'by place_id. popular_times is null when Google publishes none. Requires an API key.',
		path: '/api/google/maps/popular-times',
		keyless: false,
		inputSchema: {
			place_id: z.string().describe('Required Google Place ID. Every response is fetched live'),
			hl: z.string().optional().describe('Google interface and result language'),
			gl: z.string().optional().describe('Two-letter country localization code'),
			google_domain: z
				.string()
				.optional()
				.describe('A Google domain such as google.com or google.co.uk'),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Google Maps popular times', 'place'),
	},
	{
		name: 'google_shopping_product',
		title: 'Google Shopping Product',
		description:
			'One Google Shopping product page: every merchant offer with price, availability, ' +
			'delivery and returns, specifications and related products. Send both gpcid and the ' +
			'original search query q. Requires an API key.',
		path: '/api/google/shopping/product',
		keyless: false,
		inputSchema: {
			q: z
				.string()
				.optional()
				.describe(
					'The search term this product was found with, up to 2,048 characters. Google resolves the ' +
						'product viewer against it as well as the identifiers',
				),
			location: z
				.string()
				.optional()
				.describe(
					'Named search origin, up to 512 characters and 63 UTF-8 bytes once encoded. Conflicts ' +
						'with uule',
				),
			uule: z
				.string()
				.optional()
				.describe(
					'Canonical Google location token, up to 2,048 characters. Conflicts with location',
				),
			google_domain: z.string().optional().describe('Validated first-party Google domain'),
			gl: z.string().optional().describe('Two-letter country code, normalized to lowercase'),
			hl: z.string().optional().describe('Language code such as en, en-GB, or de'),
			device: z
				.enum(['desktop', 'tablet', 'mobile'])
				.optional()
				.describe('Google returns its real layout for the selected device'),
			gpcid: z
				.string()
				.optional()
				.describe(
					'Product cluster ID from a shopping result, 1 to 20 decimal digits. Optional when a prds ' +
						'token is supplied. Every Shopping result with a gpcid includes a ready-made ' +
						'litescrape_product_link',
				),
			headline_offer_docid: z
				.string()
				.optional()
				.describe(
					'Headline merchant offer document ID from the same shopping result, 1 to 20 decimal ' +
						'digits. Goes with gpcid rather than prds',
				),
			image_docid: z
				.string()
				.optional()
				.describe(
					'Image document ID from the same shopping result, 1 to 20 decimal digits. Goes with gpcid ' +
						'rather than prds',
				),
			prds: z
				.string()
				.optional()
				.describe(
					'Google product selector token from a previous response, up to 2,048 characters. ' +
						'Conflicts with gpcid and the identifiers above',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Google Shopping product', 'offers', 'offers'),
	},
	{
		name: 'google_shopping_merchant_urls',
		title: 'Google Shopping Merchant URLs',
		description:
			'Resolve direct merchant URLs for headline offers from Google Shopping results in one ' +
			'batch request. Requires an API key.',
		path: '/api/google/shopping/merchant-urls',
		keyless: false,
		post: true,
		inputSchema: {
			products: z
				.array(
					z.object({
						gpcid: z
							.string()
							.optional()
							.describe('Optional product ID for correlation; not used for lookup'),
						headline_offer_docid: z
							.string()
							.describe('Exact offer ID from Shopping Search; required'),
						merchant: z
							.string()
							.min(1)
							.max(200)
							.describe('Copy source from Shopping Search; required for grouping offer lookups'),
					}),
				)
				.min(1)
				.max(100)
				.describe(
					'Send 1–100 headline offers. Each item requires merchant and headline_offer_docid from ' +
						'Shopping Search',
				),
			gl: z
				.string()
				.optional()
				.describe('Use the same country code as the original Shopping Search. Defaults to us'),
			hl: z
				.string()
				.optional()
				.describe('Use the same language code as the original Shopping Search. Defaults to en'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Google Shopping merchant URLs', 'results', 'products', null),
	},
	{
		name: 'google_play_apps',
		title: 'Google Play Apps',
		description:
			'Google Play app search and browsing: title, developer, rating, downloads, price and ' +
			'screenshots, with charts, categories and device storefronts. Requires an API key.',
		path: '/api/google/play/apps',
		keyless: false,
		inputSchema: {
			hl: z
				.string()
				.max(32)
				.optional()
				.describe('Storefront language, such as en, de, or zh-TW. Maximum 32 characters'),
			gl: z.string().optional().describe('Two-letter country code'),
			q: z
				.string()
				.min(1)
				.max(2048)
				.optional()
				.describe(
					'Optional query with 1 to 2,048 UTF-8 bytes of printable text. Excludes category. Omit it ' +
						'to browse the storefront. On the games endpoint, q uses shared Android app search; omit ' +
						'q or choose games_category to browse games',
				),
			chart: z
				.string()
				.min(1)
				.max(128)
				.optional()
				.describe(
					'Chart identifier such as topselling_free, topselling_paid, or topgrossing. Excludes q ' +
						'and all pagination selectors. Apps and games charts require phone or an omitted ' +
						'store_device',
				),
			next_page_token: z
				.string()
				.min(1)
				.max(65536)
				.optional()
				.describe(
					'Use the returned next_page_token with the same parameters. Excludes chart, ' +
						'section_page_token, and see_more_token',
				),
			section_page_token: z
				.string()
				.min(1)
				.max(65536)
				.optional()
				.describe(
					'Continue one result group using its returned token and the same parameters. Excludes the ' +
						'other pagination selectors and chart',
				),
			see_more_token: z
				.string()
				.min(1)
				.max(65536)
				.optional()
				.describe(
					'Open a result collection using its returned token and the same parameters. Excludes the ' +
						'other pagination selectors and chart',
				),
			apps_category: z
				.string()
				.min(1)
				.max(128)
				.optional()
				.describe(
					'Native app category identifier, such as MEDICAL. Excludes q and an explicit store_device',
				),
			store_device: z
				.enum(['phone', 'tablet', 'tv', 'chromebook', 'watch', 'car'])
				.optional()
				.describe(
					'Omit for the default phone storefront. An explicit selection excludes q and category',
				),
			age: z
				.enum(['AGE_RANGE1', 'AGE_RANGE2', 'AGE_RANGE3'])
				.optional()
				.describe("Children's age range. Requires apps_category=FAMILY"),
			result_groups: resultGroups,
		},
		summarize: summarizeGroups('Google Play Apps'),
	},
	{
		name: 'google_play_games',
		title: 'Google Play Games',
		description:
			'Google Play games by category, chart and device with title, developer, rating, downloads ' +
			'and price, plus featured items and charts. Requires an API key.',
		path: '/api/google/play/games',
		keyless: false,
		inputSchema: {
			hl: z
				.string()
				.max(32)
				.optional()
				.describe('Storefront language, such as en, de, or zh-TW. Maximum 32 characters'),
			gl: z.string().optional().describe('Two-letter country code'),
			q: z
				.string()
				.min(1)
				.max(2048)
				.optional()
				.describe(
					'Optional query with 1 to 2,048 UTF-8 bytes of printable text. Excludes category. Omit it ' +
						'to browse the storefront. On the games endpoint, q uses shared Android app search; omit ' +
						'q or choose games_category to browse games',
				),
			chart: z
				.string()
				.min(1)
				.max(128)
				.optional()
				.describe(
					'Chart identifier such as topselling_free, topselling_paid, or topgrossing. Excludes q ' +
						'and all pagination selectors. Apps and games charts require phone or an omitted ' +
						'store_device',
				),
			next_page_token: z
				.string()
				.min(1)
				.max(65536)
				.optional()
				.describe(
					'Use the returned next_page_token with the same parameters. Excludes chart, ' +
						'section_page_token, and see_more_token',
				),
			section_page_token: z
				.string()
				.min(1)
				.max(65536)
				.optional()
				.describe(
					'Continue one result group using its returned token and the same parameters. Excludes the ' +
						'other pagination selectors and chart',
				),
			see_more_token: z
				.string()
				.min(1)
				.max(65536)
				.optional()
				.describe(
					'Open a result collection using its returned token and the same parameters. Excludes the ' +
						'other pagination selectors and chart',
				),
			games_category: z
				.string()
				.min(1)
				.max(128)
				.optional()
				.describe(
					'Native game category identifier, such as GAME_PUZZLE. Excludes q and an explicit ' +
						'store_device',
				),
			store_device: z
				.enum(['phone', 'tablet', 'tv', 'chromebook', 'watch', 'windows'])
				.optional()
				.describe(
					'Omit for the default phone storefront. An explicit selection excludes q and category',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeGroups('Google Play Games'),
	},
	{
		name: 'google_play_books',
		title: 'Google Play Books',
		description:
			'Google Play ebooks and audiobooks with title, author, rating and price, grouped by ' +
			'format, with categories, charts and free or paid filters. Requires an API key.',
		path: '/api/google/play/books',
		keyless: false,
		inputSchema: {
			hl: z
				.string()
				.max(32)
				.optional()
				.describe('Storefront language, such as en, de, or zh-TW. Maximum 32 characters'),
			gl: z.string().optional().describe('Two-letter country code'),
			q: z
				.string()
				.min(1)
				.max(2048)
				.optional()
				.describe(
					'Optional query with 1 to 2,048 UTF-8 bytes of printable text. Excludes category. Omit it ' +
						'to browse the storefront. On the games endpoint, q uses shared Android app search; omit ' +
						'q or choose games_category to browse games',
				),
			chart: z
				.string()
				.min(1)
				.max(128)
				.optional()
				.describe(
					'Chart identifier such as topselling_free, topselling_paid, or topgrossing. Excludes q ' +
						'and all pagination selectors. Apps and games charts require phone or an omitted ' +
						'store_device',
				),
			next_page_token: z
				.string()
				.min(1)
				.max(65536)
				.optional()
				.describe(
					'Use the returned next_page_token with the same parameters. Excludes chart, ' +
						'section_page_token, and see_more_token',
				),
			section_page_token: z
				.string()
				.min(1)
				.max(65536)
				.optional()
				.describe(
					'Continue one result group using its returned token and the same parameters. Excludes the ' +
						'other pagination selectors and chart',
				),
			see_more_token: z
				.string()
				.min(1)
				.max(65536)
				.optional()
				.describe(
					'Open a result collection using its returned token and the same parameters. Excludes the ' +
						'other pagination selectors and chart',
				),
			books_category: z
				.string()
				.min(1)
				.max(128)
				.optional()
				.describe(
					"Native book category identifier, such as coll_1689 for children's books. Excludes q",
				),
			age: z
				.enum(['AGE_RANGE1', 'AGE_RANGE2', 'AGE_RANGE3'])
				.optional()
				.describe("Children's age range. Requires books_category=coll_1689"),
			price: z
				.number()
				.int()
				.min(1)
				.max(2)
				.optional()
				.describe('1 for free books or 2 for paid books. Requires q'),
			result_groups: resultGroups,
		},
		summarize: summarizeGroups('Google Play Books'),
	},
	{
		name: 'google_play_movies',
		title: 'Google Play Movies',
		description:
			'Google Play movies, shows and episodes with title, rating and price, grouped by format, ' +
			'with categories and charts. Requires an API key.',
		path: '/api/google/play/movies',
		keyless: false,
		inputSchema: {
			hl: z
				.string()
				.max(32)
				.optional()
				.describe('Storefront language, such as en, de, or zh-TW. Maximum 32 characters'),
			gl: z.string().optional().describe('Two-letter country code'),
			q: z
				.string()
				.min(1)
				.max(2048)
				.optional()
				.describe(
					'Optional query with 1 to 2,048 UTF-8 bytes of printable text. Excludes category. Omit it ' +
						'to browse the storefront. On the games endpoint, q uses shared Android app search; omit ' +
						'q or choose games_category to browse games',
				),
			chart: z
				.string()
				.min(1)
				.max(128)
				.optional()
				.describe(
					'Chart identifier such as topselling_free, topselling_paid, or topgrossing. Excludes q ' +
						'and all pagination selectors. Apps and games charts require phone or an omitted ' +
						'store_device',
				),
			next_page_token: z
				.string()
				.min(1)
				.max(65536)
				.optional()
				.describe(
					'Use the returned next_page_token with the same parameters. Excludes chart, ' +
						'section_page_token, and see_more_token',
				),
			section_page_token: z
				.string()
				.min(1)
				.max(65536)
				.optional()
				.describe(
					'Continue one result group using its returned token and the same parameters. Excludes the ' +
						'other pagination selectors and chart',
				),
			see_more_token: z
				.string()
				.min(1)
				.max(65536)
				.optional()
				.describe(
					'Open a result collection using its returned token and the same parameters. Excludes the ' +
						'other pagination selectors and chart',
				),
			movies_category: z
				.string()
				.min(1)
				.max(128)
				.optional()
				.describe('Native movie category identifier, such as FAMILY for family movies. Excludes q'),
			age: z
				.enum(['AGE_RANGE1', 'AGE_RANGE2', 'AGE_RANGE3'])
				.optional()
				.describe("Children's age range. Requires movies_category=FAMILY"),
			result_groups: resultGroups,
		},
		summarize: summarizeGroups('Google Play Movies'),
	},
	{
		name: 'google_play_product',
		title: 'Google Play Product',
		description:
			'Google Play product pages: rating histogram, downloads, offers, permissions, data ' +
			'safety, developer contact, media, reviews and similar items for any app, book, movie or ' +
			'show. Requires an API key.',
		path: '/api/google/play/product',
		keyless: false,
		inputSchema: {
			hl: z
				.string()
				.max(32)
				.optional()
				.describe('Storefront language, such as en, de, or zh-TW. Maximum 32 characters'),
			gl: z.string().optional().describe('Two-letter country code'),
			product_id: z
				.string()
				.min(1)
				.max(512)
				.describe(
					'Native Google Play product identifier, with 1 to 512 letters, digits, underscores, dots, ' +
						'or hyphens',
				),
			store: z
				.enum(['apps', 'books', 'audiobooks', 'movies', 'tv'])
				.optional()
				.describe('Product catalog containing this identifier'),
			season_id: z
				.string()
				.min(1)
				.max(512)
				.optional()
				.describe('Native season identifier, such as tvseason-OVPad1njPzI.P. Requires store=tv'),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Google Play product', 'product_info'),
	},
	{
		name: 'google_play_reviews',
		title: 'Google Play Reviews',
		description:
			'Google Play reviews, up to 199 a call with reviewer, rating, text, date, likes and app ' +
			'version, filtered by rating and platform. Requires an API key.',
		path: '/api/google/play/reviews',
		keyless: false,
		inputSchema: {
			hl: z
				.string()
				.max(32)
				.optional()
				.describe('Storefront language, such as en, de, or zh-TW. Maximum 32 characters'),
			gl: z.string().optional().describe('Two-letter country code'),
			product_id: z
				.string()
				.min(1)
				.max(512)
				.describe(
					'Native Google Play product identifier, with 1 to 512 letters, digits, underscores, dots, ' +
						'or hyphens',
				),
			store: z
				.enum(['apps', 'books', 'audiobooks', 'movies', 'tv'])
				.optional()
				.describe('Product catalog containing this identifier'),
			platform: z
				.enum(['phone', 'tablet', 'watch', 'chromebook', 'tv'])
				.optional()
				.describe('Platform associated with the reviews'),
			rating: z
				.number()
				.int()
				.min(1)
				.max(5)
				.optional()
				.describe('Only reviews with this rating, from 1 through 5'),
			sort_by: z
				.number()
				.int()
				.min(1)
				.max(3)
				.optional()
				.describe('1 for relevant, 2 for newest, or 3 for rating'),
			num: z
				.number()
				.int()
				.min(1)
				.max(199)
				.optional()
				.describe('Number of reviews, from 1 through 199'),
			next_page_token: z
				.string()
				.min(1)
				.max(65536)
				.optional()
				.describe(
					'Returned review continuation. Preserve product, store, language, country, platform, ' +
						'rating, sort order, and count',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Google Play reviews', 'reviews', 'reviews', null),
	},
	{
		name: 'apple_app_store_search',
		title: 'Apple App Store Search',
		description:
			'Apple App Store search, up to 200 iPhone, iPad or Mac apps with developer, price, ' +
			'rating, genres, version, screenshots and devices, across 175 storefronts. Requires an ' +
			'API key.',
		path: '/api/apple/app-store/search',
		keyless: false,
		inputSchema: {
			country: z
				.string()
				.optional()
				.describe('Two-letter Apple storefront country. UK is accepted as an alias for GB'),
			term: z
				.string()
				.min(1)
				.max(2048)
				.describe(
					'Search term with 1 to 2,048 UTF-8 bytes of printable text, and at most 4,096 bytes after ' +
						'URL encoding',
				),
			lang: z.string().optional().describe('Language-region code, such as en-us or fr-fr'),
			num: z
				.number()
				.int()
				.min(1)
				.max(200)
				.optional()
				.describe('Maximum results after filtering, from 1 through 200'),
			disallow_explicit: z.boolean().optional().describe('Exclude explicit results when true'),
			property: z
				.literal('developer')
				.optional()
				.describe('Use developer to match developer names, ignoring case'),
			category_id: z
				.number()
				.int()
				.min(1)
				.max(2147483647)
				.optional()
				.describe('Filter results by a native genre identifier, from 1 through 2,147,483,647'),
			device: z
				.enum(['mobile', 'tablet', 'desktop'])
				.optional()
				.describe('mobile for iPhone apps, tablet for iPad apps, or desktop for Mac apps'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('App Store', 'organic_results', 'apps', 'term'),
	},
	{
		name: 'apple_app_store_product',
		title: 'Apple App Store Product',
		description:
			'Apple App Store product pages: version history, privacy labels, rating distribution, ' +
			'screenshots, information, featured placements and related apps for any app in 175 ' +
			'storefronts. Requires an API key.',
		path: '/api/apple/app-store/product',
		keyless: false,
		inputSchema: {
			country: z
				.string()
				.optional()
				.describe('Two-letter Apple storefront country. UK is accepted as an alias for GB'),
			product_id: z.string().describe('Positive decimal Apple app identifier, up to 20 digits'),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('App Store product'),
	},
	{
		name: 'apple_app_store_reviews',
		title: 'Apple App Store Reviews',
		description:
			'Apple App Store reviews: title, text, rating, author, date and reviewed version for any ' +
			'app and storefront, newest or most helpful first, with page counts. Requires an API key.',
		path: '/api/apple/app-store/reviews',
		keyless: false,
		inputSchema: {
			country: z
				.string()
				.optional()
				.describe('Two-letter Apple storefront country. UK is accepted as an alias for GB'),
			product_id: z.string().describe('Positive decimal Apple app identifier, up to 20 digits'),
			sort: z
				.enum(['mostrecent', 'mosthelpful'])
				.optional()
				.describe("mostrecent or mosthelpful. Apple's Mac storefront always returns newest first"),
			page: z
				.number()
				.int()
				.min(1)
				.max(2147483647)
				.optional()
				.describe(
					'One-based page number, from 1 through 2,147,483,647. Exhausted pages return an empty ' +
						'review list',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('App Store reviews', 'reviews', 'reviews', null),
	},
	{
		name: 'apple_maps_places',
		title: 'Apple Maps Places',
		description:
			'Apple Maps places, up to 50 a call with address, phone, website, hours, amenities, ' +
			"coordinates and Apple's category ratings, in 50 locales. Requires an API key.",
		path: '/api/apple/maps/places',
		keyless: false,
		inputSchema: {
			muid: z
				.string()
				.describe(
					'One or more Apple Maps unique place identifiers. Separate multiple identifiers with ' +
						'commas. Accepted batch size: 1 through 50 unsigned 64-bit decimal IDs. Example: ' +
						'4372355869446211302',
				),
			locale: z
				.string()
				.optional()
				.describe(
					'Controls Apple Maps language and regional formatting. Examples: en-US, fr-FR, ja-JP, and ' +
						'zh-TW',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Apple Maps', 'place_results', 'places', null),
	},
	{
		name: 'apple_maps_reviews',
		title: 'Apple Maps Reviews',
		description:
			"Apple's rating summary, per-category scores and Apple-attributed written reviews for any " +
			'Apple Maps place by MUID. Requires an API key.',
		path: '/api/apple/maps/reviews',
		keyless: false,
		inputSchema: {
			muid: z.string().describe('Exactly one unsigned 64-bit decimal Apple Maps MUID'),
			locale: z.string().optional().describe('Apple Maps language and regional formatting'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Apple Maps reviews', 'reviews', 'reviews', null),
	},
	{
		name: 'bing_images',
		title: 'Bing Images',
		description:
			'Search Bing Images for original image URLs, source pages, thumbnails, dimensions and ' +
			'titles. Filter by size, type, layout, color, people, date and license, with pagination, ' +
			'market and SafeSearch controls. Requires an API key.',
		path: '/api/bing/images',
		keyless: false,
		inputSchema: {
			q: z
				.string()
				.min(1)
				.max(2048)
				.describe(
					'Image search query, from 1 through 2,048 characters after trimming. Control characters ' +
						'are rejected',
				),
			first: z
				.number()
				.int()
				.min(1)
				.max(10000)
				.optional()
				.describe(
					'One-based Bing result offset, from 1 through 10,000. Prefer litescrape_pagination.next ' +
						'when returned. Bing may reorder or repeat images between requests',
				),
			count: z
				.number()
				.int()
				.min(1)
				.max(100)
				.optional()
				.describe(
					'Maximum images to return, from 1 through 100. Defaults to 35. Bing may return fewer ' +
						'images. Follow the pagination link to retrieve another batch',
				),
			mkt: z
				.string()
				.optional()
				.describe('Optional language-country market, such as en-US. Cannot be combined with cc'),
			cc: z
				.string()
				.optional()
				.describe('Optional two-letter country code. Cannot be combined with mkt'),
			safeSearch: z
				.enum(['off', 'moderate', 'strict'])
				.optional()
				.describe(
					'Bing content filter: off, moderate, or strict. Case-insensitive; defaults to moderate. ' +
						'Bing may enforce stricter filtering for some markets',
				),
			imagesize: z
				.enum(['small', 'medium', 'large', 'wallpaper'])
				.optional()
				.describe('Bing image size bucket: small, medium, large or wallpaper (extra large)'),
			photo: z
				.enum(['photo', 'clipart', 'linedrawing', 'animatedgif', 'transparent'])
				.optional()
				.describe(
					'Photographs, clipart, line drawings, animated GIFs or images with transparent ' +
						'backgrounds',
				),
			aspect: z
				.enum(['square', 'wide', 'tall'])
				.optional()
				.describe('Filter to square, wide or tall images'),
			color2: z
				.enum([
					'color',
					'bw',
					'FGcls_RED',
					'FGcls_ORANGE',
					'FGcls_YELLOW',
					'FGcls_GREEN',
					'FGcls_TEAL',
					'FGcls_BLUE',
					'FGcls_PURPLE',
					'FGcls_PINK',
					'FGcls_BROWN',
					'FGcls_BLACK',
					'FGcls_GRAY',
					'FGcls_WHITE',
				])
				.optional()
				.describe(
					'Use color for any color, bw for black and white, or a dominant color: FGcls_RED, ' +
						'FGcls_ORANGE, FGcls_YELLOW, FGcls_GREEN, FGcls_TEAL, FGcls_BLUE, FGcls_PURPLE, ' +
						'FGcls_PINK, FGcls_BROWN, FGcls_BLACK, FGcls_GRAY or FGcls_WHITE',
				),
			face: z
				.enum(['face', 'portrait'])
				.optional()
				.describe('Use face for just faces or portrait for head-and-shoulders images'),
			age: z
				.enum(['lt1440', 'lt10080', 'lt43200', 'lt525600'])
				.optional()
				.describe(
					'Bing date filter: lt1440 (past 24 hours), lt10080 (past week), lt43200 (past month) or ' +
						'lt525600 (past year)',
				),
			license: z
				.enum([
					'L1',
					'L2',
					'L3',
					'L4',
					'L5',
					'L6',
					'L7',
					'L2_L3',
					'L2_L3_L4',
					'L2_L3_L5_L6',
					'L2_L3_L4_L5_L6_L7',
					'creativecommons',
				])
				.optional()
				.describe(
					'Use creativecommons for all Creative Commons results, L1 for public domain, or native ' +
						'license categories L2 through L7. Bing also supports grouped categories. ' +
						'L2_L3_L4_L5_L6_L7: free to share and use. L2_L3_L4: free to share and use commercially. ' +
						'L2_L3_L5_L6: free to modify, share and use. L2_L3: free to modify, share and use ' +
						'commercially',
				),
			qft: z
				.string()
				.max(2048)
				.optional()
				.describe(
					'Optional native Bing Images qft filter expression, up to 2,048 characters without ' +
						'control characters. Named image filters override the same category in qft and preserve ' +
						'unrelated categories. Without named filters, qft is passed through unchanged. Filter ' +
						'matching and availability are controlled by Bing',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Bing Images', 'images_results', 'images'),
	},
	{
		name: 'bing_shopping',
		title: 'Bing Shopping',
		description:
			'Bing Shopping products with titles, prices, sellers, ratings, images and product tokens, ' +
			'with market, country, result offset and filter controls. Requires an API key.',
		path: '/api/bing/shopping',
		keyless: false,
		inputSchema: {
			q: z
				.string()
				.min(1)
				.max(2048)
				.describe('Product search query, up to 2,048 characters with no control characters'),
			mkt: z
				.string()
				.optional()
				.describe(
					'Case-insensitive language-country market code, such as en-US. Supply either mkt or cc',
				),
			cc: z
				.string()
				.optional()
				.describe('Two-letter country code, such as us or gb. Supply either cc or mkt'),
			efirst: z
				.number()
				.int()
				.min(0)
				.max(9007199254740991)
				.optional()
				.describe(
					'Nonnegative shopping result offset. For example, efirst=10 starts at the tenth shopping ' +
						'result',
				),
			filters: z
				.string()
				.max(6000)
				.optional()
				.describe(
					'Bing Shopping filter expression, up to 6,000 characters. Copy filters from a Bing ' +
						'Shopping URL',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Bing Shopping', 'shopping_results', 'products'),
	},
	{
		name: 'bing_product',
		title: 'Bing Product',
		description:
			'Bing product details with description, rating, images and buying options, retrieved ' +
			'using a product token from Bing Shopping. Requires an API key.',
		path: '/api/bing/product',
		keyless: false,
		inputSchema: {
			product_token: z
				.string()
				.min(1)
				.max(24000)
				.describe(
					'Product token returned in shopping_results by the Bing Shopping API. Copy the complete ' +
						'token into this request; tokens from other providers are not interchangeable',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Bing product', 'product_results'),
	},
	{
		name: 'bing_maps',
		title: 'Bing Maps',
		description:
			'Bing Maps listings, 30 a page with rating, address, phone, website, hours and ' +
			'coordinates, for any query and map center, or one place by ID. Requires an API key.',
		path: '/api/bing/maps',
		keyless: false,
		inputSchema: {
			q: z.string().optional().describe('Search query; required unless place_id is supplied'),
			place_id: z
				.string()
				.optional()
				.describe('Native Bing Maps entity identifier for a detail lookup'),
			cp: z.string().optional().describe('Optional map center in latitude~longitude form'),
			setlang: z.string().optional().describe('Bing Maps interface language, such as en-US'),
			first: z.number().int().optional().describe('Listing offset from 0 through 10,000'),
			count: z.number().int().optional().describe('Number of listings from 1 through 30'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Bing Maps', 'local_results', 'places'),
	},
	{
		name: 'brave_search',
		title: 'Brave Search',
		description:
			'Brave web search results with page offsets, country, interface language, safe search and ' +
			'date filters. Requires an API key.',
		path: '/api/brave/search',
		keyless: false,
		inputSchema: {
			q: z
				.string()
				.min(1)
				.max(2048)
				.describe(
					'Search text. Brave query operators are supported; Brave may relax them when there are ' +
						'few matches',
				),
			offset: z
				.number()
				.int()
				.min(0)
				.max(9)
				.optional()
				.describe(
					'Zero-based page number, not a result offset. Follow litescrape_pagination.next when ' +
						'present. Results per page depend on Brave. Organic positions start at 1 within each page',
				),
			country: z
				.string()
				.optional()
				.describe(
					'Two-letter country preference, or all for all regions. Brave determines regional ' +
						'availability',
				),
			ui_lang: z
				.string()
				.optional()
				.describe(
					'Interface language preference such as en-us or de-de. This does not restrict result ' +
						'languages',
				),
			safesearch: z
				.enum(['off', 'moderate', 'strict'])
				.optional()
				.describe('Adult-content filtering preference'),
			tf: z
				.enum(['pd', 'pw', 'pm', 'py'])
				.optional()
				.describe(
					'Optional date window: pd for past day, pw for past week, pm for past month, py for past ' +
						'year',
				),
			spellcheck: z.boolean().optional().describe('Allow Brave to correct the query spelling'),
			result_groups: resultGroups,
		},
		summarize: summarizeSerp('Brave Search'),
	},
	{
		name: 'brave_ai_mode',
		title: 'Brave AI Mode',
		description:
			'Brave AI answers with citations, location and language controls, and follow-up ' +
			'conversations. Requires an API key.',
		path: '/api/brave/ai-mode',
		keyless: false,
		inputSchema: {
			location: z
				.string()
				.min(1)
				.max(256)
				.optional()
				.describe(
					'City or postal code from the location catalog, such as Berlin, Germany or Austin, Texas, ' +
						'United States. Qualify ambiguous names with a state or country. Unknown locations fail; ' +
						'lat and lon take precedence when supplied together. On follow-ups, a supplied location ' +
						'replaces inherited coordinates. Send location: null in JSON to clear an inherited ' +
						'location',
				),
			lat: z
				.number()
				.min(-90)
				.max(90)
				.optional()
				.describe(
					'Latitude from -90 to 90. Supply with lon; explicit coordinates take precedence over ' +
						'location',
				),
			lon: z
				.number()
				.min(-180)
				.max(180)
				.optional()
				.describe('Longitude from -180 to 180. Supply with lat'),
			country: z
				.string()
				.optional()
				.describe(
					'Two-letter country preference, or all for all regions. Brave determines regional ' +
						'availability',
				),
			language: z
				.string()
				.optional()
				.describe(
					'Search language preference such as en, de or de-de. Brave also considers the language of ' +
						'your question when generating its answer',
				),
			safeSearch: z
				.enum(['off', 'moderate', 'strict'])
				.optional()
				.describe('Adult-content filtering preference: off, moderate or strict'),
			units_of_measurement: z
				.enum(['us', 'metric'])
				.optional()
				.describe('Unit preference: us for US customary units or metric for metric units'),
			q: z
				.string()
				.min(1)
				.max(2048)
				.describe(
					'Question for Brave AI Mode. Required for both a new conversation and each follow-up',
				),
			continuation_token: z
				.string()
				.min(1)
				.max(4096)
				.optional()
				.describe(
					'Token from the previous response. Send with a new q to continue that conversation. ' +
						'Omitted preferences carry over from the token; supplied preferences override them. Use ' +
						'the latest token returned by each successful response. Treat this token as a ' +
						'conversation credential and keep it private. Prefer JSON POST for follow-ups',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeAnswer('Brave AI Mode', 'continuation_token'),
	},
	{
		name: 'baidu_search',
		title: 'Baidu Search',
		description:
			'Baidu desktop search results as JSON, including titles, links, snippets, related ' +
			'searches and pagination. Supports English and Chinese queries. Verification failures ' +
			'return HTTP 503 and are not billed. Requires an API key.',
		path: '/api/baidu/search',
		keyless: false,
		inputSchema: {
			q: z
				.string()
				.min(1)
				.max(500)
				.describe(
					'Required search text, trimmed to 1 through 500 characters. Unicode queries are ' +
						'supported. Control characters are rejected',
				),
			pn: z
				.number()
				.int()
				.min(0)
				.max(750)
				.optional()
				.describe(
					'Zero-based result offset from 0 through 750, not a page number. Use pagination.next_pn ' +
						'or litescrape_pagination.next to continue',
				),
			rn: z
				.union([z.literal(10), z.literal(20), z.literal(50)])
				.optional()
				.describe(
					'Requested result count: 10, 20, or 50. Defaults to 10. Baidu can return fewer web ' +
						'results when a page includes other result modules',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeSerp('Baidu'),
	},
	{
		name: 'yandex_search',
		title: 'Yandex Search',
		description:
			'Yandex web search with language, region, spelling, sorting, time and pagination ' +
			'controls. Requires an API key.',
		path: '/api/yandex/search',
		keyless: false,
		inputSchema: {
			yandex_domain: z
				.enum(['yandex.com', 'yandex.ru', 'yandex.by', 'yandex.kz', 'yandex.uz', 'yandex.com.tr'])
				.optional()
				.describe('Yandex domain to search'),
			family_mode: z
				.union([z.literal(0), z.literal(1), z.literal(2)])
				.optional()
				.describe('Safe search: 0 off, 1 moderate, 2 strict'),
			p: z.number().int().min(0).optional().describe('Page number, starting at zero'),
			text: z.string().min(1).max(400).describe('Search query, including Yandex query operators'),
			lang: z.string().optional().describe('Search language code; defaults to en on yandex.com'),
			lr: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe("Country or region ID; defaults to the selected domain's region"),
			fix_typo: z.boolean().optional().describe('Automatically correct spelling'),
			groups_on_page: z.number().int().min(1).optional().describe('Maximum result groups per page'),
			sort_mode: z
				.enum(['relevance', 'date'])
				.optional()
				.describe('Sort results by relevance or date'),
			period: z
				.enum(['all', 'day', 'last_two_weeks', 'month'])
				.optional()
				.describe('Time period for results'),
			result_groups: resultGroups,
		},
		summarize: summarizeSerp('Yandex', 'text'),
	},
	{
		name: 'yandex_images',
		title: 'Yandex Images',
		description:
			'Yandex Image and reverse image search with size, color, type, source, crop and ' +
			'pagination controls. Requires an API key.',
		path: '/api/yandex/images',
		keyless: false,
		inputSchema: {
			yandex_domain: z
				.enum(['yandex.com', 'yandex.ru', 'yandex.by', 'yandex.kz', 'yandex.uz', 'yandex.com.tr'])
				.optional()
				.describe('Yandex domain to search'),
			family_mode: z
				.union([z.literal(0), z.literal(1), z.literal(2)])
				.optional()
				.describe('Safe search: 0 off, 1 moderate, 2 strict'),
			p: z.number().int().min(0).optional().describe('Page number, starting at zero'),
			text: z
				.string()
				.min(1)
				.optional()
				.describe('Image search query; optional when url is provided'),
			width: z.number().int().gt(0).optional().describe('Exact image width; requires height'),
			height: z.number().int().gt(0).optional().describe('Exact image height; requires width'),
			file_type: z.enum(['jpg', 'png', 'gifan']).optional().describe('Image file type'),
			color: z
				.enum([
					'color',
					'gray',
					'red',
					'orange',
					'yellow',
					'cyan',
					'green',
					'blue',
					'violet',
					'white',
					'black',
				])
				.optional()
				.describe('Image color filter'),
			orientation: z
				.enum(['horizontal', 'vertical', 'square'])
				.optional()
				.describe('Image orientation'),
			image_type: z
				.enum(['photo', 'clipart', 'lineart', 'demotivator', 'face'])
				.optional()
				.describe('Image content type'),
			site: z.string().optional().describe('Limit images to this source website'),
			recent: z.boolean().optional().describe('Only images appearing in the last seven days'),
			url: z.string().optional().describe('Image URL for reverse image search'),
			crop: z
				.string()
				.optional()
				.describe('Crop coordinates: left;top;right;bottom, each between 0 and 1'),
			crop_id: z
				.string()
				.optional()
				.describe('Yandex uploaded image section ID; cannot be combined with crop'),
			tab: z.enum(['about', 'similar']).optional().describe('Reverse image search tab'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Yandex Images', 'images_results', 'images', 'text'),
	},
	{
		name: 'naver_search',
		title: 'Naver Search',
		description:
			'Search Naver general, web, news, video, and image results with sorting, time filters, ' +
			'and pagination. Requires an API key.',
		path: '/api/naver/search',
		keyless: false,
		inputSchema: {
			query: z.string().min(1).max(4096).describe('Search query, including Naver search operators'),
			start: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe(
					'Result offset. Overrides page when both are supplied. Other search types default to 1; ' +
						'web uses its own page calculation',
				),
			page: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe(
					'Page number starting at 1. Uses page * 10 - 9 for most searches and max(1, page * 15 - ' +
						'29) for web',
				),
			num: z
				.number()
				.int()
				.min(1)
				.max(100)
				.optional()
				.describe(
					'Maximum image results, from 1 to 100; image searches default to 50. Only supported with ' +
						'where=image',
				),
			where: z
				.enum(['nexearch', 'web', 'video', 'news', 'image'])
				.optional()
				.describe('Search type: nexearch (general search), web, video, news, or image'),
			sort_by: z
				.enum(['r', 'dd', '0', '1', '2'])
				.optional()
				.describe(
					'News: 0 relevance (default), 1 latest, 2 oldest. Other types: r relevance (default), dd ' +
						'latest',
				),
			period: z
				.string()
				.optional()
				.describe(
					'Time window: all, 1h, 1d, 1w, 1m, 3m, 6m, 1y, or fromYYYYMMDDtoYYYYMMDD. News also ' +
						'accepts 2h, 3h, 4h, 5h, and 6h',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeSerp('Naver', 'query'),
	},
	{
		name: 'naver_ai_overview',
		title: 'Naver AI Overview',
		description:
			'Retrieve Naver AI Briefing text, citations, and media by query, or business summaries ' +
			'with a token from Naver Search. Requires an API key.',
		path: '/api/naver/ai-overview',
		keyless: false,
		inputSchema: {
			query: z
				.string()
				.min(1)
				.max(4096)
				.optional()
				.describe('Query for an AI Briefing. Supply exactly one of query or page_token'),
			page_token: z
				.string()
				.min(1)
				.max(2048)
				.optional()
				.describe(
					'Business AI Briefing token from ai_briefing.page_token in Naver Search. Send it alone; ' +
						'cannot be combined with query',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeAnswer('Naver AI Briefing', undefined, 'query'),
	},
	{
		name: 'copilot_chat_completions',
		title: 'Microsoft Copilot Chat Completions',
		description:
			'Ask Microsoft Copilot and return a chat-completion style answer ' +
			'(choices[0].message.content) with its citations. Send the whole conversation in ' +
			'messages; each call starts fresh. Text only, no streaming. Alpha. Requires an API key.',
		path: '/api/copilot/chat/completions',
		keyless: false,
		post: true,
		inputSchema: {
			messages: z
				.array(
					z.object({
						role: z
							.enum(['system', 'user', 'assistant'])
							.describe('Role in the supplied text transcript'),
						content: z
							.string()
							.min(1)
							.max(32000)
							.describe(
								'Nonblank text. Images, tool calls and other content parts are unsupported',
							),
					}),
				)
				.min(1)
				.max(32)
				.describe(
					'Text messages ending in a user message; at most 32,000 characters in total. Roles do not ' +
						'grant instruction priority. Each request starts a fresh conversation. Send prior ' +
						'messages again to include context. Supplied roles do not grant instruction priority',
				),
			country: z
				.string()
				.length(2)
				.optional()
				.describe(
					"Two-letter country or territory code, normalized to uppercase. Sets Copilot's answer and " +
						"search location to a representative populated place. Omit to use Copilot's default " +
						'location. Supports the 213 country and territory codes listed in the parameter schema',
				),
			state: z
				.string()
				.length(2)
				.optional()
				.describe(
					'US postal state code (50 states or DC), normalized to uppercase. Requires country=US. ' +
						"Sets Copilot's location to the state capital. Supports all 50 states and DC. Uses the " +
						'state capital as the representative location for local answers and searches',
				),
			result_groups: resultGroups,
		},
		summarize: (payload) => {
			const choices = Array.isArray(payload.choices) ? payload.choices : [];
			const first = isRecord(choices[0]) && isRecord(choices[0].message) ? choices[0].message : {};
			const size =
				typeof first.content === 'string' ? `${first.content.length} characters` : 'no text';
			const citations = count(payload, 'citations') ?? 0;
			return `Copilot answered: ${size}, ${citations} citations.`;
		},
	},
	{
		name: 'duckduckgo_maps',
		title: 'DuckDuckGo Maps',
		description:
			'DuckDuckGo Maps places, up to 20 per bounding box with rating, price, address, hours, ' +
			'website and their Apple Maps and Yelp IDs. Requires an API key.',
		path: '/api/duckduckgo/maps',
		keyless: false,
		inputSchema: {
			q: z.string().describe('Required place or category query, up to 500 characters'),
			bbox: z.string().optional().describe('Viewport rectangle as top,left,bottom,right'),
			lat: z.number().optional().describe('Viewport center latitude; requires lon'),
			lon: z.number().optional().describe('Viewport center longitude; requires lat'),
			strict_bbox: z.boolean().optional().describe('Exclude results outside the requested bounds'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('DuckDuckGo Maps', 'local_results', 'places'),
	},
	{
		name: 'yahoo_search',
		title: 'Yahoo Search',
		description:
			'Yahoo web results with country, language, document and domain filters. Requires an API ' +
			'key.',
		path: '/api/yahoo/search',
		keyless: false,
		inputSchema: {
			p: z.string().min(1).max(2000).describe('Text or search operators to send to Yahoo'),
			yahoo_domain: z
				.string()
				.optional()
				.describe(
					'Yahoo regional search host, for example fr.search.yahoo.com. A regional prefix such as ' +
						'fr is also accepted',
				),
			b: z
				.number()
				.int()
				.min(1)
				.max(10001)
				.optional()
				.describe(
					'One-based starting result. Web pages usually advance by 10; image pages usually advance ' +
						'by 60',
				),
			device: z
				.enum(['desktop', 'tablet', 'mobile'])
				.optional()
				.describe('Device profile used for the Yahoo result page'),
			vc: z.string().optional().describe('Country code for regional results, such as us or uk'),
			vl: z
				.string()
				.optional()
				.describe(
					'Restrict matches to a language, such as lang_fr, lang_zh_chs, or lang_zh_cht. Enables ' +
						"Yahoo's language filter",
				),
			vm: z
				.enum(['r', 'i', 'p'])
				.optional()
				.describe('Adult-content filtering: r for strict, i for moderate, p for unfiltered'),
			vs: z
				.string()
				.max(500)
				.optional()
				.describe('Comma-separated domain suffixes to search, such as .com,.org'),
			vf: z
				.string()
				.max(80)
				.optional()
				.describe('Document format to match, such as pdf, txt, or all formats'),
			fr2: z
				.string()
				.max(1000)
				.optional()
				.describe('Yahoo display token controlling result module placement and expansion'),
			d: z
				.string()
				.max(4096)
				.optional()
				.describe('Yahoo related-topic destination token, passed through as a string'),
			result_groups: resultGroups,
		},
		summarize: summarizeSerp('Yahoo', 'p'),
	},
	{
		name: 'yahoo_images',
		title: 'Yahoo Images',
		description:
			'Yahoo image results with size, color, style, shape, people, date and usage-rights ' +
			'filters. Requires an API key.',
		path: '/api/yahoo/images',
		keyless: false,
		inputSchema: {
			p: z.string().min(1).max(2000).describe('Text or search operators to send to Yahoo'),
			yahoo_domain: z
				.string()
				.optional()
				.describe(
					'Yahoo regional search host, for example fr.search.yahoo.com. A regional prefix such as ' +
						'fr is also accepted',
				),
			b: z
				.number()
				.int()
				.min(1)
				.max(10001)
				.optional()
				.describe(
					'One-based starting result. Web pages usually advance by 10; image pages usually advance ' +
						'by 60',
				),
			device: z
				.enum(['desktop', 'tablet', 'mobile'])
				.optional()
				.describe('Device profile used for the Yahoo result page'),
			imgsz: z
				.enum(['small', 'medium', 'large', 'wallpaper'])
				.optional()
				.describe('Image size category; wallpaper selects extra-large images'),
			imgc: z
				.enum([
					'color',
					'bw',
					'red',
					'orange',
					'yellow',
					'green',
					'teal',
					'blue',
					'purple',
					'pink',
					'brown',
					'black',
					'gray',
					'white',
				])
				.optional()
				.describe('Select color images, monochrome images (bw), or a dominant color'),
			imgty: z
				.enum(['photo', 'clipart', 'linedrawing', 'gif', 'transparent'])
				.optional()
				.describe('Image style or format to include'),
			imga: z
				.enum(['square', 'wide', 'tall'])
				.optional()
				.describe('Image shape: square, landscape (wide), or portrait (tall)'),
			imgf: z
				.enum(['face', 'portrait', 'nonportrait'])
				.optional()
				.describe('People filter: faces, head-and-shoulders portraits, or images without people'),
			imgt: z
				.enum(['day', 'week', 'month', 'year'])
				.optional()
				.describe('Limit images to a recent day, week, month, or year'),
			imgl: z
				.enum(['cc', 'pd', 'fsu', 'fsuc', 'fmsu', 'fmsuc'])
				.optional()
				.describe(
					'Usage-rights category: Creative Commons (cc), public domain (pd), sharing (fsu), ' +
						'commercial sharing (fsuc), modification (fmsu), or commercial modification (fmsuc)',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Yahoo Images', 'images_results', 'images', 'p'),
	},
	{
		name: 'tripadvisor_search',
		title: 'Tripadvisor Search',
		description:
			'Tripadvisor hotels, restaurants and attractions with rating, review count, type, ' +
			'location and thumbnail, up to 30 a page, near a coordinate or in a geography. Requires ' +
			'an API key.',
		path: '/api/tripadvisor/search',
		keyless: false,
		inputSchema: {
			q: z.string().describe('Required search text, up to 500 characters'),
			tripadvisor_domain: z
				.string()
				.optional()
				.describe('Supported localized Tripadvisor hostname'),
			locale: z.string().optional().describe('Language or language-COUNTRY code'),
			geo_id: z
				.number()
				.int()
				.optional()
				.describe('Optional positive Tripadvisor geography identifier'),
			lat: z.number().optional().describe('Optional search-center latitude; requires lon'),
			lon: z.number().optional().describe('Optional search-center longitude; requires lat'),
			place_type: z
				.enum(['all', 'accommodation', 'attraction', 'attraction_product', 'eatery', 'geo'])
				.optional()
				.describe('Result entity type'),
			start: z.number().int().optional().describe('Result offset from 0 through 10,000'),
			num: z.number().int().optional().describe('Result count from 1 through 30'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Tripadvisor', 'search_results', 'places'),
	},
	{
		name: 'tripadvisor_place',
		title: 'Tripadvisor Place',
		description:
			'Tripadvisor place details: rating, subratings, ranking, address, phone, email, website, ' +
			'menu and coordinates for any place ID, in your currency and locale. Requires an API key.',
		path: '/api/tripadvisor/place',
		keyless: false,
		inputSchema: {
			place_id: z.number().int().describe('Required positive Tripadvisor place identifier'),
			tripadvisor_domain: z
				.string()
				.optional()
				.describe('Supported localized Tripadvisor hostname'),
			locale: z.string().optional().describe('Language or language-COUNTRY code'),
			currency: z.string().optional().describe('Three-letter ISO currency for price fields'),
			geo_id: z.number().int().optional().describe('Optional positive parent geography identifier'),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Tripadvisor place', 'place_results'),
	},
	{
		name: 'tripadvisor_reviews',
		title: 'Tripadvisor Reviews',
		description:
			'Tripadvisor reviews, up to 50 a call with rating, title, text, dates, helpful votes, ' +
			'reviewer and trip type, sorted by recency or relevance. Requires an API key.',
		path: '/api/tripadvisor/reviews',
		keyless: false,
		inputSchema: {
			place_id: z.number().int().describe('Required positive Tripadvisor place identifier'),
			tripadvisor_domain: z
				.string()
				.optional()
				.describe('Supported localized Tripadvisor hostname'),
			locale: z.string().optional().describe('Language or language-COUNTRY code'),
			start: z.number().int().optional().describe('Review offset from 0 through 10,000'),
			num: z.number().int().optional().describe('Review count from 1 through 50'),
			sort_by: z
				.enum(['recent', 'relevance'])
				.optional()
				.describe('Chronological or machine-ranked ordering'),
			translate: z.boolean().optional().describe('Request Tripadvisor machine translation'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Tripadvisor reviews', 'reviews', 'reviews', null),
	},
	{
		name: 'airbnb_search',
		title: 'Airbnb Search',
		description:
			'Search Airbnb stays by destination or map bounds, dates, guests, price, amenities, ' +
			'accessibility and booking filters. Requires an API key.',
		path: '/api/airbnb/search',
		keyless: false,
		inputSchema: {
			q: z.string().max(500).optional().describe('Destination, address, or landmark'),
			map_bounds: z.string().optional().describe('North,east,south,west map coordinates'),
			airbnb_domain: z.string().optional().describe('Airbnb localization domain'),
			currency: z.string().optional().describe('Currency code for returned prices'),
			check_in_date: z.string().optional().describe('Check-in date in YYYY-MM-DD format'),
			check_out_date: z.string().optional().describe('Check-out date, later than check-in'),
			adults: z.number().int().min(0).optional().describe('Number of guests aged 13 or above'),
			children: z.number().int().min(0).optional().describe('Number of guests aged 2 to 12'),
			infants: z.number().int().min(0).optional().describe('Number of guests under 2'),
			pets: z.number().int().min(0).optional().describe('Number of pets'),
			room_type: z.enum(['entire_home', 'private_room']).optional().describe('Type of place'),
			min_price: z.number().min(0).optional().describe('Minimum total trip price including fees'),
			max_price: z.number().min(0).optional().describe('Maximum total trip price including fees'),
			bedrooms: z.number().int().min(0).optional().describe('Minimum bedrooms'),
			beds: z.number().int().min(0).optional().describe('Minimum beds'),
			bathrooms: z.number().min(0).optional().describe('Minimum bathrooms'),
			property_types: z.string().optional().describe('Comma-separated property types'),
			amenities: z.string().optional().describe('Comma-separated required amenities'),
			accessibility_features: z
				.string()
				.optional()
				.describe('Comma-separated accessibility features'),
			host_languages: z.string().optional().describe('Comma-separated host language codes'),
			instant_book: z.boolean().optional().describe('Require instant booking'),
			self_check_in: z.boolean().optional().describe('Require self check-in'),
			guest_favorite: z.boolean().optional().describe('Only Guest favorites'),
			luxe: z.boolean().optional().describe('Only Airbnb Luxe places'),
			page: z.number().int().min(1).max(15).optional().describe('Results page, from 1 to 15'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Airbnb', 'organic_results', 'stays'),
	},
	{
		name: 'eventbrite_search',
		title: 'Eventbrite Search',
		description:
			'Search public Eventbrite listings by location slug and keywords using HTTP, with event ' +
			'dates, venues, organizers and pagination. Requires an API key.',
		path: '/api/eventbrite/search',
		keyless: false,
		inputSchema: {
			location: z
				.string()
				.max(150)
				.optional()
				.describe('Eventbrite location slug, such as tx--austin, ny--new-york, or online'),
			q: z
				.string()
				.min(1)
				.max(200)
				.optional()
				.describe('Search keywords, such as music or python workshops'),
			page: z.number().int().min(1).max(100).optional().describe('Results page, starting at 1'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Eventbrite', 'organic_results', 'events'),
	},
	{
		name: 'indeed_search',
		title: 'Indeed Search',
		description:
			'Search Indeed jobs across country markets with location/radius, language, posting age, ' +
			'employment, remote/hybrid, education, salary, experience, Easy Apply, employer and ' +
			'attribute filters. experience_level selects entry, mid or senior; no_experience selects ' +
			'jobs that require no experience. Skills, benefits, shifts and clearance codes are ' +
			"returned in each job's attributes. Requests 10 jobs by default, configurable up to 100 " +
			'per page. Use next_page_token with next_page and unchanged filters to continue. Results ' +
			'can repeat across pages; deduplicate by job_id. Requires an API key.',
		path: '/api/indeed/search',
		keyless: false,
		inputSchema: {
			q: z
				.string()
				.min(1)
				.max(512)
				.optional()
				.describe(
					'Job title, keywords, company or Indeed query syntax. Omit to browse using only location ' +
						'and filters',
				),
			page: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe('One-based results page. Use next_page from the response to continue'),
			page_token: z
				.string()
				.min(1)
				.max(32768)
				.optional()
				.describe(
					'Continuation token from next_page_token. Use it with next_page and unchanged search ' +
						'parameters',
				),
			location: z.string().min(1).max(512).optional().describe('City, state, ZIP code, or Remote'),
			radius: z
				.number()
				.int()
				.min(0)
				.max(100)
				.optional()
				.describe('Search radius in radius_unit units; 0 means exact location'),
			radius_unit: z
				.enum(['miles', 'kilometers'])
				.optional()
				.describe('Distance unit for the location radius'),
			country: z
				.string()
				.optional()
				.describe('Two-letter Indeed market, for example US, CA, GB, DE or AU'),
			locale: z
				.string()
				.optional()
				.describe(
					'Indeed locale, such as fr-CA or de-DE. Defaults to en-{country}; set the language for ' +
						'non-English searches',
				),
			limit: z
				.number()
				.int()
				.min(1)
				.max(100)
				.optional()
				.describe(
					'Jobs requested per page. Results may contain fewer jobs; use next_page_token to continue',
				),
			sort: z.enum(['relevance', 'date']).optional().describe('Result ordering'),
			fromage: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe('Maximum age in days since the job appeared on Indeed'),
			job_type: z
				.enum([
					'fulltime',
					'parttime',
					'contract',
					'temporary',
					'internship',
					'permanent',
					'temp_to_hire',
					'freelance',
				])
				.optional()
				.describe('Employment type filter'),
			workplace: z
				.enum(['remote', 'hybrid'])
				.optional()
				.describe('Filter for remote or hybrid jobs'),
			easy_apply: z.boolean().optional().describe('Require Indeed Apply'),
			education: z
				.enum(['high_school', 'associate', 'bachelor', 'master', 'doctoral'])
				.optional()
				.describe('Education level filter'),
			no_experience: z.boolean().optional().describe('Require jobs marked No Experience Required'),
			experience_level: z
				.enum(['entry', 'mid', 'senior'])
				.optional()
				.describe('Filter for entry, mid or senior level jobs'),
			salary_min: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe("Minimum annualized base salary in the market's currency"),
			salary_max: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe("Maximum annualized base salary in the market's currency"),
			experience_months_min: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe('Minimum required experience in months'),
			experience_months_max: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe('Maximum required experience in months'),
			job_language: z
				.string()
				.optional()
				.describe('Language of the job posting, independent of the response locale'),
			employer_keys: z
				.array(z.string().min(1).max(512))
				.min(1)
				.max(100)
				.optional()
				.describe(
					'Encoded Indeed employer keys as an array. Names are not keys; company names can be ' +
						'searched in q using company:name',
				),
			attribute_keys: z
				.array(z.string().min(1).max(512))
				.min(1)
				.max(100)
				.optional()
				.describe(
					'Require all of these Indeed attribute codes (JSON array), covering skills, benefits, ' +
						'shifts, licenses, clearances and employment types. Codes and labels are included on ' +
						'returned jobs',
				),
			any_attribute_keys: z
				.array(z.string().min(1).max(512))
				.min(1)
				.max(100)
				.optional()
				.describe(
					'Require any of these Indeed attribute codes (JSON array), combined with all other ' +
						'supplied filters',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Indeed', 'jobs_results', 'jobs'),
	},
	{
		name: 'glassdoor_search',
		title: 'Glassdoor Search',
		description:
			'Search Glassdoor jobs using free-text locations or exact city/state/country IDs, ' +
			'distance, posting age, salary, employment, seniority, remote work, Easy Apply, employer, ' +
			'size, industry, occupation, city and rating filters. Set include_filters to see ' +
			'available filter choices for your search. Use next_page_token with next_page and ' +
			'unchanged parameters to continue. Requires an API key.',
		path: '/api/glassdoor/search',
		keyless: false,
		inputSchema: {
			q: z
				.string()
				.min(1)
				.max(512)
				.optional()
				.describe('Job title, keywords or company. Omit to browse using only location and filters'),
			page: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe('One-based results page. Use next_page from the response to continue'),
			location: z
				.string()
				.min(1)
				.max(512)
				.optional()
				.describe(
					'Free-text city, state, country or postal code. Use location_id and location_type for an ' +
						'exact location instead',
				),
			page_token: z
				.string()
				.min(1)
				.max(32768)
				.optional()
				.describe(
					'Copy next_page_token with its next_page and the same search parameters to continue',
				),
			location_id: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe(
					'Glassdoor location ID, for example 1132348 for New York. Omit for nationwide search',
				),
			location_type: z
				.enum(['C', 'S', 'N'])
				.optional()
				.describe('Location type: C city, S state, N country. Required with location_id'),
			location_country: z
				.string()
				.optional()
				.describe(
					'Restrict the free-text location to this two-letter country, for example GB for London, ' +
						'England. Requires location',
				),
			radius: z
				.number()
				.int()
				.min(0)
				.max(100)
				.optional()
				.describe('Distance in miles; 0 means the exact location. Defaults to 25'),
			job_type: z
				.enum(['fulltime', 'parttime', 'contract', 'temporary', 'internship', 'permanent'])
				.optional()
				.describe('Employment type. Use job_types to select multiple types'),
			job_types: z
				.array(z.string().min(1).max(512))
				.min(1)
				.max(100)
				.optional()
				.describe(
					'Employment attribute codes as an array, for example ["CF3CP","NJXCK"]. Mutually ' +
						'exclusive with job_type. Codes are returned by include_filters',
				),
			from_age: z.number().int().min(1).max(30).optional().describe('Maximum posting age in days'),
			salary_min: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe("Minimum annual salary in the search location's currency"),
			salary_max: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe("Maximum annual salary in the search location's currency"),
			remote: z
				.boolean()
				.optional()
				.describe('True selects work-from-home or remote jobs. False includes all workplace types'),
			easy_apply: z
				.boolean()
				.optional()
				.describe('True selects Easy Apply jobs. False includes all application types'),
			seniority: z
				.enum(['internship', 'entrylevel', 'midseniorlevel', 'director', 'executive'])
				.optional()
				.describe('Seniority filter'),
			company_id: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe('Glassdoor employer ID; include_filters returns matching employer IDs'),
			company_sizes: z
				.array(z.number().int())
				.min(1)
				.max(100)
				.optional()
				.describe(
					'Employer size categories as an array: 1 tiny, 2 small, 3 medium, 4 large, 5 huge',
				),
			industry_id: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe(
					'Glassdoor industry ID; available values depend on the search and are returned by ' +
						'include_filters',
				),
			occupation_id: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe('Glassdoor occupation category, such as 1007 Engineering. See include_filters'),
			city_id: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe('Refine the search to a city ID from include_filters'),
			min_rating: z.number().min(0).max(5).optional().describe('Minimum employer rating'),
			sort: z
				.enum(['relevance', 'date_asc', 'date_desc'])
				.optional()
				.describe('Relevance, oldest first, or newest first'),
			include_filters: z
				.boolean()
				.optional()
				.describe(
					'Return available filters, values, counts and employer names in available_filters',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Glassdoor', 'jobs_results', 'jobs'),
	},
	{
		name: 'ashby_search',
		title: 'Jobs by Ashby Search',
		description:
			"Search an employer's public Ashby board by keyword, primary/secondary location, " +
			'department, team, employment type, remote status and workplace type. Country, region and ' +
			'city filters match the same primary or secondary postal address. Unlisted direct-link ' +
			'jobs are excluded. Requires an API key.',
		path: '/api/ashby/search',
		keyless: false,
		inputSchema: {
			q: z
				.string()
				.min(1)
				.max(512)
				.optional()
				.describe('Case-insensitive phrase in title or description'),
			page: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe('One-based results page. Use next_page from the response to continue'),
			board: z
				.string()
				.describe('Employer board name from jobs.ashbyhq.com/{board}, for example ashby'),
			location: z
				.string()
				.min(1)
				.max(512)
				.optional()
				.describe('Case-insensitive phrase in primary or secondary locations'),
			department: z
				.string()
				.min(1)
				.max(512)
				.optional()
				.describe('Case-insensitive department name'),
			team: z.string().min(1).max(512).optional().describe('Exact team name, case-insensitive'),
			workplace_type: z
				.enum(['OnSite', 'Remote', 'Hybrid'])
				.optional()
				.describe("Employer's workplace type"),
			country: z
				.string()
				.min(1)
				.max(512)
				.optional()
				.describe(
					'Country from a primary or secondary postal address, for example USA. Exact ' +
						'case-insensitive match',
				),
			region: z
				.string()
				.min(1)
				.max(512)
				.optional()
				.describe(
					'State or province from a primary or secondary postal address. Exact case-insensitive ' +
						'match',
				),
			city: z
				.string()
				.min(1)
				.max(512)
				.optional()
				.describe(
					'City from a primary or secondary postal address. All supplied address filters must match ' +
						'the same address',
				),
			remote: z
				.boolean()
				.optional()
				.describe('True selects remote jobs. False selects non-remote jobs'),
			employment_type: z
				.enum(['FullTime', 'PartTime', 'Intern', 'Contract', 'Temporary'])
				.optional()
				.describe('Employment type'),
			limit: z.number().int().min(1).max(100).optional().describe('Results per page'),
			include_compensation: z
				.boolean()
				.optional()
				.describe('Include published compensation tiers and salary ranges'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Ashby', 'jobs_results', 'jobs'),
	},
	{
		name: 'ziprecruiter_search',
		title: 'ZipRecruiter Search',
		description:
			'Search ZipRecruiter jobs by keywords and location, including US and Canadian cities, ' +
			'with distance, posting age, employment types, on-site/remote/hybrid, annualized salary, ' +
			'experience and quick-apply filters. Keep filters unchanged when requesting additional ' +
			"pages. Salary bounds apply to the posting's maximum annualized pay. Requires an API key.",
		path: '/api/ziprecruiter/search',
		keyless: false,
		inputSchema: {
			q: z.string().min(1).max(512).describe('Job title, keywords, or company to search for'),
			page: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe('One-based results page. Use next_page from the response to continue'),
			location: z
				.string()
				.min(1)
				.max(512)
				.describe('City and state or ZIP code, for example New York, NY'),
			radius: z
				.number()
				.int()
				.min(0)
				.max(5000)
				.optional()
				.describe('Search radius in miles. Use 5000 for any distance'),
			days: z.number().int().min(1).optional().describe('Maximum posting age in days'),
			employment_types: z
				.array(
					z.enum([
						'full_time',
						'part_time',
						'contract',
						'contract_to_hire',
						'temporary',
						'as_needed',
						'other',
					]),
				)
				.min(1)
				.max(100)
				.optional()
				.describe('Employment types as an array'),
			location_type: z
				.enum(['no_remote', 'only_remote', 'hybrid'])
				.optional()
				.describe('On-site, remote-only, or hybrid jobs'),
			salary_min: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe("Lower bound for the job's maximum annualized pay, in the location's currency"),
			salary_max: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe("Upper bound for the job's maximum annualized pay"),
			experience_level: z
				.enum(['no_experience', 'junior', 'mid', 'senior'])
				.optional()
				.describe('Experience/seniority class'),
			easy_apply: z.boolean().optional().describe("Require ZipRecruiter's quick application"),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('ZipRecruiter', 'jobs_results', 'jobs'),
	},
	{
		name: 'levels_search',
		title: 'Levels.fyi Search',
		description:
			'Search public Levels.fyi jobs by multiple companies and city/state/country slugs, job ' +
			'families, levels, employment types, work arrangements, posting age, minimum base/total ' +
			'compensation, company type/size/valuation and benefits. Results are grouped by company: ' +
			'limit advances company groups and jobs_per_company selects their previews. Use a ' +
			'returned company_slug as company (or a one-element companies array) to paginate all ' +
			'matching jobs at that company; multi-company searches do not enumerate every job in each ' +
			'group. Some compensation ranges are estimates. Requires an API key.',
		path: '/api/levels/search',
		keyless: false,
		inputSchema: {
			q: z
				.string()
				.min(1)
				.max(512)
				.optional()
				.describe('Job title, keywords or company; omit to browse'),
			page: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe('One-based results page. Use next_page from the response to continue'),
			company: z.string().optional().describe('Company slug, such as google'),
			location: z
				.string()
				.optional()
				.describe('Levels.fyi location slug, such as united-states; not a free-text city name'),
			sort: z
				.enum(['relevance', 'date_published', 'total_compensation'])
				.optional()
				.describe('Result ordering'),
			limit: z
				.number()
				.int()
				.min(1)
				.max(20)
				.optional()
				.describe('Companies per page; jobs are grouped by company'),
			jobs_per_company: z
				.number()
				.int()
				.min(1)
				.max(15)
				.optional()
				.describe('Maximum matching jobs included for each company'),
			companies: z
				.array(z.string())
				.min(1)
				.max(100)
				.optional()
				.describe(
					'Company slugs as an array; mutually exclusive with company. A single company advances ' +
						'jobs instead of company groups',
				),
			locations: z
				.array(z.string())
				.min(1)
				.max(100)
				.optional()
				.describe(
					'City, state or country slugs as an array, such as ["united-states","canada"]. Mutually ' +
						'exclusive with location',
				),
			job_families: z
				.array(z.string())
				.min(1)
				.max(100)
				.optional()
				.describe('Job-family slugs as an array, such as ["software-engineer"]'),
			levels: z
				.array(
					z.enum([
						'internship',
						'entry',
						'mid_staff',
						'principal',
						'manager',
						'director',
						'executive',
					]),
				)
				.min(1)
				.max(100)
				.optional()
				.describe('Standard seniority levels as an array'),
			employment_types: z
				.array(
					z.enum([
						'full_time',
						'part_time',
						'contract',
						'temporary',
						'internship',
						'volunteer',
						'other',
					]),
				)
				.min(1)
				.max(100)
				.optional()
				.describe('Employment types as an array'),
			work_arrangements: z
				.array(z.enum(['remote', 'office', 'hybrid']))
				.min(1)
				.max(100)
				.optional()
				.describe('Work arrangements as an array'),
			min_base_compensation: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe('Minimum annual base compensation in USD'),
			min_total_compensation: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe(
					'Minimum median annual total compensation in USD; may include Levels.fyi estimates',
				),
			company_types: z
				.array(z.enum(['private', 'public', 'nonprofit', 'government', 'education', 'delisted']))
				.min(1)
				.max(100)
				.optional()
				.describe('Company types as an array'),
			company_sizes: z
				.array(z.enum(['seed', 'early', 'mid', 'large', 'enterprise']))
				.min(1)
				.max(100)
				.optional()
				.describe(
					'Company sizes as an array: seed 1–50, early 51–200, mid 201–1,000, large 1,001–10,000, ' +
						'enterprise 10,001+ employees',
				),
			company_valuations: z
				.array(z.tuple([z.number().int(), z.number().int()]))
				.min(1)
				.max(100)
				.optional()
				.describe('Company valuation ranges in USD as an array of [minimum, maximum] pairs'),
			perk_ids: z
				.array(z.number().int())
				.min(1)
				.max(100)
				.optional()
				.describe(
					'Benefit IDs as an array, for example 58 remote work, 4 retirement plan, 35 paid time ' +
						'off, 22 health insurance',
				),
			posted_within: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe('Maximum posting age in posted_within_unit units'),
			posted_within_unit: z
				.enum(['days', 'weeks', 'months'])
				.optional()
				.describe('Unit for posted_within'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Levels.fyi', 'jobs_results', 'jobs'),
	},
	{
		name: 'zillow_search',
		title: 'Zillow Search',
		description:
			'Search Zillow homes for sale, rentals and recently sold properties by location or map ' +
			'area, with price, room and property filters. Requires an API key.',
		path: '/api/zillow/search',
		keyless: false,
		inputSchema: {
			min_price: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe(
					'Minimum listing price in US dollars. For rental searches, prices are monthly rent in US ' +
						'dollars',
				),
			max_price: z.number().int().min(0).optional().describe('Maximum listing price in US dollars'),
			min_beds: z.number().int().min(0).max(20).optional().describe('Minimum number of bedrooms'),
			max_beds: z.number().int().min(0).max(20).optional().describe('Maximum number of bedrooms'),
			min_baths: z.number().min(0).max(20).optional().describe('Minimum number of bathrooms'),
			min_sqft: z.number().int().min(0).optional().describe('Minimum interior area in square feet'),
			max_sqft: z.number().int().min(0).optional().describe('Maximum interior area in square feet'),
			q: z
				.string()
				.min(1)
				.max(200)
				.optional()
				.describe(
					'City, ZIP code, neighborhood or address. Supply q or map_bounds. Supply exactly one of q ' +
						'or map_bounds',
				),
			map_bounds: z.string().optional().describe('Map rectangle as north,east,south,west'),
			status: z.enum(['for_sale', 'for_rent', 'sold']).optional().describe('Listing status'),
			property_type: z
				.enum(['house', 'condo', 'townhouse', 'multi_family', 'land', 'manufactured', 'apartment'])
				.optional()
				.describe('Restrict results to one property type'),
			sort: z
				.enum(['recommended', 'newest', 'price_asc', 'price_desc', 'beds', 'sqft'])
				.optional()
				.describe('Order of matching listings'),
			page: z
				.number()
				.int()
				.min(1)
				.max(20)
				.optional()
				.describe(
					'Result page, starting at 1; Zillow caps searches at 20 pages. Follow pagination.next for ' +
						'another page. A search exposes at most 20 pages',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Zillow', 'properties', 'properties'),
	},
	{
		name: 'zillow_property',
		title: 'Zillow Property',
		description:
			'Read a Zillow property by its identifier or listing URL, including available facts, ' +
			'photos, estimates and listing history. Requires an API key.',
		path: '/api/zillow/property',
		keyless: false,
		inputSchema: {
			zpid: z
				.number()
				.int()
				.gt(0)
				.optional()
				.describe('Zillow property identifier. Supply zpid or url'),
			url: z
				.string()
				.max(2048)
				.optional()
				.describe(
					'Zillow homedetails URL. Supply url or zpid. Supply exactly one of url or zpid. Apartment ' +
						'building URLs are not property-detail URLs',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Zillow property', 'property'),
	},
	{
		name: 'zillow_locations',
		title: 'Zillow Locations',
		description:
			'Find Zillow region and address suggestions with opaque page tokens. Requires an API key.',
		path: '/api/zillow/locations',
		keyless: false,
		inputSchema: {
			q: z
				.string()
				.min(1)
				.max(200)
				.optional()
				.describe(
					'City, ZIP code, neighborhood or street address. Required on the first page; omit with ' +
						'page_token',
				),
			type: z
				.enum(['regions', 'addresses'])
				.optional()
				.describe(
					'Find regions or addresses. Defaults to regions; omit with page_token. Region suggestions ' +
						'include Zillow region IDs. Address suggestions return names; this route does not return ' +
						'property ZPIDs or coordinates',
				),
			limit: z
				.number()
				.int()
				.min(1)
				.max(100)
				.optional()
				.describe(
					'Suggestions per page, from 1 to 100. Defaults to 10; omit with page_token. Follow ' +
						'pagination.next or send pagination.next_page_token as page_token. Each lookup supports ' +
						'up to 1,000 suggestions; if pagination.possibly_truncated is true, refine q',
				),
			page_token: z
				.string()
				.min(1)
				.max(32768)
				.optional()
				.describe(
					'Opaque next_page_token from the preceding response. Send it alone to continue the same ' +
						'lookup. Continue the same query, suggestion type and page size without repeating ' +
						'previously returned suggestions. If pagination.next is null while has_more is true, send ' +
						'page_token through POST JSON',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Zillow locations', 'locations', 'locations'),
	},
	{
		name: 'redfin_search',
		title: 'Redfin Search',
		description:
			'Search Redfin homes for sale or recently sold homes by region URL, region identifier or ' +
			'map area, with price and property filters. Requires an API key.',
		path: '/api/redfin/search',
		keyless: false,
		inputSchema: {
			min_price: z.number().int().min(0).optional().describe('Minimum listing price in US dollars'),
			max_price: z.number().int().min(0).optional().describe('Maximum listing price in US dollars'),
			min_beds: z.number().int().min(0).max(20).optional().describe('Minimum number of bedrooms'),
			max_beds: z.number().int().min(0).max(20).optional().describe('Maximum number of bedrooms'),
			min_baths: z.number().min(0).max(20).optional().describe('Minimum number of bathrooms'),
			min_sqft: z.number().int().min(0).optional().describe('Minimum interior area in square feet'),
			max_sqft: z.number().int().min(0).optional().describe('Maximum interior area in square feet'),
			url: z
				.string()
				.max(2048)
				.optional()
				.describe(
					'Redfin city, ZIP, county or neighborhood search URL. Existing URL filters are retained ' +
						'unless overridden. Supply one location: a region URL, region_id with region_type, or ' +
						'map_bounds',
				),
			region_id: z
				.number()
				.int()
				.gt(0)
				.optional()
				.describe('Redfin region identifier; requires region_type'),
			region_type: z
				.union([z.literal(1), z.literal(2), z.literal(5), z.literal(6), z.literal(11)])
				.optional()
				.describe(
					'Region kind: 1 neighborhood, 2 ZIP region, 5 county, 6 city, 11 state. A ZIP region ' +
						'identifier differs from the ZIP code. Use a Redfin ZIP search URL if the region ' +
						'identifier is unknown',
				),
			map_bounds: z.string().optional().describe('Map rectangle as north,east,south,west'),
			status: z
				.enum(['for_sale', 'sold'])
				.optional()
				.describe('Listing status. Defaults to for_sale when no URL is supplied'),
			sold_within_days: z
				.number()
				.int()
				.min(1)
				.max(365)
				.optional()
				.describe(
					'Sold listings from the last N days; requires status=sold. Defaults to 180 for sold ' +
						'searches',
				),
			property_type: z
				.enum([
					'house',
					'condo',
					'townhouse',
					'multi_family',
					'land',
					'other',
					'manufactured',
					'co_op',
				])
				.optional()
				.describe('Restrict results to one property type'),
			sort: z
				.enum(['recommended', 'newest', 'price_asc', 'price_desc', 'sqft'])
				.optional()
				.describe('Result ordering. Defaults to recommended when no URL is supplied'),
			limit: z
				.number()
				.int()
				.min(1)
				.max(350)
				.optional()
				.describe(
					'Maximum homes returned. Narrow the region or map bounds when results reach this limit. ' +
						'The response does not advertise pagination or a total count. If ' +
						'search_information.possibly_truncated is true, narrow the location or filters',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Redfin', 'properties', 'properties', null),
	},
	{
		name: 'redfin_property',
		title: 'Redfin Property',
		description:
			'Read a Redfin listing URL to retrieve property details, available photos, amenities, ' +
			'public records and listing history. Requires an API key.',
		path: '/api/redfin/property',
		keyless: false,
		inputSchema: {
			url: z.string().max(2048).describe('Redfin property URL ending in /home/<property_id>'),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Redfin property', 'property'),
	},
	{
		name: 'realtor_search',
		title: 'Realtor.com Search',
		description:
			'Search Realtor.com listings from a public location URL, preserving its filters and ' +
			'available page links. Alpha. Requires an API key.',
		path: '/api/realtor/search',
		keyless: false,
		inputSchema: {
			limit: z
				.number()
				.int()
				.min(1)
				.max(200)
				.optional()
				.describe('Listings per results page, from 1 to 200'),
			url: z
				.string()
				.max(4096)
				.describe(
					'Realtor.com city_STATE or ZIP search URL under /realestateandhomes-search/ or ' +
						'/apartments/. Alpha: availability may vary by location or property. Supported URL ' +
						'filters: price, beds, baths, sqft, type-single-family-home, show-recently-sold and pg-1 ' +
						'through pg-100. Unsupported filters and query parameters are rejected. Follow ' +
						'pagination.next when present',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Realtor.com', 'properties', 'properties', null),
	},
	{
		name: 'realtor_property',
		title: 'Realtor.com Property',
		description:
			'Read available property facts, prices and listing details from a public Realtor.com ' +
			'property URL. Alpha. Requires an API key.',
		path: '/api/realtor/property',
		keyless: false,
		inputSchema: {
			url: z
				.string()
				.max(2048)
				.describe(
					'Realtor.com property URL under /realestateandhomes-detail/, without query parameters. ' +
						'Alpha: availability may vary by location or property. Returns available fields for the ' +
						'requested property',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Realtor.com property', 'property'),
	},
	{
		name: 'apartments_search',
		title: 'Apartments.com Search',
		description:
			'Search Apartments.com listings from a public location URL, preserving its filters and ' +
			'available page links. Alpha. Requires an API key.',
		path: '/api/apartments/search',
		keyless: false,
		inputSchema: {
			url: z
				.string()
				.max(4096)
				.describe(
					'Apartments.com location search URL, including any price, bedroom, amenity or page ' +
						'filters. Alpha: availability may vary by location or property. Use the site URL to set ' +
						'filters or select a page. Follow pagination.next when present. Page links and total ' +
						'counts are included when available. Prices may represent a rental range',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Apartments.com', 'properties', 'properties', null),
	},
	{
		name: 'apartments_property',
		title: 'Apartments.com Property',
		description:
			'Read available property facts, prices and listing details from a public Apartments.com ' +
			'property URL. Alpha. Requires an API key.',
		path: '/api/apartments/property',
		keyless: false,
		inputSchema: {
			url: z
				.string()
				.max(2048)
				.describe(
					'Apartments.com property URL ending in its seven-character listing ID, without query ' +
						'parameters. Alpha: availability may vary by location or property. Returns available ' +
						'fields for the requested property. Prices may represent a rental range. Bedroom-specific ' +
						'rents and total-monthly-price labels are preserved when present',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Apartments.com property', 'property'),
	},
	{
		name: 'homes_search',
		title: 'Homes.com Search',
		description:
			'Search Homes.com listings from a public location URL, preserving its filters and ' +
			'available page links. Alpha. Requires an API key.',
		path: '/api/homes/search',
		keyless: false,
		inputSchema: {
			url: z
				.string()
				.max(4096)
				.describe(
					'Homes.com location search URL, including sale, rental, price, property-type or page ' +
						'filters. Alpha: availability may vary by location or property. Use the site URL to set ' +
						'filters or select a page. Follow pagination.next when present. Page links and total ' +
						'counts are included when available',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Homes.com', 'properties', 'properties', null),
	},
	{
		name: 'homes_property',
		title: 'Homes.com Property',
		description:
			'Read available property facts, prices and listing details from a public Homes.com ' +
			'property URL. Alpha. Requires an API key.',
		path: '/api/homes/property',
		keyless: false,
		inputSchema: {
			url: z
				.string()
				.max(2048)
				.describe(
					'Homes.com property URL under /property/, without query parameters. Alpha: availability ' +
						'may vary by location or property. Returns available property facts, descriptions, ' +
						'coordinates, agents and photos. Price history is not available from this route. Returns ' +
						'available fields for the requested property',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Homes.com property', 'property'),
	},
	{
		name: 'facebook_search_pages',
		title: 'Facebook Search Pages',
		description:
			'Find public Pages by name, with country and ad-category preferences. Returns Page IDs, ' +
			'names and available metadata, with up to 15 suggestions. Pagination is unavailable. ' +
			'Alpha. Requires an API key.',
		path: '/api/facebook/search-pages',
		keyless: false,
		inputSchema: {
			query: z.string().min(1).max(200).describe('Page name or phrase to look up'),
			limit: z
				.number()
				.int()
				.min(1)
				.max(15)
				.optional()
				.describe('Maximum Page suggestions per response; fewer may be available'),
			country: z
				.string()
				.optional()
				.describe(
					'Two-letter country preference for Page suggestions, such as US, GB or CA. Does not ' +
						"restrict a Page's location",
				),
			ad_type: z
				.enum(['ALL', 'POLITICAL_AND_ISSUE_ADS'])
				.optional()
				.describe('Ad category for Page suggestions: all ads or political and issue ads'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Facebook Pages', 'pages', 'Pages', 'query'),
	},
	{
		name: 'facebook_search_profiles',
		title: 'Facebook Search Profiles',
		description:
			'Find public profiles by name and return displayed names and profile links. Returns up to ' +
			'12 results. Pagination and enriched profile details are unavailable. Alpha. Requires an ' +
			'API key.',
		path: '/api/facebook/search-profiles',
		keyless: false,
		inputSchema: {
			query: z.string().min(1).max(200).describe('Name to search for'),
			limit: z
				.number()
				.int()
				.min(1)
				.max(12)
				.optional()
				.describe('Maximum profiles per response; fewer may be available'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Facebook profiles', 'profiles', 'profiles', 'query'),
	},
	{
		name: 'facebook_hashtag_posts',
		title: 'Facebook Hashtag Posts',
		description:
			'Read public posts associated with a hashtag, including available text, authors, media ' +
			'and engagement. Continue with the returned token and the same hashtag; limit may change. ' +
			'Previously returned posts are excluded. Responses may contain fewer posts than ' +
			'requested, and tokens can expire. Alpha. Requires an API key.',
		path: '/api/facebook/hashtag-posts',
		keyless: false,
		inputSchema: {
			tag: z
				.string()
				.describe('Hashtag made of letters, digits or underscores, with an optional leading #'),
			limit: z
				.number()
				.int()
				.min(1)
				.max(20)
				.optional()
				.describe('Maximum posts per response; fewer may be available'),
			continuation_token: z
				.string()
				.min(1)
				.max(32768)
				.optional()
				.describe(
					'Token from pagination.continuation_token in the preceding response. Keep the same ' +
						'hashtag; limit may change. Tokens can expire',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Facebook hashtag', 'posts', 'posts', 'tag'),
	},
	{
		name: 'facebook_post',
		title: 'Facebook Post Details',
		description:
			'Retrieve a public Facebook post by its direct permalink, with available text, author ' +
			'identities, publication time, media and engagement counts. Private posts and content ' +
			'requiring sign-in are unavailable. Alpha. Requires an API key.',
		path: '/api/facebook/post',
		keyless: false,
		inputSchema: {
			url: z
				.string()
				.max(400)
				.describe('Public www.facebook.com post permalink containing a page and post identifier'),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Facebook post', 'post'),
	},
	{
		name: 'facebook_page_posts',
		title: 'Facebook Page Posts',
		description:
			'Read available public posts from a Facebook Page, including text, authors, media and ' +
			'engagement. A response may contain only one post. Complete history, date filtering and ' +
			'pagination are unavailable. Alpha. Requires an API key.',
		path: '/api/facebook/page-posts',
		keyless: false,
		inputSchema: {
			handle: z.string().describe('Public page handle without a URL, such as NASA'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Facebook Page posts', 'posts', 'posts', null),
	},
	{
		name: 'facebook_marketplace_browse',
		title: 'Facebook Marketplace Browse',
		description:
			'Browse public Facebook Marketplace listings by city or search by keyword. Supports ' +
			'radius, price bounds, sorting, item condition and listing age. Use continuation tokens ' +
			'for keyword searches; later requests may fail or be rate limited. Listing-detail and ' +
			'seller enrichment are unavailable. Alpha. Requires an API key.',
		path: '/api/facebook/marketplace-browse',
		keyless: false,
		inputSchema: {
			limit: z
				.number()
				.int()
				.min(1)
				.max(26)
				.optional()
				.describe('Maximum listings per response; fewer may be available'),
			location: z
				.string()
				.optional()
				.describe(
					'Marketplace city slug or numeric city ID, such as austin or london. Required for keyword ' +
						'search and radius filtering',
				),
			query: z
				.string()
				.min(1)
				.max(200)
				.optional()
				.describe('Listing search keywords. Supply location to keep the search geography fixed'),
			radius_km: z
				.number()
				.int()
				.min(1)
				.max(500)
				.optional()
				.describe(
					'Search radius in kilometers, from 1 to 500. Requires location; defaults to 65 km when ' +
						'omitted. Shipped or promoted listings may fall outside this radius',
				),
			min_price: z
				.number()
				.min(0)
				.max(10000000)
				.optional()
				.describe('Minimum listing price in local currency units. Requires query and location'),
			max_price: z
				.number()
				.min(0)
				.max(10000000)
				.optional()
				.describe(
					'Maximum listing price in local currency units, at least min_price. Requires query and ' +
						'location',
				),
			sort_by: z
				.enum(['price_ascend', 'price_descend', 'creation_time_descend'])
				.optional()
				.describe(
					'Search ordering: lowest price, highest price or newest listings. Requires query and ' +
						'location',
				),
			condition: z
				.enum(['new', 'used_like_new', 'used_good', 'used_fair'])
				.optional()
				.describe('Item condition for keyword search. Requires query and location'),
			days_since_listed: z
				.number()
				.int()
				.min(1)
				.max(30)
				.optional()
				.describe(
					'Restrict keyword search to recent listings, from 1 to 30 days. Requires query and ' +
						'location',
				),
			continuation_token: z
				.string()
				.min(1)
				.max(32768)
				.optional()
				.describe(
					'Token from pagination.continuation_token in the preceding response. Repeat the same ' +
						'query, location and filters; limit may change. Keyword search only. Later requests may ' +
						'fail or be rate limited',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Facebook Marketplace', 'listings', 'listings', 'query'),
	},
	{
		name: 'facebook_reel',
		title: 'Facebook Reel Details',
		description:
			'Retrieve a public Facebook reel by its direct address, including available caption, ' +
			'creator, duration, thumbnail and playback URLs. Media URLs can expire. Page reels feeds ' +
			'and pagination are unavailable. Alpha. Requires an API key.',
		path: '/api/facebook/reel',
		keyless: false,
		inputSchema: {
			url: z
				.string()
				.max(150)
				.describe('Public reel address in the form https://www.facebook.com/reel/123456789/'),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Facebook reel', 'reel'),
	},
	{
		name: 'yelp_search',
		title: 'Yelp Search',
		description:
			'Yelp business search, 10 businesses a page with rating, reviews, categories, address, ' +
			"phone and coordinates, with Yelp's sort, category and attribute filters. Requires an API " +
			'key.',
		path: '/api/yelp/search',
		keyless: false,
		inputSchema: {
			find_desc: z.string().optional().describe('Business name, category, or search terms'),
			find_loc: z.string().describe('Required Yelp search location'),
			yelp_domain: z
				.string()
				.optional()
				.describe('Supported Yelp hostname. Results use the language of the selected domain'),
			l: z.string().optional().describe('Optional Yelp-native map bounds token'),
			cflt: z
				.string()
				.optional()
				.describe('Yelp category identifier containing letters, numbers, _ or -'),
			sortby: z
				.enum(['recommended', 'rating', 'review_count'])
				.optional()
				.describe('Native Yelp ordering'),
			attrs: z.string().optional().describe('Yelp-native comma-separated attribute filters'),
			start: z.number().int().optional().describe('Result offset from 0 through 10,000'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Yelp', 'organic_results', 'businesses', 'find_desc'),
	},
	{
		name: 'yelp_place',
		title: 'Yelp Place',
		description:
			'Yelp business details by ID or alias, with optional business alerts and full menus. ' +
			'Requires an API key.',
		path: '/api/yelp/place',
		keyless: false,
		inputSchema: {
			place_id: z.string().describe('Required Yelp encoded business ID or business alias'),
			yelp_domain: z.string().optional().describe('Supported localized Yelp hostname'),
			business_alert: z
				.boolean()
				.optional()
				.describe('Include business alert information when available'),
			full_menu: z
				.boolean()
				.optional()
				.describe(
					'Fetch the full menu when available; otherwise return place details with an explanation',
				),
			menu_name: z
				.string()
				.optional()
				.describe('Select a named menu when more than one is available. Requires full_menu=true'),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Yelp place', 'place_results'),
	},
	{
		name: 'yelp_reviews',
		title: 'Yelp Reviews',
		description:
			'Yelp reviews, up to 49 full reviews a call with rating, text, date, reviewer, photos, ' +
			'reactions and owner replies, six sort orders and rating filters. Requires an API key.',
		path: '/api/yelp/reviews',
		keyless: false,
		inputSchema: {
			place_id: z.string().describe('Required encoded Yelp business identifier'),
			yelp_domain: z.string().optional().describe('Supported localized Yelp hostname'),
			hl: z.string().optional().describe('Review language such as en or fr-FR'),
			q: z.string().optional().describe('Search review text for these terms'),
			sortby: z
				.enum([
					'relevance_desc',
					'date_desc',
					'date_asc',
					'rating_desc',
					'rating_asc',
					'elites_desc',
				])
				.optional()
				.describe('Yelp review ordering'),
			rating: z.string().optional().describe('Comma-separated ratings from 1 through 5'),
			not_recommended: z
				.boolean()
				.optional()
				.describe('Fetch reviews that Yelp does not recommend'),
			not_recommended_start: z
				.number()
				.int()
				.optional()
				.describe('Offset within not-recommended reviews. Requires not_recommended=true'),
			start: z.number().int().optional().describe('Review offset from 0 through 10,000'),
			num: z.number().int().optional().describe('Review count from 1 through 49'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Yelp reviews', 'reviews', 'reviews', null),
	},
	{
		name: 'youtube_search',
		title: 'YouTube Search',
		description:
			'YouTube videos, channels, playlists and Shorts as structured JSON, with country, ' +
			'language, native filters and continuation pagination. Requires an API key.',
		path: '/api/youtube/search',
		keyless: false,
		inputSchema: {
			type: z
				.enum(['video', 'shorts', 'channel', 'playlist', 'movie'])
				.optional()
				.describe(
					'Result type. Omit for mixed results. Movies appear in video_results. Channels and ' +
						'playlists cannot use upload_date, duration or features. Shorts cannot use duration. ' +
						'Movies cannot use live, subtitles, creative_commons or 3d features',
				),
			upload_date: z
				.enum(['today', 'this_week', 'this_month', 'this_year'])
				.optional()
				.describe('Limit results by upload date'),
			duration: z
				.enum(['under_3_min', 'between_3_and_20_min', 'over_20_min'])
				.optional()
				.describe('Video duration: under 3 minutes, 3–20 minutes, or over 20 minutes'),
			features: z
				.string()
				.min(1)
				.max(160)
				.optional()
				.describe(
					'Comma-separated features: live, 4k, hd, subtitles, creative_commons, 360, vr180, 3d, ' +
						'hdr, location. Combined features must all match',
				),
			sort_by: z
				.enum(['relevance', 'popularity'])
				.optional()
				.describe(
					'YouTube ranking: relevance (default) or popularity. Popularity is not a strict numerical ' +
						"view-count sort. Uses YouTube's current ranking choices. The removed upload-date/rating " +
						'sorts and last-hour upload filter are not supported named values',
				),
			q: z
				.string()
				.min(1)
				.max(2048)
				.optional()
				.describe(
					'Search query. Required for the first page; omit with page_token. Required on the first ' +
						'page',
				),
			hl: z
				.string()
				.optional()
				.describe(
					'YouTube interface language, such as en or pt-BR. Defaults to en. Omit with page_token',
				),
			gl: z
				.string()
				.optional()
				.describe('Two-letter country code. Defaults to US. Omit with page_token'),
			sp: z
				.string()
				.min(1)
				.max(2048)
				.optional()
				.describe(
					'Advanced YouTube filter token from a results URL. Use either sp or named filters, never ' +
						'both. Omit with page_token. Raw or once-URL-encoded values from a YouTube results URL ' +
						'are accepted',
				),
			page_token: z
				.string()
				.min(1)
				.max(32768)
				.optional()
				.describe(
					'Opaque next_page_token from the preceding response. Send it alone to continue the same ' +
						'search; tokens expire after one hour. Send page_token alone, without query, locale or ' +
						'filter parameters. It preserves all filters. Use POST for long tokens. Pagination ends ' +
						'when pagination.next_page_token is absent',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('YouTube', 'video_results', 'videos'),
	},
	{
		name: 'youtube_channel',
		title: 'YouTube Channel',
		description:
			'Read a YouTube channel profile and its videos, Shorts, live streams, podcasts, playlists ' +
			'or posts. Search within the channel, choose a sort order and continue through pages. ' +
			'Requires an API key.',
		path: '/api/youtube/channel',
		keyless: false,
		inputSchema: {
			channel_id: z
				.string()
				.min(1)
				.max(100)
				.optional()
				.describe(
					'Channel handle (with or without @) or a UC channel ID. Required on the first page; omit ' +
						'with next_page_token. Use a handle such as @veritasium or a UC channel ID; full URLs are ' +
						'not accepted',
				),
			tab: z
				.enum(['videos', 'shorts', 'streams', 'podcasts', 'playlists', 'posts'])
				.optional()
				.describe(
					'Channel content tab. Defaults to videos. Omit when using search_query or ' +
						'next_page_token. Not every channel offers every tab. A channel without the requested tab ' +
						'returns an empty content group with search_information.tab_available set to false',
				),
			sort: z
				.enum(['latest', 'popular', 'oldest', 'dd', 'lad'])
				.optional()
				.describe(
					'videos, shorts and streams accept latest, popular or oldest; playlists accept dd (newest ' +
						'playlist) or lad (last video added). Omit with podcasts, posts, search_query or ' +
						'next_page_token. Videos, Shorts and streams default to latest. Playlists default to dd. ' +
						'Sorting uses the choices offered by YouTube',
				),
			search_query: z
				.string()
				.min(1)
				.max(2048)
				.optional()
				.describe(
					'Search within this channel for matching videos and playlists. Cannot be combined with ' +
						'tab or sort. Omit with next_page_token. Omit tab and sort when searching. Matching ' +
						'videos and playlists appear in search_results',
				),
			hl: z
				.string()
				.optional()
				.describe(
					'Interface language, such as en or pt-BR. Defaults to en. Omit with next_page_token',
				),
			gl: z
				.string()
				.optional()
				.describe('Two-letter country code. Defaults to US. Omit with next_page_token'),
			about: z
				.boolean()
				.optional()
				.describe(
					'Include additional public channel details, such as country, join date, total views and ' +
						'links. Defaults to false. Omit with next_page_token. Channel profile data is returned on ' +
						'the first page. about=true includes additional public details. Continuation pages return ' +
						'content only',
				),
			next_page_token: z
				.string()
				.min(1)
				.max(32768)
				.optional()
				.describe(
					'Opaque pagination.next_page_token from this endpoint. Send it alone to continue the ' +
						'channel feed with its original settings. Tokens expire after one hour. Send ' +
						'next_page_token alone. The token preserves the channel, selected tab or search, sorting ' +
						'and locale. Use POST for long tokens. Stop when pagination.next_page_token is absent',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('YouTube channel', 'channel_results'),
	},
	{
		name: 'amazon_search',
		title: 'Amazon Search',
		description:
			'Search Amazon product listings with storefront, delivery, category, sorting and ' +
			'pagination controls. Alpha. Requires an API key.',
		path: '/api/amazon/search',
		keyless: false,
		inputSchema: {
			amazon_domain: z.string().optional().describe('Amazon storefront hostname'),
			language: z.string().optional().describe('Storefront locale, such as en_US or ja_JP'),
			delivery_zip: z
				.string()
				.min(1)
				.max(32)
				.optional()
				.describe('Postal code used to determine delivery eligibility'),
			shipping_location: z.string().optional().describe('Two-letter destination country code'),
			k: z.string().min(1).optional().describe('Search words. Supply either k or node'),
			node: z.string().optional().describe('Browse category ID. Supply either node or k'),
			s: z
				.enum([
					'relevanceblender',
					'price-asc-rank',
					'price-desc-rank',
					'review-rank',
					'date-desc-rank',
					'exact-aware-popularity-rank',
				])
				.optional()
				.describe('Ordering for the product listings'),
			rh: z
				.string()
				.optional()
				.describe('Comma-separated Amazon filter tokens, such as n:16318031,p_72:1248897011'),
			dc: z
				.boolean()
				.optional()
				.describe('Keep results tied to the original spelling of the query'),
			page: z.number().int().min(1).optional().describe('Result page to retrieve, starting at 1'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Amazon', 'organic_results', 'products', 'k'),
	},
	{
		name: 'amazon_product',
		title: 'Amazon Product',
		description:
			'Read an Amazon product page, with optional seller offers and related-product pages. ' +
			'Alpha. Requires an API key.',
		path: '/api/amazon/product',
		keyless: false,
		inputSchema: {
			amazon_domain: z.string().optional().describe('Amazon storefront hostname'),
			language: z.string().optional().describe('Storefront locale, such as en_US or ja_JP'),
			delivery_zip: z
				.string()
				.min(1)
				.max(32)
				.optional()
				.describe('Postal code used to determine delivery eligibility'),
			shipping_location: z.string().optional().describe('Two-letter destination country code'),
			asin: z.string().describe('Ten-character Amazon product identifier'),
			other_sellers: z
				.boolean()
				.optional()
				.describe('Fetch additional seller offers for this item'),
			all_related_products: z
				.boolean()
				.optional()
				.describe('Fetch every page exposed by related-product carousels'),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Amazon product', 'product_results'),
	},
	{
		name: 'amazon_autocomplete',
		title: 'Amazon Autocomplete',
		description:
			'Get Amazon search suggestions for a prefix and department. Alpha. Requires an API key.',
		path: '/api/amazon/autocomplete',
		keyless: false,
		inputSchema: {
			amazon_domain: z.string().optional().describe('Amazon storefront hostname'),
			k: z.string().min(1).describe('Partial search text to complete'),
			amazon_department: z
				.string()
				.min(1)
				.optional()
				.describe('Department alias used to narrow suggestions; aps searches all departments'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Amazon autocomplete', 'suggestions', 'suggestions', 'k'),
	},
	{
		name: 'amazon_featured_reviews',
		title: 'Amazon Featured Reviews',
		description:
			"Get Amazon's featured review selection for products on 23 supported storefronts. " +
			'Availability varies; this endpoint does not paginate or return every review. Alpha. ' +
			'Requires an API key.',
		path: '/api/amazon/featured-reviews',
		keyless: false,
		inputSchema: {
			asin: z
				.string()
				.describe(
					'Ten-character product ASIN in the selected Amazon storefront. Amazon chooses review ' +
						'order. Sorting, star filters and verified-purchase filters are not supported',
				),
			amazon_domain: z
				.enum([
					'amazon.ae',
					'amazon.ca',
					'amazon.co.jp',
					'amazon.co.uk',
					'amazon.co.za',
					'amazon.com',
					'amazon.com.au',
					'amazon.com.be',
					'amazon.com.br',
					'amazon.com.mx',
					'amazon.com.tr',
					'amazon.de',
					'amazon.eg',
					'amazon.es',
					'amazon.fr',
					'amazon.ie',
					'amazon.in',
					'amazon.it',
					'amazon.nl',
					'amazon.pl',
					'amazon.sa',
					'amazon.se',
					'amazon.sg',
				])
				.optional()
				.describe(
					'Amazon storefront hostname. Omit for amazon.com. Supported on 23 storefronts; amazon.cn ' +
						'is not supported. Use an ASIN available in the selected storefront. Featured reviews can ' +
						'include international reviews. If featured reviews are unavailable, the request returns ' +
						'a failure rather than an empty review list',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Amazon featured reviews', 'reviews', 'reviews', null),
	},
	{
		name: 'amazon_media_reviews',
		title: 'Amazon Media Reviews',
		description:
			'Paginate Amazon reviews containing images or videos on 23 supported storefronts. ' +
			'Availability varies; text-only reviews are excluded. Alpha. Requires an API key.',
		path: '/api/amazon/media-reviews',
		keyless: false,
		inputSchema: {
			asin: z
				.string()
				.optional()
				.describe(
					'Ten-character product ASIN in the selected Amazon storefront. Required for the first ' +
						'page',
				),
			amazon_domain: z
				.enum([
					'amazon.ae',
					'amazon.ca',
					'amazon.co.jp',
					'amazon.co.uk',
					'amazon.co.za',
					'amazon.com',
					'amazon.com.au',
					'amazon.com.be',
					'amazon.com.br',
					'amazon.com.mx',
					'amazon.com.tr',
					'amazon.de',
					'amazon.eg',
					'amazon.es',
					'amazon.fr',
					'amazon.ie',
					'amazon.in',
					'amazon.it',
					'amazon.nl',
					'amazon.pl',
					'amazon.sa',
					'amazon.se',
					'amazon.sg',
				])
				.optional()
				.describe(
					'Amazon storefront hostname. Omit for amazon.com. Supported on 23 storefronts; amazon.cn ' +
						'is not supported. Send page_token alone on continuation. Use an ASIN available in the ' +
						'selected storefront. Only reviews containing the selected media are returned. Review ' +
						'availability varies by storefront, product and request',
				),
			view: z
				.enum(['media', 'images', 'videos'])
				.optional()
				.describe(
					'Media filter: media (default) for images and videos, images, or videos. Only reviews ' +
						'containing the selected media are returned. Amazon chooses review order. Sorting, star ' +
						'filters and verified-purchase filters are not supported',
				),
			page_token: z
				.string()
				.min(5)
				.max(8196)
				.optional()
				.describe(
					'Opaque continuation from pagination.next_page_token. Send it alone to fetch the next ' +
						'media-review page. Pages can repeat a review when its media spans pages. Deduplicate by ' +
						'review id. If media reviews are unavailable, the request returns a failure rather than ' +
						'an empty review list',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Amazon media reviews', 'reviews', 'reviews', null),
	},
	{
		name: 'x_profile',
		title: 'X Profile',
		description:
			'Get a public X profile, including its bio, follower counts and profile images. Alpha. ' +
			'Requires an API key.',
		path: '/api/x/profile',
		keyless: false,
		inputSchema: {
			username: z
				.string()
				.describe('X username, with or without a leading @. Profile URLs are not accepted'),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('X profile', 'profile'),
	},
	{
		name: 'x_post',
		title: 'X Post',
		description:
			'Get an X post with its text, author, engagement counts and media. Alpha. Requires an API ' +
			'key.',
		path: '/api/x/post',
		keyless: false,
		inputSchema: {
			post_id: z.string().describe('Numeric X post ID as a string, taken from its /status/ URL'),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('X post', 'post'),
	},
	{
		name: 'x_user_posts',
		title: 'X User Posts',
		description: 'Get posts from an X user, with cursor pagination. Alpha. Requires an API key.',
		path: '/api/x/user-posts',
		keyless: false,
		inputSchema: {
			username: z
				.string()
				.describe('X username, with or without a leading @. Profile URLs are not accepted'),
			cursor: z
				.string()
				.min(1)
				.max(4096)
				.optional()
				.describe('Continuation cursor returned for the same username'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('X user posts', 'posts', 'posts', null),
	},
	{
		name: 'x_community',
		title: 'X Community',
		description:
			'Get X community details, including its creator, member count and rules. Alpha. Requires ' +
			'an API key.',
		path: '/api/x/community',
		keyless: false,
		inputSchema: {
			community_id: z.string().describe('Numeric X community ID as a string'),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('X community', 'community'),
	},
	{
		name: 'x_community_posts',
		title: 'X Community Posts',
		description:
			'Get posts from an X community, including authors, engagement and media. Alpha. Requires ' +
			'an API key.',
		path: '/api/x/community-posts',
		keyless: false,
		inputSchema: {
			community_id: z
				.string()
				.describe('Numeric X community ID as a string, from its /i/communities/ URL'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('X community posts', 'posts', 'posts', null),
	},
	{
		name: 'ebay_search',
		title: 'eBay Search',
		description:
			'Search eBay listings by keywords or category, with marketplace, price, condition, buying ' +
			'format, sort and pagination controls. Requires an API key.',
		path: '/api/ebay/search',
		keyless: false,
		inputSchema: {
			ebay_domain: z
				.enum([
					'ebay.com',
					'ebay.co.uk',
					'ebay.ca',
					'ebay.com.au',
					'ebay.de',
					'ebay.fr',
					'ebay.it',
					'ebay.es',
					'ebay.at',
					'ebay.be',
					'ebay.ch',
					'ebay.ie',
					'ebay.nl',
					'ebay.com.hk',
					'ebay.com.my',
					'ebay.pl',
					'ebay.com.sg',
				])
				.optional()
				.describe('eBay marketplace hostname'),
			_nkw: z
				.string()
				.min(1)
				.max(500)
				.optional()
				.describe('Search keywords. Required unless category_id is supplied'),
			category_id: z.number().int().min(1).max(2147483647).optional().describe('eBay category ID'),
			_pgn: z
				.number()
				.int()
				.min(1)
				.max(2147483647)
				.optional()
				.describe('Result page, starting at 1'),
			_ipg: z
				.union([z.literal(25), z.literal(50), z.literal(100), z.literal(200)])
				.optional()
				.describe('Requested results per page. eBay may adjust the page size'),
			_sop: z
				.union([
					z.literal(1),
					z.literal(2),
					z.literal(3),
					z.literal(7),
					z.literal(10),
					z.literal(12),
					z.literal(15),
					z.literal(16),
					z.literal(18),
					z.literal(19),
				])
				.optional()
				.describe(
					'Sort: 12 best match, 1 ending soonest, 10 newly listed, 7 nearest, 15/16 total price ' +
						'ascending/descending, 2/3 item price ascending/descending, 18/19 condition new/used ' +
						'first. Availability depends on marketplace',
				),
			_udlo: z.number().min(0).optional().describe('Minimum item price'),
			_udhi: z.number().min(0).optional().describe('Maximum item price'),
			buying_format: z
				.enum(['Auction', 'BIN', 'BO'])
				.optional()
				.describe('Auction, Buy It Now (BIN), or accepts offers (BO)'),
			LH_ItemCondition: z
				.string()
				.optional()
				.describe('Condition IDs joined with |, such as 1000|3000'),
			_stpos: z
				.string()
				.min(1)
				.max(20)
				.optional()
				.describe('Destination postal code used by eBay for shipping estimates'),
			_salic: z
				.number()
				.int()
				.optional()
				.describe('eBay item-location country ID, e.g. 1 US, 2 Canada, 3 UK'),
			_blrs: z
				.literal('spell_auto_correct')
				.optional()
				.describe('Exclude automatic spelling corrections'),
			show_only: z
				.string()
				.max(100)
				.optional()
				.describe(
					'Comma-separated filters: FR, RPA, AS, Savings, SaleItems, Lots, Charity, AV, FS, LPickup',
				),
			_sasl: z.string().max(1000).optional().describe('Comma-separated eBay seller usernames'),
			_saslop: z
				.union([z.literal(1), z.literal(2)])
				.optional()
				.describe('Include (1) or exclude (2) the sellers in _sasl'),
			popular_filters: z
				.string()
				.max(4000)
				.optional()
				.describe(
					'eBay aspect filters as key=value pairs joined with &, with multiple values joined by |. ' +
						'Percent-encoded names are accepted',
				),
			_dmd: z.enum(['Grid', 'List']).optional().describe('Result layout'),
			LH_PrefLoc: z
				.enum(['Domestic', 'Regional', 'Worldwide'])
				.optional()
				.describe('Item location relative to the marketplace'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('eBay', 'organic_results', 'listings', '_nkw'),
	},
	{
		name: 'ebay_product',
		title: 'eBay Product',
		description:
			'Read an eBay listing by item ID: title, price, buying options, images, condition, item ' +
			'specifics, shipping, returns and seller details. Fields depend on the listing. Requires ' +
			'an API key.',
		path: '/api/ebay/product',
		keyless: false,
		inputSchema: {
			ebay_domain: z
				.enum([
					'ebay.com',
					'ebay.co.uk',
					'ebay.ca',
					'ebay.com.au',
					'ebay.de',
					'ebay.fr',
					'ebay.it',
					'ebay.es',
					'ebay.at',
					'ebay.be',
					'ebay.ch',
					'ebay.ie',
					'ebay.nl',
					'ebay.com.hk',
					'ebay.com.my',
					'ebay.pl',
					'ebay.com.sg',
				])
				.optional()
				.describe('eBay marketplace hostname'),
			product_id: z
				.string()
				.describe('12-digit eBay listing ID from search results or an /itm/ URL'),
			locale: z
				.string()
				.optional()
				.describe("Country code for eBay's localized interface, e.g. US, JP, CA"),
			lang: z
				.string()
				.max(12)
				.optional()
				.describe('Interface language override; requires locale and ebay.com'),
			shipping_country: z
				.string()
				.optional()
				.describe('Two-letter destination country code for shipping calculations'),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('eBay listing', 'product_results'),
	},
	{
		name: 'ebay_seller',
		title: 'eBay Seller',
		description:
			'Read public eBay user or store profiles and their products, categories, ratings, ' +
			'feedback and pagination. Fields depend on the seller page. Requires an API key.',
		path: '/api/ebay/seller',
		keyless: false,
		inputSchema: {
			ebay_domain: z
				.enum([
					'ebay.com',
					'ebay.co.uk',
					'ebay.ca',
					'ebay.com.au',
					'ebay.de',
					'ebay.fr',
					'ebay.it',
					'ebay.es',
					'ebay.at',
					'ebay.be',
					'ebay.ch',
					'ebay.ie',
					'ebay.nl',
					'ebay.com.hk',
					'ebay.com.my',
					'ebay.pl',
					'ebay.com.sg',
				])
				.optional()
				.describe('eBay marketplace hostname'),
			seller_id: z
				.string()
				.describe('Seller username for type=user, or the store URL slug for type=store'),
			type: z.enum(['user', 'store']).describe('Public seller profile type'),
			_pgn: z
				.number()
				.int()
				.min(1)
				.max(2147483647)
				.optional()
				.describe('Result page, starting at 1'),
			_ipg: z
				.union([z.literal(24), z.literal(48), z.literal(72)])
				.optional()
				.describe('Products per page'),
			_sop: z
				.union([
					z.literal(1),
					z.literal(7),
					z.literal(10),
					z.literal(12),
					z.literal(15),
					z.literal(16),
				])
				.optional()
				.describe(
					'Sort: 12 best match, 1 ending soonest, 7 nearest, 10 newly listed, 15/16 total price ' +
						'ascending/descending',
				),
			buying_format: z
				.union([z.literal(0), z.literal(1), z.literal(2)])
				.optional()
				.describe('All listings (0), Buy It Now (1), or auctions (2)'),
			LH_ItemCondition: z
				.string()
				.max(20)
				.optional()
				.describe('Condition IDs joined with |: 3 new, 4 used, 10 unspecified'),
			free_shipping: z.boolean().optional().describe('Only products with free shipping'),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('eBay seller', 'seller_results'),
	},
	{
		name: 'web_screenshot',
		title: 'Screenshot',
		description:
			'Render one public web page in a fresh browser and return a PNG screenshot as base64 ' +
			'(screenshot_base64), with the page url and title. full_page captures the whole page. ' +
			'Alpha. Requires an API key.',
		path: '/api/web/screenshot',
		keyless: false,
		inputSchema: {
			url: z
				.string()
				.min(1)
				.max(8192)
				.describe(
					'Public HTTP(S) URL to capture, 1-8,192 characters. Include http:// or https://; bare ' +
						'domains are rejected. The host must be public, on port 80 or 443, without embedded ' +
						'credentials',
				),
			remove_overlay: z
				.boolean()
				.optional()
				.describe('Remove modal and cookie-banner overlays from the page'),
			detach_invisibles: z
				.boolean()
				.optional()
				.describe('Drop display:none elements from the page'),
			wait_for_selector: z
				.union([z.string().min(1).max(2048), z.array(z.string().min(1).max(2048)).min(1).max(16)])
				.optional()
				.describe(
					'CSS selector to wait for after navigation, 1-2,048 characters. Also accepts a list of ' +
						'1-16 selectors',
				),
			set_cookies: z
				.array(z.string().min(3).max(4096))
				.min(1)
				.max(100)
				.optional()
				.describe(
					'1-100 cookies in Set-Cookie syntax (name=value; Path=/; Domain=...), one line each, up ' +
						'to 4,096 characters',
				),
			user_agent: z
				.string()
				.min(1)
				.max(1024)
				.optional()
				.describe(
					'User-Agent for the page request, 1-1,024 characters without control characters. Defaults ' +
						"to the browser's own",
				),
			inject_page_script: z
				.array(z.string().min(1).max(8192))
				.min(1)
				.max(8)
				.optional()
				.describe(
					'1-8 scripts (source, or a URL to a script), up to 8,192 characters each, run in the main ' +
						'frame',
				),
			inject_frame_script: z
				.array(z.string().min(1).max(8192))
				.min(1)
				.max(8)
				.optional()
				.describe(
					'1-8 scripts (source, or a URL to a script), up to 8,192 characters each, run in every ' +
						'frame',
				),
			page_timeout: z
				.number()
				.int()
				.min(1)
				.max(180)
				.optional()
				.describe(
					'Seconds from 1 through 180 for page loading and browser operations. Cannot extend the ' +
						'total request budget set by timeout',
				),
			locale: z
				.string()
				.min(2)
				.max(64)
				.optional()
				.describe(
					"Browser locale as a language tag, 2-64 characters. Defaults to the browser's own",
				),
			referer: z.string().min(1).max(8192).optional().describe('HTTP(S) URL sent as the Referer'),
			assert_status_code: z
				.number()
				.int()
				.min(100)
				.max(599)
				.optional()
				.describe(
					'Expected origin HTTP status, 100-599. A different status is rejected; otherwise a ' +
						'rendered error page is a successful capture',
				),
			viewport: z
				.object({
					width: z
						.number()
						.int()
						.min(1)
						.max(4096)
						.describe('Viewport width in CSS pixels, 1-4,096. Required'),
					height: z
						.number()
						.int()
						.min(1)
						.max(4096)
						.describe('Viewport height in CSS pixels, 1-4,096. Required'),
					device_scale_factor: z
						.number()
						.gt(0)
						.max(4)
						.optional()
						.describe('Device pixel ratio, greater than 0 and at most 4'),
					is_mobile: z.boolean().optional().describe('Emulate a mobile device'),
					is_landscape: z.boolean().optional().describe('Use landscape orientation'),
					has_touch: z.boolean().optional().describe('Emulate touch support'),
				})
				.optional()
				.describe('Browser viewport; width and height are required. Default: 1280 x 1280'),
			robots_txt: z
				.string()
				.min(1)
				.max(256)
				.optional()
				.describe(
					"User agent, 1-256 characters, to check against the site's robots.txt; disallowed URLs " +
						'are rejected',
				),
			respond_timing: z
				.enum([
					'html',
					'visible-content',
					'mutation-idle',
					'resource-idle',
					'media-idle',
					'network-idle',
				])
				.optional()
				.describe('Page readiness condition to reach before responding'),
			full_page: z
				.boolean()
				.optional()
				.describe('Capture the full page when true. The default, false, captures the viewport'),
		},
		summarize: (payload) => {
			const title =
				typeof payload.title === 'string' && payload.title ? ` of "${payload.title}"` : '';
			const size =
				typeof payload.screenshot_base64 === 'string'
					? `, ${payload.screenshot_base64.length} base64 characters`
					: '';
			const full = payload.full_page === true ? ', full page' : '';
			return `Screenshot${title}${full}${size}.`;
		},
	},
	{
		name: 'tiktok_profile',
		title: 'TikTok Profile',
		description:
			'Get public TikTok profile fields and statistics by handle or numeric user ID. Alpha. ' +
			'Requires an API key.',
		path: '/api/tiktok/profile',
		keyless: false,
		inputSchema: {
			handle: z
				.string()
				.optional()
				.describe('Public TikTok handle, with or without @; supply this or user_id'),
			user_id: z.string().optional().describe('Numeric TikTok user ID; supply this or handle'),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('TikTok profile', 'user'),
	},
	{
		name: 'tiktok_video',
		title: 'TikTok Video',
		description:
			'Get public TikTok video or photo/slideshow metadata, media URLs, author and metrics. ' +
			'Alpha. Requires an API key.',
		path: '/api/tiktok/video',
		keyless: false,
		inputSchema: {
			url: z
				.string()
				.max(2048)
				.optional()
				.describe('TikTok video, photo/slideshow or vm/vt short-link URL'),
			video_id: z.string().optional().describe('TikTok post ID; supply this or url'),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('TikTok video', 'item'),
	},
	{
		name: 'tiktok_transcript',
		title: 'TikTok Transcript',
		description: 'Get public TikTok captions with timed segments. Alpha. Requires an API key.',
		path: '/api/tiktok/transcript',
		keyless: false,
		inputSchema: {
			url: z
				.string()
				.max(2048)
				.optional()
				.describe('TikTok video, photo/slideshow or vm/vt short-link URL'),
			video_id: z.string().optional().describe('TikTok post ID; supply this or url'),
			language: z
				.string()
				.optional()
				.describe(
					'Caption language code, for example eng-US. Defaults to the first available track',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('TikTok transcript', 'segments', 'segments', null),
	},
	{
		name: 'tiktok_search_suggestions',
		title: 'TikTok Search Suggestions',
		description: 'Get public TikTok autocomplete suggestions in order. Alpha. Requires an API key.',
		path: '/api/tiktok/search-suggestions',
		keyless: false,
		inputSchema: {
			query: z.string().min(1).max(500).describe('Search text for TikTok autocomplete suggestions'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('TikTok suggestions', 'suggestions', 'suggestions', 'query'),
	},
	{
		name: 'tiktok_user_live',
		title: 'TikTok User Live',
		description: "Get a TikTok user's live status and room metadata. Alpha. Requires an API key.",
		path: '/api/tiktok/user-live',
		keyless: false,
		inputSchema: {
			handle: z.string().describe('Public TikTok handle, with or without the leading @'),
			result_groups: resultGroups,
		},
		summarize: (payload, args) => {
			const handle = typeof args.handle === 'string' ? ` ${args.handle}` : '';
			return payload.is_live === true
				? `TikTok user${handle} is live now.`
				: `TikTok user${handle} is not live.`;
		},
	},
	{
		name: 'tiktok_live',
		title: 'TikTok Live Room',
		description:
			'Get public TikTok live-room details including status, owner, metrics and stream ' +
			'metadata. Alpha. Requires an API key.',
		path: '/api/tiktok/live',
		keyless: false,
		inputSchema: {
			room_id: z.string().describe('Numeric TikTok live-room ID, obtainable from user-live'),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('TikTok live room', 'room'),
	},
	{
		name: 'tiktok_song',
		title: 'TikTok Song',
		description:
			'Get public TikTok music clip details, including the clip ID, artist, cover and video ' +
			'usage count. Alpha. Requires an API key.',
		path: '/api/tiktok/song',
		keyless: false,
		inputSchema: {
			clip_id: z.string().describe('TikTok music clip ID, the numeric suffix of a /music/ URL'),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('TikTok song', 'music'),
	},
	{
		name: 'tiktok_profile_videos',
		title: 'TikTok Profile Videos',
		description:
			'Page through posts from a public TikTok profile by handle or numeric user ID. Alpha. ' +
			'Requires an API key.',
		path: '/api/tiktok/profile-videos',
		keyless: false,
		inputSchema: {
			cursor: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe('Upstream pagination cursor from the preceding response; 0 starts a new feed'),
			count: z
				.number()
				.int()
				.min(1)
				.max(35)
				.optional()
				.describe('Requested page size, between 1 and 35'),
			handle: z
				.string()
				.optional()
				.describe('Public TikTok handle, with or without @; supply this or user_id'),
			user_id: z.string().optional().describe('Numeric TikTok user ID; supply this or handle'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('TikTok profile videos', 'items', 'videos', null),
	},
	{
		name: 'tiktok_comments',
		title: 'TikTok Comments',
		description: 'Page through public comments on a TikTok post. Alpha. Requires an API key.',
		path: '/api/tiktok/comments',
		keyless: false,
		inputSchema: {
			cursor: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe('Upstream pagination cursor from the preceding response; 0 starts a new feed'),
			count: z
				.number()
				.int()
				.min(1)
				.max(35)
				.optional()
				.describe('Requested page size, between 1 and 35'),
			url: z
				.string()
				.max(2048)
				.optional()
				.describe('TikTok video, photo/slideshow or vm/vt short-link URL'),
			video_id: z.string().optional().describe('TikTok post ID; supply this or url'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('TikTok comments', 'comments', 'comments', null),
	},
	{
		name: 'tiktok_comment_replies',
		title: 'TikTok Comment Replies',
		description:
			'Page through replies using the post ID and parent comment ID. Alpha. Requires an API ' +
			'key.',
		path: '/api/tiktok/comment-replies',
		keyless: false,
		inputSchema: {
			cursor: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe('Upstream pagination cursor from the preceding response; 0 starts a new feed'),
			count: z
				.number()
				.int()
				.min(1)
				.max(35)
				.optional()
				.describe('Requested page size, between 1 and 35'),
			url: z
				.string()
				.max(2048)
				.optional()
				.describe('TikTok video, photo/slideshow or vm/vt short-link URL'),
			video_id: z.string().optional().describe('TikTok post ID; supply this or url'),
			comment_id: z
				.string()
				.describe('ID of the parent TikTok comment; obtain cid from the comments endpoint'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('TikTok comment replies', 'comments', 'replies', null),
	},
	{
		name: 'tiktok_following',
		title: 'TikTok Following',
		description:
			'Page through the public accounts a TikTok user follows. Alpha. Requires an API key.',
		path: '/api/tiktok/following',
		keyless: false,
		inputSchema: {
			cursor: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe('Upstream pagination cursor from the preceding response; 0 starts a new feed'),
			count: z
				.number()
				.int()
				.min(1)
				.max(35)
				.optional()
				.describe('Requested page size, between 1 and 35'),
			handle: z
				.string()
				.optional()
				.describe('Public TikTok handle, with or without @; supply this or user_id'),
			user_id: z.string().optional().describe('Numeric TikTok user ID; supply this or handle'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('TikTok following', 'users', 'accounts', null),
	},
	{
		name: 'tiktok_followers',
		title: 'TikTok Followers',
		description: 'Page through public followers of a TikTok user. Alpha. Requires an API key.',
		path: '/api/tiktok/followers',
		keyless: false,
		inputSchema: {
			cursor: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe('Upstream pagination cursor from the preceding response; 0 starts a new feed'),
			count: z
				.number()
				.int()
				.min(1)
				.max(35)
				.optional()
				.describe('Requested page size, between 1 and 35'),
			handle: z
				.string()
				.optional()
				.describe('Public TikTok handle, with or without @; supply this or user_id'),
			user_id: z.string().optional().describe('Numeric TikTok user ID; supply this or handle'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('TikTok followers', 'users', 'accounts', null),
	},
	{
		name: 'tiktok_search_keyword',
		title: 'TikTok Search Keyword',
		description:
			'Search public TikTok posts by keyword with pagination and search-session IDs. Alpha. ' +
			'Requires an API key.',
		path: '/api/tiktok/search-keyword',
		keyless: false,
		inputSchema: {
			cursor: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe('Upstream pagination cursor from the preceding response; 0 starts a new feed'),
			count: z
				.number()
				.int()
				.min(1)
				.max(35)
				.optional()
				.describe('Requested page size, between 1 and 35'),
			query: z.string().min(1).max(500).describe('TikTok video search query'),
			search_id: z
				.string()
				.optional()
				.describe('Upstream search session ID from the preceding page, when supplied'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('TikTok search', 'items', 'videos', 'query'),
	},
	{
		name: 'tiktok_search_top',
		title: 'TikTok Search Top',
		description:
			'Search mixed TikTok top results, preserving the result wrappers and types. Alpha. ' +
			'Requires an API key.',
		path: '/api/tiktok/search-top',
		keyless: false,
		inputSchema: {
			cursor: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe('Upstream pagination cursor from the preceding response; 0 starts a new feed'),
			count: z
				.number()
				.int()
				.min(1)
				.max(35)
				.optional()
				.describe('Requested page size, between 1 and 35'),
			query: z.string().min(1).max(500).describe('TikTok video search query'),
			search_id: z
				.string()
				.optional()
				.describe('Upstream search session ID from the preceding page, when supplied'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('TikTok top results', 'results', 'results', 'query'),
	},
	{
		name: 'tiktok_search_hashtag',
		title: 'TikTok Search Hashtag',
		description: 'Resolve a public hashtag and page through its posts. Alpha. Requires an API key.',
		path: '/api/tiktok/search-hashtag',
		keyless: false,
		inputSchema: {
			cursor: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe('Upstream pagination cursor from the preceding response; 0 starts a new feed'),
			count: z
				.number()
				.int()
				.min(1)
				.max(35)
				.optional()
				.describe('Requested page size, between 1 and 35'),
			hashtag: z
				.string()
				.min(1)
				.max(100)
				.describe('TikTok hashtag name, with or without the leading #'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('TikTok hashtag', 'items', 'videos', 'hashtag'),
	},
	{
		name: 'tiktok_song_videos',
		title: 'TikTok Song Videos',
		description: 'Page through public posts using a TikTok music clip. Alpha. Requires an API key.',
		path: '/api/tiktok/song-videos',
		keyless: false,
		inputSchema: {
			cursor: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe('Upstream pagination cursor from the preceding response; 0 starts a new feed'),
			count: z
				.number()
				.int()
				.min(1)
				.max(35)
				.optional()
				.describe('Requested page size, between 1 and 35'),
			clip_id: z.string().describe('Numeric TikTok music clip ID, the suffix of a /music/ URL'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('TikTok song videos', 'items', 'videos', null),
	},
	{
		name: 'tiktok_trending_feed',
		title: 'TikTok Trending Feed',
		description: 'Get a fresh public recommendation feed. Alpha. Requires an API key.',
		path: '/api/tiktok/trending-feed',
		keyless: false,
		inputSchema: {
			count: z
				.number()
				.int()
				.min(1)
				.max(35)
				.optional()
				.describe('Requested number of recommended posts, between 1 and 35'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('TikTok trending feed', 'items', 'videos', null),
	},
	{
		name: 'tiktok_collection_videos',
		title: 'TikTok Collection Videos',
		description:
			'Page through posts saved in a public TikTok collection. Alpha. Requires an API key.',
		path: '/api/tiktok/collection-videos',
		keyless: false,
		inputSchema: {
			cursor: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe('Upstream pagination cursor from the preceding response; 0 starts a new feed'),
			count: z
				.number()
				.int()
				.min(1)
				.max(35)
				.optional()
				.describe('Requested page size, between 1 and 35'),
			url: z
				.string()
				.max(2048)
				.optional()
				.describe('Public TikTok collection URL; supply this or collection_id'),
			collection_id: z
				.string()
				.optional()
				.describe('Numeric public saved-collection ID; supply this or url'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('TikTok collection', 'items', 'videos', null),
	},
	{
		name: 'instagram_profile',
		title: 'Instagram Profile',
		description:
			'Return a public Instagram profile by handle: bio, counts, links and recent posts. Alpha. ' +
			'Requires an API key.',
		path: '/api/instagram/profile',
		keyless: false,
		inputSchema: {
			handle: z.string().describe('Instagram username without @'),
			trim: z
				.boolean()
				.optional()
				.describe('Return a compact profile containing public identity and counts'),
			result_groups: resultGroups,
		},
		summarize: summarizeGroups('Instagram profile', 'handle'),
	},
	{
		name: 'instagram_posts',
		title: 'Instagram Posts',
		description:
			'Return the public posts of an Instagram profile by handle; pass next_max_id from a ' +
			'response to continue. Alpha. Requires an API key.',
		path: '/api/instagram/posts',
		keyless: false,
		inputSchema: {
			handle: z.string().describe('Instagram username without @'),
			trim: z
				.boolean()
				.optional()
				.describe('Return a compact profile containing public identity and counts'),
			next_max_id: z
				.string()
				.min(1)
				.max(8192)
				.optional()
				.describe('next_max_id from the previous page'),
			num: z
				.number()
				.int()
				.min(1)
				.max(50)
				.optional()
				.describe('Maximum number of posts requested from Instagram'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Instagram posts', 'items', 'posts', 'handle'),
	},
	{
		name: 'instagram_post',
		title: 'Instagram Post',
		description:
			'Return one public Instagram post or reel by URL: caption, media, author and engagement. ' +
			'Alpha. Requires an API key.',
		path: '/api/instagram/post',
		keyless: false,
		inputSchema: {
			url: z.string().describe('HTTPS Instagram post, reel or TV URL'),
			trim: z.boolean().optional().describe('Return compact media details'),
			result_groups: resultGroups,
		},
		summarize: summarizeGroups('Instagram post', null),
	},
	{
		name: 'instagram_profile_post_count',
		title: 'Instagram Profile Post Count',
		description:
			'Return the number of posts on a public Instagram profile; is_estimated marks an ' +
			'approximate count. Alpha. Requires an API key.',
		path: '/api/instagram/profile-post-count',
		keyless: false,
		inputSchema: {
			handle: z.string().describe('Instagram username without @'),
			result_groups: resultGroups,
		},
		summarize: (payload, args) => {
			const handle = typeof args.handle === 'string' ? ` ${args.handle}` : '';
			const value = payload.media_count ?? payload.total_media_count;
			if (typeof value !== 'number') return `Instagram post count${handle}: unavailable.`;
			const estimated = payload.is_estimated === true ? ' (estimated)' : '';
			return `Instagram post count${handle}: ${value}${estimated}.`;
		},
	},
	{
		name: 'instagram_embed',
		title: 'Instagram Embed',
		description:
			'Return the public embed view of an Instagram profile by handle. Alpha. Requires an API ' +
			'key.',
		path: '/api/instagram/embed',
		keyless: false,
		inputSchema: {
			handle: z.string().describe('Instagram username without @'),
			result_groups: resultGroups,
		},
		summarize: summarizeGroups('Instagram embed', 'handle'),
	},
	{
		name: 'instagram_search_popular',
		title: 'Instagram Search Popular',
		description:
			'Public Instagram Popular topic posts, generated descriptions, sources and suggested ' +
			'terms, with pagination. Category hubs return sections and deduplicated visible posts. ' +
			'Total media count is returned only when an exact count is available. Alpha. Requires an ' +
			'API key.',
		path: '/api/instagram/search-popular',
		keyless: false,
		inputSchema: {
			query: z
				.string()
				.min(1)
				.max(200)
				.describe('Popular topic text or URL slug; spaces become hyphens'),
			cursor: z
				.string()
				.min(1)
				.max(8192)
				.optional()
				.describe('Opaque cursor returned by search-popular for the same query'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Instagram popular', 'posts', 'posts', 'query'),
	},
	{
		name: 'walmart_search',
		title: 'Walmart Search',
		description:
			'Search public products on Walmart. Prices and availability are returned only when ' +
			'present in the retailer response and may depend on location. Alpha. Requires an API key.',
		path: '/api/walmart/search',
		keyless: false,
		inputSchema: {
			query: z.string().min(1).max(500).describe('Product keywords to search for'),
			page: z.number().int().min(1).max(100).optional().describe('One-based result page'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Walmart', 'products', 'products', 'query'),
	},
	{
		name: 'walmart_product',
		title: 'Walmart Product',
		description:
			'Retrieve a public product on Walmart. Prices and availability are returned only when ' +
			'present in the retailer response and may depend on location. Alpha. Requires an API key.',
		path: '/api/walmart/product',
		keyless: false,
		inputSchema: {
			url: z.string().min(1).max(4096).describe("Public HTTPS product URL on this retailer's site"),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Walmart product', 'product'),
	},
	{
		name: 'homedepot_search',
		title: 'Home Depot Search',
		description:
			'Search public products on Home Depot. Prices and availability are returned only when ' +
			'present in the retailer response and may depend on location. Only the first result page ' +
			'is currently supported. Requests may fail intermittently; retry later if product data is ' +
			'unavailable. Alpha. Requires an API key.',
		path: '/api/homedepot/search',
		keyless: false,
		inputSchema: {
			query: z.string().min(1).max(500).describe('Product keywords to search for'),
			page: z
				.number()
				.int()
				.min(1)
				.max(1)
				.optional()
				.describe('Only the first result page is currently supported'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Home Depot', 'products', 'products', 'query'),
	},
	{
		name: 'homedepot_product',
		title: 'Home Depot Product',
		description:
			'Retrieve a public product on Home Depot. Prices and availability are returned only when ' +
			'present in the retailer response and may depend on location. Requests may fail ' +
			'intermittently; retry later if product data is unavailable. Alpha. Requires an API key.',
		path: '/api/homedepot/product',
		keyless: false,
		inputSchema: {
			url: z.string().min(1).max(4096).describe("Public HTTPS product URL on this retailer's site"),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Home Depot product', 'product'),
	},
	{
		name: 'target_search',
		title: 'Target Search',
		description:
			'Search public products on Target. Prices and availability are returned only when present ' +
			'in the retailer response and may depend on location. Set store_id to select a store. ' +
			'Requests fail when data for that store is unavailable. Alpha. Requires an API key.',
		path: '/api/target/search',
		keyless: false,
		inputSchema: {
			query: z.string().min(1).max(500).describe('Product keywords to search for'),
			page: z.number().int().min(1).max(100).optional().describe('One-based result page'),
			store_id: z
				.string()
				.min(1)
				.max(8)
				.optional()
				.describe(
					"Retailer's store ID. Selects the store catalog, pricing or availability where the " +
						'retailer exposes it',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Target', 'products', 'products', 'query'),
	},
	{
		name: 'target_product',
		title: 'Target Product',
		description:
			'Retrieve a public product on Target. Prices and availability are returned only when ' +
			'present in the retailer response and may depend on location. Set store_id to select a ' +
			'store. Requests fail when data for that store is unavailable. Alpha. Requires an API ' +
			'key.',
		path: '/api/target/product',
		keyless: false,
		inputSchema: {
			url: z.string().min(1).max(4096).describe("Public HTTPS product URL on this retailer's site"),
			store_id: z
				.string()
				.min(1)
				.max(8)
				.optional()
				.describe(
					"Retailer's store ID. Selects the store catalog, pricing or availability where the " +
						'retailer exposes it',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Target product', 'product'),
	},
	{
		name: 'etsy_search',
		title: 'Etsy Search',
		description:
			'Search public products on Etsy. Prices and availability are returned only when present ' +
			'in the retailer response and may depend on location. Alpha. Requires an API key.',
		path: '/api/etsy/search',
		keyless: false,
		inputSchema: {
			query: z.string().min(1).max(500).describe('Product keywords to search for'),
			page: z.number().int().min(1).max(100).optional().describe('One-based result page'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Etsy', 'products', 'products', 'query'),
	},
	{
		name: 'etsy_product',
		title: 'Etsy Product',
		description:
			'Retrieve a public product on Etsy. Prices and availability are returned only when ' +
			'present in the retailer response and may depend on location. Some listings provide only ' +
			'the title, image and price; other detail fields may be unavailable. Alpha. Requires an ' +
			'API key.',
		path: '/api/etsy/product',
		keyless: false,
		inputSchema: {
			url: z.string().min(1).max(4096).describe("Public HTTPS product URL on this retailer's site"),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Etsy product', 'product'),
	},
	{
		name: 'bestbuy_search',
		title: 'Best Buy Search',
		description:
			'Search public products on Best Buy. Prices and availability are returned only when ' +
			'present in the retailer response and may depend on location. Returns matching products ' +
			'with the available prices, images and ratings. Set store_id to select a store. Requests ' +
			'fail when data for that store is unavailable. Alpha. Requires an API key.',
		path: '/api/bestbuy/search',
		keyless: false,
		inputSchema: {
			query: z.string().min(1).max(500).describe('Product keywords to search for'),
			page: z.number().int().min(1).max(100).optional().describe('One-based result page'),
			store_id: z
				.string()
				.min(1)
				.max(8)
				.optional()
				.describe(
					"Retailer's store ID. Selects the store catalog, pricing or availability where the " +
						'retailer exposes it',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Best Buy', 'products', 'products', 'query'),
	},
	{
		name: 'bestbuy_product',
		title: 'Best Buy Product',
		description:
			'Retrieve a public product on Best Buy. Prices and availability are returned only when ' +
			'present in the retailer response and may depend on location. Returns the requested ' +
			'product; some detail fields may be unavailable. Set store_id to select a store. Requests ' +
			'fail when data for that store is unavailable. Alpha. Requires an API key.',
		path: '/api/bestbuy/product',
		keyless: false,
		inputSchema: {
			url: z.string().min(1).max(4096).describe("Public HTTPS product URL on this retailer's site"),
			store_id: z
				.string()
				.min(1)
				.max(8)
				.optional()
				.describe(
					"Retailer's store ID. Selects the store catalog, pricing or availability where the " +
						'retailer exposes it',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Best Buy product', 'product'),
	},
	{
		name: 'wayfair_search',
		title: 'Wayfair Search',
		description:
			'Search public products on Wayfair. Prices and availability are returned only when ' +
			'present in the retailer response and may depend on location. Alpha. Requires an API key.',
		path: '/api/wayfair/search',
		keyless: false,
		inputSchema: {
			query: z.string().min(1).max(500).describe('Product keywords to search for'),
			page: z.number().int().min(1).max(100).optional().describe('One-based result page'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Wayfair', 'products', 'products', 'query'),
	},
	{
		name: 'wayfair_product',
		title: 'Wayfair Product',
		description:
			'Retrieve a public product on Wayfair. Prices and availability are returned only when ' +
			'present in the retailer response and may depend on location. Alpha. Requires an API key.',
		path: '/api/wayfair/product',
		keyless: false,
		inputSchema: {
			url: z.string().min(1).max(4096).describe("Public HTTPS product URL on this retailer's site"),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Wayfair product', 'product'),
	},
	{
		name: 'aliexpress_search',
		title: 'AliExpress Search',
		description:
			'Search public products on AliExpress. Prices and availability are returned only when ' +
			'present in the retailer response and may depend on location. Alpha. Requires an API key.',
		path: '/api/aliexpress/search',
		keyless: false,
		inputSchema: {
			query: z.string().min(1).max(500).describe('Product keywords to search for'),
			page: z.number().int().min(1).max(100).optional().describe('One-based result page'),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('AliExpress', 'products', 'products', 'query'),
	},
	{
		name: 'aliexpress_product',
		title: 'AliExpress Product',
		description:
			'Retrieve a public product on AliExpress. Prices and availability are returned only when ' +
			'present in the retailer response and may depend on location. May return the equivalent ' +
			'US product ID. Some products provide only the title, URL and image; price is omitted ' +
			'when unavailable. Alpha. Requires an API key.',
		path: '/api/aliexpress/product',
		keyless: false,
		inputSchema: {
			url: z.string().min(1).max(4096).describe("Public HTTPS product URL on this retailer's site"),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('AliExpress product', 'product'),
	},
	{
		name: 'kroger_search',
		title: 'Kroger Search',
		description:
			'Search public products on Kroger. Prices and availability are returned only when present ' +
			'in the retailer response and may depend on location. Only the first result page is ' +
			'currently supported. Set store_id to select a store. Requests fail when data for that ' +
			'store is unavailable. Alpha. Requires an API key.',
		path: '/api/kroger/search',
		keyless: false,
		inputSchema: {
			query: z.string().min(1).max(500).describe('Product keywords to search for'),
			page: z
				.number()
				.int()
				.min(1)
				.max(1)
				.optional()
				.describe('Only the first result page is currently supported'),
			store_id: z
				.string()
				.min(1)
				.max(8)
				.optional()
				.describe(
					"Retailer's store ID. Selects the store catalog, pricing or availability where the " +
						'retailer exposes it',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Kroger', 'products', 'products', 'query'),
	},
	{
		name: 'kroger_product',
		title: 'Kroger Product',
		description:
			'Retrieve a public product on Kroger. Prices and availability are returned only when ' +
			'present in the retailer response and may depend on location. Set store_id to select a ' +
			'store. Requests fail when data for that store is unavailable. Alpha. Requires an API ' +
			'key.',
		path: '/api/kroger/product',
		keyless: false,
		inputSchema: {
			url: z.string().min(1).max(4096).describe("Public HTTPS product URL on this retailer's site"),
			store_id: z
				.string()
				.min(1)
				.max(8)
				.optional()
				.describe(
					"Retailer's store ID. Selects the store catalog, pricing or availability where the " +
						'retailer exposes it',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Kroger product', 'product'),
	},
	{
		name: 'sprouts_search',
		title: 'Sprouts Search',
		description:
			'Search public products on Sprouts. Prices and availability are returned only when ' +
			'present in the retailer response and may depend on location. Set store_id to select a ' +
			'store. Requests fail when data for that store is unavailable. Alpha. Requires an API ' +
			'key.',
		path: '/api/sprouts/search',
		keyless: false,
		inputSchema: {
			query: z.string().min(1).max(500).describe('Product keywords to search for'),
			page: z.number().int().min(1).max(100).optional().describe('One-based result page'),
			store_id: z
				.string()
				.min(1)
				.max(8)
				.optional()
				.describe(
					"Sprouts store location ID, such as 17650. Selects that store's in-store catalog",
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Sprouts', 'products', 'products', 'query'),
	},
	{
		name: 'sprouts_product',
		title: 'Sprouts Product',
		description:
			'Retrieve a public product on Sprouts. Prices and availability are returned only when ' +
			'present in the retailer response and may depend on location. Set store_id to select a ' +
			'store. Requests fail when data for that store is unavailable. Alpha. Requires an API ' +
			'key.',
		path: '/api/sprouts/product',
		keyless: false,
		inputSchema: {
			url: z.string().min(1).max(4096).describe("Public HTTPS product URL on this retailer's site"),
			store_id: z
				.string()
				.min(1)
				.max(8)
				.optional()
				.describe(
					"Sprouts store location ID, such as 17650. Selects that store's in-store catalog",
				),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Sprouts product', 'product'),
	},
	{
		name: 'wholefoods_search',
		title: 'Whole Foods Search',
		description:
			'Search public products on Whole Foods. Prices and availability are returned only when ' +
			'present in the retailer response and may depend on location. Set store_id to select a ' +
			'store. Requests fail when data for that store is unavailable. Alpha. Requires an API ' +
			'key.',
		path: '/api/wholefoods/search',
		keyless: false,
		inputSchema: {
			query: z.string().min(1).max(500).describe('Product keywords to search for'),
			page: z.number().int().min(1).max(100).optional().describe('One-based result page'),
			store_id: z
				.string()
				.min(1)
				.max(8)
				.optional()
				.describe(
					"Retailer's store ID. Selects the store catalog, pricing or availability where the " +
						'retailer exposes it',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('Whole Foods', 'products', 'products', 'query'),
	},
	{
		name: 'wholefoods_product',
		title: 'Whole Foods Product',
		description:
			'Retrieve a public product on Whole Foods. Prices and availability are returned only when ' +
			'present in the retailer response and may depend on location. Set store_id to select a ' +
			'store. Requests fail when data for that store is unavailable. Alpha. Requires an API ' +
			'key.',
		path: '/api/wholefoods/product',
		keyless: false,
		inputSchema: {
			url: z.string().min(1).max(4096).describe("Public HTTPS product URL on this retailer's site"),
			store_id: z
				.string()
				.min(1)
				.max(8)
				.optional()
				.describe(
					"Retailer's store ID. Selects the store catalog, pricing or availability where the " +
						'retailer exposes it',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('Whole Foods product', 'product'),
	},
	{
		name: 'ikea_search',
		title: 'IKEA Search',
		description:
			'Search public products on IKEA. Prices and availability are returned only when present ' +
			'in the retailer response and may depend on location. Set store_id to select a store. ' +
			"Requests fail when data for that store is unavailable. Uses IKEA's US English catalog. " +
			'Alpha. Requires an API key.',
		path: '/api/ikea/search',
		keyless: false,
		inputSchema: {
			query: z.string().min(1).max(500).describe('Product keywords to search for'),
			page: z.number().int().min(1).max(100).optional().describe('One-based result page'),
			store_id: z
				.string()
				.min(1)
				.max(8)
				.optional()
				.describe(
					"Retailer's store ID. Selects the store catalog, pricing or availability where the " +
						'retailer exposes it',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeCount('IKEA', 'products', 'products', 'query'),
	},
	{
		name: 'ikea_product',
		title: 'IKEA Product',
		description:
			'Retrieve a public product on IKEA. Prices and availability are returned only when ' +
			'present in the retailer response and may depend on location. Set store_id to select a ' +
			"store. Requests fail when data for that store is unavailable. Uses IKEA's US English " +
			'catalog. Alpha. Requires an API key.',
		path: '/api/ikea/product',
		keyless: false,
		inputSchema: {
			url: z.string().min(1).max(4096).describe("Public HTTPS product URL on this retailer's site"),
			store_id: z
				.string()
				.min(1)
				.max(8)
				.optional()
				.describe(
					"Retailer's store ID. Selects the store catalog, pricing or availability where the " +
						'retailer exposes it',
				),
			result_groups: resultGroups,
		},
		summarize: summarizeRecord('IKEA product', 'product'),
	},
];

export function findSurface(name: string): Surface | undefined {
	return SURFACES.find((surface) => surface.name === name);
}
