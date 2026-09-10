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
 * Dual-unit display (metric + imperial)
 *
 * A pure, display-time transform: it never changes the underlying metric
 * quantity (the number that actually drives sugar/alcohol dosing math
 * elsewhere in this file) — it only appends a parenthetical conversion so
 * nothing here can ever cause an over/under dose, only mis-label one.
 *
 * Volume (ml) uses the exact, universally-used US culinary equivalences
 * (1 cup = 240 ml, 1 tbsp = 15 ml, 1 tsp = 5 ml) and is shown without a
 * "≈" qualifier, matching how virtually every recipe converter presents it.
 *
 * Mass (g) needs an ingredient-specific density to convert to cups, so it's
 * only converted when the ingredient matches a known density, and always
 * shown with "≈" to flag it as an approximation — guessing a density for an
 * unrecognized ingredient would risk exactly the mis-dosing this exists to
 * avoid, so unmatched ingredients are left metric-only instead.
 * ------------------------------------------------------------------- */

const FRACTION_STEPS = [
  [0, ""], [1 / 8, "⅛"], [1 / 4, "¼"], [1 / 3, "⅓"], [3 / 8, "⅜"],
  [1 / 2, "½"], [5 / 8, "⅝"], [2 / 3, "⅔"], [3 / 4, "¾"], [7 / 8, "⅞"], [1, ""],
];

// Rounds a decimal quantity to the nearest 1/8 and renders it as a mixed
// number using unicode fraction glyphs (e.g. 1.33 -> "1 ⅓"), the way a
// printed recipe card would show it rather than a raw decimal.
function formatFraction(value) {
  if (!(value > 0)) return "0";
  let whole = Math.floor(value);
  const frac = value - whole;
  let closest = FRACTION_STEPS[0];
  let closestDiff = Infinity;
  for (const step of FRACTION_STEPS) {
    const diff = Math.abs(frac - step[0]);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = step;
    }
  }
  if (closest[0] === 1) {
    whole += 1;
    return `${whole}`;
  }
  if (whole === 0) return closest[1] || "0";
  return closest[1] ? `${whole} ${closest[1]}` : `${whole}`;
}

function pluralUnit(qty, unit) {
  return Math.abs(qty - 1) < 0.001 ? unit : `${unit}s`;
}

function imperialForVolumeMl(ml) {
  if (!(ml > 0)) return null;
  if (ml >= 60) {
    const cups = ml / 240;
    return `${formatFraction(cups)} ${pluralUnit(cups, "cup")}`;
  }
  if (ml >= 15) {
    const tbsp = ml / 15;
    return `${formatFraction(tbsp)} tbsp`;
  }
  const tsp = ml / 5;
  return `${formatFraction(tsp)} tsp`;
}

// Grams-per-US-cup for ingredients this app actually generates/stores.
// Deliberately small and specific rather than a single "average" density —
// sugar and cocoa powder differ by more than 2x, so a generic number would
// misdose exactly the ingredients (sugar, allulose) this feature most needs
// to get right.
const DENSITY_G_PER_CUP = {
  "powdered sugar": 120,
  "brown sugar": 220,
  "light brown sugar": 220,
  "granulated sugar": 200,
  sugar: 200,
  allulose: 190,
  "cocoa powder": 90,
  salt: 290,
};

function lookupDensity(ingredientName) {
  const t = normalize(ingredientName);
  const keys = Object.keys(DENSITY_G_PER_CUP).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (t.includes(key)) return DENSITY_G_PER_CUP[key];
  }
  return null;
}

function imperialForMassGrams(grams, ingredientName) {
  const density = lookupDensity(ingredientName);
  if (!density) return null; // no known density — stay metric-only rather than guess
  const cups = grams / density;
  return `≈${formatFraction(cups)} ${pluralUnit(cups, "cup")}`;
}

const ML_PER_LITER = 1000;

function unitToMlOrG(value, unit) {
  const u = unit.toLowerCase();
  if (u === "l") return value * ML_PER_LITER;
  return value; // "ml" or "g" pass through as-is
}

// Parses the leading quantity of an ingredient line, including the
// dataset's range formats (e.g. "300–800 ml", "420 ml–1.12 L", "36–65 g")
// as well as a plain single value. Returns { loVal, hiVal, avgVal, unit,
// isRange, rest } in the line's base unit (ml stays ml, L is converted to
// ml, g stays g) — or null if the line doesn't start with a recognizable
// quantity. Used by both addImperialUnits (per-line display) and the ABV/
// batch-size estimators below, so a range recipe converts/estimates from
// the same midpoint everywhere rather than two different guesses.
function parseQuantityToken(line) {
  // Each end of the range carries its own unit, e.g. "420 ml–1.12 L ...".
  let m = line.match(/^(\d+(?:\.\d+)?)\s*(ml|g|l)\s*[–-]\s*(\d+(?:\.\d+)?)\s*(ml|g|l)\b(.*)$/i);
  if (m) {
    const lo = unitToMlOrG(parseFloat(m[1]), m[2]);
    const hi = unitToMlOrG(parseFloat(m[3]), m[4]);
    return { loVal: lo, hiVal: hi, avgVal: (lo + hi) / 2, unit: m[2].toLowerCase() === "l" ? "ml" : m[2].toLowerCase(), isRange: true, rest: m[5] };
  }
  // A single shared unit after the range, e.g. "300–800 ml ...", "36–65 g ...".
  m = line.match(/^(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*(ml|g|l)\b(.*)$/i);
  if (m) {
    const unit = m[3].toLowerCase();
    const lo = unitToMlOrG(parseFloat(m[1]), unit);
    const hi = unitToMlOrG(parseFloat(m[2]), unit);
    return { loVal: lo, hiVal: hi, avgVal: (lo + hi) / 2, unit: unit === "l" ? "ml" : unit, isRange: true, rest: m[4] };
  }
  // A plain single value, e.g. "600 ml ...", "50 g ...", "1.2 L ...".
  m = line.match(/^(\d+(?:\.\d+)?)\s*(ml|g|l)\b(.*)$/i);
  if (m) {
    const unit = m[2].toLowerCase();
    const val = unitToMlOrG(parseFloat(m[1]), unit);
    return { loVal: val, hiVal: val, avgVal: val, unit: unit === "l" ? "ml" : unit, isRange: false, rest: m[3] };
  }
  return null;
}

// Appends an imperial conversion to a "<qty> <unit> <ingredient>" line, if
// one can be computed accurately. Leaves the line untouched otherwise
// (unrecognized units, or a mass ingredient with no known density). Ranges
// are converted from their midpoint and always shown with "~" to flag that
// it's a range being approximated by one number.
function addImperialUnits(line) {
  const parsed = parseQuantityToken(line);
  if (!parsed) return line;
  const approxPrefix = parsed.isRange ? "~" : "";
  if (parsed.unit === "ml") {
    const imperial = imperialForVolumeMl(parsed.avgVal);
    return imperial ? `${line} (${approxPrefix}${imperial})` : line;
  }
  if (parsed.unit === "g") {
    // imperialForMassGrams already prefixes "≈" for the density guess, so a
    // range doesn't need its own extra "~" on top — one approximation
    // marker is enough.
    const imperial = imperialForMassGrams(parsed.avgVal, parsed.rest);
    return imperial ? `${line} (${imperial})` : line;
  }
  return line;
}

/* ---------------------------------------------------------------------
 * ABV estimation (SPIKED SLUSH only)
 *
 * Derived purely from the ml quantities already in an ingredient list and a
 * vetted per-spirit/per-premade-alcohol ABV table below — never from asking
 * the AI or the offline generator to state a number itself, so this stays
 * consistent and trustworthy across both. Assumes a ~240 ml serving (this
 * app's standard reference serving) to translate a batch-wide ABV% into a
 * per-serving standard-drink count.
 * ------------------------------------------------------------------- */

const STANDARD_SERVING_ML = 240;
// 1 US standard drink = 14 g pure ethanol; ethanol density ~0.789 g/ml, so
// 14 / 0.789 ≈ 17.7 ml of pure ethanol per standard drink.
const ML_ETHANOL_PER_STANDARD_DRINK = 17.7;

// Straight-spirit ABV assumptions — most bottled spirits are ~40%, but a
// few common liqueurs are meaningfully lower/higher, so they're called out
// individually rather than assumed flat.
const SPIRIT_ABV = {
  "triple sec": 30,
  cointreau: 40,
  schnapps: 20,
  "kahlúa": 20,
  kahlua: 20,
  "irish cream": 17,
  baileys: 17,
};
const DEFAULT_SPIRIT_ABV = 40; // rum, tequila, vodka, gin, whiskey/whisky, bourbon, brandy, mezcal

function spiritAbvPercent(spiritName) {
  const t = normalize(spiritName);
  const keys = Object.keys(SPIRIT_ABV).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (t.includes(key)) return SPIRIT_ABV[key];
  }
  return DEFAULT_SPIRIT_ABV;
}

