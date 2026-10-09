# DTU Learn for Life — Bonzai AI Search demo

A static demo of a topic hub page (Wind Energy) with the IO Bonzai Conversational
Search API integrated **directly via the HTTP API** (not the embedded `<script>`
widget used on `profilrejser`), so it can be dropped onto any page type and feel
tailored to that page's content.

## What's here

- `index.html` — a Wind Energy topic page, styled from `lfl-design-spec.md` (dark hero,
  stats bar, resource cards, newsletter block, researcher cards, course grid, footer).
- `assets/js/bonzai-client.js` — thin API client: `StartConversation` /
  `ContinueConversation` against `https://aisearch.iobonzai.com`.
- `assets/js/bonzai-widget.js` — renders the chat UI into any
  `<div data-bonzai-widget data-bonzai-topic="..." data-bonzai-suggestions="a|b|c">`,
  so the same component works on a course page, degree page, event page, etc. —
  just change the data attributes.
- `assets/js/bonzai-config.js` — demo-only credential bar at the bottom of the page.
  Lets you paste in the tenant key + agent ID and stores them in `localStorage` so
  the GitHub Pages demo can go live without committing secrets to the repo.
- `assets/css/styles.css` — design tokens + components extracted from the Figma spec.

## Running locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Then fill in the config bar at the bottom of the page:
- **Tenant key** — from Bonzai admin → *API Keys & documentation* → API KEYS tab
  (`X-API-Key` header, not secret, scopes requests to the tenant).
- **Agent ID** — the UUID of the configured search agent for this tenant.

## How the integration works

1. First message → `POST /api/v1/conversation` with `{ agentId, prompt, conversationContext }`.
   `conversationContext` carries the page's topic so the agent can personalize answers
   (e.g. `{ topic: "Wind Energy at DTU Learn for Life" }`).
2. Follow-up messages → `POST /api/v1/conversation/{conversationId}` with `{ prompt }`.
3. Response contains `answer` plus a `references` array (title/url/page) used to render
   source links under the answer.

Note: the live API currently returns PascalCase JSON keys (`Response`, `Answer`,
`References`) although the published OpenAPI spec documents camelCase — `bonzai-client.js`
normalizes both so the rest of the code can assume camelCase.

## Why API instead of embed script

The embedded `<script>` widget (as used on `profilrejser`) is a fixed, pre-styled
component. Calling the API directly means:
- Full control over styling to match any page's design system.
- Per-page context (topic, suggested questions) baked into the conversation.
- Reusable as a single component across topic hubs, degree pages, single-course
  pages, and event pages — just change `data-bonzai-topic` / `data-bonzai-suggestions`.

## Deploying to GitHub Pages

```bash
git remote add origin <your-repo-url>
git push -u origin main
```

Then enable GitHub Pages on the `main` branch in repo Settings → Pages. CORS on the
Bonzai API is open (`Access-Control-Allow-Origin: *`-equivalent, confirmed via preflight),
so the client-side calls work directly from `*.github.io`.
