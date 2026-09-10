/**
 * Ninja Slushi custom-drink backend — Cloudflare Worker.
 *
 * Receives { query, sugarFree, inspiration } from the frontend, calls the
 * Gemini API server-side (key never touches the browser), and returns
 * { recipes: [...] } in the same shape the frontend's offline generator
 * already produces, so the same rendering code handles either source.
 *
 * On any error, this returns a non-200 response — the frontend catches that
 * and falls back to its own offline rule-based generator, so a Gemini
 * outage, a bad key, or exhausted free-tier quota never breaks the feature,
 * it just quietly stops being the "smarter" path for a while.
 *
 * Deploy: paste this whole file into the Worker's "Edit code" editor in the
 * Cloudflare dashboard, then Settings → Variables and Secrets → add
 * GEMINI_API_KEY (as a Secret, not plaintext) before saving/deploying.
 * See worker/README.md for the full walkthrough.
 */

// Swap this if Google retires/renames the model — see
// https://ai.google.dev/gemini-api/docs/models for current IDs and free-tier limits.
const GEMINI_MODEL = "gemini-2.0-flash";

function geminiUrl(apiKey) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
}

// Only these origins get a real CORS allow — anyone else's fetch to this
// Worker is blocked by the browser before it can read the response (the key
// stays safe either way, since it never leaves this Worker, but this stops
// other sites from riding on your Gemini quota via your Worker).
const ALLOWED_ORIGINS = new Set([
  "https://applecow5000.github.io",
  "null", // a page opened via file:// sends this literal Origin value
]);

const MAX_QUERY_LENGTH = 300;
const MAX_INSPIRATION_RECIPES = 6;
const GEMINI_TIMEOUT_MS = 15000;

// Same machine chemistry as the offline generator (see
// references/sugar-alcohol-and-alerts.md and references/additives-and-texture.md
// in the repo), plus the one instruction the offline keyword-matcher can't
// follow: recognize any real ingredient, however unusual or regional.
const SYSTEM_INSTRUCTION = `You are a recipe designer for the Ninja Slushi (FS300/FS301), a countertop frozen-drink maker. It needs sugar or alcohol (or both) to freeze into slush rather than a solid block or thin liquid — design every recipe to satisfy these REAL machine constraints:

BATCH SIZE: total liquid must be between 475 ml and 1.9 L.

SUGAR MINIMUM (roughly ≥4% sugar by weight; sugar-free artificial sweeteners like stevia/aspartame/sucralose do NOT count and will fail to freeze):
- 240 ml serving needs ≥8 g sugar
- 355 ml serving needs ≥11 g sugar
- 591 ml serving needs ≥18 g sugar
The community's practical sweet spot for good texture is HIGHER than this legal floor: aim for ~10-15% Brix (sugar) for a cocktail-style recipe. If a base ingredient is tart/low-sugar, add 15-30 ml syrup/juice or sugar per serving.
Diet soda / sugar-free soda ALONE will not freeze. Exception: in a SPIKED SLUSH recipe the alcohol itself acts as antifreeze, so a diet mixer can work there.

ALCOHOL (SPIKED SLUSH only):
- A premade alcoholic input (wine, beer, hard seltzer, a premade cocktail mix) must be 2.8%-16% ABV, AND still meet the sugar minimum above.
- If adding straight spirits (vodka/tequila/rum/whiskey/gin, ~35-40%+), cap the spirit volume: max 120 ml per 720 ml batch, 180 ml per 1.08 L, 240 ml per 1.44 L, 300 ml per 1.9 L total recipe.
- The community's practical sweet spot for cocktails is ABV ~8-14% total (not the bare legal ceiling of 16%) alongside the ~10-15% Brix sugar target above.
- Too concentrated (over the max) won't freeze at all; too little sugar/alcohol freezes into hard ice instead of slush. If unsure, err toward the middle of these windows, not the edges.

NEVER include hot ingredients, ice, or solids (fresh fruit chunks, ice cream, frozen fruit) — everything poured in must be a pourable liquid or a fully dissolved/puréed-and-strained mixture.

SUGAR-FREE VARIANT: allulose is the community's most reliable 1:1-behaving sugar substitute that still lets the machine freeze properly (unlike stevia/aspartame/sucralose, which fail alone). Typical dosing is ~12-18 g granulated (or ~15-22 ml liquid) allulose per 355 ml of base needing sweetening. Every recipe must also include a sugar-free variant that swaps sugar/syrup/condensed-milk-type ingredients for an allulose equivalent at that ratio.

PREP / INFUSIONS: if the requested flavor needs something beyond pouring liquids together (a spice/herb infusion, a fruit purée, a flavored syrup), give CONCRETE prep steps with real quantities, ratios, and times. Never hand-wave prep as "infuse to taste."

PRESETS: SLUSH (non-dairy, non-alcoholic sugary drinks), SPIKED SLUSH (any alcoholic drink), FROZEN JUICE (100% juice or premade smoothie), MILKSHAKE (dairy-based, 720 ml+ minimum), FRAPPE (coffee/blended, 720 ml+ minimum).

CRITICAL — RECOGNIZE REAL INGREDIENTS: the user may name any real-world ingredient, however unusual, regional, or international — guava, lychee, ube, taro, hibiscus, yuzu, a Yakult/Calpico-style fermented probiotic dairy drink, horchata, jamaica, etc. Identify what it actually is (a tropical fruit, a fermented dairy drink, a floral tea, whatever it is) and use it accurately in the recipe. Do NOT fall back to a generic "flavor concentrate" or "water + your favorite flavor" filler just because an ingredient is unfamiliar — that failure mode is exactly what this system exists to fix.

You'll be given a short list of existing recipes from this machine's recipe database as style/flavor-pairing reference — draw on them, remix them, or invent something new, whichever best satisfies the request, as long as it respects every constraint above.

Return 1 to 3 recipes — use more than one only when the request is open-ended (e.g. a pile of ingredients with no named drink), not for a specific named request.

Field meanings for the required JSON output:
- batch_note: human-readable batch size + serving count, e.g. "1.2 L, about 4-6 servings"
- prep_steps: any advance prep/infusion steps with real quantities and times; empty array if none needed
- ingredients: the regular (full-sugar/full-alcohol) ingredient list, each a "qty + ingredient" string
- machine_fit_note: 1-2 sentences on why this hits the sugar/alcohol requirements (cite approx ABV%/Brix% or the relevant rule)
- sugar_free_ingredients: the allulose-substituted ingredient list
- sugar_free_note: what changed for the sugar-free version and why it still freezes
- inspired_by: names of the given reference recipes this drew from, or an empty array`;

