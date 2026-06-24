/**
 * City Trip Intelligence Planner — live-research proxy (Cloudflare Worker).
 *
 * Why this exists
 * ---------------
 * The web app's built-in answer helper (window.claude.complete) answers only
 * from the model's training knowledge — it has no web access. To genuinely
 * research a city + date (current events, festival dates, advisories, transit
 * disruptions, prices), the request has to reach the Anthropic Messages API
 * with the web_search tool enabled. That requires an API key, which must never
 * ship in the browser. This Worker is the server-side seam: it holds the key
 * as a secret, runs the search, and returns a grounded answer plus the source
 * URLs the model actually used.
 *
 * Deploy (see RESEARCH.md for the full walkthrough)
 * -------------------------------------------------
 *   wrangler deploy
 *   wrangler secret put ANTHROPIC_API_KEY      # paste your key when prompted
 * Then paste the Worker URL into RESEARCH_PROXY in index.html.
 *
 * Request  (POST, JSON body):
 *   { system: string, messages: [{role, content}], allowedDomains?: string[], maxTokens?: number }
 * Response (JSON):
 *   { reply: string, sources: string[] }            // 200
 *   { error: string }                               // 4xx/5xx
 *
 * Config via environment variables (all optional except the secret):
 *   ANTHROPIC_API_KEY  (secret, required)  — your Anthropic API key
 *   MODEL              — model id (default: claude-opus-4-8)
 *   MAX_SEARCHES       — web searches per answer (default: 5)
 *   ALLOW_ORIGIN       — CORS allow-origin (default: "*"; set to your site URL to lock it down)
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
// web_search_20260209 (dynamic filtering) needs Opus 4.8/4.7/4.6 or Sonnet 4.6.
const SEARCH_TOOL_TYPE = 'web_search_20260209';
const MAX_TURNS = 6; // safety cap on the server-tool pause/resume loop

export default {
  async fetch(request, env) {
    const allowOrigin = env.ALLOW_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, cors);
    }
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: 'Server is missing ANTHROPIC_API_KEY' }, 500, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400, cors);
    }

    const system = typeof body.system === 'string' ? body.system : '';
    const incoming = Array.isArray(body.messages) ? body.messages : [];
    const messages = incoming
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content)
      .map(m => ({ role: m.role, content: String(m.content) }));
    if (!messages.length) {
      return json({ error: 'No messages provided' }, 400, cors);
    }

    const model = env.MODEL || 'claude-opus-4-8';
    const maxUses = Number(env.MAX_SEARCHES) || 5;
    const maxTokens = Math.min(Math.max(Number(body.maxTokens) || 1500, 256), 8000);

    const tool = { type: SEARCH_TOOL_TYPE, name: 'web_search', max_uses: maxUses };
    const allowedDomains = Array.isArray(body.allowedDomains)
      ? body.allowedDomains.filter(d => typeof d === 'string' && d.trim()).map(d => d.trim())
      : [];
    if (allowedDomains.length) tool.allowed_domains = allowedDomains;

    // Server-tool loop: the Messages API runs the search server-side. If it
    // pauses (pause_turn) after a batch of searches, echo the assistant turn
    // back and continue until it finishes or we hit the turn cap.
    const convo = messages.slice();
    const sources = new Set();
    let replyText = '';

    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const req = {
          model,
          max_tokens: maxTokens,
          tools: [tool],
          messages: convo,
        };
        if (system) req.system = system;

        const resp = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': API_VERSION,
          },
          body: JSON.stringify(req),
        });

        if (!resp.ok) {
          const detail = await resp.text();
          return json({ error: 'Anthropic API error ' + resp.status, detail }, 502, cors);
        }

        const data = await resp.json();
        const content = Array.isArray(data.content) ? data.content : [];

        for (const block of content) {
          if (!block || typeof block !== 'object') continue;
          if (block.type === 'text' && typeof block.text === 'string') {
            replyText += block.text;
            // Citations on the text block point at the pages actually used.
            if (Array.isArray(block.citations)) {
              for (const c of block.citations) {
                if (c && typeof c.url === 'string') sources.add(c.url);
              }
            }
          } else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
            for (const r of block.content) {
              if (r && typeof r.url === 'string') sources.add(r.url);
            }
          }
        }

        if (data.stop_reason === 'pause_turn') {
          // Resume: the API detects the trailing server_tool_use and continues.
          convo.push({ role: 'assistant', content });
          continue;
        }
        break;
      }
    } catch (err) {
      return json({ error: 'Proxy request failed: ' + (err && err.message || err) }, 502, cors);
    }

    return json({ reply: replyText.trim(), sources: Array.from(sources).slice(0, 8) }, 200, cors);
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
