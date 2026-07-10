# Ninja Slushi Guide

A [Claude skill](https://docs.claude.com/en/docs/agents-and-tools/agent-skills)
for operating and getting the most out of the **Ninja Slushi** — a countertop
consumer frozen drink maker (FS300/FS301 Series). Covers presets, texture control,
recipes, the sugar & alcohol rules the machine enforces, cleaning, and
troubleshooting.

> Ninja markets it as the "Slushi Professional Frozen Drink Maker," but it's a
> home consumer appliance, not commercial equipment.

It combines three layers of knowledge:

1. **Manual basics** — from the official Quick Start Guide.
2. **Official recipes & limits** — the full Ninja *Inspiration Guide* (exact sugar
   minimums, alcohol limits, 12+ recipes, and the "Create Your Own" builder charts).
3. **Community wisdom** — distilled from ~2,000 posts/comments on
   [r/ninjaslushi](https://reddit.com/r/ninjaslushi): real-world recipes, fixes,
   and techniques (sugar-free workarounds, xanthan gum, Brix/ABV targets) — often
   where community experience *corrects or extends* the manual.

## Using it

Point Claude Code (or any Agent-Skills-compatible client) at this directory. The
skill activates when you ask about making a frozen drink, choosing a preset,
dialing in texture, following/adapting a recipe, decoding a beeping alert,
cleaning, or troubleshooting. Start from [`SKILL.md`](SKILL.md).

## Layout

```
SKILL.md                              Entry point (frontmatter + overview + links)
references/
  presets-and-temperature.md          Presets + ideal-texture bar chart per drink
  recipes.md                          Starter recipes + how to adapt your own drink
  official-recipes.md                 Full Inspiration Guide recipes + builder charts
  sugar-alcohol-and-alerts.md         Exact sugar/alcohol limits + alert decoding
  cleaning-and-troubleshooting.md     Setup, rinse cycle, disassembly, official fixes
  additives-and-texture.md            Xanthan/guar + sugar-free sweeteners (community)
  community-recipes.md                ~60 deduped community-tested recipes
  community-troubleshooting.md        Consolidated problems → fixes (+ manual conflicts)
  community-faq-and-tips.md           Recurring FAQ + durable tips beyond the manual
data/
  inspiration-guide.txt               Raw text of the official Inspiration Guide
  submissions.ndjson, comments.ndjson Raw r/ninjaslushi archive (via pullpush.io)
  threads.jsonl, digest/*.txt         Reconstructed, de-noised, bucketed
scripts/
  pull_dump.py                        Re-runnable subreddit archiver (pullpush.io)
  distill.py                          Stage-1 cleaner: normalize → thread → bucket
  README.md                           How to run the data pipeline
```

## Refreshing the community data

```bash
python3 scripts/pull_dump.py      # archive all submissions + comments
python3 scripts/distill.py        # clean, reconstruct threads, bucket into digests
```

See [`scripts/README.md`](scripts/README.md) for details. The re-extraction of
digests into the `community-*.md` docs is done with an LLM pass.

## Notes & provenance

- Manual/recipe content © 2024 SharkNinja Operating LLC; transcribed here for
  reference use. "Ninja Slushi" is a trademark of SharkNinja.
- The `data/` archive contains public Reddit content (including usernames) fetched
  from [pullpush.io](https://pullpush.io), the community successor to Pushshift.
  Comment coverage begins ~2025-02-17 (source ingestion gap); submissions span the
  subreddit's full history from 2024-07.
- Community docs capture user-reported experience, not manufacturer guidance —
  they're labeled as such and flag where they diverge from the official docs.
