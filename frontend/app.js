"use strict";

/* ---------------------------------------------------------------------
 * Difficulty
 * ------------------------------------------------------------------- */

function computeDifficulty(recipe) {
  if (recipe.difficultyOverride) return recipe.difficultyOverride;
  const n = recipe.ingredients.length;
  if (n <= 3) return "easy";
  if (n <= 6) return "medium";
  return "advanced";
}

/* ---------------------------------------------------------------------
 * Sugar-free rewriter
 *
 * Pattern-matches common sugar ingredients in a recipe's free-text
 * ingredient strings and rewrites them to an allulose equivalent.
 * Allulose is roughly 70% as sweet as table sugar by weight, so the
 * conventional swap is ~1.33x allulose for the same sweetness
 * (e.g. allulose brands recommend ~1 1/3 cup allulose per 1 cup sugar).
 * This is a display-time transform only — it never mutates the
 * underlying recipe data.
 * ------------------------------------------------------------------- */

const ALLULOSE_RATIO = 1.33;

function scaleQuantity(qtyStr, ratio) {
  return qtyStr.replace(/(\d+(?:\.\d+)?)/, (m) => {
    const scaled = parseFloat(m) * ratio;
    // Keep it readable: 1 decimal place, trim trailing .0
    const rounded = Math.round(scaled * 10) / 10;
    return rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toString();
  });
}

// Ordered list of [regex, rewrite(match, originalLine) => newLine].
// First rule that matches a given ingredient line wins.
const SUGAR_FREE_RULES = [
  [
    /^(.*?)(\d+(?:\.\d+)?\s*(?:g|ml|oz|cups?|tbsp|tsp))\s+(granulated |brown |white |light brown |caster )?sugar\b(.*)$/i,
    (mm) => `${mm[1]}${scaleQuantity(mm[2], ALLULOSE_RATIO)} allulose (granulated)${mm[4]}`,
  ],
  [
    /simple syrup/i,
    (_mm, line) =>
      line.replace(/simple syrup/i, "allulose syrup (1:1 allulose:water, heated to dissolve)"),
  ],
  [
    /sweetened condensed milk/i,
    (_mm, line) =>
      line.replace(
        /sweetened condensed milk/i,
        "sugar-free condensed milk (allulose-sweetened, or DIY: 1 can evaporated milk + ~150 g allulose simmered until thickened)"
      ),
  ],
  [
    /\b(chocolate syrup|caramel sauce|caramel syrup|agave|honey)\b/i,
    (mm, line) => line.replace(mm[0], `sugar-free ${mm[0]} (allulose-based; taste and adjust)`),
  ],
  [
    /\bsweetened\b/i,
    (_mm, line) => line.replace(/sweetened/i, "allulose-sweetened"),
  ],
];

function rewriteIngredientForSugarFree(line) {
  for (const [pattern, rewrite] of SUGAR_FREE_RULES) {
    const mm = line.match(pattern);
    if (mm) return rewrite(mm, line);
  }
  return line;
}

function hasAnySugarSignal(recipe) {
  const text = recipe.ingredients.join(" ");
  return /sugar|sweetened|syrup|agave|honey/i.test(text);
}

/* ---------------------------------------------------------------------
 * Search & filter state
 * ------------------------------------------------------------------- */

const state = {
  query: "",
  activeTags: new Set(),
  activeDifficulties: new Set(),
  sugarFree: false,
};

function normalize(s) {
  return s.toLowerCase().trim();
}

// One combined search box: matches the recipe name OR any ingredient line
// against every comma-separated term (so "vodka, lime" or "spicy margarita"
// both work as free-text search over the dataset).
function matchesQuery(recipe, query) {
  if (!query) return true;
  const terms = query
    .split(",")
    .map((t) => normalize(t))
    .filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normalize(`${recipe.name} | ${recipe.ingredients.join(" | ")}`);
  return terms.every((t) => haystack.includes(t));
}

function matchesTags(recipe, activeTags) {
  if (activeTags.size === 0) return true;
  // OR within the tag facet: match if the recipe has ANY selected tag.
  return recipe.tags.some((t) => activeTags.has(t));
}

