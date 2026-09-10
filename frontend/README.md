# Ninja Slushi Recipe Finder (frontend)

A small, dependency-free static web app for browsing the recipes in this repo.

## Run it

No build step, no server required — clone the repo and open the file:

```bash
git clone <this-repo-url>
cd ninja-slushi-skill/frontend
open index.html        # macOS
# or: xdg-open index.html   (Linux)
# or: start index.html      (Windows)
```

Or serve it locally (useful if your browser blocks `file://` access to some
features, or if you want to view it on your phone over LAN):

```bash
cd ninja-slushi-skill/frontend
python3 -m http.server 8000
# then visit http://localhost:8000
```

A copy of this app also lives in [`/docs`](../docs/) at the repo root, since
**GitHub Pages** can only serve from a repo's root or its `/docs` folder (not
an arbitrary path like `frontend/`). Settings → Pages → Deploy from branch →
`master` / `/docs` gives you a hosted link with no local setup at all. If you
edit the app, keep `frontend/` (for local dev) and `docs/` (for the live
Pages site) in sync — `docs/index.html` points its footer links at GitHub
instead of relative repo paths, since Pages only serves the `docs/` folder
in isolation.

## What it does

- **Nothing loads until you search or filter** — the page opens empty with a
  prompt, not all 105 recipes at once; type something, or pick a filter, to
  see results.
- **One search box, two jobs** — it matches recipe names and ingredient lines
  in the dataset (comma-separate multiple terms, e.g. `rum, pineapple juice`,
  to require all of them) **and**, once you've typed at least 3 characters,
  also builds a custom recipe from that same text and appends it into the
  same results grid, clearly labeled "✨ Custom Build." Search for
  "margarita" and you get every dataset margarita *plus* one synthesized to
  your exact phrasing — see the Custom Drink Creator section below for how
  that build is put together. Filtering with the chips alone (no typed text)
  shows dataset matches only, since there's no text to build a custom drink
  from.
- **Drink type filters** (creamy, milkshake, refreshing, fruity, spicy,
  tropical, citrus, coffee, chocolate, cocktail, mocktail) — a recipe can
  carry several tags; selecting more than one tag is an OR (show recipes with
  *any* selected tag).
- **Difficulty filters** (easy / medium / advanced) — computed automatically
  from ingredient count (≤3 easy, 4–6 medium, 7+ advanced), with a manual
  override for a few recipes whose prep is trickier than their ingredient
  count suggests (e.g. gelatin-stabilized frosé).
- **Preset filters** (SLUSH / SPIKED SLUSH / FROZEN JUICE / MILKSHAKE / FRAPPÉ).
- All filters and the search boxes **combine (AND across facets, OR within a
  facet)** rather than overwriting each other — narrow with as many as you
  like, and "Clear all filters" resets everything at once.
- **Sugar-Free mode** — a toggle that rewrites sugar ingredients on the fly:
  - `sugar` → `allulose (granulated)`, scaled ×1.33 (allulose is ~70% as
    sweet as sugar by weight, so the common conversion is about 1⅓ cups
    allulose per 1 cup sugar).
  - `simple syrup` → an allulose syrup note.
  - `sweetened condensed milk` → a sugar-free condensed milk substitute note.
  - `chocolate syrup` / `caramel sauce` / `agave` / `honey` → flagged as
    "use a sugar-free version, taste and adjust" (amounts vary too much to
    auto-scale reliably).
  - Recipes with no sugar ingredient at all (plain soda/juice bases) get a
    note reminding you to use a diet/zero-sugar base *and* add allulose,
    since diet soda alone won't freeze (per the machine's sugar requirement —
    see `../references/sugar-alcohol-and-alerts.md`).
  - This is a **display-time transform**, not a scientific guarantee — always
    taste and adjust; allulose behaves slightly differently from sugar in
    freezing point and mouthfeel.
