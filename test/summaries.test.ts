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
});
