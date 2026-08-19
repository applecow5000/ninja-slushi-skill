# Sugar & Alcohol Rules + Machine Alerts

Sugar is what lets a liquid freeze into scoopable slush instead of a solid block,
and alcohol lowers the freezing point (too much and it can't freeze at all). The
Ninja Slushi enforces a working range and actively alerts when the input is out
of range. These are the **exact manufacturer limits** from the Inspiration Guide
(pages 10–11).

## Required sugar content

Check the drink's nutrition label. Sugar must meet these **minimums** (roughly
**≥4% sugar by weight**; below that it freezes too hard to form slush):

| Serving size | Minimum total sugar |
|---|---|
| 240 ml | **8 g** |
| 355 ml | **11 g** |
| 591 ml | **18 g** |

- **Sugar-free substitutes and artificial sweeteners do NOT count** toward the
  minimum — they won't help a drink slush. (The community has found specific
  *bulk* sweeteners like allulose that physically behave like sugar do work — see
  [additives-and-texture.md](additives-and-texture.md) — but standard
  aspartame/stevia/sucralose diet drinks freeze rock-hard.)
- **Diet soda alone will NOT work.** Exception: in a *spiked* recipe the added
  spirit acts as antifreeze, so diet mixers can work (the official Rum & Cola
  builder even allows diet cola).

## Alcohol guidelines (SPIKED SLUSH)

**Premade inputs** (wine, beer, hard seltzer, premade cocktails) must contain
**between 2.8% and 16% alcohol**, AND still meet the **≥4% sugar** minimum.

Reference points on the range: light beer / hard seltzer sit near the **2.8% low
limit**; wine, IPA, and margarita sit toward the **16% high limit**.

### Adding hard alcohol / spirits (35%+)

When you add straight spirits (vodka, tequila, rum, whiskey, gin), stay at or
below these **maximum spirit amounts** per total recipe size:

| Total recipe size | Max hard alcohol/spirit |
|---|---|
| 720 ml | **120 ml** |
| 1.08 L | **180 ml** |
| 1.44 L | **240 ml** |
| 1.9 L | **300 ml** |

This chart is for spirits only. For wine/beer/seltzer/premade cocktails, use the
2.8–16% rule above (and the No-Prep Slushes bar chart in
[presets-and-temperature.md](presets-and-temperature.md)).

> **Do NOT add** hot ingredients, ice, or solids (fruit, ice cream, frozen fruit).

## Alerts the machine gives you

Both alerts flash the preset LEDs and **beep every minute for 15 minutes**. The
**flash direction** tells them apart. After fixing, **reset by pressing the preset**,
then **restart by pressing the preset again**.

### High-Alcohol / High-Sugar Alert
**Signal:** Temperature Control LEDs flash **one at a time in ascending order**
(from the bottom LED up), preset LEDs flash, beeps every minute for 15 min.

**Fix — dilute.** Per serving, add **60 ml** of: water, soda, tonic water,
seltzer, or plain chilled coffee/tea. Then reset + restart the preset.

### Low-Sugar Alert
**Signal:** Temperature Control LEDs flash **one at a time in descending order**
(from the top LED down), preset LEDs flash, beeps every minute for 15 min.

**Fix — add sugar.** Per serving, add **15–30 ml** of: flavored syrup,
juice, sugar, date sugar, coconut sugar, maple syrup, agave, simple syrup, or
honey. **Combine the sugar with the base *before* pouring in.** Then reset +
restart the preset.

### Telling them apart at a glance

| | LED flash direction | Meaning | Fix |
|---|---|---|---|
| **High-Alcohol / High-Sugar** | bottom → up (ascending) | too concentrated to freeze | +60 ml diluent per serving |
| **Low-Sugar** | top → down (descending) | not enough sugar to slush | +15–30 ml sugar per serving (mix in first) |

## Practical guidance

- **Pre-frozen/chilled ingredients taste sweeter** once slushed — a base that
  seems too sweet won't taste as sweet frozen, so don't under-sugar.
- **Tart/low-sugar juices** (e.g. pure cranberry) may need added sugar to slush.
- **Higher-proof drinks need a higher (colder) temperature bar** to freeze.
- **Mocktail swaps** still need sugar — swap out the alcohol, keep the sugar.
- The community works to a *higher* sugar target than the 4% floor (~10–15% Brix)
  for the best texture — see [community-troubleshooting.md](community-troubleshooting.md).
