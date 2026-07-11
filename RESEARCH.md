# Lake Tapps Family Event Finder — live research setup

The app (`index.html`) is a chat researcher that finds **current, verified
family activities** near Lake Tapps, WA (ZIP 98391) for a family with a
10-year-old. Its entire research spec — search area, strict past-event
filtering, source priorities, verification levels, and the required output
format — is built in as the default instructions (editable under **Settings →
Researcher instructions**).

Finding *current* events requires real web access. Without it, the app can
only answer from the model's training knowledge — it cannot verify today's
hours, this weekend's sessions, cancellations, or sold-out notices, and it
will say so in its answers. To turn on **genuine live research**, deploy the
bundled Cloudflare Worker (`worker.js`). It holds your Anthropic API key
server-side and calls the Messages API with the `web_search` tool, so every
answer is grounded in fresh web results — and the sources actually used are
shown under each reply.

> **Why a server?** The API key must never ship in the browser (`index.html`
> is served to every visitor). The Worker is the server-side seam that keeps
> the key secret. Anyone embedding a key directly in `index.html` would leak it.

## One-time deploy

You need an [Anthropic API key](https://console.anthropic.com/) and a (free)
Cloudflare account.

```bash
# from the repo root
npx wrangler login                        # opens a browser to authorize
npx wrangler deploy                       # deploys worker.js (prints the Worker URL)
npx wrangler secret put ANTHROPIC_API_KEY # paste your key when prompted
```

`wrangler deploy` prints a URL like
`https://city-planner-research.<your-subdomain>.workers.dev`.

## Wire the app to it

Either open the app and paste the Worker URL under **Settings → Live research
proxy URL**, or set it as the shipped default in `index.html`:

```js
const RESEARCH_PROXY = 'https://city-planner-research.<your-subdomain>.workers.dev';
```

That's it — the researcher now searches the web before answering, a
"Researched live" badge appears on each reply, and answers are filtered
against the real current Pacific time (the app injects the live
America/Los_Angeles clock into every request, so events that already ended
are excluded).

To turn live research back off, clear the proxy URL; the app falls back to
model-knowledge answers and clearly labels them as unverified.

## Configuration

Set as plain vars in `wrangler.toml` (non-secret) or with `wrangler secret put`
(secret):

| Name | Default | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | **Secret, required.** `wrangler secret put ANTHROPIC_API_KEY`. |
| `MODEL` | `claude-opus-4-8` | Any model that supports the `web_search_20260209` tool (Opus 4.8/4.7/4.6, Sonnet 4.6). Drop to `claude-sonnet-4-6` for lower cost. |
| `MAX_SEARCHES` | `8` | Web searches allowed per answer. The research spec cross-checks official sources and hunts for cancellations, so keep this generous. |
| `ALLOW_ORIGIN` | `*` | CORS origin. Lock to your site URL once deployed, e.g. `https://your-site.example.com`. |

## Which domains get searched

By default searches go to the **open web** — the researcher's instructions
already steer it to official city, parks, library, venue, team, and regional
family-calendar sources first, and organizer pages live on domains no fixed
list can predict.

If you want to confine searches to the priority source list (local
governments, libraries, and regional calendars from the spec), turn on
**Settings → Restrict web searches to the priority source list** in the app.
The list is editable there too. Restriction trades coverage for control:
the researcher may be unable to open an organizer's own event page to verify
details.

## Cost

Each answer is one Messages API call plus up to `MAX_SEARCHES` web searches.
Web search is billed per search in addition to tokens — see Anthropic's
pricing. Answers here are long (the spec's output format is thorough), so
expect more output tokens per answer than a typical chat. Lower
`MAX_SEARCHES` or switch `MODEL` to a cheaper model to trim cost, at some
expense of verification depth.
