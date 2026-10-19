import { KEYLESS_TOOLS } from './tools.js';

export { KEYLESS_TOOLS } from './tools.js';

export const KEY_URL = 'https://litescrape.com';

// MCP hosts forward a tool error's text to the model, not structured fields,
// so the recovery steps live in the sentence itself.
export const ACCOUNT_FIX =
	`Fix: Get a free API key at ${KEY_URL}, set LITESCRAPE_API_KEY in the MCP server's ` +
	'environment, then start a new session.';

export function keyRequiredMessage(tool: string): string {
	return (
		`${tool} needs a Litescrape API key. Without one this server offers ` +
		`${KEYLESS_TOOLS.join(', ')} for free.

${ACCOUNT_FIX}`
	);
}

export function instructions(keyed: boolean): string {
	const catalog =
		'Only the free search tools are listed. More than 130 other Litescrape tools (AI answers, ' +
		'maps details and reviews, app stores, retailers, real estate, jobs, social media, web ' +
		'pages and more) are found with find_tools: describe the task and it returns the best ' +
		'matches with their input schemas, then run one with call_tool. Identifiers from one ' +
		'result, such as a place, product or user ID, feed the matching detail tool. ';
	const shared =
		'Every call returns the Litescrape API response as JSON, unchanged, after a one-line ' +
		'summary. Pass result_groups (inside call_tool arguments for found tools) to keep only ' +
		'the top-level groups you need; search_metadata is always kept. google_search with ' +
		'fast_mode true returns organic results only, faster. Results come straight from the ' +
		'source site; links are real destinations, never redirects. When a call reports a ' +
		'limit, relay its "Fix:" line to the user.';
	if (keyed) {
		return (
			'This session is authenticated with a Litescrape API key: every tool is available and ' +
			'each successful call is billed to that key. ' +
			catalog +
			shared
		);
	}
	return (
		'This session has no Litescrape API key. google_search (25 calls), bing_search (50), ' +
		'google_maps (50) and duckduckgo_search (50) are free per network per UTC day, one call ' +
		'at a time; failed calls do not count. ' +
		catalog +
		'Found tools marked keyless false need an API key, which also lifts every limit: get one ' +
		`at ${KEY_URL} and set LITESCRAPE_API_KEY in this server's environment. ` +
		shared
	);
}