function matchesDifficulty(recipe, activeDifficulties) {
  if (activeDifficulties.size === 0) return true;
  return activeDifficulties.has(computeDifficulty(recipe));
}

function getFilteredRecipes() {
  return RECIPES.filter(
    (r) =>
      matchesQuery(r, state.query) &&
      matchesTags(r, state.activeTags) &&
      matchesDifficulty(r, state.activeDifficulties)
  );
}

/* ---------------------------------------------------------------------
 * Rendering
 * ------------------------------------------------------------------- */

const els = {
  query: document.getElementById("query"),
  tagFilters: document.getElementById("tagFilters"),
  difficultyFilters: document.getElementById("difficultyFilters"),
  sugarFreeToggle: document.getElementById("sugarFreeToggle"),
  results: document.getElementById("results"),
  resultCount: document.getElementById("resultCount"),
  clearFilters: document.getElementById("clearFilters"),
  presetFilters: document.getElementById("presetFilters"),
  apiKeyBtn: document.getElementById("apiKeyBtn"),
  apiKeyPanel: document.getElementById("apiKeyPanel"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  saveApiKeyBtn: document.getElementById("saveApiKeyBtn"),
  clearApiKeyBtn: document.getElementById("clearApiKeyBtn"),
  customPrompt: document.getElementById("customPrompt"),
  generateCustomBtn: document.getElementById("generateCustomBtn"),
  customStatus: document.getElementById("customStatus"),
  customResults: document.getElementById("customResults"),
};

const DIFFICULTIES = ["easy", "medium", "advanced"];
const PRESETS = ["SLUSH", "SPIKED SLUSH", "FROZEN JUICE", "MILKSHAKE", "FRAPPE"];

function buildChip(label, kind, value) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip";
  chip.textContent = label;
  chip.dataset.kind = kind;
  chip.dataset.value = value;
  chip.setAttribute("aria-pressed", "false");
  chip.addEventListener("click", () => {
    const targetSet =
      kind === "tag" ? state.activeTags : kind === "difficulty" ? state.activeDifficulties : state.activePresets;
    if (targetSet.has(value)) {
      targetSet.delete(value);
      chip.classList.remove("active");
      chip.setAttribute("aria-pressed", "false");
    } else {
      targetSet.add(value);
      chip.classList.add("active");
      chip.setAttribute("aria-pressed", "true");
    }
    render();
  });
  return chip;
}