- **Three themes** — ☀️ Light, 🌙 Dark, and 🎉 Party (the default) — switchable
  any time from the buttons at the top of the page. Your choice is remembered
  (`localStorage`) and applied before the page paints, so there's no flash of
  the wrong theme on reload. Light and Dark stay clean and colorful but calm;
  Party adds a bobbing-balloon header, an animated rainbow title, drifting
  confetti, floating cake/cupcake shapes, and dancing unicorns — all skipped
  automatically if your OS has "reduce motion" turned on.
- **✨ Custom Drink Creator (built into the search box)** — type a drink idea
  in plain English ("spicy margarita") or list what you have on hand
  ("mango, coconut milk, dark rum") into the same search box above, and it
  designs one or two custom recipes on the spot, shown alongside any dataset
  matches. **Fully offline, no API key, no network call** — it's a
  rule-based keyword/template matcher (see `buildCustomRecipesFromText()`
  and friends in `app.js`), not a live model call:
  - Recognizes ~16 named drink families (margarita, daiquiri, piña colada,
    mule, mimosa, sangria, painkiller, paloma, mojito, cosmopolitan,
    screwdriver, bloody mary, frappé, milkshake, (spiked) lemonade, iced tea)
    and detects spirits, premade alcohol, dairy, coffee, fruit/juice, and
    soda keywords for anything else, including a "list your ingredients"
    mode (comma-separated, no recognized drink name) that builds one or two
    variants — "Full Mix" and a "Simplified Twist" leaving an ingredient or
    two out — since **multiple results are fine** when the request is
    open-ended.
  - Every recipe is sized against the machine's real chemistry from
    `../references/sugar-alcohol-and-alerts.md`: batch 475 ml–1.9 L, straight
    spirits capped per the official ml-per-batch-size table (recommended at
    ~85% of the max, landing in the community's tighter ~8-14% ABV sweet
    spot), premade alcohol flagged for the 2.8-16% ABV rule, and sugar
    topped up (~9% of batch weight) whenever nothing in the mix already
    looks sweet — so a savory request like a Bloody Mary still gets the
    sugar it needs to freeze, correctly noted as such.
  - "Spicy" triggers a real jalapeño infusion prep step (ratio + steep time)
    on the spirit, or a chili-syrup method for mocktails; "mojito" gets a
    mint-syrup prep step the same way.
  - "Mocktail" / "virgin" / "kid friendly" swaps any alcoholic family to its
    non-alcoholic form (SLUSH preset, zero-proof spirit noted), matching how
    the official docs themselves describe mocktail conversions.
  - Its sugar-free variant reuses the exact same `rewriteIngredientForSugarFree()`
    used for the dataset, so it's consistent with the rest of the app, and
    typing "sugar free" / "diet" in the box auto-enables the Sugar-Free
    toggle for you.
  - A handful of the closest-matching dataset recipes (simple keyword-overlap
    scoring) are credited under "Inspired by."
  - This is a heuristic, not a chemistry simulator — always taste and adjust,
    and treat the generated ratios as a solid starting point, not gospel.

## Adding / editing recipes

All recipe data lives in `recipes-data.js` as a plain JS array — no build
tooling, just edit and reload. Each recipe looks like:

```js
{
  id: "my-recipe",
  name: "My Recipe",
  preset: "SLUSH",                 // SLUSH | SPIKED SLUSH | FROZEN JUICE | MILKSHAKE | FRAPPE
  source: "community",             // "official" | "community"
  tags: ["fruity", "refreshing"],  // any of CATEGORY_TAGS
  kid: false,                      // optional
  ingredients: ["600 ml soda", "50 g granulated sugar"],
  directions: "Pour in and run SLUSH.",
  sugarFreeNote: "optional extra note shown only in Sugar-Free mode",
  difficultyOverride: "advanced",  // optional, skips the automatic ingredient-count rule
  url: "https://...",              // optional source link
}
```

The dataset currently covers 105 recipes curated from
[`../references/official-recipes.md`](../references/official-recipes.md) and
[`../references/community-recipes.md`](../references/community-recipes.md),
including the official "Create Your Own" builder-chart combos expanded into
individual recipes. A handful of near-duplicate variants (e.g. multiple
posted ratios for the same drink) and a few "to taste, no real quantities"
entries were deliberately left out — add them the same way if you want them.
