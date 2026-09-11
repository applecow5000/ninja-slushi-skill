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
  custom-drink generation, never dataset recipes, which always show their
  original as-authored batch. This app's reference serving is 6.4 US fl oz,
  so a custom build's batch size is exactly `servings × 6.4 oz` — "10"
  lands right at the machine's real 1.9 L / 64 oz single-batch max, and
  every option is sized to genuinely fit in one pass.
- **🍹 Buzz level** (5 single-select "radial" stops — left end says "🥴 I
  want to feel a lil buzz," right end says "🥴🥴🥴🥴🥴 I don't know what's
  going on anymore") — only affects alcoholic custom builds, never dataset
  recipes. Each stop targets a real batch-wide ABV% (5/6/7/8/9%,
  backend-only — never shown in the UI) rather than a fixed spirit volume,
  which fixes a real bug: 120 ml of 40% tequila in a 1.2 L batch is
  actually ~4% ABV (120 × 0.40 ÷ 1200), not ~10% (120 ÷ 1200) — every ABV
  calculation in this app, generation-time or the ABV badge on a card,
  goes through the same real-strength math (`applyAbvTargetToLines()`), so
  they can never disagree with each other. Every stop is always fully
  reachable — all 5 sit comfortably inside the machine's real 2.8%-16% ABV
  freezing range regardless of whether the alcohol is a spirit or a
  premade bottle.
- **Servings and Buzz level adjust an already-shown custom build directly**
  — move either one after a custom recipe is on screen and its
  ratios/volume update immediately, no re-search and no new AI call (the
  same rescale math runs client-side on whatever's already showing,
  offline- or AI-built alike). Dataset recipes are never touched by either
  selector, and drink-type/difficulty selections never touch an
  already-shown custom build either — they only ever apply to the *next*
  fresh search. All custom builds start at the leftmost buzz level
  (mildest) by default.
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
- **Estimated Brix on every card** (dataset, AI, or offline-built) —
  the community's real sweet spot for texture is a tighter ~13-15 Brix
  (13-15% dissolved sugar by weight) than the machine's bare ~4% freezing
  floor, so every card shows an estimate and flags it when it's outside
  that window (dataset recipes show their own real number, which can
  legitimately fall outside it — only custom builds actively target it).
  Estimated the same way as ABV: from the real sugar content already in
  the ingredient list (explicit sugar/allulose/syrup amounts, plus a
  reasonable assumed natural-sugar content for juice/soda/dairy), never
  asked of the AI directly. Custom builds solve for this target directly
  when adding sugar (replacing an old flat "9% of batch weight" guess that
  could land well outside 13-15 depending on the base), and a defensive
  clamp catches an AI response suggesting an absurd amount of syrup for
  the batch size regardless of how it got there.
- **Fixed a real gap in the Brix correction**: `applyBrixTargetToLines()`
  (the pass that re-targets Brix on every custom recipe, AI or offline,
  after ABV/serving-size adjustments) would leave a recipe with NO sugar
  line entirely alone — meaning an AI response that forgot sugar (e.g. a
  ginger beer + whiskey + lime combo with nothing else) kept whatever
  low Brix the natural sugar alone produced, since there was no existing
  sugar line to rescale. It now adds a real sugar line when one is
  genuinely needed and none exists, exactly like the offline generator's
  `ensureSugar()` already did — and since the sugar-free variant is always
  re-derived from the final ingredient list, that newly-added sugar
  automatically becomes an allulose line in Sugar-Free mode too, with no
  extra logic needed.
- **Fixed a real word-collision bug in the ABV/Brix math**: "gin" (the
  spirit) was matching as a plain substring inside "ginger" — meaning
  "ginger ale"/"ginger beer" (both extremely common mixers in this exact
  app) got miscounted as alcohol, corrupting the ABV, the batch total, and
  the ingredient ratios for anything built around them (a Moscow Mule, a
  Whiskey & Ginger, ...). Separately, "beer" (a real premade-alcohol
  keyword) was matching inside "ginger beer"/"root beer," which really are
  non-alcoholic sodas that happen to contain that word. All keyword
  matching now requires a real word boundary (`\bgin\b`, not just
  "contains gin somewhere"), so a short keyword can never misfire inside a
  longer, unrelated word again.
- **Lime/lemon are treated as a sour accent, not a base juice** — earlier
  custom builds could call for 80%+ straight lime or lemon juice (plus a
  large sugar dose to compensate for how sour that actually is) whenever
  lime/lemon was the only detected flavor, which isn't a realistic recipe.
  They're now capped to a small splash (water fills the rest) unless
  they're part of a named family (margarita, daiquiri, ...) that already
  specifies its own realistic ratio. "Limeade"/"spiked limeade" are also
  now recognized as their own already-balanced, already-sweetened mixer
  (the lime counterpart to the existing lemonade family), instead of
  "limeade" being parsed as if you'd asked for straight lime juice.
- The AI backend is now explicitly instructed to always use metric
  ml/g units in an exact "<number> ml/g <name>" format (never a range,
  "to taste," or an imperial unit) — the client-side math depends on
  parsing that exact shape — and the client itself now has a fallback
  parser for oz/cup/tbsp/tsp as a defense-in-depth measure if it ever
  slips. Also strengthened the prompt to explicitly forbid returning a
  single-serving/single-glass recipe when a full batch size was requested.
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
  - `sugar` → `allulose (granulated)`, scaled ÷1.9 (not the ~1.33x taste-
    equivalence ratio you'd use to match sweetness — allulose depresses
    freezing point ~1.9x as hard per gram as real sugar, so dividing by
    that factor is what actually lands the swap in allulose's own ~5-8
    Brix ideal instead of overshooting it; see the allulose section
    below). Handles a shared-unit range quantity (`36–65 g sugar`) by
    scaling both ends, not just one.
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
    topped up to land at ~13-15 Brix, computed from whatever natural sugar
    is already estimated in the mix — so a savory request like a Bloody
    Mary still gets the sugar it needs to freeze, correctly noted as such.
  - "Spicy" triggers a real jalapeño infusion prep step (ratio + steep time)
    on the spirit, or a chili-syrup method for mocktails; a mentioned herb
    (mint, basil, rosemary, ...) always becomes its own small syrup
    infusion rather than being (mis)treated as a pourable base — "mojito"
    gets this via its named-family template, and a bare mention like
    "mint, gin" or "mint gin drink" gets the same treatment even without a
    recognized drink name.
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
  - **Allulose gets its own, lower Brix target — not the same 13-15 as
    sugar**: allulose is ~70% as sweet as sugar by weight (the ~1.33x
    ratio you'd use for a taste-only conversion), but for THIS app's
    purposes — freezing chemistry — what matters is that it depresses the
    freezing point roughly ~1.9x as hard per gram, a completely different,
    unrelated property. The sugar→allulose swap (`rewriteIngredientForSugarFree`)
    now converts by dividing by that ~1.9x factor, not multiplying by the
    1.33x taste ratio — multiplying by 1.33x was a real bug: it landed at
    ~1.33×1.9 ≈ 2.5x sugar's actual freezing effect, well past allulose's
    ideal and, combined with any alcohol, could prevent the batch from
    slushing at all. Rather than converting allulose into a single blended
    "effective Brix" number, every Brix calculation now grades a recipe
    against one of TWO windows depending on which sweetener actually
    dominates its (real) sugar mass: sugar's usual ~13-15 ideal, or
    allulose's own, much lower ~5-8 ideal (roughly the sugar window scaled
    down by that ~1.9x factor, widened a bit for margin). Both windows
    share the same four-tier shape — a floor (below it, a low-sugar alert
    that the batch likely won't slush at all), the ideal sweet spot, a
    caution zone (soft/syrupy texture), and a likely-failure zone (freezing
    point may be suppressed below what the machine can reach) — just
    scaled to whichever sweetener is present. `computeSugarLoad()` (used by
    the on-card note, the offline generator's sugar top-up, and every
    custom recipe's Brix correction pass) tracks real sugar mass and how
    much of it is allulose specifically, and `brixWindowFor()` picks the
    matching window off that. Since alcohol independently suppresses
    freezing point too, an allulose-based recipe pushed into caution/
    elevated/failure on ITS window AND carrying a meaningful ABV (≥8%)
    gets an extra ⚠️ high-risk sentence suggesting a fix: reduce the
    alcohol %, reduce the allulose amount, or swap some allulose back for
    real sugar. This applies uniformly everywhere Brix is shown, including
    toggling Sugar-Free mode on a dataset recipe — the card's Brix note
    recomputes (and re-picks its window) against whatever's actually
    displayed, so switching to allulose correctly re-grades the recipe
    against allulose's tighter, lower target instead of judging it by
    sugar's.
  - **Hard limits for allulose-based custom drinks**: the buzz-level radial
    doesn't apply once Sugar-Free mode is on — `currentTargetAbv()` ignores
    the slider entirely and always targets a fixed 3.5% ABV midpoint
    instead (3-4% is the allowed band), and the radial's radios are
    disabled in the UI with a note explaining why. `applyAbvTargetToLines()`
    also enforces a hard ceiling of 175 ml of total poured alcohol for the
    whole pitcher regardless of batch size — for most batch sizes this
    naturally falls out of the 3-4% target anyway, but it still kicks in
    for a large batch paired with a weak-ABV premade (wine, cider, etc.)
    that would otherwise need more volume than that to reach even 3%; the
    cap wins in that conflict, which can mean landing under the 3% floor
    for that edge case rather than exceeding 175 ml. A dedicated
    `buildAlluloseVariant()` builds the Sugar-Free/allulose variant of a
    custom recipe from scratch rather than just relabeling the regular
    variant's numbers: it re-targets ABV under the allulose cap, re-targets
    Brix (still against sugar's window, since the line still says "sugar"
    at that point) so the pre-swap amount is sized for whatever room the
    now much-smaller alcohol pour left, swaps sugar/syrup/sweetened-base
    wording to allulose/diet/unsweetened (dividing by the ~1.9x FPD factor,
    landing directly in allulose's ~5-8 ideal rather than the old, buggy
    ~1.33x taste-ratio multiply), then re-targets Brix once more as a final
    safety pass against whatever window the result actually falls under.
    Also, any typically-sweetened base
    (soda, margarita/daiquiri mix, lemonade, iced tea) gets swapped to its
    diet/unsweetened/sugar-free counterpart (`rewriteIngredientToUnsweetenedBase()`,
    folded into `rewriteIngredientForSugarFree()`) — both so the recipe is
    actually consistent with going sugar-free, and so `computeSugarLoad()`
    stops assuming full-sugar natural-sugar content for a line that no
    longer carries it (any line reading diet/unsweetened/zero sugar/
    sugar-free/no sugar added is counted as 0 natural sugar). Dataset
    recipes still always show their as-authored numbers (per the earlier
    decision that the serving-size/buzz-level selectors never touch them)
    — only their ingredient wording benefits from the diet-base swap when
    Sugar-Free mode is on, not their ABV/volume.

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
