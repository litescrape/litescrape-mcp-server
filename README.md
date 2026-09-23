# Litescrape MCP Server

Google Search, Bing, DuckDuckGo and Google Maps results for any MCP client, free and without an API key. Add a key for Google AI Mode, Google AI Overview, Google Shopping and Google Reviews, and to lift every limit.

Results come straight from the search engines' own pages as structured JSON, through the [Litescrape API](https://litescrape.com). Links are real destinations, never redirects, and nothing is cached: every call runs fresh.

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
| `search`            | Google organic results in fast mode (title, link, snippet); shares the `google_search` allowance                                         | 25                                 |
| `google_search`     | The full Google results page: organic results, Knowledge Graph, AI Overview, ads, related questions and every other module Google served | 25                                 |
| `bing_search`       | Bing organic results, answer boxes, Knowledge Graph, Copilot answer and more                                                             | 50                                 |
| `duckduckgo_search` | DuckDuckGo organic results with region, safety and date filters                                                                          | 50                                 |
| `google_maps`       | Google Maps places (name, address, rating, hours, phone, website, coordinates) or one exact place                                        | 50                                 |

One call runs at a time per network, and failed calls never count. When a limit is reached, the tool result says so and tells the model exactly how to add a key, so the agent can relay it to you.

## Add an API key

A key unlocks `google_ai_mode`, `google_ai_overview`, `google_shopping`, `google_reviews` and `web_fetch`, removes the daily limits and allows concurrent calls. Get one at [litescrape.com](https://litescrape.com), then set `LITESCRAPE_API_KEY` in the server's environment:

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

| Tool                 | Key needed | What it does                                                                                                                                                                                                                                                           |
| -------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search`             | No         | Web search through Google, organic results only. Parameters: `q`, `gl`, `hl`, `location`, `num`, `start`                                                                                                                                                               |
| `google_search`      | No         | Full Google Search page. Localization (`gl`, `hl`, `location`, `uule`, `lat`/`lon`), verticals (`tbm`: news, videos, local, shopping, patents), date filters (`tbs`, `as_qdr`), site restriction (`as_sitesearch`), pagination (`start`, `num`), `device`, `fast_mode` |
| `bing_search`        | No         | Bing web search with `mkt`/`cc`, `location`, `lat`/`lon`, `first`, `safeSearch`, `filters`, `device`                                                                                                                                                                   |
| `duckduckgo_search`  | No         | DuckDuckGo web search with `kl`, `safe`, `df`, `start`, `m`                                                                                                                                                                                                            |
| `google_maps`        | No         | Places by query inside a viewport (`ll`, `location`, `lat`/`lon` with `z` or `m`) with price, rating and opening-hours filters, or one exact place by `place_id`, `data_cid` or `data`                                                                                 |
| `google_ai_overview` | Yes        | Only the AI Overview for a Google search, or `null` when Google shows none                                                                                                                                                                                             |
| `google_ai_mode`     | Yes        | Google AI Mode's generated answer with its cited sources; `continuable` returns a follow-up token, `image_url` adds a picture to the question                                                                                                                          |
| `google_shopping`    | Yes        | The Google Shopping product grid, category blocks, sponsored listings and refinement chips; price, sale, shipping and small-business refinements, `sort_by`, pagination                                                                                                |
| `google_reviews`     | Yes        | The Google Maps reviews of one place by `place_id` or `data_id` (from a `google_maps` result) with `place_info`; `sort_by`, `topic_id` or `query` filters, `num`, and `next_page_token` for the next page                                                              |
| `web_fetch`          | Yes        | One public web page rendered in a fresh browser, as Markdown (default), HTML, text or a base64 PNG screenshot, with the site's `status_code`; `target_selector`, `remove_selector`, `wait_until`, `wait_for_selector`, `page_timeout`, link and image styles. Alpha    |

Parameter names and accepted values follow the [Litescrape API reference](https://litescrape.com/docs).

Every tool accepts `result_groups`, a list of top-level groups to keep (for example `["organic_results", "knowledge_graph"]`) so the model's context stays small. `search_metadata` is always included.

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
| A key-only tool was called without a key | Error text naming the tool and the free alternatives, and how to add a key; no request is made                                               |
| The upstream page could not be fetched   | Error text with the API's `error_code`, HTTP status and `request_id`; retryable failures are retried twice, and failed calls are not charged |
| Invalid arguments                        | Rejected by the tool schema before any request                                                                                               |

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

Every request identifies itself with `X-Litescrape-Client: mcp/<version>` and a `litescrape-mcp-server/<version>` user agent. The server writes protocol messages to stdout and its logs to stderr.

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
