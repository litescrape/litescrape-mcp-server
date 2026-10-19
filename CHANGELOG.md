# Changelog

## [0.4.0] - 2026-10-19

### Added

- A tool for every endpoint of the current Litescrape API, 130 new tools in
  all, each named after its route (`/api/amazon/product` is `amazon_product`)
  with that endpoint's parameters and limits: more Google (Images, Local,
  Ads, Jobs, Gemini, Maps posts, photo metadata, popular times, contributor
  reviews, Shopping product and merchant URLs, Play), Bing Images, Maps,
  Shopping and Product, Brave, Baidu, Yandex, Naver, Yahoo, YouTube, the
  Apple App Store and Apple Maps, DuckDuckGo Maps, Tripadvisor, Yelp, Airbnb,
  Eventbrite, Copilot, Amazon, eBay and eleven more retailers, Zillow, Redfin,
  Realtor.com, Apartments.com and Homes.com, Indeed, Glassdoor, Ashby,
  ZipRecruiter and Levels.fyi, TikTok, Instagram, X and Facebook, and
  `web_screenshot`. All of them need an API key; the free keyless tools are
  unchanged.
- `google_search` takes `page_token` (from `pagination.next_page_token`) for
  the next page, and `google_reviews` takes `source_metadata`.
- Arguments that a query string cannot carry (arrays, objects, values over
  2,048 characters) and endpoints that accept only a body are sent as a JSON
  `POST`. Everything else is still a `GET`.

### Changed

- `web_fetch` follows the current API: `respond_with` is `content` (default,
  the main content as Markdown), `markdown`, `html`, `text`, `frontmatter` or
  a `+` combination; `retain_links` and `retain_images` replace `with_links`
  and `with_images`; `respond_timing` replaces `wait_until`; `with_iframe` is
  `true`, `false` or `quoted`. New options include `engine`, `preset`,
  `max_tokens`, `token_budget`, `markdown_chunking`, `set_cookies`,
  `viewport` and `assert_status_code`. Screenshots moved to
  `web_screenshot`.
- The Google `radius` parameter accepts 1 to 1,000 meters (1 to 199 on
  desktop), as the API does.

## [0.3.0] - 2026-09-22

### Added

- `web_fetch`: one public web page rendered in a fresh browser, returned as
  Markdown (default), HTML, plain text or a base64 PNG screenshot, with the
  status code the site returned. Supports target and remove selectors, wait
  conditions, page timeout, locale, user agent, link and image styles,
  iframes and shadow DOM. Needs an API key.

### Changed

- `num` on `search` and `google_search` accepts 1 to 10, the most Google
  returns on one page. Use `start` to page further.

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
