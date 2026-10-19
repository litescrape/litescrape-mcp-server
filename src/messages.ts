export const KEY_URL = 'https://litescrape.com';

// MCP hosts forward a tool error's text to the model, not structured fields,
// so the recovery steps live in the sentence itself.
export const ACCOUNT_FIX =
	`Fix: Get a free API key at ${KEY_URL}, set LITESCRAPE_API_KEY in the MCP server's ` +
	'environment, then start a new session.';

export const KEYLESS_TOOLS = ['google_search', 'bing_search', 'google_maps', 'duckduckgo_search'];

export function keyRequiredMessage(tool: string): string {
	return (
		`${tool} needs a Litescrape API key. Without one this server offers ` +
		`${KEYLESS_TOOLS.join(', ')} and search for free.\n\n${ACCOUNT_FIX}`
	);
}

export function instructions(keyed: boolean): string {
	const shared =
		'Every tool returns the Litescrape API response as JSON, unchanged, after a one-line ' +
		'summary. Pass result_groups to keep only the top-level groups you need (search_metadata ' +
		'is always kept). Results come straight from the source site; links are real ' +
		'destinations, never redirects. When a call reports a limit, relay its "Fix:" line to ' +
		'the user.';
	if (keyed) {
		return (
			'This session is authenticated with a Litescrape API key: every tool is available and ' +
			'each successful call is billed to that key. search is google_search in fast mode ' +
			'(organic results only). google_ai_mode generates an answer per request and is the ' +
			'slowest tool. google_reviews takes the place_id or data_id of a google_maps result ' +
			'and pages with next_page_token. web_fetch returns one web page as Markdown, HTML or ' +
			'text, and web_screenshot returns a base64 PNG of it. The other tools are named after the ' +
			'site and endpoint they read (amazon_product, tiktok_comments, zillow_search, ' +
			'indeed_search and so on); identifiers from one result, such as a place, product or ' +
			'user ID, feed the matching detail tool. Tools marked Alpha may change. ' +
			shared
		);
	}
	return (
		'This session has no Litescrape API key. google_search (25 calls), bing_search (50), ' +
		'google_maps (50) and duckduckgo_search (50) are free per network per UTC day, one call ' +
		'at a time; failed calls do not count. search is google_search in fast mode (organic ' +
		'results only) and shares its allowance. Every other tool (google_ai_mode, ' +
		'google_shopping, google_reviews, web_fetch and the rest of the catalog: other search ' +
		'engines, maps, reviews, app stores, retailers, real estate, jobs and social media) ' +
		'needs an API key, which also lifts every limit: get one at ' +
		`${KEY_URL} and set LITESCRAPE_API_KEY in this server's environment. ` +
		shared
	);
}
