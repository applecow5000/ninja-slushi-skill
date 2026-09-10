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
  if (u === "oz") return value * OZ_TO_ML;
  if (u === "cup" || u === "cups") return value * 240;
  if (u === "tbsp") return value * 15;
  if (u === "tsp") return value * 5;
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
  // A plain single value, e.g. "600 ml ...", "50 g ...", "1.2 L ...". Also
  // accepts oz/cup/tbsp/tsp as a fallback — the AI backend is instructed to
  // always use ml/g, but this keeps ABV/Brix math working even if it slips
  // and uses an imperial unit instead.
  m = line.match(/^(\d+(?:\.\d+)?)\s*(ml|g|l|oz|cups?|tbsp|tsp)\b(.*)$/i);
  if (m) {
    const rawUnit = m[2].toLowerCase();
    const unit = rawUnit === "g" ? "g" : "ml"; // everything else is a volume, normalized to ml
    const val = unitToMlOrG(parseFloat(m[1]), rawUnit);
    return { loVal: val, hiVal: val, avgVal: val, unit, isRange: false, rest: m[3] };
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

// This app's reference serving is 6.4 US fl oz (~189 ml) — the same number
// the serving-size selector below sizes a batch against, so "per serving"
// always means the same serving everywhere in the app (ABV note, batch
// note, and the serving-size selector's own math).
const OZ_TO_ML = 29.5735;
const STANDARD_SERVING_OZ = 6.4;
const STANDARD_SERVING_ML = Math.round(STANDARD_SERVING_OZ * OZ_TO_ML);
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
    const spiritKey = SPIRITS.find((s) => includesWord(t, s));
    if (spiritKey) {
      found = true;
      totalEthanolMl += qty * (spiritAbvPercent(spiritKey) / 100);
      return;
    }
    const premadeKey = PREMADE_ALCOHOL.find((s) => isPremadeAlcoholMatch(t, s));
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
 * "Buzz level" — targets a real batch-wide ABV%, not a spirit-volume ratio
 *
 * The bug this fixes: 120 ml of 40% tequila in a 1.2 L batch is really
 * ~4% ABV (120 × 0.40 / 1200), not ~10% (120 / 1200) — any calculation
 * that skips the spirit's actual strength and just divides volumes is
 * wrong. Every spirit/premade-alcohol amount in a generated recipe is
 * solved FOR a real target ABV using the ingredient's actual strength
 * (spiritAbvPercent/premadeAbvPercent), via applyAbvTargetToLines() below,
 * then hard-clamped to the machine's official safety ceiling. This is also
 * exactly what the buzz-level slider and the ABV badge on a card both read
 * from — one calculation, used everywhere, never re-derived differently in
 * two places.
 * ------------------------------------------------------------------- */

// Percentages are backend-only — never shown in the UI, which only shows
// the two end captions/emoji (see index.html and initBuzzLevelSlider()).
const BUZZ_LEVELS = [{ targetAbv: 5 }, { targetAbv: 6 }, { targetAbv: 7 }, { targetAbv: 8 }, { targetAbv: 9 }];

function currentTargetAbv() {
  const level = BUZZ_LEVELS[state.buzzLevel] || BUZZ_LEVELS[0];
  return level.targetAbv;
}

// Scales just the leading quantity of an "<N> ml ..." / "<N> g ..." line by
// a factor. Leaves range-format lines and non-numeric lines untouched
// (rare in generated recipes — this only ever operates on the app's own
// generated "qty unit ingredient" lines, offline or AI).
function scaleNumberForUnit(value, unit, factor) {
  const scaled = value * factor;
  // Liters get 2 decimal places; ml/g round to the nearest 5, matching how
  // the rest of this app already displays each unit.
  return unit.toLowerCase() === "l" ? Math.round(scaled * 100) / 100 : round5(scaled);
}

// Mirrors parseQuantityToken()'s three formats (plain value, shared-unit
// range like "300–800 ml", and each-side-its-own-unit range like
// "420 ml–1.12 L") so a dataset recipe's range-format quantities rescale
// correctly instead of only the leading number getting touched.
function rescaleMlOrGLine(line, factor) {
  let m = line.match(/^(\d+(?:\.\d+)?)\s*(ml|g|l)\s*([–-])\s*(\d+(?:\.\d+)?)\s*(ml|g|l)\b(.*)$/i);
  if (m) {
    const n1 = scaleNumberForUnit(parseFloat(m[1]), m[2], factor);
    const n2 = scaleNumberForUnit(parseFloat(m[4]), m[5], factor);
    if (n1 <= 0 || n2 <= 0) return line;
    return `${n1} ${m[2]}${m[3]}${n2} ${m[5]}${m[6]}`;
  }
  m = line.match(/^(\d+(?:\.\d+)?)\s*([–-])\s*(\d+(?:\.\d+)?)\s*(ml|g|l)\b(.*)$/i);
  if (m) {
    const n1 = scaleNumberForUnit(parseFloat(m[1]), m[4], factor);
    const n2 = scaleNumberForUnit(parseFloat(m[3]), m[4], factor);
    if (n1 <= 0 || n2 <= 0) return line;
    return `${n1}${m[2]}${n2} ${m[4]}${m[5]}`;
  }
  m = line.match(/^(\d+(?:\.\d+)?)\s*(ml|g|l)\b(.*)$/i);
  if (!m) return line;
  const scaled = scaleNumberForUnit(parseFloat(m[1]), m[2], factor);
  if (scaled <= 0) return line;
  return `${scaled} ${m[2]}${m[3]}`;
}

// The single place that sizes alcohol (and rebalances everything else
// around it) for a target ABV. Used both when a recipe is first built and
// when the buzz-level/serving-size selectors adjust an already-shown one —
// same math either time, whether the recipe came from the offline
// generator or the AI backend (both produce the same "qty ml/g ingredient"
// line shape). No-ops (aside from a plain volume rescale) on a recipe with
// no recognized alcohol line.
function applyAbvTargetToLines(lines, batchMl, targetAbvPercent) {
  const alcoholInfo = lines
    .map((line, i) => {
      const parsed = parseQuantityToken(line);
      if (!parsed || parsed.unit !== "ml") return null;
      const t = normalize(parsed.rest);
      const spiritKey = SPIRITS.find((s) => includesWord(t, s));
      if (spiritKey) return { i, kind: "spirit", ml: parsed.avgVal, abvPct: spiritAbvPercent(spiritKey) };
      const premadeKey = PREMADE_ALCOHOL.find((s) => isPremadeAlcoholMatch(t, s));
      if (premadeKey) return { i, kind: "premade", ml: parsed.avgVal, abvPct: premadeAbvPercent(premadeKey) };
      return null;
    })
    .filter(Boolean);

  const currentTotalMl = estimateBatchMlFromLines(lines);

  if (alcoholInfo.length === 0) {
    // No alcohol recognized — just a plain volume rescale (for serving-size
    // changes on a non-alcoholic recipe), nothing ABV-related to do.
    if (!(currentTotalMl > 0) || Math.round(currentTotalMl) === Math.round(batchMl)) {
      return { lines, alcoholMl: 0, actualAbvPercent: null };
    }
    const factor = batchMl / currentTotalMl;
    return { lines: lines.map((l) => rescaleMlOrGLine(l, factor)), alcoholMl: 0, actualAbvPercent: null };
  }

  const oldEthanolMl = alcoholInfo.reduce((a, x) => a + x.ml * (x.abvPct / 100), 0);
  const targetEthanolMl = (targetAbvPercent / 100) * batchMl;
  let scale = oldEthanolMl > 0 ? targetEthanolMl / oldEthanolMl : 1;

  // A buzz-level target ABV (5-9%) is always honored exactly — every stop
  // sits well inside the machine's real 2.8%-16% ABV freezing range
  // regardless of whether the alcohol comes from a spirit or a premade
  // bottle (see machineFitNote), so there's no freeze-risk reason to cap it
  // short. Only a broad physical-realism bound applies, scaled to how
  // strong the alcohol actually is: a 40%+ spirit never legitimately needs
  // more than about a quarter of the batch to reach 9%, while a much
  // weaker premade (wine ~11-13%, beer/cider/seltzer ~5%) can legitimately
  // need most of it.
  const hasSpirit = alcoholInfo.some((x) => x.kind === "spirit");
  const oldAlcoholTotalMl = alcoholInfo.reduce((a, x) => a + x.ml, 0);
  const newAlcoholRaw = oldAlcoholTotalMl * scale;
  if (hasSpirit) {
    const sanityMaxMl = batchMl * 0.5;
    if (newAlcoholRaw > sanityMaxMl) scale = sanityMaxMl / oldAlcoholTotalMl;
  } else {
    const minMl = batchMl * 0.15;
    const maxMl = batchMl * 0.95;
    if (newAlcoholRaw > maxMl) scale = maxMl / oldAlcoholTotalMl;
    else if (newAlcoholRaw < minMl) scale = minMl / oldAlcoholTotalMl;
  }

  const newAlcoholTotalMl = round5(oldAlcoholTotalMl * scale);
  const oldNonAlcoholMl = currentTotalMl - oldAlcoholTotalMl;
  const newNonAlcoholMl = batchMl - newAlcoholTotalMl;
  const nonAlcoholFactor = oldNonAlcoholMl > 0 ? newNonAlcoholMl / oldNonAlcoholMl : 1;

  const alcoholIndexes = new Set(alcoholInfo.map((x) => x.i));
  const newLines = lines.map((line, i) => rescaleMlOrGLine(line, alcoholIndexes.has(i) ? scale : nonAlcoholFactor));

  const newEthanolMl = alcoholInfo.reduce((a, x) => a + x.ml * scale * (x.abvPct / 100), 0);
  const actualAbvPercent = Math.round((newEthanolMl / batchMl) * 1000) / 10;

  return { lines: newLines, alcoholMl: newAlcoholTotalMl, actualAbvPercent };
}

/* ---------------------------------------------------------------------
 * Search & filter state
 * ------------------------------------------------------------------- */

const state = {
  query: "",
  activeTags: new Set(),
  activeDifficulties: new Set(),
  sugarFree: false,
  servingCount: null, // 3 | 4 | 6 | 8 | 10 | null — overrides batch size for custom builds only
  buzzLevel: 0, // index into BUZZ_LEVELS (0-4) — always has a default, leftmost/mildest
};

function normalize(s) {
  return s.toLowerCase().trim();
}

// Word-boundary-aware substring check. Plain .includes() lets short
// keywords collide with common longer words that happen to contain
// them — most importantly "gin" (a real spirit) matching inside "ginger"
// (as in "ginger ale"/"ginger beer", both extremely common in this app's
// own vocabulary), which without this fix miscounts a plain mixer as
// alcohol and corrupts every downstream ABV/volume calculation. \b treats
// each candidate as a whole word/phrase, so "gin" only matches standalone
// "gin," never "ginger."
function includesWord(haystack, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

// "ginger beer"/"root beer"/"birch beer" are non-alcoholic sodas that
// happen to contain "beer" as a genuine standalone word — includesWord
// alone can't tell them apart from the alcoholic drink, since "beer" really
// is its own word in "ginger beer" too. Strip these known phrases out
// before matching PREMADE_ALCOHOL's "beer" entry, so it only ever matches
// the real thing.
function withoutNonAlcoholicBeerPhrases(text) {
  return text.replace(/\b(?:ginger|root|birch)\s+beer\b/gi, "");
}

function isPremadeAlcoholMatch(haystack, s) {
  return includesWord(s === "beer" ? withoutNonAlcoholicBeerPhrases(haystack) : haystack, s);
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
  servingSizeFilters: document.getElementById("servingSizeFilters"),
  buzzStops: document.getElementById("buzzStops"),
  historyPanel: document.getElementById("historyPanel"),
  historyList: document.getElementById("historyList"),
};

const DIFFICULTIES = ["easy", "medium", "advanced"];
// "spicy"/"chocolate"/"milkshake" are still valid recipe tags (dataset
// recipes can carry them, and they still show as pills on a card) — they're
// just not offered as filter chips, per request.
const CATEGORY_TAGS_FOR_FILTER = CATEGORY_TAGS.filter((t) => !["spicy", "chocolate", "milkshake"].includes(t));

// Filter/serving chips update state only — they never call render()
// themselves. That's deliberate: you type something, make your selections,
// then hit Search/Enter once to generate — not one execution per click.
function buildChip(label, kind, value) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip";
  chip.textContent = label;
  chip.dataset.kind = kind;
  chip.dataset.value = value;
  chip.setAttribute("aria-pressed", "false");
  chip.addEventListener("click", () => {
    const targetSet = kind === "tag" ? state.activeTags : state.activeDifficulties;
    if (targetSet.has(value)) {
      targetSet.delete(value);
      chip.classList.remove("active");
      chip.setAttribute("aria-pressed", "false");
    } else {
      targetSet.add(value);
      chip.classList.add("active");
      chip.setAttribute("aria-pressed", "true");
    }
  });
  return chip;
}

function initFilterChips() {
  CATEGORY_TAGS_FOR_FILTER.forEach((tag) => {
    els.tagFilters.appendChild(buildChip(capitalize(tag), "tag", tag));
  });
  DIFFICULTIES.forEach((d) => {
    els.difficultyFilters.appendChild(buildChip(capitalize(d), "difficulty", d));
  });
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Single-select (unlike the multi-select chips above): only one serving
// count applies at a time, since it maps directly to one batch size. Only
// affects custom-drink generation, never dataset filtering — dataset
// recipes already have a fixed batch.
const SERVING_SIZE_OPTIONS = [3, 4, 6, 8, 10];

function initServingSizeChips() {
  if (!els.servingSizeFilters) return;
  SERVING_SIZE_OPTIONS.forEach((count) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = String(count);
    chip.dataset.kind = "servingCount";
    chip.dataset.value = String(count);
    chip.setAttribute("aria-pressed", "false");
    chip.addEventListener("click", () => {
      const wasActive = state.servingCount === count;
      els.servingSizeFilters.querySelectorAll(".chip").forEach((c) => {
        c.classList.remove("active");
        c.setAttribute("aria-pressed", "false");
      });
      state.servingCount = wasActive ? null : count;
      if (!wasActive) {
        chip.classList.add("active");
        chip.setAttribute("aria-pressed", "true");
      }
      // Serving size is one of the two selectors (with buzz level) that DO
      // adjust an already-shown recipe's numbers directly — drink-type and
      // difficulty chips never do this.
      liveAdjustCurrentRecipes();
    });
    els.servingSizeFilters.appendChild(chip);
  });
}

// Single-select "radial" stops (native radio buttons, styled) rather than a
// literal <input type=range> — 5 fixed, meaningful stops instead of a
// continuous drag. Always has a value (defaults to leftmost/mildest); like
// serving size, changing it live-adjusts whatever custom recipes are
// already on screen (see liveAdjustCurrentRecipes()). The tipsy-face emoji
// only appear at the two end captions (index.html) — the actual target
// ABV% is never shown anywhere in the UI.
function initBuzzLevelSlider() {
  if (!els.buzzStops) return;
  BUZZ_LEVELS.forEach((level, i) => {
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "buzzLevel";
    radio.className = "buzz-radio";
    radio.value = String(i);
    radio.checked = i === state.buzzLevel;
    radio.addEventListener("change", () => {
      state.buzzLevel = i;
      liveAdjustCurrentRecipes();
    });
    els.buzzStops.appendChild(radio);
  });
}

// Dataset recipes always show their original, as-authored numbers —
// the serving-size/buzz-level selectors only ever affect custom builds
// (see buildCustomRecipesFromText/rescaleRecipeForSelections), never the
// dataset.
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

  // Reused for the Brix note below too, so its effective-Brix math (and
  // the allulose FPD weighting) reflects whatever's actually shown on the
  // card — the sugar-free swap when that toggle is on, the original sugar
  // otherwise.
  const displayLines = recipe.ingredients.map((line) => (state.sugarFree ? rewriteIngredientForSugarFree(line) : line));

  const ingList = document.createElement("ul");
  ingList.className = "ingredient-list";
  recipe.ingredients.forEach((line, i) => {
    const li = document.createElement("li");
    const sugarFreeLine = displayLines[i];
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

  const brixBatchMl = estimateBatchMlFromLines(displayLines);
  const brixAbvInfo = estimateAbv(displayLines, brixBatchMl);
  const brixNote = formatBrixNote(displayLines, brixBatchMl, brixAbvInfo ? brixAbvInfo.abvPercent : null);
  if (brixNote) {
    const brixEl = document.createElement("p");
    brixEl.className = brixNote.inRange ? "brix-note" : "brix-note brix-warning";
    brixEl.textContent = `🍬 ${brixNote.text}`;
    card.appendChild(brixEl);
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


/* ---------------------------------------------------------------------
 * Brix estimation — the community's real target for texture is tighter
 * than the machine's bare freezing floor. This is a heuristic, not a lab
 * refractometer reading: it estimates sugar content from the SAME
 * ingredient lines everything else in this app already works from —
 * explicit sugar/syrup amounts count at (approximately) their real
 * weight, and juice/soda/dairy bases get a reasonable assumed
 * natural-sugar content, since this app doesn't have real nutrition data
 * per ingredient.
 *
 * Sugar and allulose are graded against TWO DIFFERENT windows, not one
 * shared number. Allulose depresses the freezing point roughly ~1.9x as
 * hard per gram as real sugar, so a recipe relying on allulose needs
 * proportionally less of it to hit the same freezing effect — its ideal
 * window is roughly the sugar window scaled down by that ~1.9x factor
 * (13-15 / ~1.9 ≈ 6.8-7.9, widened a bit for margin to ~5-8). Each
 * recipe is graded against whichever window matches its actual dominant
 * sweetener (by real mass), rather than trying to force both onto one
 * "effective" number.
 * ------------------------------------------------------------------- */

const SUGAR_IDEAL_MIN = 13;
const SUGAR_IDEAL_MAX = 15;
const SUGAR_IDEAL_MID = 14;
const SUGAR_FLOOR = 4.5; // ~4-5 g/100ml
const SUGAR_CAUTION_MAX = 18;
const SUGAR_FAILURE_MIN = 25; // "approaching/exceeding ~25-30"

const ALLULOSE_IDEAL_MIN = 5;
const ALLULOSE_IDEAL_MAX = 8;
const ALLULOSE_IDEAL_MID = 6.5;
const ALLULOSE_FLOOR = 2;
const ALLULOSE_CAUTION_MAX = 10;
const ALLULOSE_FAILURE_MIN = 14;

const SUGAR_BRIX_WINDOW = {
  sweetener: "sugar",
  floor: SUGAR_FLOOR,
  min: SUGAR_IDEAL_MIN,
  max: SUGAR_IDEAL_MAX,
  mid: SUGAR_IDEAL_MID,
  cautionMax: SUGAR_CAUTION_MAX,
  failureMin: SUGAR_FAILURE_MIN,
};
const ALLULOSE_BRIX_WINDOW = {
  sweetener: "allulose",
  floor: ALLULOSE_FLOOR,
  min: ALLULOSE_IDEAL_MIN,
  max: ALLULOSE_IDEAL_MAX,
  mid: ALLULOSE_IDEAL_MID,
  cautionMax: ALLULOSE_CAUTION_MAX,
  failureMin: ALLULOSE_FAILURE_MIN,
};

// Full four-tier classification against whichever window applies:
//   < floor            → low-sugar alert, likely won't slush
//   floor - min         → under the sweet spot, freezes harder/icier
//   min - max           → ideal
//   max - cautionMax     → caution: texture goes soft/syrupy
//   cautionMax - failureMin → elevated risk, approaching failure
//   >= failureMin        → likely failure: may never fully freeze
function classifyBrix(brix, win) {
  if (brix < win.floor) return "floor";
  if (brix < win.min) return "below";
  if (brix <= win.max) return "ideal";
  if (brix <= win.cautionMax) return "caution";
  if (brix < win.failureMin) return "elevated";
  return "failure";
}

// Grams of dissolved sugar per ml of an ingredient at typical concentration
// — used only for ingredients that AREN'T already a direct "N g sugar"
// line. Deliberately approximate; sourced from typical nutrition-label
// ballparks, not measured per-recipe.
const SIMPLE_SYRUP_SUGAR_G_PER_ML = 0.6; // ~50 Brix 1:1 syrup at ~1.23 g/ml density
const CONDENSED_MILK_SUGAR_G_PER_ML = 0.55; // sweetened condensed milk is very sugar-dense
const NATURAL_SUGAR_G_PER_ML = {
  juice: 0.11,
  soda: 0.1,
  dairy: 0.05, // lactose + any inherent sweetness; conservative
  premadeMix: 0.12, // margarita/daiquiri mix, lemonade, sweetened iced tea
};

// Single pass over every ingredient line that returns BOTH the total real
// dissolved-sugar mass AND, separately, how much of that mass came from
// allulose specifically — the latter is what decides which Brix window
// (sugar's ~13-15 vs allulose's ~5-8) a recipe should be graded against.
function computeSugarLoad(ingredientLines) {
  let realGrams = 0;
  let alluloseGrams = 0;
  ingredientLines.forEach((line) => {
    const parsed = parseQuantityToken(line);
    if (!parsed) return;
    const t = normalize(parsed.rest);
    if (parsed.unit === "g" && /\ballulose\b/.test(t)) {
      realGrams += parsed.avgVal;
      alluloseGrams += parsed.avgVal;
      return;
    }
    if (parsed.unit === "g" && /\bsugar\b/.test(t)) {
      realGrams += parsed.avgVal;
      return;
    }
    if (parsed.unit !== "ml") return;
    const isAlluloseSyrup = /allulose syrup/.test(t);
    let grams = 0;
    if (isAlluloseSyrup || /simple syrup/.test(t)) {
      grams = parsed.avgVal * SIMPLE_SYRUP_SUGAR_G_PER_ML;
    } else if (/condensed milk/.test(t)) {
      grams = parsed.avgVal * CONDENSED_MILK_SUGAR_G_PER_ML;
    } else if (/margarita mix|daiquiri mix|lemonade|iced tea/.test(t)) {
      grams = parsed.avgVal * NATURAL_SUGAR_G_PER_ML.premadeMix;
    } else if (normalizedIncludesAny(t, JUICE_FRUIT_WORDS)) {
      grams = parsed.avgVal * NATURAL_SUGAR_G_PER_ML.juice;
    } else if (normalizedIncludesAny(t, SODA_WORDS)) {
      grams = parsed.avgVal * NATURAL_SUGAR_G_PER_ML.soda;
    } else if (normalizedIncludesAny(t, DAIRY_WORDS)) {
      grams = parsed.avgVal * NATURAL_SUGAR_G_PER_ML.dairy;
    }
    realGrams += grams;
    if (isAlluloseSyrup) alluloseGrams += grams;
  });
  return { realGrams, alluloseGrams };
}

function estimateSugarGrams(ingredientLines) {
  return computeSugarLoad(ingredientLines).realGrams;
}

// Which Brix window a recipe should be graded against — allulose's ~5-8
// ideal if allulose makes up the majority of its (real) sugar mass,
// sugar's ~13-15 ideal otherwise (including recipes with no sugar at all,
// so a missing-sugar recipe correctly reads as "below the sugar window"
// rather than being compared to the tighter allulose one).
function brixWindowFor(realGrams, alluloseGrams) {
  return alluloseGrams > realGrams - alluloseGrams ? ALLULOSE_BRIX_WINDOW : SUGAR_BRIX_WINDOW;
}

// Approximates total solution mass as batch volume + real sugar mass
// (water density ~1 g/ml) — close enough for a heuristic, not lab-grade
// precision.
function estimateBrix(ingredientLines, batchMl) {
  if (!(batchMl > 0)) return null;
  const { realGrams } = computeSugarLoad(ingredientLines);
  if (realGrams <= 0) return null;
  return (realGrams / (batchMl + realGrams)) * 100;
}

// abvPercent is optional — when given (and this recipe is allulose-based),
// an elevated Brix is cross-checked against ABV, since alcohol
// independently suppresses freezing point too. Both pushing in the same
// direction is flagged as a compounded risk, with a concrete suggestion,
// rather than just reporting the Brix number alone.
function formatBrixNote(ingredientLines, batchMl, abvPercent) {
  if (!(batchMl > 0)) return null;
  const { realGrams, alluloseGrams } = computeSugarLoad(ingredientLines);
  if (realGrams <= 0) return null;
  const brix = (realGrams / (batchMl + realGrams)) * 100;
  const rounded = Math.round(brix * 10) / 10;
  const win = brixWindowFor(realGrams, alluloseGrams);
  const isAlluloseRecipe = win.sweetener === "allulose";
  const tier = classifyBrix(rounded, win);
  const inRange = tier === "ideal";

  const status =
    tier === "floor"
      ? `well below the ~${win.floor}g/100ml floor — low-sugar alert, this likely won't slush at all`
      : tier === "below"
      ? `below the ~${win.min}-${win.max} Brix sweet spot — may freeze harder/icier than ideal`
      : tier === "ideal"
      ? `right in the community's ~${win.min}-${win.max} Brix sweet spot`
      : tier === "caution"
      ? `in the ~${win.max}-${win.cautionMax} Brix caution zone — texture may turn out soft/syrupy`
      : tier === "elevated"
      ? `well above the ~${win.cautionMax} Brix caution zone, approaching the ~${win.failureMin}+ range where the freezing point may drop below what the machine can reach`
      : `at/above ~${win.failureMin} Brix — freezing point is likely suppressed below what the machine can reach; this batch may never fully freeze`;

  const label = isAlluloseRecipe ? "Brix (allulose target: ~5-8)" : "Brix";
  let text = `Estimated ~${rounded} ${label} — ${status}.`;

  if (isAlluloseRecipe && abvPercent != null && abvPercent >= 8 && (tier === "caution" || tier === "elevated" || tier === "failure")) {
    text += ` ⚠️ High risk: allulose's freezing-point-depression effect is compounding with ~${Math.round(abvPercent * 10) / 10}% ABV — both independently fight the freeze. Try reducing the alcohol %, reducing the allulose amount, or swapping some allulose back for real sugar.`;
  }

  return { text, inRange, tier };
}

// Solves for the total sugar mass (grams) needed to hit a target Brix in a
// given batch, accounting for the fact that added sugar also adds mass:
// targetBrix = totalSugarGrams / (batchMl + totalSugarGrams) * 100.
function totalSugarGramsForBrix(batchMl, targetBrix) {
  const frac = targetBrix / 100;
  return (frac * batchMl) / (1 - frac);
}

// How much MORE sugar (grams) is needed on top of what's already estimated
// in the lines to reach a target Brix — 0 if already there or above.
function sugarGramsNeededForBrix(existingSugarGrams, batchMl, targetBrix) {
  const totalNeeded = totalSugarGramsForBrix(batchMl, targetBrix);
  return Math.max(0, round5(totalNeeded - existingSugarGrams));
}

// Defensive backstop applied to EVERY custom recipe (AI or offline) right
// before it reaches the page: caps any single explicit sugar/syrup line at
// a physically sane share of the batch. Catches cases like an AI response
// (or a template combination) suggesting hundreds of ml of syrup in a
// modest batch — clearly wrong regardless of how it got there.
const SUGAR_LINE_MAX_FRACTION = 0.25;

function isExplicitSugarLine(parsed, t) {
  return (
    (parsed.unit === "g" && /\b(sugar|allulose)\b/.test(t)) ||
    (parsed.unit === "ml" && /simple syrup|allulose syrup|condensed milk/.test(t))
  );
}

function clampExcessiveSugarLines(lines, batchMl) {
  return lines.map((line) => {
    const parsed = parseQuantityToken(line);
    if (!parsed) return line;
    const t = normalize(parsed.rest);
    if (!isExplicitSugarLine(parsed, t)) return line;
    const maxAmount = batchMl * SUGAR_LINE_MAX_FRACTION;
    if (parsed.avgVal <= maxAmount) return line;
    return rescaleMlOrGLine(line, maxAmount / parsed.avgVal);
  });
}

// Re-targets Brix after a serving-size/buzz-level rescale changed the
// batch's proportions (a bigger buzz-level target claims more of a fixed
// batch for alcohol, which otherwise drags the remaining sugar/mixer
// portion — and therefore Brix — down along with it). Only scales the
// EXPLICIT sugar-source lines (sugar/allulose/simple syrup/condensed milk)
// that a recipe already added, never natural sugar from juice/soda/dairy,
// so it stays a small correction rather than re-deriving the whole recipe.
function applyBrixTargetToLines(lines, batchMl) {
  const sugarLineInfo = lines
    .map((line, i) => {
      const parsed = parseQuantityToken(line);
      if (!parsed) return null;
      const t = normalize(parsed.rest);
      if (!isExplicitSugarLine(parsed, t)) return null;
      const isAllulose = /\ballulose\b/.test(t);
      const gramsPerUnit = parsed.unit === "g" ? 1 : /condensed milk/.test(t) ? CONDENSED_MILK_SUGAR_G_PER_ML : SIMPLE_SYRUP_SUGAR_G_PER_ML;
      const grams = parsed.avgVal * gramsPerUnit;
      return { i, isAllulose, grams };
    })
    .filter(Boolean);

  const { realGrams: totalGrams } = computeSugarLoad(lines);
  const explicitGrams = sugarLineInfo.reduce((a, x) => a + x.grams, 0);
  const naturalGrams = totalGrams - explicitGrams;

  // Which window is this recipe actually on? An existing allulose line
  // means it's already on the allulose track, so target ITS ideal (~5-8),
  // not sugar's (~13-15) — the two aren't interchangeable 1:1 (allulose
  // depresses freezing point ~1.9x as hard per gram as real sugar). No
  // explicit line yet defaults to the sugar window, matching what gets
  // added below (plain granulated sugar).
  const explicitAlluloseGrams = sugarLineInfo.filter((x) => x.isAllulose).reduce((a, x) => a + x.grams, 0);
  const win = brixWindowFor(explicitGrams, explicitAlluloseGrams);
  const targetTotalGrams = totalSugarGramsForBrix(batchMl, win.mid);
  const neededExplicitGrams = Math.max(0, targetTotalGrams - naturalGrams);

  if (sugarLineInfo.length === 0) {
    // No explicit sugar/syrup line at all — if natural sugar (juice/soda/
    // dairy already in the mix) genuinely isn't enough, ADD one rather than
    // silently leaving the recipe under-sugared. This is exactly what
    // catches an AI response (or an offline build) that forgot sugar
    // entirely — e.g. "ginger beer + whiskey + lime" with nothing else has
    // only ~8 Brix from the ginger beer alone, well short of the 13-15
    // target, and needs real sugar added to actually freeze into slush.
    if (neededExplicitGrams > 0) {
      return [...lines, `${round5(neededExplicitGrams)} g granulated sugar`];
    }
    return lines;
  }

  const scale = explicitGrams > 0 ? neededExplicitGrams / explicitGrams : 1;
  const sugarIndexes = new Set(sugarLineInfo.map((x) => x.i));
  return lines.map((line, i) => (sugarIndexes.has(i) ? rescaleMlOrGLine(line, scale) : line));
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
  const oz = Math.round(batchMl / OZ_TO_ML);
  const servings = Math.max(1, Math.round(batchMl / STANDARD_SERVING_ML));
  return `${liters} L (~${oz} oz), about ${servings} serving${servings === 1 ? "" : "s"} at ${STANDARD_SERVING_OZ} oz each`;
}

// ---- Serving-size selector ----
//
// A single-select control (see initServingSizeChips()) that, when set,
// overrides the free-text batch-size parsing above for custom builds only
// (it never affects dataset filtering, since dataset recipes already have a
// fixed batch). Sizing is exact: batchMl = servings × 6.4 oz, so selecting
// "10" lands right at the machine's real 1.9 L / 64 oz single-batch max —
// there's no serving count in SERVING_SIZE_OPTIONS that can exceed it, so
// every option is honest about what one batch can actually hold.
function batchMlForServings(count) {
  return clamp(round5(count * STANDARD_SERVING_OZ * OZ_TO_ML), 475, 1900);
}

function resolveBatchMl(freeText) {
  if (state.servingCount) return batchMlForServings(state.servingCount);
  return parseBatchMl(freeText);
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
// Guava/lychee/etc. are listed first so a real named fruit in the typed
// request always wins over a filter-chip hint fruit (pineapple/lime/lemon,
// injected later in the array) when only one can be "the" primary flavor —
// see selectedDrinkTypeHints()/injectFilterHintIngredients() below for how
// the hint still gets folded in as an additional ingredient either way.
const JUICE_FRUIT_WORDS = [
  "guava", "lychee", "kiwi", "dragonfruit", "dragon fruit", "pomegranate",
  "pineapple", "mango", "strawberry", "cranberry", "watermelon", "passionfruit",
  "passion fruit", "peach", "cherry", "raspberry", "blueberry", "grapefruit",
  "orange", "coconut", "apple", "grape", "lime", "lemon",
];
// Lime/lemon are sour accents, never a mild base juice like orange/mango/
// guava/etc. — real recipes use them as a splash (a squeeze, a couple
// tablespoons), not as 80%+ of the batch. Anywhere a lone detected fruit
// would otherwise become "most of the batch," these two get capped to a
// small accent share with water filling the rest instead — see
// buildGenericFromText/buildFromTokens. Named families (margarita,
// daiquiri, ...) already specify their own realistic lime/lemon ratios and
// aren't affected.
const ACCENT_CITRUS_WORDS = ["lime", "lemon"];
const ACCENT_CITRUS_FRACTION = 0.12;
// Fresh herbs/aromatics — never a pourable liquid base by themselves, so
// they're handled as an infusion (see applyHerbPrep) rather than being
// classified as a flavor base like a fruit/soda/dairy token would be.
const HERB_WORDS = ["mint", "basil", "rosemary", "thyme", "sage", "lavender", "cilantro"];

function normalizedIncludesAny(haystack, needles) {
  return needles.find((n) => includesWord(haystack, n)) || null;
}

// Builds the "flavor + water" split of a batch, treating a lone lime/lemon
// detection as a small accent splash (see ACCENT_CITRUS_WORDS) rather than
// the usual mixerRatio-sized base — used by both the generic fallback and
// (via the same idea) anywhere else a single detected fruit would
// otherwise become the bulk of the batch.
function buildFruitOrSodaLines(remainingMl, fruit, soda, mixerRatio) {
  if (fruit && ACCENT_CITRUS_WORDS.includes(fruit) && !soda) {
    const accentMl = round5(remainingMl * ACCENT_CITRUS_FRACTION);
    return [`${accentMl} ml fresh ${fruit} juice`, `${round5(remainingMl - accentMl)} ml water`];
  }
  const mixerName = fruit ? `${fruit} juice` : soda || "juice or soda of choice";
  return [`${round5(remainingMl * mixerRatio)} ml ${mixerName}`, `${round5(remainingMl * (1 - mixerRatio))} ml water`];
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
    // "limeade" is its own already-diluted, already-sweetened mixer — same
    // template shape as lemonade, so plain "lime" detection in the generic
    // fallback below never mistakes it for straight lime juice.
    aliases: ["spiked limeade"], preset: "SPIKED SLUSH", tags: ["cocktail", "citrus", "refreshing"], spirit: "vodka",
    components: [{ name: "limeade", weight: 4 }],
  },
  {
    aliases: ["limeade"], preset: "SLUSH", tags: ["refreshing", "citrus"],
    components: [{ name: "limeade", weight: 5 }],
  },
  {
    aliases: ["iced tea", "ice tea"], preset: "SLUSH", tags: ["refreshing"],
    components: [{ name: "sweetened iced tea", weight: 5 }],
  },
];

function findDrinkFamily(normalizedText) {
  // "spiked lemonade"/"spiked limeade" must win over the plain form;
  // families are checked in the declared order above, so list the more
  // specific one first.
  for (const family of DRINK_FAMILIES) {
    if (family.aliases.some((a) => normalizedText.includes(a))) return family;
  }
  // "lemonade"/"limeade" + any spirit word but no named cocktail → treat as spiked
  if (normalizedText.includes("lemonade") && SPIRITS.some((s) => includesWord(normalizedText, s))) {
    return DRINK_FAMILIES.find((f) => f.aliases.includes("spiked lemonade"));
  }
  if (normalizedText.includes("limeade") && SPIRITS.some((s) => includesWord(normalizedText, s))) {
    return DRINK_FAMILIES.find((f) => f.aliases.includes("spiked limeade"));
  }
  return null;
}

// ---- Building ingredient lines from a family/component list ----

// Nudges a component's weight slightly toward the first or last item in its
// group, driven by the same `mixerRatio` a style already carries (see
// GENERIC_VARIANT_STYLES) — this is how the 3 custom-recipe variants differ
// in flavor balance without touching sugar/spirit dosing math at all, which
// stays governed entirely by ensureSugar (Brix-targeted)/recommendedSpiritMl.
function styleWeight(baseWeight, index, count, style) {
  if (!style || count < 2) return baseWeight;
  const delta = (style.mixerRatio - 0.8) * 0.5; // small: mixerRatio only ranges ~0.75-0.9
  if (index === 0) return baseWeight * (1 - delta);
  if (index === count - 1) return baseWeight * (1 + delta);
  return baseWeight;
}

function buildComponentIngredients(components, batchMl, spiritMl, spiritDisplay, style) {
  const nonSweetenerComponents = components.filter((c) => !c.isSweetener);
  const nonSweetenerWeight = nonSweetenerComponents.reduce(
    (a, c, i) => a + styleWeight(c.weight, i, nonSweetenerComponents.length, style),
    0
  );
  const remainingMl = batchMl - spiritMl;
  const lines = [];
  nonSweetenerComponents.forEach((c, i) => {
    const w = styleWeight(c.weight, i, nonSweetenerComponents.length, style);
    const ml = round5((w / nonSweetenerWeight) * remainingMl);
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
  applyHerbPrep(lines, prepSteps, "mint");
}

// A fresh herb/aromatic never becomes "the base" of a batch — it's an
// infusion into a small amount of syrup instead. Used both for named
// families with mintPrep (mojito) and for a bare herb mentioned in free
// text or an ingredient list, so "mint, gin" never ends up trying to pour
// hundreds of ml of literal mint as if it were a liquid.
function applyHerbPrep(lines, prepSteps, herbName) {
  lines.push(`60 ml ${herbName}-infused simple syrup (see prep)`);
  prepSteps.push(
    `Muddle a handful of fresh ${herbName} leaves with 60 ml simple syrup (or allulose syrup), let steep 15-20 min, then strain out the leaves before adding to the batch.`
  );
}

// Tops up sugar to land at the community's ~13-15 Brix sweet spot
// (targeting the midpoint, 14) rather than a flat percentage — computed
// from whatever natural sugar is ALREADY estimated in the lines (juice,
// soda, dairy, any syrup already added), so a juice-based drink that's
// already close to 14 Brix gets little or nothing added, while a savory
// base (a Bloody Mary, a bare spirit-and-water combo) gets however much it
// actually needs, not a fixed guess.
function ensureSugar(lines, batchMl, forceSugar) {
  const { realGrams: existingSugarGrams } = computeSugarLoad(lines);
  const currentBrix = batchMl > 0 ? (existingSugarGrams / batchMl) * 100 : 0;
  if (!forceSugar && currentBrix >= SUGAR_IDEAL_MIN) return false;
  const neededGrams = sugarGramsNeededForBrix(existingSugarGrams, batchMl, SUGAR_IDEAL_MID);
  if (neededGrams <= 0) return false;
  lines.push(`${neededGrams} g granulated sugar`);
  return true;
}

function machineFitNote({ isSpiked, isPremade, spiritMl, batchMl, addedSugar, mocktail, actualAbvPercent }) {
  if (mocktail) {
    return `Made non-alcoholic per your request — without alcohol as antifreeze, the sugar in this batch is what lets it freeze, so keep the full-sugar (or allulose, in Sugar-Free mode) version rather than a diet base alone.`;
  }
  // Both alcoholic branches describe the REAL computed ABV (actual ethanol
  // content ÷ batch volume, from applyAbvTargetToLines) — never a flat
  // claim derived from spirit/premade volume alone, which would be wrong
  // (120 ml of 40% tequila in a 1.2 L batch is ~4% ABV, not the ~10% a
  // volume-only calculation would suggest). The machine's real freezing
  // range is 2.8%-16% ABV regardless of whether the alcohol comes from a
  // spirit or a premade bottle — every buzz-level stop (5-9%) sits
  // comfortably inside it, so no extra caveat is needed just for landing
  // on the higher end of that range.
  if (isPremade) {
    const abvText = actualAbvPercent != null ? `sized to land at about ${actualAbvPercent}% ABV` : `needs to land between 2.8%-16% ABV to freeze`;
    return `Premade alcoholic input ${abvText} — check the label since bottled strength varies, and make sure it still has real sugar (the machine's low-sugar alert will fire otherwise).`;
  }
  if (isSpiked) {
    const abvText = actualAbvPercent != null ? `sized to land at about ${actualAbvPercent}% ABV` : `capped at ${spiritMl} ml`;
    return `Spirit ${abvText} — within the machine's safe 2.8%-16% ABV freezing range; too little and it won't slush, too much and it won't freeze at all.${addedSugar ? " Sugar topped up since the base alone was too tart/low-sugar to hit the machine's freezing threshold." : ""}`;
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
    batch_ml: batchMl, // exact batch size used to build this — lets the buzz-level/serving-size sliders rescale it later without re-parsing
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
  return SPIRITS.find((s) => includesWord(normalizedText, s)) || null;
}

function detectPremadeAlcohol(normalizedText) {
  return PREMADE_ALCOHOL.find((s) => isPremadeAlcoholMatch(normalizedText, s)) || null;
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

// Additive version of the same idea, for drink-type filter-chip hints
// (fresh lime juice for Citrus, pineapple juice for Tropical, etc.): each
// hint gets folded in as its own small line pulled out of the biggest
// existing one, UNLESS it's already represented — so "guava juice" + the
// Citrus chip keeps guava as the star and adds a real citrus ingredient
// alongside it, rather than one silently replacing the other. Never used
// for the cocktail/mocktail hints — those work through the normal spirit-
// detection/mocktail-conversion text scan instead, so alcohol amounts stay
// governed by recommendedSpiritMl's cap rather than a naive proportional
// split like this.
function injectFilterHintIngredients(lines, hints) {
  if (!hints || !hints.length || lines.length === 0) return;
  hints.forEach((hint) => {
    if (normalize(lines.join(" ")).includes(normalize(hint))) return; // already represented
    const match = lines[0].match(/^(\d+(?:\.\d+)?)\s*ml\s+(.*)$/i);
    if (!match) return;
    const totalMl = parseFloat(match[1]);
    const hintMl = round5(totalMl * 0.2);
    const remainMl = round5(totalMl - hintMl);
    if (hintMl <= 0 || remainMl <= 0) return;
    lines[0] = `${remainMl} ml ${match[2]}`;
    lines.splice(1, 0, `${hintMl} ml ${hint}`);
  });
}

function buildFromFamily(family, normalizedText, batchMl, freeText, style, injectableHints) {
  style = style || GENERIC_VARIANT_STYLES[0];
  const mocktail = MOCKTAIL_KEYWORDS.some((k) => normalizedText.includes(k));
  const spicy = SPICY_KEYWORDS.some((k) => normalizedText.includes(k));
  batchMl = Math.max(batchMl, family.minBatch || 0);

  const isAlcoholicFamily = family.preset === "SPIKED SLUSH";
  const preset = isAlcoholicFamily && mocktail ? "SLUSH" : family.preset;
  const requestedSpirit = detectSpirit(normalizedText);
  const spiritDisplay = family.spirit ? requestedSpirit || family.spirit : null;

  // Seed with a reasonable starting spirit amount — applyAbvTargetToLines
  // below resizes it (and rebalances everything else) to the buzz-level's
  // real target ABV, so this seed only matters for splitting the other
  // components sensibly, not for the final numbers.
  let spiritMl = 0;
  if (isAlcoholicFamily && !mocktail && !family.premade && spiritDisplay) {
    spiritMl = recommendedSpiritMl(batchMl);
  }

  let lines = buildComponentIngredients(
    family.components,
    batchMl,
    spiritMl,
    isAlcoholicFamily && !mocktail && !family.premade ? spiritDisplay : null,
    style
  );
  if (family.fixedExtras) lines.push(...family.fixedExtras);
  if (isAlcoholicFamily && mocktail && spiritDisplay) {
    lines.push(`zero-proof ${spiritDisplay}, to taste`);
  }
  injectExtraFruit(lines, normalizedText);
  injectFilterHintIngredients(lines, injectableHints);

  let actualAbvPercent = null;
  if (isAlcoholicFamily && !mocktail) {
    const abvResult = applyAbvTargetToLines(lines, batchMl, currentTargetAbv());
    lines = abvResult.lines;
    actualAbvPercent = abvResult.actualAbvPercent;
    spiritMl = abvResult.alcoholMl; // for the spicy-prep infusion text below
  }

  const prepSteps = [];
  if (family.mintPrep) applyMintPrep(lines, prepSteps);
  if (spicy) applySpicyPrep(lines, prepSteps, isAlcoholicFamily && !mocktail && !family.premade ? spiritDisplay : null, spiritMl);

  const addedSugar = ensureSugar(lines, batchMl, family.forceSugar);

  const fitInfo = machineFitNote({
    isSpiked: isAlcoholicFamily && !mocktail && !family.premade,
    isPremade: Boolean(family.premade) && isAlcoholicFamily && !mocktail,
    spiritMl,
    actualAbvPercent,
    batchMl,
    addedSugar,
    mocktail: isAlcoholicFamily && mocktail,
  });

  const tags = Array.from(new Set([...family.tags, ...detectTags(normalizedText)]));
  let familyLabel = titleCase(family.aliases[0]);
  const extraFruit = normalizedIncludesAny(normalizedText, JUICE_FRUIT_WORDS);
  if (extraFruit && !normalize(familyLabel).includes(extraFruit)) familyLabel = `${titleCase(extraFruit)} ${familyLabel}`;
  const sugarFreeAsked = SUGAR_FREE_KEYWORDS.some((k) => normalizedText.includes(k));
  const name = `${style.label} ${sugarFreeAsked ? "Sugar-Free " : ""}${mocktail && isAlcoholicFamily ? "Mocktail " : ""}${spicy ? "Spicy " : ""}${familyLabel}`;

  let directions = `Combine everything${prepSteps.length ? " (after the prep step above)" : ""}, run ${preset}${preset === "SPIKED SLUSH" ? ", starting near the middle of the temperature range and adjusting to taste" : ""}.`;
  if (style.note) directions += ` ${style.note}`;

  return finishRecipe({
    name, preset, tags, batchMl, lines, prepSteps, directions, fitInfo, freeText,
    servingTip: family.servingTip,
  });
}

// ---- Generic fallback (no named family recognized) ----
//
// A purely custom, open-ended request gets 3 varied recipes rather than 1
// (see buildGenericVariants below). Variety comes only from mixer/flavor
// ratios (mixerRatio, via styleWeight()) — ABV is no longer part of this
// variety at all, since the buzz-level slider is now the sole, explicit
// control over how strong an alcoholic build is (see applyAbvTargetToLines
// above); all 3 style variants of the same request land at the same target
// ABV. The sugar dosing formula (Brix-targeted, via ensureSugar) is
// also identical across every variant, so variety never comes at the cost
// of the machine's freezing chemistry.

const GENERIC_VARIANT_STYLES = [
  { label: "Classic", mixerRatio: 0.8, note: "" },
  {
    label: "Lighter Pour",
    mixerRatio: 0.75,
    note: "Garnish with a citrus wheel for a crisper finish.",
  },
  {
    label: "Extra Fruity",
    mixerRatio: 0.9,
    note: "Stir in a handful of extra fresh fruit chunks or purée just before serving for more texture.",
  },
];

function buildGenericFromText(normalizedText, batchMl, freeText, style, injectableHints) {
  style = style || GENERIC_VARIANT_STYLES[0];
  const mocktail = MOCKTAIL_KEYWORDS.some((k) => normalizedText.includes(k));
  const spicy = SPICY_KEYWORDS.some((k) => normalizedText.includes(k));
  const requestedSpirit = !mocktail ? detectSpirit(normalizedText) : null;
  const premadeAlcohol = !mocktail ? detectPremadeAlcohol(normalizedText) : null;
  const dairy = normalizedIncludesAny(normalizedText, DAIRY_WORDS);
  const coffee = normalizedIncludesAny(normalizedText, COFFEE_WORDS);
  const soda = normalizedIncludesAny(normalizedText, SODA_WORDS);
  const fruit = normalizedIncludesAny(normalizedText, JUICE_FRUIT_WORDS);

  let lines = [];
  const prepSteps = [];
  let preset = "SLUSH";
  let spiritMl = 0;
  let spiritDisplay = null;
  let isPremade = false;
  let noFlavorDetected = false;

  if (requestedSpirit) {
    preset = "SPIKED SLUSH";
    spiritDisplay = requestedSpirit;
    // Seed amount only — applyAbvTargetToLines below resizes this (and
    // rebalances the mixer/water split) to the buzz-level's real target ABV.
    spiritMl = recommendedSpiritMl(batchMl);
    const remaining = batchMl - spiritMl;
    lines.push(...buildFruitOrSodaLines(remaining, fruit, soda, style.mixerRatio));
    lines.push(`${spiritMl} ml ${spiritDisplay}`);
  } else if (premadeAlcohol) {
    preset = "SPIKED SLUSH";
    isPremade = true;
    // Seed dilution only — applyAbvTargetToLines below resizes it to the
    // buzz-level's real target ABV using this bottle's actual strength.
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
  } else if (
    (normalizedText.includes("smoothie") || normalizedText.includes("100% juice") || normalizedText.includes("real juice")) &&
    !(fruit && ACCENT_CITRUS_WORDS.includes(fruit) && !soda)
  ) {
    // Excluded when the only detected flavor is straight lime/lemon — a
    // "100% lime juice" batch isn't realistic even when asked for "100%
    // juice"; falls through to the accent-aware handling below instead.
    preset = "FROZEN JUICE";
    lines.push(`${round5(batchMl)} ml ${fruit ? `${fruit} juice` : "100% juice of choice"}`);
  } else if (fruit || soda) {
    lines.push(...buildFruitOrSodaLines(batchMl, fruit, soda, style.mixerRatio));
  } else {
    // No flavor detected at all — plain water needs sugar force-added below
    // regardless of keyword matching (there's nothing sweet to detect yet).
    lines.push(`${round5(batchMl)} ml water — pick a full-sugar flavor concentrate to add`);
    noFlavorDetected = true;
  }

  injectFilterHintIngredients(lines, injectableHints);

  // A mentioned herb (mint, basil, ...) gets its own infusion rather than
  // silently being ignored — the named-family path already does this for
  // "mojito" via mintPrep, this covers the same idea for a bare mention
  // like "mint gin drink" that doesn't match any named family.
  const herbMentioned = normalizedIncludesAny(normalizedText, HERB_WORDS);
  if (herbMentioned) applyHerbPrep(lines, prepSteps, herbMentioned);

  let actualAbvPercent = null;
  if (preset === "SPIKED SLUSH" && !mocktail) {
    const abvResult = applyAbvTargetToLines(lines, batchMl, currentTargetAbv());
    lines = abvResult.lines;
    actualAbvPercent = abvResult.actualAbvPercent;
    spiritMl = abvResult.alcoholMl; // for the spicy-prep infusion text below
  }

  if (spicy) applySpicyPrep(lines, prepSteps, spiritDisplay, spiritMl);
  const addedSugar = ensureSugar(lines, batchMl, preset === "MILKSHAKE" || preset === "FRAPPE" || noFlavorDetected);

  const tags = detectTags(normalizedText);
  if (tags.length === 0) tags.push(preset === "SPIKED SLUSH" ? "cocktail" : "refreshing");

  const fitInfo = machineFitNote({
    isSpiked: preset === "SPIKED SLUSH" && !isPremade,
    isPremade,
    spiritMl,
    actualAbvPercent,
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
function buildGenericVariants(normalizedText, batchMl, freeText, injectableHints) {
  return GENERIC_VARIANT_STYLES.map((style) => buildGenericFromText(normalizedText, batchMl, freeText, style, injectableHints));
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
  const herb = normalizedIncludesAny(t, HERB_WORDS);
  if (herb) return { type: "herb", display: token, raw: token, herbName: herb };
  return { type: "other", display: token, raw: token };
}

function buildFromTokens(tokens, normalizedText, batchMl, freeText, variantLabel, useCount, style) {
  style = style || GENERIC_VARIANT_STYLES[0];
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
  let lines = [];
  const prepSteps = [];
  let isPremade = false;
  let noFlavorDetected = false;

  // Seed amounts only — applyAbvTargetToLines below resizes whatever
  // alcohol ends up in `lines` to the buzz-level's real target ABV.
  if (spiritToken) spiritMl = recommendedSpiritMl(batchMl);
  if (premadeToken) isPremade = true;

  const flavorBases = baseTokens.length ? baseTokens : used.filter((t) => t.type === "other");
  const premadeRatio = clamp(style.mixerRatio, 0.75, 0.9);
  const reserved = spiritMl + (isPremade ? round5(batchMl * premadeRatio) : 0);
  const remaining = batchMl - reserved;

  const soleAccentCitrus =
    flavorBases.length === 1 && flavorBases[0].type === "fruit" && ACCENT_CITRUS_WORDS.includes(normalize(flavorBases[0].display));

  if (isPremade) {
    lines.push(`${round5(batchMl * premadeRatio)} ml ${premadeToken.display}`);
    lines.push(`${round5(batchMl * (1 - premadeRatio))} ml water or soda (to keep it in the 2.8-16% ABV range)`);
  } else if (soleAccentCitrus) {
    // A lone lime/lemon is a sour accent, never the bulk of the batch (see
    // ACCENT_CITRUS_WORDS) — cap it to a splash and fill the rest with
    // water, the same treatment the generic fallback already gets.
    const accentMl = round5(remaining * ACCENT_CITRUS_FRACTION);
    lines.push(`${accentMl} ml fresh ${flavorBases[0].display} juice`, `${round5(remaining - accentMl)} ml water`);
  } else if (flavorBases.length > 0) {
    const weights = flavorBases.map((_, i) => styleWeight(i === 0 ? 2 : 1, i, flavorBases.length, style));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    flavorBases.forEach((tok, i) => {
      const ml = round5((weights[i] / totalWeight) * remaining);
      const alreadyDescribesForm = /juice|pur[ée]e|nectar|smoothie/i.test(tok.display);
      const label = tok.type === "fruit" && !alreadyDescribesForm ? `${tok.display} juice or purée` : tok.display;
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

  // Herbs (mint, basil, ...) are never a pourable base — each becomes its
  // own small infusion instead of trying to fill the batch with "715 ml
  // mint," which isn't a real liquid.
  const herbTokens = used.filter((t) => t.type === "herb");
  herbTokens.forEach((t) => applyHerbPrep(lines, prepSteps, t.herbName));

  let actualAbvPercent = null;
  if (preset === "SPIKED SLUSH" && !mocktail) {
    const abvResult = applyAbvTargetToLines(lines, batchMl, currentTargetAbv());
    lines = abvResult.lines;
    actualAbvPercent = abvResult.actualAbvPercent;
    spiritMl = abvResult.alcoholMl; // for the spicy-prep infusion text below
  }

  if (spicy) applySpicyPrep(lines, prepSteps, spiritToken ? spiritToken.display : null, spiritMl);
  const addedSugar = ensureSugar(lines, batchMl, preset === "MILKSHAKE" || preset === "FRAPPE" || noFlavorDetected);

  const tags = detectTags(normalizedText);
  if (tags.length === 0) tags.push(preset === "SPIKED SLUSH" ? "cocktail" : "refreshing");

  const fitInfo = machineFitNote({
    isSpiked: preset === "SPIKED SLUSH" && !isPremade,
    isPremade,
    spiritMl,
    actualAbvPercent,
    batchMl,
    addedSugar,
    mocktail: mocktail && Boolean(spiritToken || premadeToken),
  });

  const usedNames = used.map((t) => t.raw).join(", ");
  const leftOutNames = tokens.slice(useCount).map((t) => t.raw);
  const name = `${spicy ? "Spicy " : ""}${variantLabel} (${usedNames})`;
  let directions = `Combine everything${prepSteps.length ? " (after the prep step above)" : ""}, run ${preset}, adjusting the temperature bar to taste.`;
  if (leftOutNames.length) directions += ` (Left out ${leftOutNames.join(", ")} for this variant — see the other version if you want everything in one batch.)`;
  if (style.note) directions += ` ${style.note}`;

  return finishRecipe({ name, preset, tags, batchMl, lines, prepSteps, directions, fitInfo, freeText });
}

function buildFromIngredientList(freeText, normalizedText, batchMl) {
  const rawTokens = freeText.split(",").map((t) => t.trim()).filter(Boolean);
  const classified = rawTokens.map(classifyIngredientToken);
  if (classified.length <= 2) {
    // Few enough tokens that dropping any would leave almost nothing — vary
    // by flavor-balance style instead (same 3-variant treatment as
    // everything else), using the full token set every time.
    return GENERIC_VARIANT_STYLES.map((style) =>
      buildFromTokens(classified, normalizedText, batchMl, freeText, style.label, classified.length, style)
    );
  }
  // Multiple candidate ingredients, open-ended request: offer 3 variants —
  // a full mix, a simplified two-ingredient twist, and a single-ingredient
  // highlight — the same "3 recipes for purely custom requests" treatment
  // as the generic fallback. Only which/how-many flavor tokens are used
  // varies; recommendedSpiritMl/ensureSugar's Brix targeting (called inside
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

// ---- Drink-type filter chips as generation hints (not hard requirements) ----
//
// The chips only ever update state (see buildChip above) — this is where
// that state actually reaches the generator. A representative real
// ingredient for each selected drink-type tag gets folded into the text the
// generator scans, so "guava juice" + the Citrus chip really does end up
// with a citrus ingredient in the result, not just a tag label on the card.
// Selections never have to ALL be satisfied — only up to 2 of them are
// actually used (a real requirement, not a suggestion, for keeping a
// generated drink coherent instead of a kitchen-sink mess); applyFilter
// SelectionNotes() below explains on the card when a selection got left out.
const TAG_INGREDIENT_HINTS = {
  creamy: "heavy cream",
  refreshing: "club soda",
  fruity: "mixed berry purée",
  tropical: "pineapple juice",
  citrus: "fresh lime juice",
  coffee: "chilled cold brew",
  cocktail: "vodka",
  mocktail: "mocktail",
};
// cocktail/mocktail are scan-only: they steer the existing spirit-detection/
// mocktail-conversion text scan (so alcohol amounts stay governed by
// recommendedSpiritMl's cap, or get zeroed out, exactly as normal), rather
// than being spliced in as a naive raw ingredient line the way a flavor
// hint is — injecting alcohol that way would bypass the machine's cap.
const SCAN_ONLY_HINT_TAGS = new Set(["cocktail", "mocktail"]);

function selectedDrinkTypeHints(rawNormalizedText) {
  const selected = Array.from(state.activeTags);
  const used = selected.slice(0, Math.min(2, selected.length));
  const hints = [];
  const injectableHints = [];
  used.forEach((tag) => {
    // Don't override an already-named spirit/premade alcohol with the
    // "cocktail" chip's default vodka hint.
    if (tag === "cocktail" && (detectSpirit(rawNormalizedText) || detectPremadeAlcohol(rawNormalizedText))) return;
    const hint = TAG_INGREDIENT_HINTS[tag];
    if (!hint) return;
    hints.push(hint);
    if (!SCAN_ONLY_HINT_TAGS.has(tag)) injectableHints.push(hint);
  });
  return { selected, used, hints, injectableHints };
}

// ---- Entry point ----

// Pure (aside from reading the module-level `state` for filter-chip hints):
// given free text, returns an array of custom recipe objects — always at
// least 3, whether that's a named-family match, an ingredient list, or an
// open-ended description (see buildFromFamily/buildFromIngredientList/
// buildGenericVariants). No DOM side effects — the caller (render()) decides
// where these go.
function buildCustomRecipesFromText(freeText) {
  const rawNormalizedText = normalize(freeText);
  const { hints, injectableHints } = selectedDrinkTypeHints(rawNormalizedText);
  const scanText = hints.length ? `${freeText} ${hints.join(" ")}` : freeText;
  const normalizedText = normalize(scanText);
  const batchMl = resolveBatchMl(freeText);
  const looksLikeIngredientList =
    freeText.includes(",") &&
    !/\b(i want|i'd like|need|craving|give me|make me|for a)\b/i.test(rawNormalizedText) &&
    !findDrinkFamily(normalizedText);

  if (looksLikeIngredientList) {
    // Ingredient-list mode already treats commas as literal tokens, so the
    // hints go in as real extra tokens here rather than through
    // injectFilterHintIngredients (which is for the text-description paths
    // below).
    const listFreeText = hints.length ? `${freeText}, ${hints.join(", ")}` : freeText;
    return buildFromIngredientList(listFreeText, normalizedText, batchMl);
  }
  const family = findDrinkFamily(normalizedText);
  // A named drink family (e.g. "margarita") and a purely custom/open-ended
  // request both now return 3 varied recipes — see GENERIC_VARIANT_STYLES.
  if (family) {
    return GENERIC_VARIANT_STYLES.map((style) => buildFromFamily(family, normalizedText, batchMl, freeText, style, injectableHints));
  }
  return buildGenericVariants(normalizedText, batchMl, freeText, injectableHints);
}

// Applied uniformly to whatever came back (AI or offline) in
// resolveCustomForQuery — a recipe's tags get the actually-used drink-type
// selections unioned in (defensive: the hint ingredient above should already
// make detectTags() pick them up, but this guarantees it), and an honest
// note is added whenever a selection had to be left out or the built
// difficulty didn't land on a selected one, rather than silently dropping
// the mismatch or forcing an incoherent recipe to comply.
function applyFilterSelectionNotes(recipes, hintInfo) {
  const { selected, used } = hintInfo;
  const leftOut = selected.filter((t) => !used.includes(t));
  const tagNote = leftOut.length
    ? `You selected ${selected.length} drink-type filters — this build leans into ${used.map(capitalize).join(" and ")} for a coherent flavor rather than also forcing in ${leftOut.map(capitalize).join(", ")}.`
    : null;
  const difficultySelected = state.activeDifficulties.size > 0;
  return recipes.map((r) => {
    const notes = [];
    if (tagNote) notes.push(tagNote);
    if (difficultySelected && r.difficulty && !state.activeDifficulties.has(r.difficulty)) {
      notes.push(`This build came out "${r.difficulty}" rather than your selected difficulty — that's what the ingredients/prep this flavor combo needed to hit safely.`);
    }
    if (notes.length === 0) return r;
    return {
      ...r,
      tags: Array.from(new Set([...(r.tags || []), ...used])),
      machine_fit_note: r.machine_fit_note ? `${r.machine_fit_note} ${notes.join(" ")}` : notes.join(" "),
    };
  });
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

async function fetchCustomRecipesFromApi(freeText, inspirationRecipes, targetBatchMl, hintInfo) {
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
        // Best-effort hint only — the real guarantee is enforced client-side
        // in resolveCustomForQuery() regardless of what comes back, via the
        // same applyAbvTargetToLines() used for the offline generator and
        // the buzz-level/serving-size live adjustment.
        targetAbvPercent: currentTargetAbv(),
        // Best-effort hints for the AI — the client-side guarantee (real
        // ingredient injection for offline, tag-union + honest note either
        // way) lives in applyFilterSelectionNotes(), so this never needs to
        // be perfectly honored to still work.
        driveTypeFilters: hintInfo.selected,
        difficultyFilters: Array.from(state.activeDifficulties),
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
  key: null, // full request fingerprint (text + filters + serving + sugar-free) — see computeCustomRequestKey()
  recipes: [], // last resolved recipes (AI or offline) for `key`
  pending: false, // true while a fetch is in flight
  source: null, // "ai" | "offline", for the small provenance note on the card
  requestSeq: 0, // bumped on every new request — lets a stale resolve bail out
};

function renderCustomLoadingPlaceholder() {
  const el = document.createElement("p");
  el.className = "custom-loading";
  el.textContent = "✨ Thinking of a custom drink… (can take up to ~20s)";
  return el;
}

// Rescales an already-built recipe (offline OR AI-sourced — both produce
// the same "qty ml/g ingredient" line shape) to a new batch size and/or
// buzz-level target ABV, via the same applyAbvTargetToLines() used at
// build time. This is what lets the buzz-level/serving-size selectors
// adjust a recipe already on screen without a full regeneration (or a new
// AI call) — drink-type/difficulty chips never do this, by design.
function rescaleRecipeForSelections(recipe, newBatchMl, targetAbvPercent) {
  if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) return recipe;
  const oldBatchMl = recipe.batch_ml || estimateBatchMlFromLines(recipe.ingredients);
  if (!(oldBatchMl > 0)) return recipe;
  // Always runs the ABV+Brix correction, even when the batch size hasn't
  // changed and the recipe isn't alcoholic — Brix can need fixing (e.g. an
  // AI response that forgot sugar entirely) independent of batch size, and
  // both passes are cheap no-ops when a recipe is already correct.

  const abvResult = applyAbvTargetToLines(recipe.ingredients, newBatchMl, targetAbvPercent);
  // Re-target Brix after the ABV/volume rescale — a bigger buzz-level
  // target claims more of a fixed batch for alcohol, which otherwise drags
  // the remaining sugar (and therefore Brix) down along with it.
  const newLines = applyBrixTargetToLines(abvResult.lines, newBatchMl);
  const sugarFreeLines = newLines.map(rewriteIngredientForSugarFree);
  const anyLineChanged = sugarFreeLines.some((l, i) => l !== newLines[i]);
  const sugarFreeNote = anyLineChanged
    ? "Sugar swapped for allulose (~1.33x, since it's about 70% as sweet as sugar by weight) so this still clears the machine's freezing threshold — taste and adjust."
    : "This base likely needs sugar to freeze — if using a diet/zero-sugar version of any soda or juice here, add ~15-20 g granulated allulose per 355 ml to restore the sugar the machine needs.";

  let machineFit = recipe.machine_fit_note;
  if (recipe.preset === "SPIKED SLUSH" && abvResult.actualAbvPercent != null) {
    const isPremadeLine = newLines.some((l) => {
      const p = parseQuantityToken(l);
      return p && p.unit === "ml" && PREMADE_ALCOHOL.some((s) => isPremadeAlcoholMatch(normalize(p.rest), s));
    });
    machineFit = machineFitNote({
      isSpiked: !isPremadeLine,
      isPremade: isPremadeLine,
      spiritMl: abvResult.alcoholMl,
      actualAbvPercent: abvResult.actualAbvPercent,
      batchMl: newBatchMl,
      addedSugar: /sugar topped up/i.test(recipe.machine_fit_note || ""),
      mocktail: false,
    });
  }

  return {
    ...recipe,
    batch_ml: newBatchMl,
    batch_note: batchNote(newBatchMl),
    ingredients: newLines,
    sugar_free_ingredients: sugarFreeLines,
    sugar_free_note: sugarFreeNote,
    machine_fit_note: machineFit,
    difficulty: difficultyFor(newLines, recipe.prep_steps || []),
  };
}

// Fires from the buzz-level and serving-size controls only. No-ops if
// nothing is on screen yet — the current values just apply to whatever
// gets built next time a fresh Search runs.
function liveAdjustCurrentRecipes() {
  if (!customState.recipes.length) return; // no custom build on screen — dataset cards are never affected
  const newBatchMl = resolveBatchMl(customState.query || "");
  const targetAbv = currentTargetAbv();
  customState.recipes = customState.recipes.map((r) => rescaleRecipeForSelections(r, newBatchMl, targetAbv));
  // Keep the fingerprint in sync so a later Search (with nothing else
  // changed) sees these are already accounted for, instead of redundantly
  // re-querying the AI for the same adjustment we just made client-side.
  customState.key = computeCustomRequestKey((customState.query || "").trim());
  render();
}

async function resolveCustomForQuery(freeText, mySeq) {
  const inspiration = pickInspirationRecipes(freeText, 6);
  const targetBatchMl = resolveBatchMl(freeText);
  const hintInfo = selectedDrinkTypeHints(normalize(freeText));
  let recipes;
  let source;
  if (CUSTOM_DRINK_API_URL) {
    try {
      recipes = await fetchCustomRecipesFromApi(freeText, inspiration, targetBatchMl, hintInfo);
      source = "ai";
    } catch (err) {
      recipes = buildCustomRecipesFromText(freeText);
      source = "offline";
    }
  } else {
    recipes = buildCustomRecipesFromText(freeText);
    source = "offline";
  }

  if (mySeq !== customState.requestSeq) return; // superseded by a newer request since we started

  // AI-returned recipes get the buzz-level's real target ABV enforced the
  // same way an offline build or a live slider adjustment does — never
  // trust the AI's own arithmetic for something this safety-relevant, only
  // its ingredient/flavor choices.
  if (source === "ai") {
    const targetAbv = currentTargetAbv();
    recipes = recipes.map((r) => rescaleRecipeForSelections(r, targetBatchMl, targetAbv));
  }

  // Defensive backstop against an absurdly large sugar/syrup line (AI or
  // offline) — e.g. hundreds of ml of simple syrup in a modest batch —
  // regardless of how it got there. Re-derives sugar_free_ingredients from
  // the clamped lines too, so it doesn't go stale relative to `ingredients`.
  recipes = recipes.map((r) => {
    const clamped = clampExcessiveSugarLines(r.ingredients, r.batch_ml || targetBatchMl);
    if (clamped.every((l, i) => l === r.ingredients[i])) return r; // nothing changed
    return { ...r, ingredients: clamped, sugar_free_ingredients: clamped.map(rewriteIngredientForSugarFree) };
  });

  // Applied uniformly regardless of source (AI or offline) — never relies on
  // the AI having honored the filter-selection hints itself.
  const finalRecipes = applyFilterSelectionNotes(recipes, hintInfo);
  customState.recipes = finalRecipes;
  customState.pending = false;
  customState.source = source;
  addHistoryEntry({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    query: freeText,
    timestamp: Date.now(),
    source,
    sugarFree: state.sugarFree,
    servingCount: state.servingCount,
    buzzLevel: state.buzzLevel,
    activeTags: Array.from(state.activeTags),
    activeDifficulties: Array.from(state.activeDifficulties),
    recipes: finalRecipes,
    starred: false,
  });
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

  if (Array.isArray(ingredients) && ingredients.length) {
    // Use whatever's actually displayed (sugar_free_ingredients when the
    // toggle is on) so the effective-Brix/allulose-FPD math matches the
    // card, same as the dataset card above.
    const brixBatchMl = estimateBatchMlFromLines(ingredients);
    const brixAbvInfo = estimateAbv(ingredients, brixBatchMl);
    const brixNote = formatBrixNote(ingredients, brixBatchMl, brixAbvInfo ? brixAbvInfo.abvPercent : null);
    if (brixNote) {
      const brixEl = document.createElement("p");
      brixEl.className = brixNote.inRange ? "brix-note" : "brix-note brix-warning";
      brixEl.textContent = `🍬 ${brixNote.text}`;
      card.appendChild(brixEl);
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

/* ---------------------------------------------------------------------
 * Local custom-drink history, with starring
 *
 * Every resolved custom search (AI or offline) gets recorded in
 * localStorage — query text, the filter/serving/sugar-free context it was
 * built under, and the actual resolved recipes. Clicking an entry restores
 * it exactly (no re-query, no regeneration) — the point being: an AI build
 * can vary run-to-run even for a similar request, so this is how you get
 * back to the *exact* one you saw before rather than a fresh, possibly
 * different, one. Starring exempts an entry from the trim-to-cap eviction
 * below, so favorites stick around indefinitely; per-browser only (this
 * never leaves localStorage, so it doesn't sync across devices).
 * ------------------------------------------------------------------- */

const HISTORY_STORAGE_KEY = "ninja-slushi-custom-history";
const HISTORY_MAX_UNSTARRED = 20;

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return []; // localStorage unavailable (private mode, etc.) — history just won't persist
  }
}

function saveHistory(history) {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch (e) {
    /* localStorage unavailable — silently skip persisting */
  }
}

function addHistoryEntry(entry) {
  const history = loadHistory();
  history.unshift(entry);
  // Trim unstarred entries beyond the cap; never evict a starred one.
  let unstarredSeen = 0;
  const trimmed = history.filter((h) => {
    if (h.starred) return true;
    unstarredSeen += 1;
    return unstarredSeen <= HISTORY_MAX_UNSTARRED;
  });
  saveHistory(trimmed);
  renderHistoryPanel();
}

function toggleStarHistoryEntry(id) {
  const history = loadHistory();
  const entry = history.find((h) => h.id === id);
  if (!entry) return;
  entry.starred = !entry.starred;
  saveHistory(history);
  renderHistoryPanel();
}

function deleteHistoryEntry(id) {
  saveHistory(loadHistory().filter((h) => h.id !== id));
  renderHistoryPanel();
}

function formatHistoryTimestamp(ts) {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Restores every part of the search context an entry was built under, then
// feeds its stored recipes straight into customState — no fetch, no
// regeneration — which is the entire point of the feature.
function restoreHistoryEntry(entry) {
  state.query = entry.query;
  state.sugarFree = Boolean(entry.sugarFree);
  state.servingCount = entry.servingCount || null;
  state.buzzLevel = typeof entry.buzzLevel === "number" ? entry.buzzLevel : 0;
  state.activeTags = new Set(entry.activeTags || []);
  state.activeDifficulties = new Set(entry.activeDifficulties || []);

  els.query.value = entry.query;
  els.sugarFreeToggle.checked = state.sugarFree;
  document.body.classList.toggle("sugar-free-mode", state.sugarFree);
  document.querySelectorAll("#tagFilters .chip").forEach((c) => {
    const active = state.activeTags.has(c.dataset.value);
    c.classList.toggle("active", active);
    c.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("#difficultyFilters .chip").forEach((c) => {
    const active = state.activeDifficulties.has(c.dataset.value);
    c.classList.toggle("active", active);
    c.setAttribute("aria-pressed", String(active));
  });
  if (els.servingSizeFilters) {
    els.servingSizeFilters.querySelectorAll(".chip").forEach((c) => {
      const active = Number(c.dataset.value) === state.servingCount;
      c.classList.toggle("active", active);
      c.setAttribute("aria-pressed", String(active));
    });
  }
  if (els.buzzStops) {
    els.buzzStops.querySelectorAll('input[name="buzzLevel"]').forEach((radio) => {
      radio.checked = Number(radio.value) === state.buzzLevel;
    });
  }

  const trimmedQuery = entry.query.trim();
  customState.query = trimmedQuery;
  customState.key = computeCustomRequestKey(trimmedQuery);
  customState.recipes = entry.recipes;
  customState.pending = false;
  customState.source = entry.source;
  customState.requestSeq++; // invalidate any in-flight fetch for a different request
  render();
}

function renderHistoryPanel() {
  if (!els.historyPanel || !els.historyList) return;
  const history = loadHistory();
  els.historyList.innerHTML = "";
  if (history.length === 0) {
    els.historyPanel.hidden = true;
    return;
  }
  els.historyPanel.hidden = false;
  const sorted = [...history].sort((a, b) => Number(b.starred) - Number(a.starred) || b.timestamp - a.timestamp);
  sorted.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "history-item";

    const starBtn = document.createElement("button");
    starBtn.type = "button";
    starBtn.className = `history-star${entry.starred ? " starred" : ""}`;
    starBtn.setAttribute("aria-label", entry.starred ? "Unstar this build" : "Star this build");
    starBtn.textContent = entry.starred ? "⭐" : "☆";
    starBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleStarHistoryEntry(entry.id);
    });

    const label = document.createElement("button");
    label.type = "button";
    label.className = "history-label";
    label.textContent = `${entry.query} · ${formatHistoryTimestamp(entry.timestamp)}`;
    label.title = "View this custom build again (no re-query)";
    label.addEventListener("click", () => restoreHistoryEntry(entry));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "history-delete";
    delBtn.setAttribute("aria-label", "Remove from history");
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteHistoryEntry(entry.id);
    });

    item.appendChild(starBtn);
    item.appendChild(label);
    item.appendChild(delBtn);
    els.historyList.appendChild(item);
  });
}

// A full fingerprint of everything that changes what gets GENERATED — not
// just the typed text, but every chip and the serving size too. Changing
// any of it and hitting Search counts as a new request; an exact repeat
// reuses the cached result instead of re-querying. Sugar-Free is
// deliberately excluded: every generated recipe already carries both a
// regular and a sugar-free ingredient list, so toggling it is a display
// choice handled at render time, not something that needs regenerating.
function computeCustomRequestKey(trimmedQuery) {
  return JSON.stringify({
    q: trimmedQuery,
    tags: Array.from(state.activeTags).sort(),
    diff: Array.from(state.activeDifficulties).sort(),
    serving: state.servingCount,
    buzz: state.buzzLevel,
  });
}

function render() {
  const trimmedQuery = state.query.trim();
  const hasFilters = state.activeTags.size > 0 || state.activeDifficulties.size > 0;
  const hasSearched = trimmedQuery.length > 0 || hasFilters;
  const wantsCustom = trimmedQuery.length >= CUSTOM_MIN_QUERY_LENGTH;

  els.results.innerHTML = "";

  if (!hasSearched) {
    customState.requestSeq++; // invalidate any in-flight fetch
    customState.query = null;
    customState.key = null;
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
    const requestKey = computeCustomRequestKey(trimmedQuery);
    if (requestKey !== customState.key) {
      // Text OR any selection (filters, serving size, sugar-free) changed
      // since the last search — reset and kick off the fetch/build right
      // away. render() only runs on an explicit action (Search button,
      // Enter), never on every keystroke or chip click, so there's no need
      // to additionally debounce here — the Search button *is* the debounce.
      customState.query = trimmedQuery;
      customState.key = requestKey;
      customState.recipes = [];
      customState.pending = true;
      customState.requestSeq++;
      const mySeq = customState.requestSeq;
      resolveCustomForQuery(trimmedQuery, mySeq);
    }
    // else: an exact repeat of the last search — customState already holds
    // the right pending/resolved data, reuse it rather than re-querying.
  } else {
    customState.requestSeq++;
    customState.query = null;
    customState.key = null;
    customState.recipes = [];
    customState.pending = false;
  }

  const filtered = getFilteredRecipes();

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
  initServingSizeChips();
  initBuzzLevelSlider();
  renderHistoryPanel();

  // Typing alone doesn't trigger a search, and neither does clicking a
  // filter/serving chip — only an explicit action does (the Search button
  // or pressing Enter), so the custom drink builder fires once per finished
  // selection, not once per click.
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
    state.servingCount = null;
    state.buzzLevel = 0;
    els.query.value = "";
    document.querySelectorAll(".chip.active").forEach((c) => {
      c.classList.remove("active");
      c.setAttribute("aria-pressed", "false");
    });
    if (els.buzzStops) {
      const leftmost = els.buzzStops.querySelector('input[value="0"]');
      if (leftmost) leftmost.checked = true;
    }
    render();
  });

  render();
}

document.addEventListener("DOMContentLoaded", init);
