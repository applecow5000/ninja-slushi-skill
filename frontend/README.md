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

- **Search by name or ingredient** — the top search box matches recipe names
  and any word in the ingredient list.
- **"I have these ingredients"** — type a comma-separated list (e.g.
  `rum, pineapple juice`) and it shows recipes containing all of them.
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
