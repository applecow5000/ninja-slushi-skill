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
edit the app, keep `frontend/` and `docs/` in sync (they're identical now
that the footer with repo-relative links is gone).

## What it does

- **Nothing loads until you search or filter** — the page opens empty with a
  prompt, not all 105 recipes at once; type something, or pick a filter, to
  see results.
- **Typing and clicking filters/serving-size chips never search by
  themselves** — press **Enter** or click **🔍 Search** once you've typed
  something and made whatever selections you want. This is deliberate: you
  can type "guava juice," select the Citrus chip and a serving size, and
  nothing runs until you hit Search, at which point all of it is used
  together for one generation. Only the Sugar-Free toggle still acts
  immediately, since it's a display choice, not a new generation (every
  custom recipe already carries both a regular and a sugar-free ingredient
  list — toggling just switches which one is shown).
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
- **Drink type filters** (creamy, refreshing, fruity, tropical, citrus,
  coffee, cocktail, mocktail — spicy/chocolate/milkshake aren't offered as
  filter chips, though a recipe can still carry those tags and show them as
  pills) — a recipe can carry several tags; selecting more than one tag is
  an OR for dataset filtering (show recipes with *any* selected tag). For a
  **custom build**, selected drink-type chips are hints, not hard
  requirements: up to 2 of them get a real representative ingredient folded
  in (e.g. Citrus adds fresh lime juice) without overriding whatever you
  actually typed ("guava juice" + Citrus keeps guava as the main flavor and
  adds a real citrus ingredient alongside it, rather than one replacing the
  other) — if you select 3+, only 2 are actually used and the card says
  which, rather than forcing an incoherent recipe to satisfy all of them.
- **Difficulty filters** (easy / medium / advanced) — computed automatically
  from ingredient count (≤3 easy, 4–6 medium, 7+ advanced), with a manual
  override for a few recipes whose prep is trickier than their ingredient
  count suggests (e.g. gelatin-stabilized frosé). For dataset search this
  narrows results as usual; for a custom build it's a preference the
  generator tries to land on — if the flavor combo genuinely needs more
  ingredients/prep to be safe, the card says so honestly rather than
  stripping something chemistry-relevant just to hit "easy."
- There's no preset filter — SLUSH / SPIKED SLUSH / FROZEN JUICE / MILKSHAKE
  / FRAPPÉ is decided by the ingredients, and every card (dataset or custom)
  shows which preset to run right in its badge.
- **Servings** (3 / 4 / 6 / 8 / 10, single-select) — only affects
  custom-drink generation (both the AI backend and the offline generator),
  not dataset filtering, since dataset recipes already have a fixed batch.
  This app's reference serving is 6.4 US fl oz, so the batch size is exactly
  `servings × 6.4 oz` — "10" lands right at the machine's real 1.9 L / 64 oz
  single-batch max, and every option is sized to genuinely fit in one pass
  (no serving count here can exceed what the machine can actually hold).
- All filters and the search boxes **combine (AND across facets, OR within a
  facet)** for dataset search, rather than overwriting each other — narrow
  with as many as you like, and "Clear all filters" resets everything at
  once.
- **Dual-unit measurements** — every ingredient quantity shows its metric
  amount plus a parenthetical imperial conversion, on dataset cards and
  custom-built cards alike: volume (ml/L) converts to cups/tbsp/tsp using
  the exact standard US culinary equivalences (1 cup = 240 ml, 1 tbsp =
  15 ml, 1 tsp = 5 ml — shown without a "≈", the way virtually every recipe
  converter shows them), while mass (g) only converts to cups when the
  ingredient matches a known density (sugar, brown sugar, powdered sugar,
  allulose, cocoa powder, salt) and is always flagged "≈" since a
  gram-to-cup conversion is inherently ingredient-specific — if there's no
  known density, it's left metric-only rather than guessing, so this can
  never quietly over/under-dose a conversion. A handful of dataset recipes
  give a range (e.g. "300–800 ml") rather than one number; those convert
  from the midpoint and get an extra "~" to flag it.