function initFilterChips() {
  CATEGORY_TAGS.forEach((tag) => {
    els.tagFilters.appendChild(buildChip(capitalize(tag), "tag", tag));
  });
  DIFFICULTIES.forEach((d) => {
    els.difficultyFilters.appendChild(buildChip(capitalize(d), "difficulty", d));
  });
  state.activePresets = new Set();
  PRESETS.forEach((p) => {
    els.presetFilters.appendChild(buildChip(p, "preset", p));
  });
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function matchesPreset(recipe, activePresets) {
  if (!activePresets || activePresets.size === 0) return true;
  return activePresets.has(recipe.preset);
}

function renderRecipeCard(recipe) {
  const card = document.createElement("article");
  card.className = "card";

  const difficulty = computeDifficulty(recipe);

  const header = document.createElement("div");
  header.className = "card-header";
  header.innerHTML = `
    <h3>${escapeHtml(recipe.name)}</h3>
    <span class="badge preset-badge">${escapeHtml(recipe.preset)}</span>
  `;
  card.appendChild(header);

  const meta = document.createElement("div");
  meta.className = "card-meta";
  const sourceLabel = recipe.source === "official" ? "Official Inspiration Guide" : "Community (r/ninjaslushi)";
  meta.innerHTML = `
    <span class="badge difficulty-${difficulty}">${capitalize(difficulty)}</span>
    <span class="badge source-badge">${sourceLabel}</span>
    ${recipe.kid ? '<span class="badge kid-badge">Kid friendly</span>' : ""}
  `;
  card.appendChild(meta);

  if (recipe.tags.length) {
    const tagsRow = document.createElement("div");
    tagsRow.className = "card-tags";
    tagsRow.innerHTML = recipe.tags
      .map((t) => `<span class="tag-pill">${escapeHtml(capitalize(t))}</span>`)
      .join("");
    card.appendChild(tagsRow);
  }

  const ingList = document.createElement("ul");
  ingList.className = "ingredient-list";
  recipe.ingredients.forEach((line) => {
    const li = document.createElement("li");
    const displayLine = state.sugarFree ? rewriteIngredientForSugarFree(line) : line;
    li.textContent = displayLine;
    if (state.sugarFree && displayLine !== line) {
      li.classList.add("sugar-free-adjusted");
    }
    ingList.appendChild(li);
  });
  card.appendChild(ingList);

  const directions = document.createElement("p");
  directions.className = "directions";
  directions.textContent = recipe.directions;
  card.appendChild(directions);

  if (state.sugarFree) {
    const note = recipe.sugarFreeNote;
    const noSugarSignal = !hasAnySugarSignal(recipe);
    if (note || noSugarSignal) {
      const noteEl = document.createElement("p");
      noteEl.className = "sugar-free-note";
      noteEl.textContent =
        note ||
        "This recipe's base likely needs sugar to freeze — if using a diet/zero-sugar version of any soda or juice here, add ~15–20 g granulated allulose per 355 ml to restore the sugar the machine needs.";
      card.appendChild(noteEl);
    }
  }

  if (recipe.url) {
    const link = document.createElement("a");
    link.href = recipe.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "source-link";
    link.textContent = "View original post ↗";
    card.appendChild(link);
  }

  return card;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ---------------------------------------------------------------------
 * Birthday-mode decorations — confetti, drifting cake shapes, and dancing
 * unicorns. Party-mode only (CSS also hides the fields in light/dark, this
 * just avoids doing pointless work), and skipped for reduced motion.
 * ------------------------------------------------------------------- */

const CONFETTI_EMOJI = ["🎉", "🎈", "🎊", "🍬", "🧁", "✨"];
const CAKE_EMOJI = ["🎂", "🍰", "🧁"];
const UNICORN_EMOJI = "🦄";

function prefersReducedMotion() {
  return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function spawnConfetti() {
  const field = document.getElementById("confettiField");
  if (!field || prefersReducedMotion()) return;
  const pieceCount = 22;
  for (let i = 0; i < pieceCount; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.textContent = CONFETTI_EMOJI[i % CONFETTI_EMOJI.length];
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.fontSize = `${0.8 + Math.random() * 0.9}rem`;
    piece.style.animationDuration = `${8 + Math.random() * 10}s`;
    piece.style.animationDelay = `${Math.random() * 12}s`;
    field.appendChild(piece);
  }
}

function spawnCakes() {
  const field = document.getElementById("cakeField");
  if (!field || prefersReducedMotion()) return;
  const pieceCount = 7;
  for (let i = 0; i < pieceCount; i++) {
    const piece = document.createElement("span");
    piece.className = "cake-piece";
    piece.textContent = CAKE_EMOJI[i % CAKE_EMOJI.length];
    piece.style.left = `${Math.random() * 92}%`;
    piece.style.top = `${Math.random() * 90}%`;
    piece.style.fontSize = `${3 + Math.random() * 4}rem`;
    piece.style.animationDuration = `${6 + Math.random() * 6}s`;
    piece.style.animationDelay = `${Math.random() * 4}s`;
    field.appendChild(piece);
  }
}

function spawnUnicorns() {
  const field = document.getElementById("unicornField");
  if (!field || prefersReducedMotion()) return;
  const pieceCount = 5;
  for (let i = 0; i < pieceCount; i++) {
    const piece = document.createElement("span");
    piece.className = "unicorn-piece";
    piece.textContent = UNICORN_EMOJI;
    piece.style.left = `${4 + i * 20 + Math.random() * 8}%`;
    piece.style.bottom = `${2 + Math.random() * 6}%`;
    piece.style.animationDuration = `${2 + Math.random() * 1.5}s`;
    piece.style.animationDelay = `${Math.random() * 2}s`;
    field.appendChild(piece);
  }
}

function clearPartyDecorations() {
  ["confettiField", "cakeField", "unicornField"].forEach((id) => {
    const field = document.getElementById(id);
    if (field) field.innerHTML = "";
  });
}

function spawnPartyDecorations() {
  spawnConfetti();
  spawnCakes();
  spawnUnicorns();
}

/* ---------------------------------------------------------------------
 * Theme switcher — light / dark / party, persisted in localStorage.
 * The <head> also runs a tiny inline copy of this default logic before
 * first paint (see index.html) so there's no flash of the wrong theme.
 * ------------------------------------------------------------------- */

const THEME_STORAGE_KEY = "ninja-slushi-theme";
const THEMES = ["light", "dark", "party"];

function getStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return THEMES.includes(stored) ? stored : "party";
  } catch (e) {
    return "party";
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (e) {
    /* localStorage unavailable (private mode, etc.) — theme just won't persist */
  }
  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.themeChoice === theme);
  });
  clearPartyDecorations();
  if (theme === "party") spawnPartyDecorations();
}

