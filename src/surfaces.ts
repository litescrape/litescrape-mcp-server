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
		.positive()
		.optional()
		.describe('Radius in meters around the location or coordinates'),
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

function quoted(args: Record<string, unknown>): string {
	return typeof args.q === 'string' ? ` for "${args.q}"` : '';
}

function summarizeSerp(engine: string): Surface['summarize'] {
	return (payload, args) => {
		const organic = count(payload, 'organic_results') ?? 0;
		const others = presentGroups(payload, ['organic_results', 'search_information', 'pagination']);
		const also = others.length ? `; also ${others.join(', ')}` : '';
		return `${engine}${quoted(args)}: ${organic} organic results${also}.`;
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
			'Render one public web page in a fresh browser and return it as Markdown (default), ' +
			'HTML, plain text or a full-page PNG screenshot encoded as base64, with url, title, ' +
			'content and the status_code the site returned. Narrow the content with ' +
			'target_selector or remove_selector. Alpha. Requires an API key.',
		path: '/api/web/fetch',
		keyless: false,
		inputSchema: {
			url: z
				.string()
				.min(1)
				.max(8192)
				.describe('Public http:// or https:// URL on the standard port, without credentials'),
			respond_with: z
				.enum(['markdown', 'html', 'text', 'screenshot'])
				.optional()
				.describe('Output format; default markdown. screenshot returns a base64 PNG'),
			target_selector: z
				.string()
				.min(1)
				.max(2048)
				.optional()
				.describe('CSS selector to extract; falls back to the full page when nothing matches'),
			remove_selector: z
				.string()
				.min(1)
				.max(2048)
				.optional()
				.describe('CSS selector removed before extraction, e.g. "nav, footer"'),
			wait_for_selector: z
				.string()
				.min(1)
				.max(2048)
				.optional()
				.describe('CSS selector to wait for after navigation'),
			wait_until: z
				.enum(['commit', 'domcontentloaded', 'load', 'networkidle'])
				.optional()
				.describe('Navigation event to wait for; default domcontentloaded'),
			page_timeout: z
				.number()
				.int()
				.min(1)
				.max(180)
				.optional()
				.describe('Seconds for browser operations; default 30'),
			locale: z.string().min(2).max(64).optional().describe('Browser locale; default en-US'),
			user_agent: z.string().min(1).max(1024).optional().describe('User-Agent to send'),
			with_links: z
				.enum(['inlined', 'referenced', 'collapsed', 'shortcut', 'discarded'])
				.optional()
				.describe('How Markdown writes links; default inlined'),
			with_images: z
				.enum(['all', 'alt', 'none'])
				.optional()
				.describe('How Markdown writes images; default all'),
			with_iframe: z
				.enum(['true', 'false', 'quoted'])
				.optional()
				.describe('Include direct child frames before extraction; default false'),
			with_shadow_dom: z
				.boolean()
				.optional()
				.describe('Expand open shadow roots before extraction; default false'),
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
];

export function findSurface(name: string): Surface | undefined {
	return SURFACES.find((surface) => surface.name === name);
}
