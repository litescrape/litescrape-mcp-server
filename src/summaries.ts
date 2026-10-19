import { isRecord, type Payload } from './client.js';

export type Summarize = (payload: Payload, args: Record<string, unknown>) => string;

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

function summarizeSerp(engine: string, key: string | null = 'q'): Summarize {
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
): Summarize {
	return (payload, args) => {
		const found = count(payload, group) ?? 0;
		return `${label}${quoted(args, key)}: ${found} ${noun}${more(payload)}.`;
	};
}

const NAMES = ['title', 'name', 'nickname', 'unique_id', 'username', 'screen_name', 'address'];

/** "<label>: <name>", for responses built around one record (the whole payload when group is omitted). */
function summarizeRecord(label: string, group?: string): Summarize {
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
function summarizeGroups(label: string, key: string | null = 'q'): Summarize {
	return (payload, args) => {
		const groups = presentGroups(payload, PAGING);
		const listed = groups.length ? groups.join(', ') : 'no result groups';
		return `${label}${quoted(args, key)}: ${listed}${more(payload)}.`;
	};
}

/** Generated answers with text blocks, references and an optional follow-up token. */
function summarizeAnswer(label: string, token?: string, key = 'q'): Summarize {
	return (payload, args) => {
		const blocks = count(payload, 'text_blocks') ?? 0;
		const references = count(payload, 'references') ?? 0;
		const followUp =
			token !== undefined && typeof payload[token] === 'string' ? '; follow-up token included' : '';
		return `${label}${quoted(args, key)}: ${blocks} text blocks, ${references} references${followUp}.`;
	};
}

/** Plain-text replies such as Gemini's. */
function summarizeText(label: string, field: string, key: string): Summarize {
	return (payload, args) => {
		const value = payload[field];
		const size = typeof value === 'string' ? `${value.length} characters` : 'no text';
		const followUp =
			typeof payload.subsequent_request_token === 'string' ? '; follow-up token included' : '';
		return `${label}${quoted(args, key)}: ${size}${followUp}.`;
	};
}

/** The one-line summary that leads each tool result, by tool name. */
export const SUMMARIES: Record<string, Summarize> = {
	google_search: summarizeSerp('Google Search'),
	bing_search: summarizeSerp('Bing'),
	duckduckgo_search: summarizeSerp('DuckDuckGo'),
	google_maps: (payload, args) => {
		const place = payload.place_results;
		if (isRecord(place)) {
			const title = typeof place.title === 'string' ? place.title : 'one place';
			return `Google Maps place: ${title}.`;
		}
		const places = count(payload, 'local_results') ?? 0;
		return `Google Maps${quoted(args)}: ${places} places.`;
	},
	google_ai_overview: (payload, args) => {
		const overview = payload.ai_overview;
		if (!isRecord(overview)) return `Google served no AI Overview${quoted(args)}.`;
		if (isRecord(overview.error)) return `Google AI Overview${quoted(args)}: unavailable.`;
		const blocks = count(overview, 'text_blocks') ?? 0;
		const references = count(overview, 'references') ?? 0;
		return `Google AI Overview${quoted(args)}: ${blocks} text blocks, ${references} references.`;
	},
	google_ai_mode: (payload, args) => {
		const blocks = count(payload, 'text_blocks') ?? 0;
		const references = count(payload, 'references') ?? 0;
		const token =
			typeof payload.subsequent_request_token === 'string' ? '; follow-up token included' : '';
		return `Google AI Mode${quoted(args)}: ${blocks} text blocks, ${references} references${token}.`;
	},
	google_shopping: (payload, args) => {
		const products = count(payload, 'shopping_results') ?? 0;
		const categories = count(payload, 'categorized_shopping_results') ?? 0;
		const sponsored = count(payload, 'inline_shopping_results') ?? 0;
		return (
			`Google Shopping${quoted(args)}: ${products} products, ${categories} category blocks, ` +
			`${sponsored} sponsored listings.`
		);
	},
	google_reviews: (payload) => {
		const reviews = count(payload, 'reviews') ?? 0;
		const place = isRecord(payload.place_info) ? payload.place_info : {};
		const name = typeof place.title === 'string' ? ` for ${place.title}` : '';
		const pagination = isRecord(payload.pagination) ? payload.pagination : {};
		const more = typeof pagination.next_page_token === 'string' ? '; more pages available' : '';
		return `Google Reviews${name}: ${reviews} reviews${more}.`;
	},
	web_fetch: (payload) => {
		const title = typeof payload.title === 'string' && payload.title ? ` "${payload.title}"` : '';
		const status =
			typeof payload.status_code === 'number' ? `, site status ${payload.status_code}` : '';
		const size =
			typeof payload.content === 'string' ? `, ${payload.content.length} characters` : '';
		return `Fetched${title}${status}${size}.`;
	},
	google_jobs: summarizeCount('Google Jobs', 'jobs_results', 'jobs'),
	google_images: summarizeCount('Google Images', 'images_results', 'images'),
	google_ads: summarizeCount('Google Ads', 'ads', 'ads'),
	google_gemini: summarizeText('Gemini', 'text', 'prompt'),
	google_local: summarizeCount('Google Local', 'local_results', 'places'),
	google_contributor_reviews: summarizeCount(
		'Google contributor reviews',
		'reviews',
		'reviews',
		null,
	),
	google_maps_posts: summarizeCount('Google Maps posts', 'posts', 'posts', null),
	google_maps_photo_meta: summarizeRecord('Google Maps photo', 'location'),
	google_maps_popular_times: summarizeRecord('Google Maps popular times', 'place'),
	google_shopping_product: summarizeCount('Google Shopping product', 'offers', 'offers'),
	google_shopping_merchant_urls: summarizeCount(
		'Google Shopping merchant URLs',
		'results',
		'products',
		null,
	),
	google_play_apps: summarizeGroups('Google Play Apps'),
	google_play_games: summarizeGroups('Google Play Games'),
	google_play_books: summarizeGroups('Google Play Books'),
	google_play_movies: summarizeGroups('Google Play Movies'),
	google_play_product: summarizeRecord('Google Play product', 'product_info'),
	google_play_reviews: summarizeCount('Google Play reviews', 'reviews', 'reviews', null),
	apple_app_store_search: summarizeCount('App Store', 'organic_results', 'apps', 'term'),
	apple_app_store_product: summarizeRecord('App Store product'),
	apple_app_store_reviews: summarizeCount('App Store reviews', 'reviews', 'reviews', null),
	apple_maps_places: summarizeCount('Apple Maps', 'place_results', 'places', null),
	apple_maps_reviews: summarizeCount('Apple Maps reviews', 'reviews', 'reviews', null),
	bing_images: summarizeCount('Bing Images', 'images_results', 'images'),
	bing_shopping: summarizeCount('Bing Shopping', 'shopping_results', 'products'),
	bing_product: summarizeRecord('Bing product', 'product_results'),
	bing_maps: summarizeCount('Bing Maps', 'local_results', 'places'),
	brave_search: summarizeSerp('Brave Search'),
	brave_ai_mode: summarizeAnswer('Brave AI Mode', 'continuation_token'),
	baidu_search: summarizeSerp('Baidu'),
	yandex_search: summarizeSerp('Yandex', 'text'),
	yandex_images: summarizeCount('Yandex Images', 'images_results', 'images', 'text'),
	naver_search: summarizeSerp('Naver', 'query'),
	naver_ai_overview: summarizeAnswer('Naver AI Briefing', undefined, 'query'),
	copilot_chat_completions: (payload) => {
		const choices = Array.isArray(payload.choices) ? payload.choices : [];
		const first = isRecord(choices[0]) && isRecord(choices[0].message) ? choices[0].message : {};
		const size =
			typeof first.content === 'string' ? `${first.content.length} characters` : 'no text';
		const citations = count(payload, 'citations') ?? 0;
		return `Copilot answered: ${size}, ${citations} citations.`;
	},
	duckduckgo_maps: summarizeCount('DuckDuckGo Maps', 'local_results', 'places'),
	yahoo_search: summarizeSerp('Yahoo', 'p'),
	yahoo_images: summarizeCount('Yahoo Images', 'images_results', 'images', 'p'),
	tripadvisor_search: summarizeCount('Tripadvisor', 'search_results', 'places'),
	tripadvisor_place: summarizeRecord('Tripadvisor place', 'place_results'),
	tripadvisor_reviews: summarizeCount('Tripadvisor reviews', 'reviews', 'reviews', null),
	airbnb_search: summarizeCount('Airbnb', 'organic_results', 'stays'),
	eventbrite_search: summarizeCount('Eventbrite', 'organic_results', 'events'),
	indeed_search: summarizeCount('Indeed', 'jobs_results', 'jobs'),
	glassdoor_search: summarizeCount('Glassdoor', 'jobs_results', 'jobs'),
	ashby_search: summarizeCount('Ashby', 'jobs_results', 'jobs'),
	ziprecruiter_search: summarizeCount('ZipRecruiter', 'jobs_results', 'jobs'),
	levels_search: summarizeCount('Levels.fyi', 'jobs_results', 'jobs'),
	zillow_search: summarizeCount('Zillow', 'properties', 'properties'),
	zillow_property: summarizeRecord('Zillow property', 'property'),
	zillow_locations: summarizeCount('Zillow locations', 'locations', 'locations'),
	redfin_search: summarizeCount('Redfin', 'properties', 'properties', null),
	redfin_property: summarizeRecord('Redfin property', 'property'),
	realtor_search: summarizeCount('Realtor.com', 'properties', 'properties', null),
	realtor_property: summarizeRecord('Realtor.com property', 'property'),
	apartments_search: summarizeCount('Apartments.com', 'properties', 'properties', null),
	apartments_property: summarizeRecord('Apartments.com property', 'property'),
	homes_search: summarizeCount('Homes.com', 'properties', 'properties', null),
	homes_property: summarizeRecord('Homes.com property', 'property'),
	facebook_search_pages: summarizeCount('Facebook Pages', 'pages', 'Pages', 'query'),
	facebook_search_profiles: summarizeCount('Facebook profiles', 'profiles', 'profiles', 'query'),
	facebook_hashtag_posts: summarizeCount('Facebook hashtag', 'posts', 'posts', 'tag'),
	facebook_post: summarizeRecord('Facebook post', 'post'),
	facebook_page_posts: summarizeCount('Facebook Page posts', 'posts', 'posts', null),
	facebook_marketplace_browse: summarizeCount(
		'Facebook Marketplace',
		'listings',
		'listings',
		'query',
	),
	facebook_reel: summarizeRecord('Facebook reel', 'reel'),
	yelp_search: summarizeCount('Yelp', 'organic_results', 'businesses', 'find_desc'),
	yelp_place: summarizeRecord('Yelp place', 'place_results'),
	yelp_reviews: summarizeCount('Yelp reviews', 'reviews', 'reviews', null),
	youtube_search: summarizeCount('YouTube', 'video_results', 'videos'),
	youtube_channel: summarizeRecord('YouTube channel', 'channel_results'),
	amazon_search: summarizeCount('Amazon', 'organic_results', 'products', 'k'),
	amazon_product: summarizeRecord('Amazon product', 'product_results'),
	amazon_autocomplete: summarizeCount('Amazon autocomplete', 'suggestions', 'suggestions', 'k'),
	amazon_featured_reviews: summarizeCount('Amazon featured reviews', 'reviews', 'reviews', null),
	amazon_media_reviews: summarizeCount('Amazon media reviews', 'reviews', 'reviews', null),
	x_profile: summarizeRecord('X profile', 'profile'),
	x_post: summarizeRecord('X post', 'post'),
	x_user_posts: summarizeCount('X user posts', 'posts', 'posts', null),
	x_community: summarizeRecord('X community', 'community'),
	x_community_posts: summarizeCount('X community posts', 'posts', 'posts', null),
	ebay_search: summarizeCount('eBay', 'organic_results', 'listings', '_nkw'),
	ebay_product: summarizeRecord('eBay listing', 'product_results'),
	ebay_seller: summarizeRecord('eBay seller', 'seller_results'),
	web_screenshot: (payload) => {
		const title =
			typeof payload.title === 'string' && payload.title ? ` of "${payload.title}"` : '';
		const size =
			typeof payload.screenshot_base64 === 'string'
				? `, ${payload.screenshot_base64.length} base64 characters`
				: '';
		const full = payload.full_page === true ? ', full page' : '';
		return `Screenshot${title}${full}${size}.`;
	},
	tiktok_profile: summarizeRecord('TikTok profile', 'user'),
	tiktok_video: summarizeRecord('TikTok video', 'item'),
	tiktok_transcript: summarizeCount('TikTok transcript', 'segments', 'segments', null),
	tiktok_search_suggestions: summarizeCount(
		'TikTok suggestions',
		'suggestions',
		'suggestions',
		'query',
	),
	tiktok_user_live: (payload, args) => {
		const handle = typeof args.handle === 'string' ? ` ${args.handle}` : '';
		return payload.is_live === true
			? `TikTok user${handle} is live now.`
			: `TikTok user${handle} is not live.`;
	},
	tiktok_live: summarizeRecord('TikTok live room', 'room'),
	tiktok_song: summarizeRecord('TikTok song', 'music'),
	tiktok_profile_videos: summarizeCount('TikTok profile videos', 'items', 'videos', null),
	tiktok_comments: summarizeCount('TikTok comments', 'comments', 'comments', null),
	tiktok_comment_replies: summarizeCount('TikTok comment replies', 'comments', 'replies', null),
	tiktok_following: summarizeCount('TikTok following', 'users', 'accounts', null),
	tiktok_followers: summarizeCount('TikTok followers', 'users', 'accounts', null),
	tiktok_search_keyword: summarizeCount('TikTok search', 'items', 'videos', 'query'),
	tiktok_search_top: summarizeCount('TikTok top results', 'results', 'results', 'query'),
	tiktok_search_hashtag: summarizeCount('TikTok hashtag', 'items', 'videos', 'hashtag'),
	tiktok_song_videos: summarizeCount('TikTok song videos', 'items', 'videos', null),
	tiktok_trending_feed: summarizeCount('TikTok trending feed', 'items', 'videos', null),
	tiktok_collection_videos: summarizeCount('TikTok collection', 'items', 'videos', null),
	instagram_profile: summarizeGroups('Instagram profile', 'handle'),
	instagram_posts: summarizeCount('Instagram posts', 'items', 'posts', 'handle'),
	instagram_post: summarizeGroups('Instagram post', null),
	instagram_profile_post_count: (payload, args) => {
		const handle = typeof args.handle === 'string' ? ` ${args.handle}` : '';
		const value = payload.media_count ?? payload.total_media_count;
		if (typeof value !== 'number') return `Instagram post count${handle}: unavailable.`;
		const estimated = payload.is_estimated === true ? ' (estimated)' : '';
		return `Instagram post count${handle}: ${value}${estimated}.`;
	},
	instagram_embed: summarizeGroups('Instagram embed', 'handle'),
	instagram_search_popular: summarizeCount('Instagram popular', 'posts', 'posts', 'query'),
	walmart_search: summarizeCount('Walmart', 'products', 'products', 'query'),
	walmart_product: summarizeRecord('Walmart product', 'product'),
	homedepot_search: summarizeCount('Home Depot', 'products', 'products', 'query'),
	homedepot_product: summarizeRecord('Home Depot product', 'product'),
	target_search: summarizeCount('Target', 'products', 'products', 'query'),
	target_product: summarizeRecord('Target product', 'product'),
	etsy_search: summarizeCount('Etsy', 'products', 'products', 'query'),
	etsy_product: summarizeRecord('Etsy product', 'product'),
	bestbuy_search: summarizeCount('Best Buy', 'products', 'products', 'query'),
	bestbuy_product: summarizeRecord('Best Buy product', 'product'),
	wayfair_search: summarizeCount('Wayfair', 'products', 'products', 'query'),
	wayfair_product: summarizeRecord('Wayfair product', 'product'),
	aliexpress_search: summarizeCount('AliExpress', 'products', 'products', 'query'),
	aliexpress_product: summarizeRecord('AliExpress product', 'product'),
	kroger_search: summarizeCount('Kroger', 'products', 'products', 'query'),
	kroger_product: summarizeRecord('Kroger product', 'product'),
	sprouts_search: summarizeCount('Sprouts', 'products', 'products', 'query'),
	sprouts_product: summarizeRecord('Sprouts product', 'product'),
	wholefoods_search: summarizeCount('Whole Foods', 'products', 'products', 'query'),
	wholefoods_product: summarizeRecord('Whole Foods product', 'product'),
	ikea_search: summarizeCount('IKEA', 'products', 'products', 'query'),
	ikea_product: summarizeRecord('IKEA product', 'product'),
};

/** Summarize a response, falling back to its result groups for a tool without its own summary. */
export function summarize(
	name: string,
	title: string,
	payload: Payload,
	args: Record<string, unknown>,
): string {
	return (SUMMARIES[name] ?? summarizeGroups(title))(payload, args);
}
