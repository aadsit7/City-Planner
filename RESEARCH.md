# Live research (web search) setup

By default the City Trip Intelligence Planner answers from the model's training
knowledge — it has **no web access**, so it can't pull *current* event dates,
advisories, transit disruptions, or prices. This is a hard limit of the built-in
`window.claude.complete` helper the app falls back to: it takes text in and
returns text out, with no search tool.

To turn on **genuine live research**, deploy the bundled Cloudflare Worker
(`worker.js`). It holds your Anthropic API key server-side and calls the
Messages API with the `web_search` tool, so every answer is grounded in fresh
web results — and the sources are shown in the chat.

> **Why a server?** The API key must never ship in the browser (`index.html`
> is served to every visitor). The Worker is the server-side seam that keeps the
> key secret. Anyone embedding a key directly in `index.html` would leak it.

## One-time deploy

You need an [Anthropic API key](https://console.anthropic.com/) and a (free)
Cloudflare account.

```bash
# from the repo root
npx wrangler login                       # opens a browser to authorize
npx wrangler deploy                       # deploys worker.js (prints the Worker URL)
npx wrangler secret put ANTHROPIC_API_KEY # paste your key when prompted
```

`wrangler deploy` prints a URL like
`https://city-planner-research.<your-subdomain>.workers.dev`.

## Wire the app to it

Open `index.html`, find `RESEARCH_PROXY`, and paste the Worker URL:

```js
const RESEARCH_PROXY = 'https://city-planner-research.<your-subdomain>.workers.dev';
```

Commit and redeploy the site. That's it — the assistant now searches the web
before answering, and a "Scouted live" badge plus source links appear under
each reply.

To turn live research back off, set `RESEARCH_PROXY = ''` again; the app falls
back to model-knowledge answers with no other changes.

## Configuration

Set as plain vars in `wrangler.toml` (non-secret) or with `wrangler secret put`
(secret):

| Name | Default | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | **Secret, required.** `wrangler secret put ANTHROPIC_API_KEY`. |
| `MODEL` | `claude-opus-4-8` | Any model that supports the `web_search_20260209` tool (Opus 4.8/4.7/4.6, Sonnet 4.6). Drop to `claude-sonnet-4-6` for lower cost. |
| `MAX_SEARCHES` | `5` | Web searches allowed per answer. Higher = more thorough, slower, costlier. |
| `ALLOW_ORIGIN` | `*` | CORS origin. Lock to your site URL once deployed, e.g. `https://your-site.example.com`. |

## Which domains get searched

The **Settings → research sources** list is forwarded to the Worker as the
search allow-list — the model only searches those domains. The shipped defaults
lean toward event sites; for well-rounded travel research, broaden the list to
include official city/airport/government and tourism-board domains (e.g.
`travel.state.gov`, `cdc.gov`, `weather.gov`, the destination's airport and
transit-authority sites). Clear the list entirely to search the open web.

## Cost

Each answer is one Messages API call plus up to `MAX_SEARCHES` web searches.
Web search is billed per search in addition to tokens — see Anthropic's pricing.
Keep `MAX_SEARCHES` modest (3–5) for a good thoroughness/cost balance.