const PREMADE_ALCOHOL_ABV = {
  champagne: 12,
  prosecco: 11.5,
  "sparkling wine": 11.5,
  "rosé wine": 12.5,
  "rose wine": 12.5,
  "red wine": 13,
  "white wine": 12.5,
  wine: 12.5,
  "hard seltzer": 5,
  seltzer: 5,
  "hard cider": 5,
  cider: 5,
  beer: 5,
};
const DEFAULT_PREMADE_ABV = 12.5;

function premadeAbvPercent(name) {
  const t = normalize(name);
  const keys = Object.keys(PREMADE_ALCOHOL_ABV).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (t.includes(key)) return PREMADE_ALCOHOL_ABV[key];
  }
  return DEFAULT_PREMADE_ABV;
}

// Sums ml-of-pure-alcohol across every recognized alcoholic ingredient line,
// then expresses it as batch-wide ABV%. Returns null if nothing alcoholic
// was found (so callers know not to show an ABV note at all).
function estimateAbv(ingredientLines, batchMl) {
  if (!(batchMl > 0)) return null;
  let totalEthanolMl = 0;
  let found = false;
  ingredientLines.forEach((line) => {
    const parsed = parseQuantityToken(line);
    if (!parsed || parsed.unit !== "ml") return;
    const qty = parsed.avgVal; // range recipes: estimate from the midpoint
    const t = normalize(parsed.rest);
    const spiritKey = SPIRITS.find((s) => t.includes(s));
    if (spiritKey) {
      found = true;
      totalEthanolMl += qty * (spiritAbvPercent(spiritKey) / 100);
      return;
    }
    const premadeKey = PREMADE_ALCOHOL.find((s) => t.includes(s));
    if (premadeKey) {
      found = true;
      totalEthanolMl += qty * (premadeAbvPercent(premadeKey) / 100);
    }
  });
  if (!found) return null;
  return { abvPercent: (totalEthanolMl / batchMl) * 100, totalEthanolMl };
}

// Sums every ml-quantity ingredient line (midpoint, for range recipes) as a
// rough total batch volume — used for dataset/AI recipes that don't carry
// an explicit batch-size field.
function estimateBatchMlFromLines(lines) {
  let sum = 0;
  lines.forEach((line) => {
    const parsed = parseQuantityToken(line);
    if (parsed && parsed.unit === "ml") sum += parsed.avgVal;
  });
  return sum;
}

function formatAbvNote(ingredientLines, batchMl, servingMl) {
  const est = estimateAbv(ingredientLines, batchMl);
  if (!est) return null;
  const abv = Math.round(est.abvPercent * 10) / 10;
  const ethanolPerServingMl = est.totalEthanolMl * ((servingMl || STANDARD_SERVING_ML) / batchMl);
  const drinks = Math.round((ethanolPerServingMl / ML_ETHANOL_PER_STANDARD_DRINK) * 10) / 10;
  return `Estimated ~${abv}% ABV — about ${drinks} standard drink${drinks === 1 ? "" : "s"} per ~${servingMl || STANDARD_SERVING_ML} ml serving.`;
}

/* ---------------------------------------------------------------------
 * Search & filter state
 * ------------------------------------------------------------------- */

const state = {
  query: "",
  activeTags: new Set(),
  activeDifficulties: new Set(),
  sugarFree: false,
  servingBand: null, // "2-4" | "5-8" | "9-12" | null — overrides batch size for custom builds only
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
  searchBtn: document.getElementById("searchBtn"),
  tagFilters: document.getElementById("tagFilters"),
  difficultyFilters: document.getElementById("difficultyFilters"),
  sugarFreeToggle: document.getElementById("sugarFreeToggle"),
  results: document.getElementById("results"),
  resultCount: document.getElementById("resultCount"),
  clearFilters: document.getElementById("clearFilters"),
  presetFilters: document.getElementById("presetFilters"),
  servingBandFilters: document.getElementById("servingBandFilters"),
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

// Single-select (unlike the multi-select chips above): only one serving
// band applies at a time, since it maps directly to one batch size. Only
// affects custom-drink generation, never dataset filtering.
const SERVING_BAND_OPTIONS = [
  { value: "2-4", label: "2 to 4" },
  { value: "5-8", label: "5 to 8" },
  { value: "9-12", label: "9 to 12" },
];

function initServingBandChips() {
  if (!els.servingBandFilters) return;
  SERVING_BAND_OPTIONS.forEach(({ value, label }) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = label;
    chip.dataset.kind = "servingBand";
    chip.dataset.value = value;
    chip.setAttribute("aria-pressed", "false");
    chip.addEventListener("click", () => {
      const wasActive = state.servingBand === value;
      els.servingBandFilters.querySelectorAll(".chip").forEach((c) => {
        c.classList.remove("active");
        c.setAttribute("aria-pressed", "false");
      });
      state.servingBand = wasActive ? null : value;
      if (!wasActive) {
        chip.classList.add("active");
        chip.setAttribute("aria-pressed", "true");
      }
      // Force the custom build to re-run at the new batch size even if the
      // query text itself hasn't changed.
      customState.query = null;
      render();
    });
    els.servingBandFilters.appendChild(chip);
  });
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
    const sugarFreeLine = state.sugarFree ? rewriteIngredientForSugarFree(line) : line;
    li.textContent = addImperialUnits(sugarFreeLine);
    if (state.sugarFree && sugarFreeLine !== line) {
      li.classList.add("sugar-free-adjusted");
    }
    ingList.appendChild(li);
  });
  card.appendChild(ingList);

  const directions = document.createElement("p");
  directions.className = "directions";
  directions.textContent = recipe.directions;
  card.appendChild(directions);

  if (recipe.preset === "SPIKED SLUSH") {
    const abvNote = formatAbvNote(recipe.ingredients, estimateBatchMlFromLines(recipe.ingredients), STANDARD_SERVING_ML);
    if (abvNote) {
      const abvEl = document.createElement("p");
      abvEl.className = "abv-note";
      abvEl.textContent = `🍸 ${abvNote}`;
      card.appendChild(abvEl);
    }
  }

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
const CANADA_EMOJI = ["🍁", "🇨🇦", "🦫", "🫎", "🍟"];

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

function spawnCanada() {
  const field = document.getElementById("canadaField");
  if (!field || prefersReducedMotion()) return;
  const pieceCount = 5;
  for (let i = 0; i < pieceCount; i++) {
    const piece = document.createElement("span");
    piece.className = "cake-piece";
    piece.textContent = CANADA_EMOJI[i % CANADA_EMOJI.length];
    piece.style.left = `${Math.random() * 92}%`;
    piece.style.top = `${Math.random() * 90}%`;
    piece.style.fontSize = `${2.5 + Math.random() * 3}rem`;
    piece.style.animationDuration = `${6 + Math.random() * 6}s`;
    piece.style.animationDelay = `${Math.random() * 4}s`;
    field.appendChild(piece);
  }
}

function clearPartyDecorations() {
  ["confettiField", "cakeField", "unicornField", "canadaField"].forEach((id) => {
    const field = document.getElementById(id);
    if (field) field.innerHTML = "";
  });
}