function initThemeSwitcher() {
  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyTheme(btn.dataset.themeChoice));
  });
  applyTheme(getStoredTheme());
}

/* =======================================================================
 * Custom Drink Creator
 *
 * Free-text ("I want a spicy margarita" / "mango, coconut milk, dark rum")
 * goes to Claude (the visitor's own Anthropic API key, called directly from
 * this browser — see the privacy note in the API key panel), constrained by
 * the machine's actual sugar/alcohol chemistry so what comes back is
 * something that will really freeze in a Ninja Slushi, not just a cocktail
 * recipe. A handful of the closest-matching dataset recipes are sent along
 * as style/inspiration reference. Response is a JSON array of 1-3 recipes,
 * each carrying its own pre-computed sugar-free variant (rendered instead
 * of the regular ingredients when the global Sugar-Free toggle is on).
 * ===================================================================== */

const ANTHROPIC_API_KEY_STORAGE = "ninja-slushi-anthropic-key";
const ANTHROPIC_MODEL = "claude-opus-5";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

let lastCustomRecipes = [];

function getStoredApiKey() {
  try {
    return localStorage.getItem(ANTHROPIC_API_KEY_STORAGE) || "";
  } catch (e) {
    return "";
  }
}

function setStoredApiKey(key) {
  try {
    if (key) localStorage.setItem(ANTHROPIC_API_KEY_STORAGE, key);
    else localStorage.removeItem(ANTHROPIC_API_KEY_STORAGE);
  } catch (e) {
    /* localStorage unavailable — key just won't persist across reloads */
  }
}

