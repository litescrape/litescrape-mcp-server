import { describe, expect, it } from 'vitest';

import { KEYLESS_TOOLS } from '../src/messages.js';
import { SURFACES } from '../src/surfaces.js';

// Every route the Litescrape API serves (api/documentation.json in the backend), sorted.
const API_ROUTES = [
	'/airbnb/search',
	'/aliexpress/product',
	'/aliexpress/search',
	'/amazon/autocomplete',
	'/amazon/featured-reviews',
	'/amazon/media-reviews',
	'/amazon/product',
	'/amazon/search',
	'/apartments/property',
	'/apartments/search',
	'/apple/app-store/product',
	'/apple/app-store/reviews',
	'/apple/app-store/search',
	'/apple/maps/places',
	'/apple/maps/reviews',
	'/ashby/search',
	'/baidu/search',
	'/bestbuy/product',
	'/bestbuy/search',
	'/bing/images',
	'/bing/maps',
	'/bing/product',
	'/bing/search',
	'/bing/shopping',
	'/brave/ai-mode',
	'/brave/search',
	'/copilot/chat/completions',
	'/duckduckgo/maps',
	'/duckduckgo/search',
	'/ebay/product',
	'/ebay/search',
	'/ebay/seller',
	'/etsy/product',
	'/etsy/search',
	'/eventbrite/search',
	'/facebook/hashtag-posts',
	'/facebook/marketplace-browse',
	'/facebook/page-posts',
	'/facebook/post',
	'/facebook/reel',
	'/facebook/search-pages',
	'/facebook/search-profiles',
	'/glassdoor/search',
	'/google/ads',
	'/google/ai-mode',
	'/google/ai-overview',
	'/google/contributor-reviews',
	'/google/gemini',
	'/google/images',
	'/google/jobs',
	'/google/local',
	'/google/maps',
	'/google/maps/photo-meta',
	'/google/maps/popular-times',
	'/google/maps/posts',
	'/google/play/apps',
	'/google/play/books',
	'/google/play/games',
	'/google/play/movies',
	'/google/play/product',
	'/google/play/reviews',
	'/google/reviews',
	'/google/search',
	'/google/shopping',
	'/google/shopping/merchant-urls',
	'/google/shopping/product',
	'/homedepot/product',
	'/homedepot/search',
	'/homes/property',
	'/homes/search',
	'/ikea/product',
	'/ikea/search',
	'/indeed/search',
	'/instagram/embed',
	'/instagram/post',
	'/instagram/posts',
	'/instagram/profile',
	'/instagram/profile-post-count',
	'/instagram/search-popular',
	'/kroger/product',
	'/kroger/search',
	'/levels/search',
	'/naver/ai-overview',
	'/naver/search',
	'/realtor/property',
	'/realtor/search',
	'/redfin/property',
	'/redfin/search',
	'/sprouts/product',
	'/sprouts/search',
	'/target/product',
	'/target/search',
	'/tiktok/collection-videos',
	'/tiktok/comment-replies',
	'/tiktok/comments',
	'/tiktok/followers',
	'/tiktok/following',
	'/tiktok/live',
	'/tiktok/profile',
	'/tiktok/profile-videos',
	'/tiktok/search-hashtag',
	'/tiktok/search-keyword',
	'/tiktok/search-suggestions',
	'/tiktok/search-top',
	'/tiktok/song',
	'/tiktok/song-videos',
	'/tiktok/transcript',
	'/tiktok/trending-feed',
	'/tiktok/user-live',
	'/tiktok/video',
	'/tripadvisor/place',
	'/tripadvisor/reviews',
	'/tripadvisor/search',
	'/walmart/product',
	'/walmart/search',
	'/wayfair/product',
	'/wayfair/search',
	'/web/fetch',
	'/web/screenshot',
	'/wholefoods/product',
	'/wholefoods/search',
	'/x/community',
	'/x/community-posts',
	'/x/post',
	'/x/profile',
	'/x/user-posts',
	'/yahoo/images',
	'/yahoo/search',
	'/yandex/images',
	'/yandex/search',
	'/yelp/place',
	'/yelp/reviews',
	'/yelp/search',
	'/youtube/channel',
	'/youtube/search',
	'/zillow/locations',
	'/zillow/property',
	'/zillow/search',
	'/ziprecruiter/search',
];

describe('catalog', () => {
	it('has one tool for every API route and no tool for a route the API does not serve', () => {
		const paths = new Set(SURFACES.map((surface) => surface.path.replace(/^\/api/, '')));
		expect([...paths].sort()).toEqual(API_ROUTES);
	});

	it('names each tool after its route, uniquely, within the MCP name limits', () => {
		const names = SURFACES.map((surface) => surface.name);
		expect(new Set(names).size).toBe(names.length);
		for (const surface of SURFACES) {
			expect(surface.name).toMatch(/^[a-z0-9_]{1,64}$/);
			if (surface.name === 'search') continue;
			expect(surface.name).toBe(surface.path.replace(/^\/api\//, '').replace(/[/-]/g, '_'));
		}
	});

	it('serves only the free routes without a key and says so in every other description', () => {
		const keyless = SURFACES.filter((surface) => surface.keyless).map((surface) => surface.name);
		expect(keyless.sort()).toEqual([...KEYLESS_TOOLS, 'search'].sort());
		for (const surface of SURFACES.filter((surface) => !surface.keyless)) {
			expect(surface.description).toMatch(/Requires an API key\.$/);
		}
	});

	it('offers result_groups on every tool except the web page tools', () => {
		for (const surface of SURFACES) {
			const expected = !['web_fetch', 'web_screenshot'].includes(surface.name);
			expect(Object.hasOwn(surface.inputSchema, 'result_groups')).toBe(expected);
		}
	});
});