function spawnPartyDecorations() {
  spawnConfetti();
  spawnCakes();
  spawnUnicorns();
  spawnCanada();
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
 * Custom drink builder (fully offline, rule-based)
 *
 * Folded into the single search box: whatever you type there both filters
 * the dataset (as before) AND — once it's at least CUSTOM_MIN_QUERY_LENGTH
 * characters — is parsed with keyword/template matching into a synthesized
 * custom recipe, appended into the same results grid. No API key, no
 * network call, works from file://. Free text ("I want a spicy margarita",
 * "mango, coconut milk, dark rum") is matched against a small library of
 * named-drink templates and the machine's real chemistry (see references/
 * sugar-alcohol-and-alerts.md and references/additives-and-texture.md) to
 * size the batch, cap alcohol, and top up sugar so what comes back will
 * actually freeze. Every generated recipe reuses the same
 * rewriteIngredientForSugarFree() used for the dataset, so its sugar-free
 * variant is consistent app-wide, and pickInspirationRecipes() credits the
 * closest dataset matches.
 * ===================================================================== */

// ---- Machine chemistry (see references/sugar-alcohol-and-alerts.md) ----

// ml of straight spirit (~35-40%+ ABV) the machine can handle per batch size.
const MAX_SPIRIT_TABLE = [
  [720, 120],
  [1080, 180],
  [1440, 240],
  [1900, 300],
];

function round5(n) {
  return Math.round(n / 5) * 5;
}

