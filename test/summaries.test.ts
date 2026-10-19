import { describe, expect, it } from 'vitest';

import { findSurface } from '../src/surfaces.js';

function summarize(
	name: string,
	payload: Record<string, unknown>,
	args: Record<string, unknown> = {},
) {
	const surface = findSurface(name);
	if (!surface) throw new Error(`unknown surface ${name}`);
	return surface.summarize(payload, args);
}

describe('summaries', () => {
	it('counts SERP groups without the metadata keys', () => {
		expect(
			summarize(
				'bing_search',
				{
					search_metadata: {},
					search_parameters: {},
					search_information: {},
					organic_results: [1, 2, 3],
					answer_box: {},
					pagination: {},
				},
				{ q: 'pizza' },
			),
		).toBe('Bing for "pizza": 3 organic results; also answer_box.');
		expect(summarize('duckduckgo_search', { organic_results: [] })).toBe(
			'DuckDuckGo: 0 organic results.',
		);
	});

	it('describes a Maps search or an exact place', () => {
		expect(summarize('google_maps', { local_results: [{}, {}] }, { q: 'cafes' })).toBe(
			'Google Maps for "cafes": 2 places.',
		);
		expect(summarize('google_maps', { place_results: { title: 'Blue Bottle' } })).toBe(
			'Google Maps place: Blue Bottle.',
		);
	});

	it('describes the AI Overview states', () => {
		expect(summarize('google_ai_overview', { ai_overview: null }, { q: 'x' })).toBe(
			'Google served no AI Overview for "x".',
		);
		expect(
			summarize('google_ai_overview', { ai_overview: { error: { code: 'unavailable' } } }),
		).toBe('Google AI Overview: unavailable.');
		expect(
			summarize('google_ai_overview', { ai_overview: { text_blocks: [{}, {}], references: [{}] } }),
		).toBe('Google AI Overview: 2 text blocks, 1 references.');
	});

	it('describes Shopping results', () => {
		expect(
			summarize(
				'google_shopping',
				{
					shopping_results: [{}, {}, {}],
					categorized_shopping_results: [{}],
					inline_shopping_results: [],
				},
				{ q: 'coffee maker' },
			),
		).toBe(
			'Google Shopping for "coffee maker": 3 products, 1 category blocks, 0 sponsored listings.',
		);
	});

	it('counts the main list of a catalog response and notes further pages', () => {
		expect(
			summarize(
				'amazon_search',
				{ search_metadata: {}, organic_results: [{}, {}], pagination: { next: 'https://x' } },
				{ k: 'kettle' },
			),
		).toBe('Amazon for "kettle": 2 products; more pages available.');
		expect(summarize('tiktok_comments', { has_more: false, comments: [{}] })).toBe(
			'TikTok comments: 1 comments.',
		);
		expect(summarize('zillow_search', {})).toBe('Zillow: 0 properties.');
	});

	it('names the record of a detail response', () => {
		expect(summarize('zillow_property', { property: { address: '1 Main St' } })).toBe(
			'Zillow property: 1 Main St.',
		);
		expect(summarize('x_profile', { profile: { username: 'jack' } })).toBe('X profile: jack.');
		expect(summarize('walmart_product', { product: {} })).toBe('Walmart product: found.');
		expect(summarize('tiktok_video', {})).toBe('TikTok video: not found.');
		expect(summarize('apple_app_store_product', { title: 'Notes' })).toBe(
			'App Store product: Notes.',
		);
	});

	it('lists the groups of a response whose shape varies', () => {
		expect(
			summarize('google_play_games', { search_metadata: {}, organic_results: [], charts: [] }),
		).toBe('Google Play Games: organic_results, charts.');
	});

	it('describes generated answers and text replies', () => {
		expect(
			summarize(
				'brave_ai_mode',
				{ text_blocks: [{}], references: [{}, {}], continuation_token: 't' },
				{ q: 'why' },
			),
		).toBe('Brave AI Mode for "why": 1 text blocks, 2 references; follow-up token included.');
		expect(summarize('google_gemini', { text: 'Hello' }, { prompt: 'hi' })).toBe(
			'Gemini for "hi": 5 characters.',
		);
	});

	it('describes live status, post counts and screenshots', () => {
		expect(summarize('tiktok_user_live', { is_live: true }, { handle: 'a' })).toBe(
			'TikTok user a is live now.',
		);
		expect(
			summarize(
				'instagram_profile_post_count',
				{ media_count: 42, is_estimated: true },
				{ handle: 'b' },
			),
		).toBe('Instagram post count b: 42 (estimated).');
		expect(
			summarize('web_screenshot', {
				title: 'Example',
				screenshot_base64: 'aGVsbG8=',
				full_page: true,
			}),
		).toBe('Screenshot of "Example", full page, 8 base64 characters.');
	});
});
