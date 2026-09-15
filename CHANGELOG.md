# Changelog

## [0.2.1] - 2026-09-15

### Changed

- HTTP mode behind Cloudflare: with `LITESCRAPE_EDGE_SECRET` set, the caller
  forwarded to the API is `CF-Connecting-IP` from requests that carry the
  secret Cloudflare's transform rule adds, and nothing is forwarded for a
  request that reached the server directly. Without the variable, behaviour
  is unchanged. This is what `mcp.litescrape.com` runs.

## [0.2.0] - 2026-09-15

### Added

- `google_reviews`: the Google Maps reviews of one place by `place_id` or
  `data_id`, with sorting, topic and text filters and `next_page_token`
  pagination. Needs an API key.
- Streamable HTTP mode: `litescrape-mcp-server --http` (or
  `LITESCRAPE_MCP_TRANSPORT=http`) serves stateless MCP on `POST /mcp` with a
  `/healthz` check. The API key comes from each request's
  `Authorization: Bearer` header or `?api_key=` query parameter, so one
  process serves keyed and keyless callers. This is what runs at
  `https://mcp.litescrape.com/mcp`.
- `LITESCRAPE_KEYLESS_PROXY_SECRET`: in HTTP mode, forwards each caller's
  address to the API under the secret shared with it, so the free allowance
  is metered per caller rather than per hosted server.

## [0.1.1] - 2026-09-15

### Changed

- Releases are published from GitHub Actions with an npm provenance
  attestation, so the package on npm can be verified against this repository
  and its release tag. No functional changes.

## [0.1.0] - 2026-09-14

### Added

- First release. `npx -y litescrape-mcp-server` gives any MCP client Google
  Search, Bing, DuckDuckGo and Google Maps results with no API key, from a free
  daily allowance per network, plus Google AI Mode, Google AI Overview and
  Google Shopping with a `LITESCRAPE_API_KEY`. Every tool returns the API's JSON
  unchanged after a one-line summary, with `result_groups` to keep only the
  groups you need.