// The machine's real chemistry, straight from references/sugar-alcohol-and-alerts.md
// and references/additives-and-texture.md, so generated recipes actually freeze.
const MACHINE_CONSTRAINTS_PROMPT = `You are a recipe designer for the Ninja Slushi (FS300/FS301), a countertop frozen-drink maker. It needs sugar or alcohol (or both) to freeze into slush rather than a solid block or thin liquid — you must design every recipe to satisfy these REAL machine constraints:

BATCH SIZE: total liquid must be between 475 ml and 1.9 L.

SUGAR MINIMUM (roughly ≥4% sugar by weight; sugar-free artificial sweeteners like stevia/aspartame/sucralose do NOT count and will fail to freeze):
- 240 ml serving needs ≥8 g sugar
- 355 ml serving needs ≥11 g sugar
- 591 ml serving needs ≥18 g sugar
The community's practical sweet spot for good texture is HIGHER than this legal floor: aim for ~10-15% Brix (sugar) for a cocktail-style recipe. If a base ingredient is tart/low-sugar (e.g. cranberry, black coffee, plain tomato juice), add 15-30 ml syrup/juice or sugar per serving.
Diet soda / sugar-free soda ALONE will not freeze. Exception: in a SPIKED SLUSH recipe the alcohol itself acts as antifreeze, so a diet mixer can work there.

ALCOHOL (SPIKED SLUSH only):
- A premade alcoholic input (wine, beer, hard seltzer, a premade cocktail mix) must be 2.8%-16% ABV, AND still meet the sugar minimum above.
- If adding straight spirits (vodka/tequila/rum/whiskey/gin, ~35-40%+), cap the spirit volume: max 120 ml per 720 ml batch, 180 ml per 1.08 L, 240 ml per 1.44 L, 300 ml per 1.9 L total recipe.
- The community's practical sweet spot for cocktails is ABV ~8-14% total (not the bare legal ceiling of 16%) alongside the ~10-15% Brix sugar target above.
- Too concentrated (over the max) won't freeze at all; too little sugar/alcohol freezes into hard ice instead of slush. If you're unsure, err toward the middle of these windows, not the edges.

NEVER include hot ingredients, ice, or solids (fresh fruit chunks, ice cream, frozen fruit) — everything poured into the machine must be a pourable liquid or a fully dissolved/puréed-and-strained mixture.

SUGAR-FREE VARIANT: allulose is the community's most reliable 1:1-behaving sugar substitute that still lets the machine freeze properly (unlike stevia/aspartame/sucralose, which fail alone). Typical dosing is ~12-18 g granulated (or ~15-22 ml liquid) allulose per 355 ml of base needing sweetening. Every recipe you generate must also include a sugar-free variant that swaps sugar/syrup/condensed-milk-type ingredients for an allulose equivalent at that ratio, with a one-sentence note on why it still freezes.

PREP / INFUSIONS: if the requested flavor needs something not achievable by just pouring liquids together (e.g. a spicy margarita wanting jalapeño heat, an herb or spice infusion, a fruit purée, a flavored syrup), give CONCRETE prep steps with real quantities, ratios, and times (e.g. "Muddle 3 fresh jalapeño slices — seeds removed for less heat, left in for more — into 250 ml tequila. Steep sealed at room temperature 24-48h, tasting after 24h, then strain." or a faster quick-infusion alternative). Never hand-wave prep as "infuse to taste" without a real method.

PRESETS: SLUSH (non-dairy, non-alcoholic sugary drinks), SPIKED SLUSH (any alcoholic drink), FROZEN JUICE (100% juice or premade smoothie), MILKSHAKE (dairy-based, 720 ml+ minimum, dispense within 30 min), FRAPPE (coffee/blended, 720 ml+ minimum, dispense within 30 min).

You'll be given a short list of existing recipes from this machine's recipe database as style/flavor-pairing reference — you may draw on them, remix them, or ignore them and invent something new, whichever best satisfies the request, as long as it respects every constraint above.

Respond with ONLY a raw JSON array (no markdown code fences, no commentary before or after) of 1 to 3 recipe objects — use more than one only when the request is open-ended (e.g. a pile of ingredients with no named drink), not for a specific named request. Each object must have exactly these fields:
{
  "name": "string",
  "preset": "SLUSH" | "SPIKED SLUSH" | "FROZEN JUICE" | "MILKSHAKE" | "FRAPPE",
  "tags": ["array of 1-4 from: creamy, milkshake, refreshing, fruity, spicy, tropical, citrus, coffee, chocolate, cocktail, mocktail"],
  "difficulty": "easy" | "medium" | "advanced",
  "batch_note": "string, e.g. '1.9 L, about 6-8 servings'",
  "prep_steps": ["array of strings for any advance prep/infusion steps; empty array if none needed"],
  "ingredients": ["array of qty + ingredient strings, the regular (full-sugar/full-alcohol) version"],
  "directions": "string: how to combine everything and which preset + temperature bar to run",
  "machine_fit_note": "string: 1-2 sentences on why this hits the machine's sugar/alcohol requirements (cite approx ABV%/Brix% or the relevant rule)",
  "sugar_free_ingredients": ["array of qty + ingredient strings, the allulose-substituted version"],
  "sugar_free_note": "string: what changed for the sugar-free version and why it still freezes",
  "inspired_by": ["array of existing recipe names this drew from, or empty array"]
}`;

