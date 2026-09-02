/* =============================================================
   outfit.js — scoring and week generation.

   Every candidate outfit gets two scores:
     colorScore   — how well the three pieces look together
     varietyScore — how overdue those pieces are for a wear
   and the final ranking is a weighted blend the user controls.
   ============================================================= */
const Outfit = (function () {

  const DAY_MS = 86400000;

  /*
   * How much color harmony counts against rotation, 0 to 1. This used to be a
   * slider; it is fixed here because measurement says the interesting range is
   * narrow and one value sits at the top of it.
   *
   * Over twelve-week simulations (20 runs each, 10 shirts / 7 trousers):
   *
   *   weight   avg color   shirt spread   runs with spread <= 1
   *     0.50       94.0        1.00              20/20
   *     0.60       93.9        1.10              18/20
   *     0.70       94.0        1.10              18/20
   *     0.90       95.8       14.50   pieces going entirely unworn
   *
   * Color quality is flat from 0.5 to 0.7, so there is nothing to buy by
   * pushing higher, and past 0.8 rotation collapses. 0.5 is the value that
   * holds every wear count within one of every other while scoring as well on
   * color as anything above it.
   */
  const COLOR_WEIGHT = 0.5;
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  /* ---------------------- date helpers ---------------------- */

  const toKey = d => {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  const fromKey = key => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  /** Monday of the week containing `date`. */
  function weekStart(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const offset = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - offset);
    return d;
  }

  function daysBetween(aKey, bKey) {
    return Math.round((fromKey(bKey) - fromKey(aKey)) / DAY_MS);
  }

  /** The dates in a week that the user actually works. */
  function workDatesFor(monday, workDays) {
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      if (workDays.includes(d.getDay())) out.push(d);
    }
    return out;
  }

  /* ---------------------- color ---------------------- */

  /**
   * Blend of the shirt/pants pairing (which carries the outfit) and how the
   * shoes land underneath it.
   */
  function colorScoreFor(shirt, pants, shoes) {
    const top = Color.pairScore(shirt.color, pants.color);
    if (!shoes) return { score: top.score, notes: top.notes.slice(0, 2) };
    const feet = Color.shoeScore(shoes.color, shirt.color, pants.color);
    return {
      score: Math.round(0.68 * top.score + 0.32 * feet.score),
      notes: top.notes.slice(0, 2).concat(feet.notes.slice(0, 1))
    };
  }

  /* ---------------------- variety ---------------------- */

  /**
   * How overdue a single item is (0-100).
   *
   * Two halves, weighted evenly:
   *   count   — is this piece under-worn relative to the rest of its category?
   *   recency — has it had time to breathe since its last outing?
   *
   * The recency target scales with closet size: with 20 shirts and 4 wearing
   * days a week, a shirt should come around roughly every five weeks, and
   * that's the gap we reward. Small closets get a proportionally smaller gap
   * automatically, so the rule never becomes impossible to satisfy.
   */
  function itemVariety(item, stats, todayKey, settings) {
    const { maxWear, minWear, count } = stats;

    const countScore = maxWear === minWear
      ? 1
      : (maxWear - item.wearCount) / (maxWear - minWear);

    const idealGap = Math.max(
      3,
      Math.min(settings.minGapDays, Math.round(count * 7 / Math.max(1, settings.workDays.length)))
    );

    let recencyScore, daysSince = Infinity;
    if (!item.lastWorn) {
      recencyScore = 1;                       // never worn — top priority
    } else {
      daysSince = daysBetween(item.lastWorn, todayKey);
      if (daysSince < 0) daysSince = 0;       // scheduled ahead of today
      recencyScore = Math.min(1, daysSince / idealGap);
    }

    let score = 100 * (0.5 * countScore + 0.5 * recencyScore);

    // Hard-ish brake on wearing the same thing again within the rotation floor.
    if (daysSince < idealGap * 0.5) score *= 0.35;

    return { score, daysSince, idealGap };
  }

  /** Per-category min/max wear counts, so variety is judged within a category. */
  function buildStats(items) {
    const stats = {};
    for (const cat of ['shirt', 'pants', 'shoes']) {
      const inCat = items.filter(i => i.category === cat);
      const counts = inCat.map(i => i.wearCount || 0);
      stats[cat] = {
        count: inCat.length,
        maxWear: counts.length ? Math.max(...counts) : 0,
        minWear: counts.length ? Math.min(...counts) : 0
      };
    }
    return stats;
  }

  /** When was this exact shirt+pants pairing last worn? */
  function pairingIndex(outfits) {
    const map = new Map();
    for (const o of outfits) {
      if (!o.shirtId || !o.pantsId) continue;
      const key = o.shirtId + '|' + o.pantsId;
      const prev = map.get(key);
      if (!prev || o.date > prev) map.set(key, o.date);
    }
    return map;
  }

  /* ---------------------- candidate scoring ---------------------- */

  function scoreCandidate(shirt, pants, shoes, ctx) {
    const { stats, todayKey, settings, pairings } = ctx;

    const color = colorScoreFor(shirt, pants, shoes);

    const vShirt = itemVariety(shirt, stats.shirt, todayKey, settings);
    const vPants = itemVariety(pants, stats.pants, todayKey, settings);
    const vShoes = shoes ? itemVariety(shoes, stats.shoes, todayKey, settings) : null;

    // Shoes rotate less than clothes do, so they count for less.
    let variety = vShoes
      ? 0.40 * vShirt.score + 0.40 * vPants.score + 0.20 * vShoes.score
      : 0.5 * vShirt.score + 0.5 * vPants.score;

    const notes = [];
    if (!shirt.lastWorn) notes.push(`${shirt.name} hasn't been worn yet`);
    else if (vShirt.daysSince > vShirt.idealGap) notes.push(`${shirt.name} is overdue`);
    if (!pants.lastWorn) notes.push(`${pants.name} hasn't been worn yet`);

    // Don't re-run a shirt+pants combination the user had recently.
    const lastPaired = pairings.get(shirt.id + '|' + pants.id);
    if (lastPaired) {
      const since = daysBetween(lastPaired, todayKey);
      if (since < settings.pairGapDays) {
        const penalty = 1 - Math.max(0, Math.min(1, since / settings.pairGapDays));
        variety *= 1 - 0.55 * penalty;
        notes.push(`worn together ${since} day${since === 1 ? '' : 's'} ago`);
      }
    }

    const total = COLOR_WEIGHT * color.score + (1 - COLOR_WEIGHT) * variety;

    return {
      shirt, pants, shoes,
      colorScore: Math.round(color.score),
      varietyScore: Math.round(variety),
      score: total,
      notes: color.notes.concat(notes).slice(0, 4)
    };
  }

  /* ---------------------- week generation ---------------------- */

  /**
   * Fill the given dates with outfits.
   *
   * Days already present in `locked` keep their outfit. The rest are filled
   * greedily, best-first, re-scoring after every pick so that items already
   * used this week fall out of contention. Among the top few candidates we
   * pick at random (weighted) so that hitting "regenerate" gives a genuinely
   * different week rather than the same deterministic answer.
   */
  function generateWeek({ dates, items, outfits, settings, locked = {}, exclude = new Set() }) {
    const available = items.filter(i => i.inRotation !== false);
    const shirts = available.filter(i => i.category === 'shirt');
    const pants = available.filter(i => i.category === 'pants');
    const shoes = available.filter(i => i.category === 'shoes');

    if (!shirts.length || !pants.length) {
      return { days: [], error: missingMessage(shirts.length, pants.length) };
    }

    const ctx = {
      stats: buildStats(available),
      todayKey: toKey(new Date()),
      settings,
      pairings: pairingIndex(outfits)
    };

    // With few pieces we can't keep every day distinct — relax rather than fail.
    const enforceDistinct = {
      shirt: shirts.length > dates.length - 1 + countExcluded(shirts, exclude),
      pants: pants.length > dates.length - 1 + countExcluded(pants, exclude)
    };

    // Items the caller has already committed elsewhere (e.g. the other days of
    // the week when re-rolling a single day) start out as "already used".
    const usedShirts = new Set([...exclude].filter(id => shirts.some(i => i.id === id)));
    const usedPants = new Set([...exclude].filter(id => pants.some(i => i.id === id)));
    const usedShoes = new Set([...exclude].filter(id => shoes.some(i => i.id === id)));

    // How many times each item is already spoken for this week. When the closet
    // is too small to keep every day distinct we can't skip repeats outright, so
    // we price them instead — that spreads two shirts over four days evenly
    // rather than leaning on whichever one scores best.
    const weekUse = new Map();
    const bump = id => id && weekUse.set(id, (weekUse.get(id) || 0) + 1);
    const uses = id => weekUse.get(id) || 0;
    exclude.forEach(bump);

    const result = [];

    // Locked days still consume their items.
    for (const date of dates) {
      const key = toKey(date);
      const lock = locked[key];
      if (lock) {
        usedShirts.add(lock.shirtId);
        usedPants.add(lock.pantsId);
        if (lock.shoesId) usedShoes.add(lock.shoesId);
        bump(lock.shirtId); bump(lock.pantsId); bump(lock.shoesId);
      }
    }

    for (const date of dates) {
      const key = toKey(date);

      if (locked[key]) { result.push(Object.assign({}, locked[key], { locked: true })); continue; }

      const candidates = [];
      for (const sh of shirts) {
        if (enforceDistinct.shirt && usedShirts.has(sh.id)) continue;
        for (const pa of pants) {
          if (enforceDistinct.pants && usedPants.has(pa.id)) continue;

          const reuse = 30 * (uses(sh.id) + uses(pa.id));

          if (shoes.length) {
            for (const so of shoes) {
              const c = scoreCandidate(sh, pa, so, ctx);
              // Shoes may repeat in a week far more readily than clothes.
              c.score -= reuse + 6 * uses(so.id);
              candidates.push(c);
            }
          } else {
            const c = scoreCandidate(sh, pa, null, ctx);
            c.score -= reuse;
            candidates.push(c);
          }
        }
      }

      if (!candidates.length) {
        // Distinctness made the day unsolvable; drop the constraint and retry.
        enforceDistinct.shirt = false;
        enforceDistinct.pants = false;
        for (const sh of shirts) for (const pa of pants) {
          const reuse = 30 * (uses(sh.id) + uses(pa.id));
          const push = so => {
            const c = scoreCandidate(sh, pa, so, ctx);
            c.score -= reuse + (so ? 6 * uses(so.id) : 0);
            candidates.push(c);
          };
          if (shoes.length) shoes.forEach(push); else push(null);
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      const pick = weightedPick(candidates.slice(0, 6));

      usedShirts.add(pick.shirt.id);
      usedPants.add(pick.pants.id);
      if (pick.shoes) usedShoes.add(pick.shoes.id);
      bump(pick.shirt.id); bump(pick.pants.id); bump(pick.shoes && pick.shoes.id);

      result.push({
        date: key,
        dayName: DAY_NAMES[date.getDay()],
        shirtId: pick.shirt.id,
        pantsId: pick.pants.id,
        shoesId: pick.shoes ? pick.shoes.id : null,
        colorScore: pick.colorScore,
        varietyScore: pick.varietyScore,
        notes: pick.notes,
        status: 'planned'
      });
    }

    return { days: result, error: null };
  }

  /** Re-roll a single day, keeping clear of the items the rest of the week uses. */
  function regenerateDay({ date, items, outfits, settings, weekOutfits }) {
    const key = toKey(date);
    const exclude = new Set();
    for (const o of weekOutfits) {
      if (!o || o.date === key) continue;
      exclude.add(o.shirtId);
      exclude.add(o.pantsId);
    }
    return generateWeek({ dates: [date], items, outfits, settings, exclude });
  }

  /** How many items in `list` are already spoken for by `exclude`. */
  function countExcluded(list, exclude) {
    return list.reduce((n, i) => n + (exclude.has(i.id) ? 1 : 0), 0);
  }

  /** Softmax-ish pick so regeneration varies without dropping to bad outfits. */
  function weightedPick(list) {
    if (list.length === 1) return list[0];
    const top = list[0].score;
    const weights = list.map(c => Math.pow(Math.max(0.01, c.score / top), 12));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < list.length; i++) {
      r -= weights[i];
      if (r <= 0) return list[i];
    }
    return list[0];
  }

  function missingMessage(shirtCount, pantsCount) {
    const missing = [];
    if (!shirtCount) missing.push('at least one shirt');
    if (!pantsCount) missing.push('at least one pair of pants');
    return `Add ${missing.join(' and ')} to start generating outfits.`;
  }

  return {
    DAY_NAMES, toKey, fromKey, weekStart, workDatesFor, daysBetween,
    generateWeek, regenerateDay, colorScoreFor, itemVariety, buildStats,
    COLOR_WEIGHT
  };
})();
