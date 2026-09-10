# Custom Drink Backend (Cloudflare Worker)

A small Cloudflare Worker that gives the frontend's Custom Drink Creator
real, open-vocabulary understanding via Google's Gemini API — the frontend's
own offline generator (see `../frontend/app.js`) only recognizes ingredients
in its hardcoded keyword lists, so this is what handles "guava juice" or "a
Yakult-style yogurt drink" correctly instead of falling back to a generic
filler.

**The frontend already points at this Worker's deployed URL and falls back
to the offline generator automatically** if this Worker is unreachable,
misconfigured, or Gemini's free tier is rate-limited — so the site keeps
working even before you finish this setup, and keeps working if Gemini ever
has an outage.

## One-time setup

1. **Get a Gemini API key** (free tier, no credit card): sign in at
   [aistudio.google.com](https://aistudio.google.com) → **Get API key** →
   **Create API key**. Copy it.

2. **Create the Worker** in the [Cloudflare dashboard](https://dash.cloudflare.com)
   (free account): **Workers & Pages → Create → Workers → Create Worker**.
   Name it (e.g. `ninja-slushi-api`) and deploy the placeholder — this gives
   you a URL like `https://ninja-slushi-api.<your-subdomain>.workers.dev`.

3. **Add the Gemini key as a secret** on that Worker: **Settings →
   Variables and Secrets → Add** → name `GEMINI_API_KEY` → type **Secret**
   (encrypted) → paste your key → **Save**. Never put the key directly in
   the code — the Worker reads it from `env.GEMINI_API_KEY` at request time.

4. **Deploy the code**: open the Worker → **Edit code** → replace the
   placeholder with the full contents of [`index.js`](index.js) in this
   folder → **Save and deploy**.

5. **Add rate limiting** so a bot (or an enthusiastic visitor) can't burn
   through your free Gemini quota: on the Worker's route, add a Rate
   Limiting rule (Cloudflare's free plan includes a basic allowance) —
   something like 10 requests/minute per visitor is plenty for a personal
   site.

6. **Point the frontend at your Worker's URL** — it's the
   `CUSTOM_DRINK_API_URL` constant near the top of the "Optional live
   backend" section in `../frontend/app.js` (and mirrored in
   `../docs/app.js`). It's already set to
   `https://ninja-slushi-api.johnny-y-w-wang.workers.dev/` — update it if
   you ever rename or recreate the Worker.

That's it — no ongoing deploy step beyond editing `index.js` in the
dashboard again if you change it (or set up Cloudflare's Git integration
for Workers if you want push-to-deploy for this file too; the frontend's
own deploy via GitHub Pages is unaffected either way).

## How it fits together

```
Browser (GitHub Pages)  --POST {query, inspiration, sugarFree}-->  Worker
                                                                       |
                                                                  reads GEMINI_API_KEY
                                                                       |
                                                                       v
                                                          Gemini API (generateContent)
                                                                       |
                                                          structured JSON recipe(s)
                                                                       |
                        <--{recipes: [...]}------------------------- Worker
Browser renders the recipe(s) the same way it renders offline-built ones
```

- **CORS** is locked to `https://applecow5000.github.io` (and `null`, for
  local `file://` testing) in `ALLOWED_ORIGINS` in `index.js` — update that
  list if you host the frontend somewhere else too.
- **Timeouts**: the Worker gives Gemini 15s; the frontend gives the whole
  round trip 9s before giving up and falling back to the offline generator.
- **Structured output**: the request uses Gemini's `responseSchema` to
  force schema-valid JSON matching the same recipe shape the offline
  generator produces (`RECIPE_ARRAY_SCHEMA` in `index.js`), so the same
  `renderCustomRecipeCard()` on the frontend renders either source
  identically.
- **Debounce**: the frontend waits ~500ms after you stop typing before
  calling this Worker, so it's one call per finished thought, not one per
  keystroke (see `CUSTOM_DEBOUNCE_MS` in `app.js`).

## Cost

Gemini's free tier has no per-token charge; it's capped by requests-per-
minute/day instead (check current limits at
[ai.google.dev/gemini-api/docs/rate-limits](https://ai.google.dev/gemini-api/docs/rate-limits)).
Cloudflare Workers' free tier (100,000 requests/day) covers this easily for
a personal site. The rate-limiting rule in step 5 is what actually protects
you from a spike eating your daily Gemini quota.