- **Estimated ABV for alcoholic drinks** — any SPIKED SLUSH card (dataset,
  AI, or offline-built) shows an estimated batch-wide ABV% and roughly how
  many standard drinks (14 g pure alcohol each) that works out to per this
  app's 6.4 oz (~189 ml) reference serving — the same serving the servings
  selector sizes a batch against, so "per serving" means the same thing
  everywhere. This is computed client-side from the ml quantities already
  in the ingredient list against a small per-spirit/per-premade-alcohol ABV
  table (standard spirits ~40%, triple sec/schnapps/Kahlúa/Irish cream
  lower, wine ~12-13%, beer/cider/seltzer ~5%) — never asked of the AI or
  the offline generator directly, so it can't drift from the actual numbers
  in the recipe.
- **🕘 Recent custom drinks, with starring** — every resolved custom search
  (AI or offline) is saved locally (`localStorage`, per-browser) with its
  query text, filter/serving-size context, and the actual recipes it
  produced. Click an entry to bring back that *exact* result — no
  re-query, no regeneration — which matters because an AI build can vary
  run-to-run even for a similar request; this is how you get back to the
  one you actually liked. Click ⭐ to star an entry so it's never
  auto-evicted (up to 20 unstarred entries are kept; older ones roll off),
  and ✕ to remove one you don't want. This never leaves your browser — it
  doesn't sync across devices and isn't visible to anyone else.
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
  confetti, floating cake/cupcake shapes, dancing unicorns, and a dash of
  Canadian flair (maple leaves, the flag, a beaver, a moose, poutine) — all
  skipped automatically if your OS has "reduce motion" turned on.
- **✨ Custom Drink Creator (built into the search box)** — type a drink idea
  in plain English ("spicy margarita") or list what you have on hand
  ("mango, coconut milk, dark rum") into the same search box above, make any
  filter/serving-size selections, and click Search — it designs 3 custom
  recipes on the spot, shown alongside any dataset matches. There are two
  layers underneath it, and the second one only runs if the first can't
  place it:

  **1. Live backend (optional).** If `CUSTOM_DRINK_API_URL` in `app.js`
  points at a deployed backend (see [`../worker/`](../worker/) for the
  Cloudflare Worker + Gemini setup this repo ships with), the query is sent
  there first — that's real open-vocabulary NLP, so "guava juice" or "a
  Yakult-style yogurt drink" get identified correctly instead of falling
  back to a generic filler, which the offline layer below can't do (it only
  recognizes ingredients in its hardcoded keyword lists). Cards built this
  way carry an "(AI)" tag on their badge. Leave `CUSTOM_DRINK_API_URL` empty
  to skip the network call entirely and always use the offline generator.

  **2. Offline rule-based generator (always available, the fallback).** No
  API key, no network call — a keyword/template matcher (see
  `buildCustomRecipesFromText()` and friends). This is what runs if the
  live backend is unreachable, misconfigured, rate-limited, or simply not
  configured — the feature never just breaks, it just stops being the
  "smarter" version for a while:
  - Recognizes ~16 named drink families (margarita, daiquiri, piña colada,
    mule, mimosa, sangria, painkiller, paloma, mojito, cosmopolitan,
    screwdriver, bloody mary, frappé, milkshake, (spiked) lemonade, iced tea)
    and detects spirits, premade alcohol, dairy, coffee, fruit/juice, and
    soda keywords for anything else. **Every custom build returns exactly 3
    recipes**, whether it's a named drink, a comma-separated ingredient
    list, or an open-ended description: a named family gets "Classic,"
    "Lighter Pour," and "Extra Fruity" variants; "list your ingredients"
    mode (comma-separated, no recognized drink name) gets "Full Mix,"
    "Simplified Twist," and "Solo Highlight" using progressively fewer of
    the listed ingredients; the generic fallback (a description matching no
    named family) gets the same "Classic"/"Lighter Pour"/"Extra Fruity"
    treatment. The 3 variants differ only in mixer ratio and, when
    alcoholic, how much of the *already safe* recommended spirit amount
    they use — never in the sugar dosing formula, which stays identical and
    safe across every variant. The live backend follows the same rule
    (always exactly 3).
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
