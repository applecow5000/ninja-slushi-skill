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
  ingredientQuery: "",
  activeTags: new Set(),
  activeDifficulties: new Set(),
  sugarFree: false,
};

function normalize(s) {
  return s.toLowerCase().trim();
}

function matchesQuery(recipe, query) {
  if (!query) return true;
  const q = normalize(query);
  if (normalize(recipe.name).includes(q)) return true;
  return recipe.ingredients.some((ing) => normalize(ing).includes(q));
}

function matchesIngredientQuery(recipe, ingredientQuery) {
  if (!ingredientQuery) return true;
  // Split on commas so "vodka, lime" requires all named ingredients present.
  const terms = ingredientQuery
    .split(",")
    .map((t) => normalize(t))
    .filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normalize(recipe.ingredients.join(" | "));
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
      matchesIngredientQuery(r, state.ingredientQuery) &&
      matchesTags(r, state.activeTags) &&
      matchesDifficulty(r, state.activeDifficulties)
  );
}

/* ---------------------------------------------------------------------
 * Rendering
 * ------------------------------------------------------------------- */

const els = {
  query: document.getElementById("query"),
  ingredientQuery: document.getElementById("ingredientQuery"),
  tagFilters: document.getElementById("tagFilters"),
  difficultyFilters: document.getElementById("difficultyFilters"),
  sugarFreeToggle: document.getElementById("sugarFreeToggle"),
  results: document.getElementById("results"),
  resultCount: document.getElementById("resultCount"),
  clearFilters: document.getElementById("clearFilters"),
  presetFilters: document.getElementById("presetFilters"),
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

  els.ingredientQuery.addEventListener("input", (e) => {
    state.ingredientQuery = e.target.value;
    render();
  });

  els.sugarFreeToggle.addEventListener("change", (e) => {
    state.sugarFree = e.target.checked;
    document.body.classList.toggle("sugar-free-mode", state.sugarFree);
    render();
  });

  els.clearFilters.addEventListener("click", () => {
    state.query = "";
    state.ingredientQuery = "";
    state.activeTags.clear();
    state.activeDifficulties.clear();
    state.activePresets.clear();
    els.query.value = "";
    els.ingredientQuery.value = "";
    document.querySelectorAll(".chip.active").forEach((c) => {
      c.classList.remove("active");
      c.setAttribute("aria-pressed", "false");
    });
    render();
  });

  render();
}

document.addEventListener("DOMContentLoaded", init);