function interpolateSpiritMaxMl(batchMl) {
  const table = MAX_SPIRIT_TABLE;
  if (batchMl <= table[0][0]) return batchMl * (table[0][1] / table[0][0]);
  for (let i = 0; i < table.length - 1; i++) {
    const [x0, y0] = table[i];
    const [x1, y1] = table[i + 1];
    if (batchMl >= x0 && batchMl <= x1) {
      const t = (batchMl - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return table[table.length - 1][1];
}

// Recommend ~85% of the hard cap by default — lands near the community's
// tighter practical ABV window (~8-14%) rather than the bare legal ceiling.
// `factor` lets callers dial a variant lighter (never used to go above the
// default 0.85, only at or below it) without touching the underlying cap
// table — used to vary the "3 custom recipes" flavor profile without ever
// making a variant less safe than the standard recommendation.
function recommendedSpiritMl(batchMl, factor = 0.85) {
  return round5(interpolateSpiritMaxMl(batchMl) * factor);
}

// Heuristic added-sugar target (~9% of batch weight) for a base with no
// inherent sweetness — above the machine's bare ~4% floor, inside the
// community's preferred ~10-15% Brix once combined with any natural sugars
// already in a juice/soda ingredient.
function recommendedSugarGrams(batchMl) {
  return round5(batchMl * 0.09);
}

function hasInherentSweetness(ingredientLines) {
  return /juice|soda|lemonade|nectar|cola|punch|cider|cream of coconut|condensed milk|margarita mix|daiquiri mix|mix\b/i.test(
    ingredientLines.join(" ")
  );
}

// ---- Batch size parsing ----

function parseBatchMl(text) {
  const literMatch = text.match(/(\d+(?:\.\d+)?)\s*(l|liter|litre|liters|litres)\b/i);
  if (literMatch) return clamp(parseFloat(literMatch[1]) * 1000, 475, 1900);
  const mlMatch = text.match(/(\d+(?:\.\d+)?)\s*ml\b/i);
  if (mlMatch) return clamp(parseFloat(mlMatch[1]), 475, 1900);
  const servingsMatch = text.match(/(\d+)\s*(?:-|to)?\s*(\d+)?\s*servings?/i);
  if (servingsMatch) {
    const lo = parseInt(servingsMatch[1], 10);
    const hi = servingsMatch[2] ? parseInt(servingsMatch[2], 10) : lo;
    const avg = (lo + hi) / 2;
    if (avg <= 3) return 720;
    if (avg <= 6) return 1200;
    return 1800;
  }
  return 1200; // default: a solid 4-6 serving batch
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function batchNote(batchMl) {
  const liters = (batchMl / 1000).toFixed(batchMl % 1000 === 0 ? 0 : 1);
  const servings = batchMl <= 720 ? "2-3" : batchMl <= 1440 ? "4-6" : "6-8";
  return `${liters} L, about ${servings} servings`;
}

// ---- Serving-size selector ----
//
// A single-select control (see initServingBandChips()) that, when set,
// overrides the free-text batch-size parsing above for custom builds only
// (it never affects dataset filtering). "9 to 12" is honest about the
// machine's real 1.9 L single-batch ceiling (~7-8 servings at a 240 ml
// reference serving) rather than silently pretending it can do more —
// applyServingBandCaveat() appends a note explaining the batch needs to run
// twice to reach that count.
const SERVING_BANDS = {
  "2-4": { batchMl: 720 },
  "5-8": { batchMl: 1600 },
  "9-12": { batchMl: 1900, exceedsSingleBatch: true },
};

function resolveBatchMl(freeText) {
  const band = state.servingBand && SERVING_BANDS[state.servingBand];
  if (band) return band.batchMl;
  return parseBatchMl(freeText);
}

const SERVING_BAND_CAVEAT =
  "This machine's max single batch is 1.9 L (about 7-8 servings at a ~240 ml serving) — for 9 to 12 servings, run this exact recipe twice back-to-back rather than trying to fit it all in one pass.";

function applyServingBandCaveat(recipes) {
  const band = state.servingBand && SERVING_BANDS[state.servingBand];
  if (!band || !band.exceedsSingleBatch) return recipes;
  return recipes.map((r) => ({
    ...r,
    machine_fit_note: r.machine_fit_note ? `${r.machine_fit_note} ${SERVING_BAND_CAVEAT}` : SERVING_BAND_CAVEAT,
  }));
}

// ---- Keyword vocabularies ----

const MOCKTAIL_KEYWORDS = [
  "mocktail", "virgin", "non-alcoholic", "nonalcoholic", "no alcohol",
  "zero proof", "zero-proof", "alcohol free", "alcohol-free", "kid friendly",
  "kid-friendly", "kids",
];
const SUGAR_FREE_KEYWORDS = ["sugar free", "sugar-free", "diet", "zero sugar", "no sugar", "keto", "low sugar", "low-sugar"];
const SPICY_KEYWORDS = ["spicy", "spice", "chili", "chile", "chilli", "jalapeno", "jalapeño", "habanero", "serrano", "ghost pepper", "cayenne", "hot pepper", "hot sauce"];

const TAG_KEYWORDS = {
  creamy: ["creamy", "cream"],
  milkshake: ["milkshake", "milk shake", "shake", "frosty"],
  refreshing: ["refreshing", "refresh", "light", "crisp", "cooling"],
  fruity: ["fruity", "fruit", "berry"],
  spicy: SPICY_KEYWORDS,
  tropical: ["tropical", "pineapple", "coconut", "mango", "passionfruit", "passion fruit", "piña", "pina"],
  citrus: ["citrus", "lime", "lemon", "orange", "grapefruit"],
  coffee: ["coffee", "espresso", "latte", "frappe", "frappé", "mocha", "cappuccino"],
  chocolate: ["chocolate", "cocoa", "mocha", "fudge"],
  cocktail: ["cocktail"],
  mocktail: MOCKTAIL_KEYWORDS,
};

// Straight spirits (subject to the ml-per-batch cap table)
const SPIRITS = [
  "dark rum", "white rum", "light rum", "spiced rum", "rum",
  "tequila", "vodka", "gin", "whiskey", "whisky", "bourbon", "brandy",
  "mezcal", "triple sec", "cointreau", "schnapps", "kahlúa", "kahlua",
  "irish cream", "baileys",
].sort((a, b) => b.length - a.length);

// Premade alcoholic inputs (subject to the 2.8-16% ABV rule, not the ml cap)
const PREMADE_ALCOHOL = [
  "sparkling wine", "champagne", "prosecco", "rosé wine", "rosé", "rose wine",
  "red wine", "white wine", "wine", "hard seltzer", "seltzer", "hard cider",
  "cider", "beer",
].sort((a, b) => b.length - a.length);

const DAIRY_WORDS = ["condensed milk", "half and half", "half-and-half", "ice cream", "yogurt", "milk", "cream"];
const COFFEE_WORDS = ["cold brew", "espresso", "coffee"];
const SODA_WORDS = ["ginger beer", "ginger ale", "grapefruit soda", "lemon-lime soda", "root beer", "cola", "coke", "pepsi", "sprite", "7up", "dr pepper", "tonic", "soda", "seltzer"];
const JUICE_FRUIT_WORDS = [
  "pineapple", "mango", "strawberry", "cranberry", "watermelon", "passionfruit",
  "passion fruit", "peach", "cherry", "raspberry", "blueberry", "grapefruit",
  "orange", "coconut", "apple", "grape", "lime", "lemon",
];

function normalizedIncludesAny(haystack, needles) {
  return needles.find((n) => haystack.includes(n)) || null;
}

// ---- Named drink-family templates ----
// `components` are relative weights (not required to sum to 1) split across
// the batch volume left over after any spirit is poured; `spirit` gives the
// family's default straight spirit (overridden if the request names one).

const DRINK_FAMILIES = [
  {
    aliases: ["mojito"], preset: "SPIKED SLUSH", tags: ["cocktail", "citrus", "refreshing"], spirit: "white rum",
    components: [{ name: "club soda or sparkling water", weight: 2.5 }, { name: "fresh lime juice", weight: 0.5 }],
    mintPrep: true,
  },
  {
    aliases: ["margarita"], preset: "SPIKED SLUSH", tags: ["cocktail", "citrus"], spirit: "tequila",
    components: [{ name: "margarita mix (or orange liqueur + agave for a from-scratch build)", weight: 3 }, { name: "water", weight: 1 }, { name: "fresh lime juice", weight: 0.6 }],
  },
  {
    aliases: ["daiquiri", "daquiri"], preset: "SPIKED SLUSH", tags: ["cocktail", "fruity"], spirit: "white rum",
    components: [{ name: "strawberry (or other fruit) daiquiri mix", weight: 3 }, { name: "water", weight: 1 }, { name: "fresh lime juice", weight: 0.4 }],
  },
  {
    aliases: ["piña colada", "pina colada", "colada"], preset: "SPIKED SLUSH", tags: ["cocktail", "tropical", "creamy"], spirit: "white rum",
    components: [{ name: "pineapple juice", weight: 2.5 }, { name: "cream of coconut", weight: 1 }, { name: "unsweetened coconut milk", weight: 1 }],
  },
  {
    aliases: ["moscow mule", "mule"], preset: "SPIKED SLUSH", tags: ["cocktail", "spicy", "refreshing", "citrus"], spirit: "vodka",
    components: [{ name: "ginger beer", weight: 4 }, { name: "fresh lime juice", weight: 0.5 }],
  },
  {
    aliases: ["mimosa"], preset: "SPIKED SLUSH", tags: ["cocktail", "citrus", "fruity"], premade: true,
    components: [{ name: "orange juice", weight: 1 }, { name: "sparkling wine (Champagne, Prosecco, or Cava)", weight: 1.4 }],
  },
  {
    aliases: ["sangria"], preset: "SPIKED SLUSH", tags: ["cocktail", "fruity"], premade: true,
    components: [
      { name: "red wine", weight: 2.5 }, { name: "orange juice", weight: 1.2 },
      { name: "orange liqueur or brandy", weight: 0.3 }, { name: "light brown sugar", weight: 0.15, isSweetener: true },
    ],
  },
  {
    aliases: ["painkiller", "pain killer"], preset: "SPIKED SLUSH", tags: ["cocktail", "tropical"], spirit: "dark rum",
    components: [{ name: "pineapple juice", weight: 2.5 }, { name: "orange juice", weight: 1.2 }, { name: "cream of coconut", weight: 1 }],
    servingTip: "Grate fresh nutmeg on top just before serving.",
  },
  {
    aliases: ["paloma"], preset: "SPIKED SLUSH", tags: ["cocktail", "citrus", "refreshing"], spirit: "tequila",
    components: [{ name: "grapefruit soda", weight: 4 }, { name: "fresh lime juice", weight: 0.3 }],
  },
  {
    aliases: ["cosmopolitan", "cosmo"], preset: "SPIKED SLUSH", tags: ["cocktail", "fruity", "citrus"], spirit: "vodka",
    components: [{ name: "cranberry juice", weight: 2.5 }, { name: "fresh lime juice", weight: 0.4 }, { name: "triple sec", weight: 0.6 }],
  },
  {
    aliases: ["screwdriver"], preset: "SPIKED SLUSH", tags: ["cocktail", "citrus"], spirit: "vodka",
    components: [{ name: "orange juice", weight: 5 }],
  },
  {
    aliases: ["bloody mary", "bloody caesar"], preset: "SPIKED SLUSH", tags: ["cocktail", "spicy"], spirit: "vodka",
    components: [{ name: "tomato juice", weight: 5 }, { name: "hot sauce, a few dashes", weight: 0.03 }, { name: "Worcestershire sauce", weight: 0.05 }],
  },
  {
    aliases: ["frappe", "frappé", "frappuccino"], preset: "FRAPPE", tags: ["coffee", "creamy"], minBatch: 720,
    components: [{ name: "chilled black coffee", weight: 3 }, { name: "half & half", weight: 1.5 }],
    fixedExtras: ["10 ml vanilla extract"], forceSugar: true,
  },
  {
    aliases: ["milkshake", "milk shake"], preset: "MILKSHAKE", tags: ["creamy", "milkshake"], minBatch: 720,
    components: [{ name: "whole milk", weight: 3 }, { name: "heavy cream", weight: 1 }],
    fixedExtras: ["10 ml vanilla extract"], forceSugar: true,
  },
  {
    aliases: ["spiked lemonade"], preset: "SPIKED SLUSH", tags: ["cocktail", "citrus", "refreshing"], spirit: "vodka",
    components: [{ name: "lemonade", weight: 4 }],
  },
  {
    aliases: ["lemonade"], preset: "SLUSH", tags: ["refreshing", "citrus"],
    components: [{ name: "lemonade", weight: 5 }],
  },
  {
    aliases: ["iced tea", "ice tea"], preset: "SLUSH", tags: ["refreshing"],
    components: [{ name: "sweetened iced tea", weight: 5 }],
  },
];

function findDrinkFamily(normalizedText) {
  // "spiked lemonade" must win over plain "lemonade"; families are checked
  // in the declared order above, so list the more specific one first.
  for (const family of DRINK_FAMILIES) {
    if (family.aliases.some((a) => normalizedText.includes(a))) return family;
  }
  // "lemonade" + any spirit word but no named cocktail → treat as spiked lemonade
  if (normalizedText.includes("lemonade") && SPIRITS.some((s) => normalizedText.includes(s))) {
    return DRINK_FAMILIES.find((f) => f.aliases.includes("spiked lemonade"));
  }
  return null;
}

// ---- Building ingredient lines from a family/component list ----

function buildComponentIngredients(components, batchMl, spiritMl, spiritDisplay) {
  const nonSweetenerWeight = components.filter((c) => !c.isSweetener).reduce((a, c) => a + c.weight, 0);
  const remainingMl = batchMl - spiritMl;
  const lines = [];
  components.forEach((c) => {
    if (c.isSweetener) return; // handled by the sugar pass below, to stay consistent with the rewriter
    const ml = round5((c.weight / nonSweetenerWeight) * remainingMl);
    if (ml > 0) lines.push(`${ml} ml ${c.name}`);
  });
  if (spiritMl > 0 && spiritDisplay) {
    lines.push(`${spiritMl} ml ${spiritDisplay}`);
  }
  return lines;
}

function applySpicyPrep(lines, prepSteps, spiritDisplay, spiritMl) {
  if (spiritDisplay && spiritMl > 0) {
    const idx = lines.findIndex((l) => l.endsWith(spiritDisplay));
    if (idx !== -1) lines[idx] = `${spiritMl} ml jalapeño-infused ${spiritDisplay}`;
    prepSteps.push(
      `Infuse the ${spiritDisplay}: muddle 3-4 fresh jalapeño slices (deseed for less heat, leave seeds in for more) into ${spiritMl} ml ${spiritDisplay}. Steep sealed at room temperature 24-48h, tasting at 24h, then strain before using.`
    );
  } else {
    lines.push("120 ml chili-infused simple syrup (or allulose syrup)");
    prepSteps.push(
      "Make a chili syrup: warm 120 ml simple syrup (or allulose syrup) with 1-2 sliced fresh or dried chilis for 10-15 min over low heat (do not boil), then strain and cool before using."
    );
  }
}

function applyMintPrep(lines, prepSteps) {
  lines.push("60 ml mint-infused simple syrup (see prep)");
  prepSteps.push(
    "Muddle a handful of fresh mint leaves with 60 ml simple syrup (or allulose syrup), let steep 15-20 min, then strain out the leaves before adding to the batch."
  );
}

function ensureSugar(lines, batchMl, forceSugar) {
  if (forceSugar || !hasInherentSweetness(lines)) {
    lines.push(`${recommendedSugarGrams(batchMl)} g granulated sugar`);
    return true;
  }
  return false;
}

function machineFitNote({ isSpiked, isPremade, spiritMl, batchMl, addedSugar, mocktail }) {
  if (mocktail) {
    return `Made non-alcoholic per your request — without alcohol as antifreeze, the sugar in this batch is what lets it freeze, so keep the full-sugar (or allulose, in Sugar-Free mode) version rather than a diet base alone.`;
  }
  if (isPremade) {
    return `Premade alcoholic inputs (wine/beer/cider/sparkling wine) need to land between 2.8%-16% ABV to freeze — check the label and dilute with a splash of water/soda if it runs hot, and make sure it still has real sugar (the machine's low-sugar alert will fire otherwise).`;
  }
  if (isSpiked) {
    const maxMl = Math.round(interpolateSpiritMaxMl(batchMl));
    return `Spirit capped at ${spiritMl} ml (official max for this batch size is ~${maxMl} ml) to land in the community's practical ~8-14% ABV sweet spot rather than the legal 16% ceiling — too much and it won't freeze at all.${addedSugar ? " Sugar topped up since the base alone was too tart/low-sugar to hit the machine's freezing threshold." : ""}`;
  }
  return addedSugar
    ? `Sugar topped up to roughly the community's ~10-15% Brix target — this base alone was under the machine's low-sugar threshold and would freeze into hard ice instead of slush.`
    : `This base already carries enough natural sugar (from the juice/soda/mix) to clear the machine's freezing threshold.`;
}

function difficultyFor(lines, prepSteps) {
  if (prepSteps.length > 0) return "advanced";
  if (lines.length <= 3) return "easy";
  if (lines.length <= 6) return "medium";
  return "advanced";
}

function finishRecipe({ name, preset, tags, batchMl, lines, prepSteps, directions, fitInfo, freeText, servingTip }) {
  if (servingTip) directions = `${directions} ${servingTip}`;
  const sugarFreeLines = lines.map(rewriteIngredientForSugarFree);
  // Base the note on whether the rewriter actually changed anything (not a
  // separate keyword re-check) so it never contradicts machine_fit_note.
  const anyLineChanged = sugarFreeLines.some((l, i) => l !== lines[i]);
  const sugarFreeNote = anyLineChanged
    ? "Sugar swapped for allulose (~1.33x, since it's about 70% as sweet as sugar by weight) so this still clears the machine's freezing threshold — taste and adjust."
    : "This base likely needs sugar to freeze — if using a diet/zero-sugar version of any soda or juice here, add ~15-20 g granulated allulose per 355 ml to restore the sugar the machine needs.";
  return {
    name,
    preset,
    tags: Array.from(new Set(tags)),
    difficulty: difficultyFor(lines, prepSteps),
    batch_note: batchNote(batchMl),
    prep_steps: prepSteps,
    ingredients: lines,
    directions,
    machine_fit_note: fitInfo,
    sugar_free_ingredients: sugarFreeLines,
    sugar_free_note: sugarFreeNote,
    inspired_by: pickInspirationRecipes(freeText, 3).map((r) => r.name),
  };
}

function titleCase(s) {
  // Capitalize each space-separated word's first character only — JS's \w is
  // ASCII-only, so a \b-based regex misfires on accented names like "piña".
  return s
    .split(" ")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function detectSpirit(normalizedText) {
  return SPIRITS.find((s) => normalizedText.includes(s)) || null;
}

function detectPremadeAlcohol(normalizedText) {
  return PREMADE_ALCOHOL.find((s) => normalizedText.includes(s)) || null;
}

function detectTags(normalizedText) {
  const tags = [];
  Object.entries(TAG_KEYWORDS).forEach(([tag, words]) => {
    if (words.some((w) => normalizedText.includes(w))) tags.push(tag);
  });
  return tags;
}

// ---- Building a recipe from a matched drink family ----

// If the request names a fruit flavor the matched template doesn't already
// mention (e.g. "strawberry lemonade"), blend some of that fruit juice into
// the largest existing component rather than ignoring the descriptor.
function injectExtraFruit(lines, normalizedText) {
  const fruit = normalizedIncludesAny(normalizedText, JUICE_FRUIT_WORDS);
  if (!fruit || lines.length === 0) return;
  if (normalize(lines.join(" ")).includes(fruit)) return;
  const match = lines[0].match(/^(\d+(?:\.\d+)?)\s*ml\s+(.*)$/i);
  if (!match) return;
  const totalMl = parseFloat(match[1]);
  const fruitMl = round5(totalMl * 0.35);
  const remainMl = round5(totalMl - fruitMl);
  if (fruitMl <= 0 || remainMl <= 0) return;
  lines[0] = `${remainMl} ml ${match[2]}`;
  lines.splice(1, 0, `${fruitMl} ml ${fruit} juice`);
}

function buildFromFamily(family, normalizedText, batchMl, freeText) {
  const mocktail = MOCKTAIL_KEYWORDS.some((k) => normalizedText.includes(k));
  const spicy = SPICY_KEYWORDS.some((k) => normalizedText.includes(k));
  batchMl = Math.max(batchMl, family.minBatch || 0);

  const isAlcoholicFamily = family.preset === "SPIKED SLUSH";
  const preset = isAlcoholicFamily && mocktail ? "SLUSH" : family.preset;
  const requestedSpirit = detectSpirit(normalizedText);
  const spiritDisplay = family.spirit ? requestedSpirit || family.spirit : null;

  let spiritMl = 0;
  if (isAlcoholicFamily && !mocktail && !family.premade && spiritDisplay) {
    spiritMl = recommendedSpiritMl(batchMl);
  }

  const lines = buildComponentIngredients(family.components, batchMl, spiritMl, isAlcoholicFamily && !mocktail && !family.premade ? spiritDisplay : null);
  if (family.fixedExtras) lines.push(...family.fixedExtras);
  if (isAlcoholicFamily && mocktail && spiritDisplay) {
    lines.push(`zero-proof ${spiritDisplay}, to taste`);
  }
  if (family.premade && isAlcoholicFamily) {
    // premade alcohol (wine/sparkling) is already one of the weighted components' names in most
    // of these templates, so nothing extra to add here beyond what buildComponentIngredients did.
  }
  injectExtraFruit(lines, normalizedText);

  const prepSteps = [];
  if (family.mintPrep) applyMintPrep(lines, prepSteps);
  if (spicy) applySpicyPrep(lines, prepSteps, isAlcoholicFamily && !mocktail ? spiritDisplay : null, spiritMl);

  const addedSugar = ensureSugar(lines, batchMl, family.forceSugar);

  const fitInfo = machineFitNote({
    isSpiked: isAlcoholicFamily && !mocktail && !family.premade,
    isPremade: Boolean(family.premade) && isAlcoholicFamily && !mocktail,
    spiritMl,
    batchMl,
    addedSugar,
    mocktail: isAlcoholicFamily && mocktail,
  });

  const tags = Array.from(new Set([...family.tags, ...detectTags(normalizedText)]));
  let familyLabel = titleCase(family.aliases[0]);
  const extraFruit = normalizedIncludesAny(normalizedText, JUICE_FRUIT_WORDS);
  if (extraFruit && !normalize(familyLabel).includes(extraFruit)) familyLabel = `${titleCase(extraFruit)} ${familyLabel}`;
  const sugarFreeAsked = SUGAR_FREE_KEYWORDS.some((k) => normalizedText.includes(k));
  const name = `${sugarFreeAsked ? "Sugar-Free " : ""}${mocktail && isAlcoholicFamily ? "Mocktail " : ""}${spicy ? "Spicy " : ""}${familyLabel}`;

  const directions = `Combine everything${prepSteps.length ? " (after the prep step above)" : ""}, run ${preset}${preset === "SPIKED SLUSH" ? ", starting near the middle of the temperature range and adjusting to taste" : ""}.`;

  return finishRecipe({
    name, preset, tags, batchMl, lines, prepSteps, directions, fitInfo, freeText,
    servingTip: family.servingTip,
  });
}

// ---- Generic fallback (no named family recognized) ----
//
// A purely custom, open-ended request gets 3 varied recipes rather than 1
// (see buildGenericVariants below). Variety comes only from flavor/dilution
// ratios and a spirit amount within the already-safe range (never above the
// standard 85%-of-cap recommendation) — the sugar dosing formula
// (recommendedSugarGrams via ensureSugar) is identical across every variant,
// so variety never comes at the cost of the machine's freezing chemistry.

const GENERIC_VARIANT_STYLES = [
  { label: "Classic", spiritFactor: 0.85, mixerRatio: 0.8, note: "" },
  {
    label: "Lighter Pour",
    spiritFactor: 0.7,
    mixerRatio: 0.75,
    note: "Garnish with a citrus wheel for a crisper finish.",
  },
  {
    label: "Extra Fruity",
    spiritFactor: 0.85,
    mixerRatio: 0.9,
    note: "Stir in a handful of extra fresh fruit chunks or purée just before serving for more texture.",
  },
];

function buildGenericFromText(normalizedText, batchMl, freeText, style) {
  style = style || GENERIC_VARIANT_STYLES[0];
  const mocktail = MOCKTAIL_KEYWORDS.some((k) => normalizedText.includes(k));
  const spicy = SPICY_KEYWORDS.some((k) => normalizedText.includes(k));
  const requestedSpirit = !mocktail ? detectSpirit(normalizedText) : null;
  const premadeAlcohol = !mocktail ? detectPremadeAlcohol(normalizedText) : null;
  const dairy = normalizedIncludesAny(normalizedText, DAIRY_WORDS);
  const coffee = normalizedIncludesAny(normalizedText, COFFEE_WORDS);
  const soda = normalizedIncludesAny(normalizedText, SODA_WORDS);
  const fruit = normalizedIncludesAny(normalizedText, JUICE_FRUIT_WORDS);

  const lines = [];
  const prepSteps = [];
  let preset = "SLUSH";
  let spiritMl = 0;
  let spiritDisplay = null;
  let isPremade = false;
  let noFlavorDetected = false;

  if (requestedSpirit) {
    preset = "SPIKED SLUSH";
    spiritDisplay = requestedSpirit;
    spiritMl = recommendedSpiritMl(batchMl, style.spiritFactor);
    const mixerName = fruit ? `${fruit} juice` : soda ? soda : "juice or soda of choice";
    const remaining = batchMl - spiritMl;
    lines.push(`${round5(remaining * style.mixerRatio)} ml ${mixerName}`, `${round5(remaining * (1 - style.mixerRatio))} ml water`, `${spiritMl} ml ${spiritDisplay}`);
  } else if (premadeAlcohol) {
    preset = "SPIKED SLUSH";
    isPremade = true;
    // Vary the dilution a little (still well inside the safe 2.8-16% ABV
    // range machineFitNote describes — this only ever adjusts water/soda
    // split, never the alcohol input itself).
    const premadeRatio = clamp(style.mixerRatio, 0.75, 0.9);
    lines.push(`${round5(batchMl * premadeRatio)} ml ${premadeAlcohol}`, `${round5(batchMl * (1 - premadeRatio))} ml water or soda (to keep it in the 2.8-16% ABV range)`);
  } else if (dairy || normalizedText.includes("milkshake")) {
    preset = "MILKSHAKE";
    batchMl = Math.max(batchMl, 720);
    const creamRatio = clamp(0.24 + (style.mixerRatio - 0.8) * 0.3, 0.15, 0.32);
    const flavor = fruit || (normalizedText.includes("chocolate") ? "chocolate syrup" : null);
    lines.push(`${round5(batchMl * (0.96 - creamRatio))} ml whole milk`, `${round5(batchMl * creamRatio)} ml heavy cream`, "10 ml vanilla extract");
    if (flavor) lines.push(flavor === "chocolate syrup" ? "60 ml chocolate syrup" : `${flavor} purée or syrup, to taste`);
  } else if (coffee) {
    preset = "FRAPPE";
    batchMl = Math.max(batchMl, 720);
    const coffeeRatio = clamp(0.65 + (style.mixerRatio - 0.8) * 0.3, 0.55, 0.75);
    lines.push(`${round5(batchMl * coffeeRatio)} ml chilled black coffee`, `${round5(batchMl * (0.98 - coffeeRatio))} ml half & half`);
  } else if (normalizedText.includes("smoothie") || normalizedText.includes("100% juice") || normalizedText.includes("real juice")) {
    preset = "FROZEN JUICE";
    lines.push(`${round5(batchMl)} ml ${fruit ? `${fruit} juice` : "100% juice of choice"}`);
  } else if (fruit || soda) {
    lines.push(`${round5(batchMl * style.mixerRatio)} ml ${fruit ? `${fruit} juice` : soda}`, `${round5(batchMl * (1 - style.mixerRatio))} ml water`);
  } else {
    // No flavor detected at all — plain water needs sugar force-added below
    // regardless of keyword matching (there's nothing sweet to detect yet).
    lines.push(`${round5(batchMl)} ml water — pick a full-sugar flavor concentrate to add`);
    noFlavorDetected = true;
  }

  if (spicy) applySpicyPrep(lines, prepSteps, spiritDisplay, spiritMl);
  const addedSugar = ensureSugar(lines, batchMl, preset === "MILKSHAKE" || preset === "FRAPPE" || noFlavorDetected);

  const tags = detectTags(normalizedText);
  if (tags.length === 0) tags.push(preset === "SPIKED SLUSH" ? "cocktail" : "refreshing");

  const fitInfo = machineFitNote({
    isSpiked: preset === "SPIKED SLUSH" && !isPremade,
    isPremade,
    spiritMl,
    batchMl,
    addedSugar,
    mocktail: mocktail && Boolean(requestedSpirit || premadeAlcohol),
  });

  const name = `${spicy ? "Spicy " : ""}${style.label} Custom ${titleCase(preset === "SPIKED SLUSH" ? "Spiked Slush" : preset.toLowerCase())}`;
  let directions = `Combine everything${prepSteps.length ? " (after the prep step above)" : ""}, run ${preset}, adjusting the temperature bar to taste.`;
  if (style.note) directions += ` ${style.note}`;

  return finishRecipe({ name, preset, tags, batchMl, lines, prepSteps, directions, fitInfo, freeText });
}

// Purely custom, open-ended requests (no named family) get 3 varied
// recipes — see GENERIC_VARIANT_STYLES above for how they differ.
function buildGenericVariants(normalizedText, batchMl, freeText) {
  return GENERIC_VARIANT_STYLES.map((style) => buildGenericFromText(normalizedText, batchMl, freeText, style));
}

// ---- Ingredient-list mode ("mango, coconut milk, dark rum") ----

function classifyIngredientToken(token) {
  const t = normalize(token);
  const spirit = detectSpirit(t);
  if (spirit) return { type: "spirit", display: spirit, raw: token };
  const premade = detectPremadeAlcohol(t);
  if (premade) return { type: "premade", display: premade, raw: token };
  const dairy = normalizedIncludesAny(t, DAIRY_WORDS);
  if (dairy) return { type: "dairy", display: token, raw: token };
  const coffee = normalizedIncludesAny(t, COFFEE_WORDS);
  if (coffee) return { type: "coffee", display: token, raw: token };
  const fruit = normalizedIncludesAny(t, JUICE_FRUIT_WORDS);
  if (fruit) return { type: "fruit", display: token, raw: token };
  const soda = normalizedIncludesAny(t, SODA_WORDS);
  if (soda) return { type: "soda", display: token, raw: token };
  if (/sugar|honey|agave|syrup|allulose/i.test(t)) return { type: "sweetener", display: token, raw: token };
  return { type: "other", display: token, raw: token };
}

function buildFromTokens(tokens, normalizedText, batchMl, freeText, variantLabel, useCount) {
  const mocktail = MOCKTAIL_KEYWORDS.some((k) => normalizedText.includes(k));
  const spicy = SPICY_KEYWORDS.some((k) => normalizedText.includes(k));
  const used = tokens.slice(0, useCount);

  const spiritToken = !mocktail ? used.find((t) => t.type === "spirit") : null;
  const premadeToken = !mocktail ? used.find((t) => t.type === "premade") : null;
  const dairyTokens = used.filter((t) => t.type === "dairy");
  const coffeeToken = used.find((t) => t.type === "coffee");
  const baseTokens = used.filter((t) => ["fruit", "soda", "dairy"].includes(t.type) && t !== spiritToken);

  let preset = "SLUSH";
  if (dairyTokens.length && !coffeeToken) preset = "MILKSHAKE";
  else if (coffeeToken) preset = "FRAPPE";
  else if (spiritToken || premadeToken) preset = "SPIKED SLUSH";
  if (preset === "MILKSHAKE" || preset === "FRAPPE") batchMl = Math.max(batchMl, 720);

  let spiritMl = 0;
  const lines = [];
  const prepSteps = [];
  let isPremade = false;
  let noFlavorDetected = false;

  if (spiritToken) spiritMl = recommendedSpiritMl(batchMl);
  if (premadeToken) isPremade = true;

  const flavorBases = baseTokens.length ? baseTokens : used.filter((t) => t.type === "other");
  const reserved = spiritMl + (isPremade ? round5(batchMl * 0.85) : 0);
  const remaining = batchMl - reserved;

  if (isPremade) {
    lines.push(`${round5(batchMl * 0.85)} ml ${premadeToken.display}`);
    lines.push(`${round5(batchMl * 0.15)} ml water or soda (to keep it in the 2.8-16% ABV range)`);
  } else if (flavorBases.length > 0) {
    const weights = flavorBases.map((_, i) => (i === 0 ? 2 : 1));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    flavorBases.forEach((tok, i) => {
      const ml = round5((weights[i] / totalWeight) * remaining);
      const label = tok.type === "fruit" ? `${tok.display} juice or purée` : tok.type === "dairy" ? tok.display : tok.type === "soda" ? tok.display : tok.display;
      if (ml > 0) lines.push(`${ml} ml ${label}`);
    });
  } else {
    lines.push(`${round5(remaining)} ml water — pick a full-sugar flavor concentrate to add`);
    noFlavorDetected = true;
  }

  if (coffeeToken) lines.push(`${round5(batchMl * 0.3)} ml half & half`);
  if (dairyTokens.length && preset === "MILKSHAKE") lines.push("10 ml vanilla extract");
  if (spiritToken) lines.push(`${spiritMl} ml ${spiritToken.display}`);
  else if (mocktail && (spiritToken || premadeToken)) lines.push(`zero-proof ${(spiritToken || premadeToken).display}, to taste`);

  const explicitSweetener = used.find((t) => t.type === "sweetener");
  if (explicitSweetener) lines.push(explicitSweetener.display);

  if (spicy) applySpicyPrep(lines, prepSteps, spiritToken ? spiritToken.display : null, spiritMl);
  const addedSugar = ensureSugar(lines, batchMl, preset === "MILKSHAKE" || preset === "FRAPPE" || noFlavorDetected);

  const tags = detectTags(normalizedText);
  if (tags.length === 0) tags.push(preset === "SPIKED SLUSH" ? "cocktail" : "refreshing");

  const fitInfo = machineFitNote({
    isSpiked: preset === "SPIKED SLUSH" && !isPremade,
    isPremade,
    spiritMl,
    batchMl,
    addedSugar,
    mocktail: mocktail && Boolean(spiritToken || premadeToken),
  });

  const usedNames = used.map((t) => t.raw).join(", ");
  const leftOutNames = tokens.slice(useCount).map((t) => t.raw);
  const name = `${spicy ? "Spicy " : ""}${variantLabel} (${usedNames})`;
  let directions = `Combine everything${prepSteps.length ? " (after the prep step above)" : ""}, run ${preset}, adjusting the temperature bar to taste.`;
  if (leftOutNames.length) directions += ` (Left out ${leftOutNames.join(", ")} for this variant — see the other version if you want everything in one batch.)`;

  return finishRecipe({ name, preset, tags, batchMl, lines, prepSteps, directions, fitInfo, freeText });
}

function buildFromIngredientList(freeText, normalizedText, batchMl) {
  const rawTokens = freeText.split(",").map((t) => t.trim()).filter(Boolean);
  const classified = rawTokens.map(classifyIngredientToken);
  if (classified.length <= 2) {
    return [buildFromTokens(classified, normalizedText, batchMl, freeText, "Custom Mix", classified.length)];
  }
  // Multiple candidate ingredients, open-ended request: offer 3 variants —
  // a full mix, a simplified two-ingredient twist, and a single-ingredient
  // highlight — the same "3 recipes for purely custom requests" treatment
  // as the generic fallback. Only which/how-many flavor tokens are used
  // varies; recommendedSpiritMl/recommendedSugarGrams (called inside
  // buildFromTokens) are unaffected by useCount, so safety math never
  // changes across variants.
  const results = [buildFromTokens(classified, normalizedText, batchMl, freeText, "Full Mix", classified.length)];
  results.push(buildFromTokens(classified, normalizedText, batchMl, freeText, "Simplified Twist", Math.min(2, classified.length)));
  results.push(buildFromTokens(classified, normalizedText, batchMl, freeText, "Solo Highlight", 1));
  return results;
}

// ---- Retrieval: closest dataset recipes, for the "Inspired by" credit ----

function pickInspirationRecipes(freeText, limit) {
  const queryWords = normalize(freeText)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  if (queryWords.length === 0) return [];
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

// ---- Entry point ----

// Pure: given free text, returns an array of 1-2 custom recipe objects.
// No DOM side effects — the caller (render()) decides where these go.
function buildCustomRecipesFromText(freeText) {
  const normalizedText = normalize(freeText);
  const batchMl = resolveBatchMl(freeText);
  const looksLikeIngredientList =
    freeText.includes(",") &&
    !/\b(i want|i'd like|need|craving|give me|make me|for a)\b/i.test(normalizedText) &&
    !findDrinkFamily(normalizedText);

  if (looksLikeIngredientList) {
    return buildFromIngredientList(freeText, normalizedText, batchMl);
  }
  const family = findDrinkFamily(normalizedText);
  // A named drink (e.g. "margarita") gets exactly one recipe — it's a
  // specific request, not an open-ended one. Only a purely custom request
  // (no recognized family) gets 3 varied recipes.
  if (family) return [buildFromFamily(family, normalizedText, batchMl, freeText)];
  return buildGenericVariants(normalizedText, batchMl, freeText);
}

// If the query mentions "sugar free"/"diet"/etc., flip the toggle on for
// them (never auto-off) — a one-way convenience, not a recursive re-render.
function maybeAutoEnableSugarFree(normalizedText) {
  if (state.sugarFree) return;
  if (!SUGAR_FREE_KEYWORDS.some((k) => normalizedText.includes(k))) return;
  state.sugarFree = true;
  els.sugarFreeToggle.checked = true;
  document.body.classList.add("sugar-free-mode");
}

// Minimum query length before we bother synthesizing a custom recipe —
// avoids a nonsense card while someone is still mid-word.
const CUSTOM_MIN_QUERY_LENGTH = 3;

/* ---------------------------------------------------------------------
 * Optional live backend (Gemini via a Cloudflare Worker) for open-
 * vocabulary custom-recipe understanding — the offline generator above
 * only recognizes ingredients in its hardcoded keyword lists, so
 * "guava" or "Yakult" fall through to a generic filler. If this URL is
 * reachable it's tried first; on any failure (network, timeout, bad
 * shape) we silently fall back to the offline generator, so the feature
 * never just breaks. Leave CUSTOM_DRINK_API_URL empty ("") to skip the
 * network call entirely and always use the offline generator.
 * ------------------------------------------------------------------- */

const CUSTOM_DRINK_API_URL = "https://ninja-slushi-api.johnny-y-w-wang.workers.dev/";
// Must stay comfortably longer than the Worker's own GEMINI_TIMEOUT_MS
// (worker/index.js) — otherwise the browser gives up and falls back to
// offline before the Worker even finishes waiting on Gemini.
const CUSTOM_API_TIMEOUT_MS = 25000;

async function fetchCustomRecipesFromApi(freeText, inspirationRecipes, targetBatchMl, servingBand) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CUSTOM_API_TIMEOUT_MS);
  try {
    const response = await fetch(CUSTOM_DRINK_API_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: freeText,
        sugarFree: state.sugarFree,
        targetBatchMl,
        servingBand: servingBand || null,
        inspiration: inspirationRecipes.map((r) => ({
          name: r.name,
          preset: r.preset,
          tags: r.tags,
          ingredients: r.ingredients,
        })),
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`API responded ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.recipes) || data.recipes.length === 0) {
      throw new Error("No recipes in API response");
    }
    // Light shape check — enough to trust rendering, not full schema validation.
    const looksValid = data.recipes.every(
      (r) => r && typeof r.name === "string" && Array.isArray(r.ingredients) && typeof r.directions === "string"
    );
    if (!looksValid) throw new Error("Malformed recipe in API response");
    return data.recipes;
  } finally {
    clearTimeout(timeoutId);
  }
}

// State for the debounced/async custom-recipe slot. Kept separate from the
// synchronous dataset filtering above, since it resolves later than the
// initial render() call that kicked it off.
const customState = {
  query: null, // the query text the current result/pending-state corresponds to
  recipes: [], // last resolved recipes (AI or offline) for `query`
  pending: false, // true while a fetch is in flight
  source: null, // "ai" | "offline", for the small provenance note on the card
  requestSeq: 0, // bumped on every new query — lets a stale resolve bail out
};

function renderCustomLoadingPlaceholder() {
  const el = document.createElement("p");
  el.className = "custom-loading";
  el.textContent = "✨ Thinking of a custom drink… (can take up to ~20s)";
  return el;
}

async function resolveCustomForQuery(freeText, mySeq) {
  const inspiration = pickInspirationRecipes(freeText, 6);
  const targetBatchMl = resolveBatchMl(freeText);
  let recipes;
  let source;
  if (CUSTOM_DRINK_API_URL) {
    try {
      recipes = await fetchCustomRecipesFromApi(freeText, inspiration, targetBatchMl, state.servingBand);
      source = "ai";
    } catch (err) {
      recipes = buildCustomRecipesFromText(freeText);
      source = "offline";
    }
  } else {
    recipes = buildCustomRecipesFromText(freeText);
    source = "offline";
  }

  if (mySeq !== customState.requestSeq) return; // superseded by a newer query since we started

  // Applied uniformly regardless of source (AI or offline) — never relies
  // on the AI having remembered the "9-12 needs 2 runs" instruction itself.
  customState.recipes = applyServingBandCaveat(recipes);
  customState.pending = false;
  customState.source = source;
  render();
}

function renderCustomRecipeCard(recipe, source) {
  const card = document.createElement("article");
  card.className = "card custom-card";

  const header = document.createElement("div");
  header.className = "card-header";
  header.innerHTML = `
    <h3>${escapeHtml(recipe.name || "Custom Drink")}</h3>
    <span class="badge preset-badge">${escapeHtml(recipe.preset || "")}</span>
  `;
  card.appendChild(header);

  const badgeLabel = source === "ai" ? "✨ Custom Build (AI)" : "✨ Custom Build";
  const meta = document.createElement("div");
  meta.className = "card-meta";
  const difficulty = recipe.difficulty || "medium";
  meta.innerHTML = `
    <span class="badge difficulty-${escapeHtml(difficulty)}">${escapeHtml(capitalize(difficulty))}</span>
    <span class="badge ai-badge">${badgeLabel}</span>
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
    li.textContent = addImperialUnits(line);
    if (state.sugarFree) li.classList.add("sugar-free-adjusted");
    ingList.appendChild(li);
  });
  card.appendChild(ingList);

  const directions = document.createElement("p");
  directions.className = "directions";
  directions.textContent = recipe.directions || "";
  card.appendChild(directions);

  if (recipe.preset === "SPIKED SLUSH" && Array.isArray(recipe.ingredients)) {
    const abvNote = formatAbvNote(recipe.ingredients, estimateBatchMlFromLines(recipe.ingredients), STANDARD_SERVING_ML);
    if (abvNote) {
      const abvEl = document.createElement("p");
      abvEl.className = "abv-note";
      abvEl.textContent = `🍸 ${abvNote}`;
      card.appendChild(abvEl);
    }
  }

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

function render() {
  const trimmedQuery = state.query.trim();
  const hasFilters = state.activeTags.size > 0 || state.activeDifficulties.size > 0 || state.activePresets.size > 0;
  const hasSearched = trimmedQuery.length > 0 || hasFilters;
  const wantsCustom = trimmedQuery.length >= CUSTOM_MIN_QUERY_LENGTH;

  els.results.innerHTML = "";

  if (!hasSearched) {
    customState.requestSeq++; // invalidate any in-flight fetch
    customState.query = null;
    customState.recipes = [];
    customState.pending = false;
    const prompt = document.createElement("p");
    prompt.className = "empty-state";
    prompt.textContent = "👀 Search a recipe or ingredient, describe a custom drink, or pick a filter to see results.";
    els.results.appendChild(prompt);
    els.resultCount.textContent = "";
    return;
  }

  if (wantsCustom) {
    maybeAutoEnableSugarFree(normalize(trimmedQuery));
    if (trimmedQuery !== customState.query) {
      // New query text — reset and kick off the fetch/build right away.
      // render() only runs on an explicit action (Search button, Enter, a
      // filter click), never on every keystroke, so there's no need to
      // additionally debounce here — the button *is* the debounce.
      customState.query = trimmedQuery;
      customState.recipes = [];
      customState.pending = true;
      customState.requestSeq++;
      const mySeq = customState.requestSeq;
      resolveCustomForQuery(trimmedQuery, mySeq);
    }
    // else: same query as last render (e.g. only a filter/toggle changed) —
    // customState already holds the right pending/resolved data, reuse it.
  } else {
    customState.requestSeq++;
    customState.query = null;
    customState.recipes = [];
    customState.pending = false;
  }

  const filtered = getFilteredRecipes().filter((r) => matchesPreset(r, state.activePresets));

  if (filtered.length === 0 && !wantsCustom) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No recipes match your search and filters. Try clearing some filters.";
    els.results.appendChild(empty);
  } else {
    filtered.forEach((r) => els.results.appendChild(renderRecipeCard(r)));
    if (wantsCustom) {
      const slot = document.createElement("div");
      slot.id = "customSlot";
      slot.className = "contents";
      if (customState.pending) {
        slot.appendChild(renderCustomLoadingPlaceholder());
      } else {
        customState.recipes.forEach((r) => slot.appendChild(renderCustomRecipeCard(r, customState.source)));
      }
      els.results.appendChild(slot);
    }
  }

  const recipeCountText = `${filtered.length} recipe${filtered.length === 1 ? "" : "s"}`;
  let customCountText = "";
  if (wantsCustom) {
    customCountText = customState.pending
      ? " + ✨ building a custom drink…"
      : customState.recipes.length
      ? ` + ${customState.recipes.length} custom build${customState.recipes.length === 1 ? "" : "s"}`
      : "";
  }
  els.resultCount.textContent = recipeCountText + customCountText;
}

/* ---------------------------------------------------------------------
 * Wiring
 * ------------------------------------------------------------------- */

function init() {
  initThemeSwitcher();
  initFilterChips();
  initServingBandChips();

  // Typing alone doesn't trigger a search — only an explicit action does
  // (the Search button, pressing Enter, or a filter chip), so the custom
  // drink builder only ever fires once per finished query, not per keystroke.
  els.query.addEventListener("input", (e) => {
    state.query = e.target.value;
  });
  els.query.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      render();
    }
  });
  els.searchBtn.addEventListener("click", () => {
    state.query = els.query.value;
    render();
  });

  els.sugarFreeToggle.addEventListener("change", (e) => {
    state.sugarFree = e.target.checked;
    document.body.classList.toggle("sugar-free-mode", state.sugarFree);
    render();
  });

  els.clearFilters.addEventListener("click", () => {
    state.query = "";
    state.activeTags.clear();
    state.activeDifficulties.clear();
    state.activePresets.clear();
    state.servingBand = null;
    els.query.value = "";
    document.querySelectorAll(".chip.active").forEach((c) => {
      c.classList.remove("active");
      c.setAttribute("aria-pressed", "false");
    });
    render();
  });

  render();
}

document.addEventListener("DOMContentLoaded", init);