// Cheap keyword-overlap scoring against the dataset, just to pick a handful
// of relevant few-shot examples to ground the model — not the "NLP" itself
// (that's Claude's job on the free text), just retrieval.
function pickInspirationRecipes(freeText, limit) {
  const queryWords = normalize(freeText)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  if (queryWords.length === 0) return RECIPES.slice(0, limit);

  const scored = RECIPES.map((r) => {
    const haystack = normalize(`${r.name} ${r.tags.join(" ")} ${r.ingredients.join(" ")}`);
    const score = queryWords.reduce((acc, w) => acc + (haystack.includes(w) ? 1 : 0), 0);
    return { r, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.r);
}

function buildInspirationBlock(freeText) {
  const picks = pickInspirationRecipes(freeText, 6);
  if (picks.length === 0) return "No closely related existing recipes found — invent freely within the constraints above.";
  return picks
    .map(
      (r) =>
        `- ${r.name} (${r.preset}, tags: ${r.tags.join(", ")}): ${r.ingredients.join("; ")}`
    )
    .join("\n");
}

function extractJsonArray(text) {
  // Strip ```json ... ``` fences if the model added them despite instructions.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate);
  } catch (e) {
    // Fall back to the substring between the first [ and last ]
    const start = candidate.indexOf("[");
    const end = candidate.lastIndexOf("]");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw e;
  }
}

function setCustomStatus(message, kind) {
  if (!message) {
    els.customStatus.hidden = true;
    els.customStatus.textContent = "";
    return;
  }
  els.customStatus.hidden = false;
  els.customStatus.textContent = message;
  els.customStatus.className = `custom-status ${kind || ""}`.trim();
}

async function generateCustomDrinks() {
  const freeText = els.customPrompt.value.trim();
  if (!freeText) {
    setCustomStatus("Type what you're craving, or list a few ingredients, first.", "error");
    return;
  }
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    setCustomStatus("Add your Anthropic API key first (🔑 API Key button above).", "error");
    els.apiKeyPanel.hidden = false;
    return;
  }

  els.generateCustomBtn.disabled = true;
  setCustomStatus("✨ Mixing up your custom drink…", "loading");
  els.customResults.innerHTML = "";

  const userMessage = `Existing recipes for reference:\n${buildInspirationBlock(freeText)}\n\nRequest: ${freeText}`;

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        // Required for any direct browser call to the Anthropic API — see
        // the privacy note in the API key panel for what this means.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        system: MACHINE_CONSTRAINTS_PROMPT,
        output_config: { effort: "medium" },
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      let detail = body;
      try {
        detail = JSON.parse(body).error?.message || body;
      } catch (e) {
        /* keep raw body as detail */
      }
      if (response.status === 401) {
        throw new Error("That API key was rejected (401). Double-check it and save again.");
      }
      if (response.status === 429) {
        throw new Error("Rate limited (429) — wait a moment and try again.");
      }
      throw new Error(`Request failed (${response.status}): ${detail}`);
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) throw new Error("No text in the response.");

    const recipes = extractJsonArray(textBlock.text);
    if (!Array.isArray(recipes) || recipes.length === 0) {
      throw new Error("Got a response, but couldn't find any recipes in it.");
    }

    lastCustomRecipes = recipes;
    renderCustomResults();
    setCustomStatus(`✨ Created ${recipes.length} custom recipe${recipes.length === 1 ? "" : "s"}.`, "success");
  } catch (err) {
    setCustomStatus(`Couldn't create a drink: ${err.message}`, "error");
  } finally {
    els.generateCustomBtn.disabled = false;
  }
}

