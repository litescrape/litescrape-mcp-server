# Litescrape MCP Server

Google Search, Bing, DuckDuckGo and Google Maps results for any MCP client, free and without an API key. Add a key for the rest of the Litescrape catalog (Google AI Mode, AI Overview, Shopping and Reviews, plus Brave, Yandex, Baidu, Naver, Yahoo, YouTube, app stores, Amazon, eBay and other retailers, Zillow and other real-estate sites, job boards, TikTok, Instagram, X, Facebook and web page capture) and to lift every limit.

Results come straight from each site's own pages as structured JSON, through the [Litescrape API](https://litescrape.com). Links are real destinations, never redirects, and nothing is cached: every call runs fresh.

## Quick start

No account, no key, one line.

**Claude Code**

```
claude mcp add litescrape -- npx -y litescrape-mcp-server
```

**Cursor, Windsurf, Claude Desktop, Codex, Gemini CLI and most other clients** (`mcp.json`, `claude_desktop_config.json`, or the client's MCP settings)

```json
{
	"mcpServers": {
		"litescrape": {
			"command": "npx",
			"args": ["-y", "litescrape-mcp-server"]
		}
	}
}
```

**VS Code**

```
code --add-mcp '{"name":"litescrape","command":"npx","args":["-y","litescrape-mcp-server"]}'
```

**Codex CLI**

```
codex mcp add litescrape -- npx -y litescrape-mcp-server
```

**Gemini CLI**

```
gemini mcp add litescrape npx -y litescrape-mcp-server
```

Requires Node.js 20 or newer.

**Hosted, nothing to install**: clients that connect to remote servers can use `https://mcp.litescrape.com/mcp` instead. Same tools, same free allowance; send an API key as `Authorization: Bearer ls_live_...` to unlock the rest.

```
claude mcp add --transport http litescrape https://mcp.litescrape.com/mcp
```

## What you get without a key

| Tool                | Returns                                                                                                                                  | Free calls per network per UTC day |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `google_search`     | The full Google results page: organic results, Knowledge Graph, AI Overview, ads, related questions and every other module Google served | 25                                 |
| `bing_search`       | Bing organic results, answer boxes, Knowledge Graph, Copilot answer and more                                                             | 50                                 |
| `duckduckgo_search` | DuckDuckGo organic results with region, safety and date filters                                                                          | 50                                 |
| `google_maps`       | Google Maps places (name, address, rating, hours, phone, website, coordinates) or one exact place                                        | 50                                 |

One call runs at a time per network, and failed calls never count. When a limit is reached, the tool result says so and tells the model exactly how to add a key, so the agent can relay it to you.

## Add an API key

A key unlocks every other tool (`google_ai_mode`, `google_ai_overview`, `google_shopping`, `google_reviews`, `web_fetch` and [the rest of the catalog](#more-tools-with-a-key)), removes the daily limits and allows concurrent calls. Get one at [litescrape.com](https://litescrape.com), then set `LITESCRAPE_API_KEY` in the server's environment:

```json
{
	"mcpServers": {
		"litescrape": {
			"command": "npx",
			"args": ["-y", "litescrape-mcp-server"],
			"env": {
				"LITESCRAPE_API_KEY": "ls_live_..."
			}
		}
	}
}
```

With Claude Code: `claude mcp add litescrape -e LITESCRAPE_API_KEY=ls_live_... -- npx -y litescrape-mcp-server`

With the hosted endpoint: `claude mcp add --transport http litescrape https://mcp.litescrape.com/mcp --header "Authorization: Bearer ls_live_..."`

## Tools

The server lists only the free tools, plus two that reach the rest of the catalog, so every session starts with a small tool list (about 5K tokens) whether or not it has a key:

| Tool                | Key needed | What it does                                                                                                                                      |
| ------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `google_search`     | No         | The full Google Search page; `fast_mode` returns organic results only, faster                                                                     |
| `bing_search`       | No         | Bing web search                                                                                                                                   |
| `duckduckgo_search` | No         | DuckDuckGo web search                                                                                                                             |
| `google_maps`       | No         | Google Maps places, or one exact place                                                                                                            |
| `find_tools`        | No         | Finds the Litescrape tools for a task described in plain language (`q`), best matches first with their input schemas, or fetches tools by `names` |
| `call_tool`         | Depends    | Runs a tool from `find_tools` by `name` with its `arguments`; works without a key only for the free tools                                         |

Tool names, descriptions and input schemas come from the [Litescrape API](https://litescrape.com/docs) itself (`/api/tools`), so they always match the endpoints.

### More tools with a key

Every other Litescrape endpoint is reachable through `find_tools` and `call_tool`, named after its route (`/api/amazon/product` is `amazon_product`) and taking that endpoint's parameters. Identifiers in one result (a place, product, video or user ID) are the input of the matching detail tool. `find_tools` works without a key too, so an agent can see what a key would unlock.

| Area                    | Tools                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Search engines          | `google_images`, `google_local`, `google_ads`, `bing_images`, `brave_search`, `baidu_search`, `yandex_search`, `yandex_images`, `naver_search`, `yahoo_search`, `yahoo_images`, `youtube_search`, `youtube_channel`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AI answers              | `google_ai_mode`, `google_ai_overview`, `google_gemini`, `brave_ai_mode`, `naver_ai_overview`, `copilot_chat_completions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Maps, places and travel | `google_reviews`, `google_maps_posts`, `google_maps_photo_meta`, `google_maps_popular_times`, `google_contributor_reviews`, `apple_maps_places`, `apple_maps_reviews`, `bing_maps`, `duckduckgo_maps`, `tripadvisor_search`, `tripadvisor_place`, `tripadvisor_reviews`, `yelp_search`, `yelp_place`, `yelp_reviews`, `airbnb_search`, `eventbrite_search`                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Shopping                | `google_shopping`, `google_shopping_product`, `google_shopping_merchant_urls`, `bing_shopping`, `bing_product`, `ebay_search`, `ebay_product`, `ebay_seller`, `amazon_search`, `amazon_product`, `amazon_autocomplete`, `amazon_featured_reviews`, `amazon_media_reviews`, and `_search` plus `_product` for `walmart`, `homedepot`, `target`, `etsy`, `bestbuy`, `wayfair`, `aliexpress`, `kroger`, `sprouts`, `wholefoods` and `ikea`                                                                                                                                                                                                                                                                                                                                                                                        |
| App stores              | `google_play_apps`, `google_play_games`, `google_play_books`, `google_play_movies`, `google_play_product`, `google_play_reviews`, `apple_app_store_search`, `apple_app_store_product`, `apple_app_store_reviews`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Jobs                    | `google_jobs`, `indeed_search`, `glassdoor_search`, `ashby_search`, `ziprecruiter_search`, `levels_search`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Real estate             | `zillow_search`, `zillow_property`, `zillow_locations`, `redfin_search`, `redfin_property`, `realtor_search`, `realtor_property`, `apartments_search`, `apartments_property`, `homes_search`, `homes_property`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Social media            | TikTok: `tiktok_profile`, `tiktok_video`, `tiktok_transcript`, `tiktok_search_suggestions`, `tiktok_user_live`, `tiktok_live`, `tiktok_song`, `tiktok_profile_videos`, `tiktok_comments`, `tiktok_comment_replies`, `tiktok_following`, `tiktok_followers`, `tiktok_search_keyword`, `tiktok_search_top`, `tiktok_search_hashtag`, `tiktok_song_videos`, `tiktok_trending_feed`, `tiktok_collection_videos`. Instagram: `instagram_profile`, `instagram_posts`, `instagram_post`, `instagram_profile_post_count`, `instagram_embed`, `instagram_search_popular`. X: `x_profile`, `x_post`, `x_user_posts`, `x_community`, `x_community_posts`. Facebook: `facebook_search_pages`, `facebook_search_profiles`, `facebook_hashtag_posts`, `facebook_post`, `facebook_page_posts`, `facebook_marketplace_browse`, `facebook_reel` |
| Web                     | `web_fetch` (one page as Markdown, HTML or text), `web_screenshot`: a base64 PNG of one page, optionally the full page                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Parameter names and accepted values follow the [Litescrape API reference](https://litescrape.com/docs).

Every tool accepts `result_groups` (inside `call_tool`'s `arguments` for a found tool), a list of top-level groups to keep (for example `["organic_results", "knowledge_graph"]`) so the model's context stays small. `search_metadata` is always included.

## Results

A tool result is one text block: a one-line summary, a blank line, then the API's JSON response unchanged.

```
Google Search for "espresso machine": 10 organic results; also knowledge_graph, related_questions, ai_overview. Free allowance: 24 of 25 google_search calls left today (no API key set).

{"search_metadata":{...},"search_parameters":{...},"organic_results":[...],...}
```

The same JSON is also returned as `structuredContent` for clients that read it.

## Limits and errors

| What happened                            | Tool result                                                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily allowance for that tool is used up | Error text naming the tool and the limit, when it resets (00:00 UTC), and how to add a key                                                   |
| A keyless call is already in flight      | The server waits for the API's `Retry-After` (a few seconds) and retries up to twice before reporting the limit                              |
| A key-only tool was called without a key | Error text naming the tool and the free alternatives, and how to add a key; only the free tool lookup is made                                |
| The upstream page could not be fetched   | Error text with the API's `error_code`, HTTP status and `request_id`; retryable failures are retried twice, and failed calls are not charged |
| Invalid arguments                        | Rejected by the API with its `error_code` and a message naming the argument; not charged                                                     |

Requests time out after 120 seconds by default (the API's own deadline is 90 seconds). AI Mode is the slowest tool.

## Configuration

| Environment variable    | Default                      | Meaning                                            |
| ----------------------- | ---------------------------- | -------------------------------------------------- |
| `LITESCRAPE_API_KEY`    | unset                        | Bearer key; unset means the free keyless allowance |
| `LITESCRAPE_API_URL`    | `https://api.litescrape.com` | API origin, for self-hosted or staging deployments |
| `LITESCRAPE_TIMEOUT_MS` | `120000`                     | Per-request timeout in milliseconds                |

### Streamable HTTP mode

`litescrape-mcp-server --http` (or `LITESCRAPE_MCP_TRANSPORT=http`) serves MCP over HTTP instead of stdio: stateless `POST /mcp`, `GET /healthz`, listening on `PORT` (default 8080) and `HOST` (default `0.0.0.0`), or `--port` and `--host`. Each request's API key comes from its `Authorization: Bearer` header or `?api_key=` query parameter, so one process serves keyed and keyless callers; `LITESCRAPE_API_KEY` is ignored in this mode. This is what runs at `https://mcp.litescrape.com/mcp`.

Behind a shared address, keyless callers would all count against one allowance. `LITESCRAPE_KEYLESS_PROXY_SECRET` is the secret the Litescrape API shares with its own hosted endpoint for forwarding each caller's address, and `LITESCRAPE_EDGE_SECRET` is the value Cloudflare adds in front of that endpoint so the caller can be read from `CF-Connecting-IP`. Neither is needed for a private deployment, where the server's own address is metered.

```
docker build -t litescrape-mcp-server . && docker run -p 8080:8080 litescrape-mcp-server --http
```

Every request identifies itself with `X-Litescrape-Client: mcp/<version>` and a `litescrape-mcp-server/<version>` user agent. Arguments travel in a `GET` query string, except for endpoints that only take a JSON body and for calls with an array or object argument or a value over 2,048 characters, which are sent as a JSON `POST`. The server writes protocol messages to stdout and its logs to stderr.

## Development

```
npm install
npm run lint       # prettier + tsc
npm test           # vitest, including real stdio and HTTP round trips
npm run build      # tsc -> dist/
npm run inspector  # MCP Inspector against dist/index.js
```

`npm run dev` runs the server from source with tsx. Releases are tagged with the package version (for example `0.1.0`); the publish workflow builds and publishes to npm with provenance.

## License

[MIT](LICENSE)