const RECIPE_ARRAY_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      name: { type: "STRING" },
      preset: {
        type: "STRING",
        enum: ["SLUSH", "SPIKED SLUSH", "FROZEN JUICE", "MILKSHAKE", "FRAPPE"],
      },
      tags: {
        type: "ARRAY",
        items: {
          type: "STRING",
          enum: [
            "creamy", "milkshake", "refreshing", "fruity", "spicy",
            "tropical", "citrus", "coffee", "chocolate", "cocktail", "mocktail",
          ],
        },
      },
      difficulty: { type: "STRING", enum: ["easy", "medium", "advanced"] },
      batch_note: { type: "STRING" },
      prep_steps: { type: "ARRAY", items: { type: "STRING" } },
      ingredients: { type: "ARRAY", items: { type: "STRING" } },
      directions: { type: "STRING" },
      machine_fit_note: { type: "STRING" },
      sugar_free_ingredients: { type: "ARRAY", items: { type: "STRING" } },
      sugar_free_note: { type: "STRING" },
      inspired_by: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: [
      "name", "preset", "tags", "difficulty", "prep_steps", "ingredients",
      "directions", "machine_fit_note", "sugar_free_ingredients", "sugar_free_note", "inspired_by",
    ],
  },
};

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://applecow5000.github.io";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, "content-type": "application/json" },
  });
}

function buildInspirationText(inspiration) {
  if (!inspiration.length) {
    return "No closely related existing recipes found — invent freely within the constraints above.";
  }
  return inspiration
    .map((r) => `- ${r.name} (${r.preset}, tags: ${(r.tags || []).join(", ")}): ${(r.ingredients || []).join("; ")}`)
    .join("\n");
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, headers);
    }
    if (!env.GEMINI_API_KEY) {
      return json({ error: "Server misconfigured: GEMINI_API_KEY is not set" }, 500, headers);
    }

    // Rate limiting: only active once a "Rate Limiting" binding named
    // RATE_LIMITER is added on this Worker (Settings → Bindings, no custom
    // domain required — see worker/README.md). Skips silently until then,
    // so the feature works before you've set that up, just unprotected.
    if (env.RATE_LIMITER) {
      const clientId = request.headers.get("CF-Connecting-IP") || "unknown";
      const { success } = await env.RATE_LIMITER.limit({ key: clientId });
      if (!success) {
        return json({ error: "Rate limit exceeded — please wait a moment and try again." }, 429, headers);
      }
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: "Invalid JSON body" }, 400, headers);
    }

    const query = typeof body.query === "string" ? body.query.trim().slice(0, MAX_QUERY_LENGTH) : "";
    if (!query) return json({ error: "Missing query" }, 400, headers);

    const inspiration = Array.isArray(body.inspiration) ? body.inspiration.slice(0, MAX_INSPIRATION_RECIPES) : [];
    const sugarFreeHint = Boolean(body.sugarFree);

    const userText =
      `Existing recipes for reference:\n${buildInspirationText(inspiration)}\n\n` +
      `Request: ${query}` +
      (sugarFreeHint ? "\n\n(The visitor currently has Sugar-Free mode on — both versions are still required, but lean into making the sugar-free version genuinely good.)" : "");

    const geminiRequestBody = {
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
        responseSchema: RECIPE_ARRAY_SCHEMA,
      },
    };

    let geminiResponse;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
      try {
        geminiResponse = await fetch(geminiUrl(env.GEMINI_API_KEY), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(geminiRequestBody),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      return json({ error: `Upstream request failed: ${err.message}` }, 502, headers);
    }

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      return json({ error: `Gemini error ${geminiResponse.status}: ${errText.slice(0, 300)}` }, 502, headers);
    }

    let geminiData;
    try {
      geminiData = await geminiResponse.json();
    } catch (err) {
      return json({ error: "Could not parse Gemini response" }, 502, headers);
    }

    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return json({ error: "Empty response from Gemini" }, 502, headers);
    }

    let recipes;
    try {
      recipes = JSON.parse(text);
    } catch (err) {
      return json({ error: "Gemini did not return valid JSON" }, 502, headers);
    }

    if (!Array.isArray(recipes) || recipes.length === 0) {
      return json({ error: "No recipes returned" }, 502, headers);
    }

    return json({ recipes }, 200, headers);
  },
};