function renderCustomRecipeCard(recipe) {
  const card = document.createElement("article");
  card.className = "card custom-card";

  const header = document.createElement("div");
  header.className = "card-header";
  header.innerHTML = `
    <h3>${escapeHtml(recipe.name || "Custom Drink")}</h3>
    <span class="badge preset-badge">${escapeHtml(recipe.preset || "")}</span>
  `;
  card.appendChild(header);

  const meta = document.createElement("div");
  meta.className = "card-meta";
  const difficulty = recipe.difficulty || "medium";
  meta.innerHTML = `
    <span class="badge difficulty-${escapeHtml(difficulty)}">${escapeHtml(capitalize(difficulty))}</span>
    <span class="badge ai-badge">✨ AI Custom</span>
    ${recipe.batch_note ? `<span class="badge source-badge">${escapeHtml(recipe.batch_note)}</span>` : ""}
  `;
  card.appendChild(meta);

  if (Array.isArray(recipe.tags) && recipe.tags.length) {
    const tagsRow = document.createElement("div");
    tagsRow.className = "card-tags";
    tagsRow.innerHTML = recipe.tags.map((t) => `<span class="tag-pill">${escapeHtml(capitalize(t))}</span>`).join("");
    card.appendChild(tagsRow);
  }

  if (Array.isArray(recipe.prep_steps) && recipe.prep_steps.length) {
    const prepLabel = document.createElement("p");
    prepLabel.className = "prep-label";
    prepLabel.textContent = "Advance prep:";
    card.appendChild(prepLabel);
    const prepList = document.createElement("ol");
    prepList.className = "prep-list";
    recipe.prep_steps.forEach((step) => {
      const li = document.createElement("li");
      li.textContent = step;
      prepList.appendChild(li);
    });
    card.appendChild(prepList);
  }

  const ingredients = state.sugarFree && Array.isArray(recipe.sugar_free_ingredients)
    ? recipe.sugar_free_ingredients
    : recipe.ingredients || [];
  const ingList = document.createElement("ul");
  ingList.className = "ingredient-list";
  ingredients.forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    if (state.sugarFree) li.classList.add("sugar-free-adjusted");
    ingList.appendChild(li);
  });
  card.appendChild(ingList);

  const directions = document.createElement("p");
  directions.className = "directions";
  directions.textContent = recipe.directions || "";
  card.appendChild(directions);

  if (recipe.machine_fit_note) {
    const fitNote = document.createElement("p");
    fitNote.className = "machine-fit-note";
    fitNote.textContent = `⚙️ ${recipe.machine_fit_note}`;
    card.appendChild(fitNote);
  }

  if (state.sugarFree && recipe.sugar_free_note) {
    const noteEl = document.createElement("p");
    noteEl.className = "sugar-free-note";
    noteEl.textContent = recipe.sugar_free_note;
    card.appendChild(noteEl);
  }

  if (Array.isArray(recipe.inspired_by) && recipe.inspired_by.length) {
    const inspired = document.createElement("p");
    inspired.className = "inspired-by";
    inspired.textContent = `Inspired by: ${recipe.inspired_by.join(", ")}`;
    card.appendChild(inspired);
  }

  return card;
}

function renderCustomResults() {
  els.customResults.innerHTML = "";
  lastCustomRecipes.forEach((r) => els.customResults.appendChild(renderCustomRecipeCard(r)));
}

function initCustomDrinkCreator() {
  els.apiKeyInput.value = getStoredApiKey();

  els.apiKeyBtn.addEventListener("click", () => {
    els.apiKeyPanel.hidden = !els.apiKeyPanel.hidden;
  });

  els.saveApiKeyBtn.addEventListener("click", () => {
    setStoredApiKey(els.apiKeyInput.value.trim());
    setCustomStatus("API key saved to this browser.", "success");
    els.apiKeyPanel.hidden = true;
  });

  els.clearApiKeyBtn.addEventListener("click", () => {
    setStoredApiKey("");
    els.apiKeyInput.value = "";
    setCustomStatus("API key cleared.", "success");
  });

  els.generateCustomBtn.addEventListener("click", generateCustomDrinks);
  els.customPrompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      generateCustomDrinks();
    }
  });
}

function render() {
  const filtered = getFilteredRecipes().filter((r) => matchesPreset(r, state.activePresets));
  els.results.innerHTML = "";
  if (filtered.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No recipes match your search and filters. Try clearing some filters.";
    els.results.appendChild(empty);
  } else {
    filtered.forEach((r) => els.results.appendChild(renderRecipeCard(r)));
  }
  els.resultCount.textContent = `${filtered.length} recipe${filtered.length === 1 ? "" : "s"}`;
}

/* ---------------------------------------------------------------------
 * Wiring
 * ------------------------------------------------------------------- */

function init() {
  initThemeSwitcher();
  initFilterChips();

  els.query.addEventListener("input", (e) => {
    state.query = e.target.value;
    render();
  });

  els.sugarFreeToggle.addEventListener("change", (e) => {
    state.sugarFree = e.target.checked;
    document.body.classList.toggle("sugar-free-mode", state.sugarFree);
    render();
    renderCustomResults();
  });

  els.clearFilters.addEventListener("click", () => {
    state.query = "";
    state.activeTags.clear();
    state.activeDifficulties.clear();
    state.activePresets.clear();
    els.query.value = "";
    document.querySelectorAll(".chip.active").forEach((c) => {
      c.classList.remove("active");
      c.setAttribute("aria-pressed", "false");
    });
    render();
  });

  initCustomDrinkCreator();

  render();
}

document.addEventListener("DOMContentLoaded", init);
