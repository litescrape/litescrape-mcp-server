# Installing litescrape-mcp-server

Instructions for AI agents (Cline, Claude Code, Cursor and similar) that set up MCP servers on a user's behalf.

## What this server is

`litescrape-mcp-server` gives an assistant live search results from Google Search, Bing, DuckDuckGo and Google Maps through the Litescrape API. It works with **no API key and no account**: those four tools come from a free daily allowance per network (25 Google Search calls, 50 each for Bing, DuckDuckGo and Google Maps, one call at a time). Every other tool needs an API key, which also removes the limits: Google AI Mode, AI Overview, Shopping and Reviews, and the rest of the Litescrape catalog (other search engines, maps and reviews, app stores, retailers, real estate, job boards, social media and web page capture), more than 130 tools in all. The server lists only the four free tools plus `find_tools` and `call_tool`; the rest are found and run through those two, so the tool list stays small.

## Requirements

- Node.js 20 or newer (`node --version`).
- Network access to `https://api.litescrape.com`.
- Nothing else: no key, no signup, no build step.

## Setup

Add the server to the client's MCP configuration. It runs over stdio with `npx`, which downloads the package on first use.

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

Client-specific one-liners:

- Claude Code: `claude mcp add litescrape -- npx -y litescrape-mcp-server`
- VS Code: `code --add-mcp '{"name":"litescrape","command":"npx","args":["-y","litescrape-mcp-server"]}'`
- Codex CLI: `codex mcp add litescrape -- npx -y litescrape-mcp-server`
- Gemini CLI: `gemini mcp add litescrape npx -y litescrape-mcp-server`

Do not ask the user for an API key during setup; the server is fully usable without one.

Clients that support remote (Streamable HTTP) servers can use the hosted endpoint instead of running the package: URL `https://mcp.litescrape.com/mcp`, no headers needed. With a key, add the header `Authorization: Bearer ls_live_...`. For example, Claude Code: `claude mcp add --transport http litescrape https://mcp.litescrape.com/mcp`.

## Optional: API key

Only if the user already has a Litescrape API key (`ls_live_...`), or wants a key-only tool or no daily limits, add it as an environment variable:

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

Keys are created at https://litescrape.com. Other optional variables: `LITESCRAPE_API_URL` (default `https://api.litescrape.com`) and `LITESCRAPE_TIMEOUT_MS` (default `120000`).

## Verify

After the client restarts the server, list its tools; expect six: `google_search`, `bing_search`, `duckduckgo_search`, `google_maps`, `find_tools` and `call_tool`. Then call `google_search` with `{"q": "model context protocol", "fast_mode": true}`. A working install returns a one-line summary followed by JSON, for example:

```
Google Search for "model context protocol": 10 organic results. Free allowance: 24 of 25 google_search calls left today (no API key set).

{"search_metadata":{...},"organic_results":[...]}
```

## Troubleshooting

- `google_ai_mode needs a Litescrape API key ...`: expected without a key; the message says how to add one.
- `You've hit Litescrape's free MCP limit ...`: the day's allowance for that tool is spent; it resets at 00:00 UTC, or add a key.
- `Free MCP access runs one request at a time per network ...`: the server already waits and retries; if it persists, calls from this network are overlapping.
- `Could not reach https://api.litescrape.com ...`: no network access from the machine running the server.
- The server logs to stderr only; a line `litescrape-mcp-server <version> ready (keyless mode, ...)` confirms it started.
