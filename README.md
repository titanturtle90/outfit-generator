# Workweek

Generates your Monday–Thursday work outfits from photos of your own clothes,
balancing two things you can't easily do by eye: **colors that actually work
together**, and **wearing your whole closet** instead of the same four favourites.

Everything runs in the browser. No account, no server, no photos leaving your
machine.

![the week view](docs/week.png)

## Running it

It's a static site with no build step.

```bash
# any static server works
python3 -m http.server 8080
# then open http://localhost:8080
```

Opening `index.html` directly from the filesystem won't work — browsers refuse
IndexedDB access on `file://` origins.

To put it online, push this repo and turn on **GitHub Pages** (Settings → Pages
→ deploy from branch, root folder). There's nothing to build.

## Using it

1. **Closet** — drop in photos of your shirts, pants and shoes. Drop several at
   once and they queue up. Each one gets a name, a category, and a color the app
   reads off the photo. The four swatches next to the picker are the other
   colors it found, in case it grabbed your wall instead of your shirt.
2. **This Week** — four outfits, generated. Each shows why it was picked.
   - **Shuffle** re-rolls one day, avoiding what the other days are using.
   - **Lock** pins a day you like so regenerating leaves it alone.
   - **Mark worn** logs it, which is what feeds the variety tracking. This is
     the one habit the app needs from you — without it, it can't know what
     you've actually worn.
   - The **Color ↔ Variety** slider decides how the two priorities trade off.
3. **History** — what you've worn, how much of your closet you've actually got
   through, and which pieces are still sitting unworn.
4. **Settings** — work days, rotation gaps, and backup.

Bench an item (the ✓ button on a closet card) to keep it while taking it out of
rotation — laundry, seasonal, or a shirt you've gone off.

## How outfits get picked

Every possible shirt + pants + shoes combination is scored on two axes, and the
slider sets the blend.

### Color

Scoring follows the rules people actually dress by, in `js/color.js`:

- **Neutrals do the heavy lifting.** Navy, olive, khaki, denim, cream, grey,
  black and brown are treated as neutrals even though several are saturated
  hues, because that's how they behave in a wardrobe. A neutral next to a color
  is the highest-scoring pairing there is.
- **Hue relationships.** Neighbours on the color wheel (analogous) and opposites
  (complementary) both read as deliberate. The arc in between is the awkward
  zone and gets marked down hard.
- **Two loud colors fight.** Both pieces heavily saturated is a penalty.
- **Contrast matters regardless of hue.** Two pieces of similar brightness blur
  into one shape, so low light/dark separation is penalised even when the hues
  are fine — that's why charcoal-on-charcoal scores below white-on-navy.
- **Shoes answer to the trousers.** Weighted toward the pants, with the two
  classic rules enforced: black shoes fight brown or tan trousers, brown shoes
  fight black ones. Shoes matching the trouser tone is fine, unlike clothes.

### Variety

Per item, in `js/outfit.js`:

- **Under-use** — how far below the rest of its category this item's wear count
  sits.
- **Recency** — how long since it was last worn, measured against a target gap
  that scales with your closet. With 20 shirts and four wearing days, a shirt
  should come round about every five weeks, and that's the gap it rewards. A
  small closet gets a proportionally smaller target, so the rule never becomes
  impossible to satisfy.
- Anything worn recently is heavily discounted, never-worn items go to the front
  of the queue, and a shirt + pants pairing you've had recently is penalised
  even when both pieces are individually due.

Within a week no item repeats — unless your closet is too small, in which case
repeats get *priced* rather than blocked, so two shirts across four days
alternate evenly instead of the better-scoring one running three times.

## Your data

The closet, the photos and the history live in this browser's IndexedDB.
Clearing site data wipes it. Photos are downscaled to 700px on the way in.

**Settings → Export** writes a single JSON file with the images embedded — that's
the backup, and it's how you move the closet to another browser or device.
Import replaces what's there.

## Tests

The two engine modules are pure and covered by a dependency-free suite:

```bash
node tests/engine.test.js
```

62 assertions over color naming and classification, the harmony and shoe rules,
date handling, week generation, degenerate closets (empty, no shoes, fewer
clothes than days), locking, single-day re-rolls, and a twelve-week rotation
simulation that asserts wear counts stay within one of each other while the
average color score holds above 85.

## Layout

```
index.html          markup for all four views
styles.css          styling, light and dark
js/color.js         color math, garment naming, extraction, harmony rules
js/db.js            IndexedDB persistence, import/export
js/outfit.js        scoring and week generation  (no DOM, no storage)
js/app.js           UI wiring
tests/engine.test.js
```

`color.js` and `outfit.js` touch neither the DOM nor storage, which is what
makes them testable in plain Node.
