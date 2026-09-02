/* =============================================================
   color.js — color space math, garment color naming, extraction
   from photos, and the harmony rules used to score outfits.
   ============================================================= */
const Color = (function () {

  /* ---------------------- conversions ---------------------- */

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    return {
      r: parseInt(v.slice(0, 2), 16),
      g: parseInt(v.slice(2, 4), 16),
      b: parseInt(v.slice(4, 6), 16)
    };
  }

  function rgbToHex(r, g, b) {
    const p = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return '#' + p(r) + p(g) + p(b);
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h, s, l };
  }

  function hexToHsl(hex) {
    const { r, g, b } = hexToRgb(hex);
    return rgbToHsl(r, g, b);
  }

  /** Perceived brightness (0-1). Closer to how the eye reads contrast than HSL lightness. */
  function luminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  /** Shortest distance between two hues on the color wheel (0-180). */
  function hueDistance(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  /* ---------------------- classification ---------------------- */

  /**
   * Garments don't split into "neutral / not neutral" the way a color wheel
   * does. Navy, olive, khaki and denim all behave like neutrals in a wardrobe
   * even though they're saturated hues, so they get their own tier.
   *
   * Returns 'neutral' | 'soft' | 'color'.
   */
  function tier(hex) {
    const { h, s, l } = hexToHsl(hex);

    // Greys, black, white, cream.
    if (s < 0.12) return 'neutral';
    if (l < 0.13) return 'neutral';
    if (l > 0.90 && s < 0.30) return 'neutral';

    // Navy and other very dark blues read as neutral.
    if (h >= 195 && h <= 260 && l < 0.32) return 'neutral';

    // Khaki, tan, stone, cream, brown — the warm neutral family.
    if (h >= 15 && h <= 55 && s < 0.55 && l < 0.93) return 'neutral';

    // Denim blue and olive/drab greens — safe, but they still carry a hue.
    if (h >= 190 && h <= 250 && s < 0.60) return 'soft';
    if (h >= 50 && h <= 110 && s < 0.50 && l < 0.55) return 'soft';
    if (s < 0.28) return 'soft';

    return 'color';
  }

  const isNeutralish = hex => tier(hex) !== 'color';

  /** Black/charcoal family — used for the black-shoes-with-brown-pants rule. */
  function isBlackFamily(hex) {
    const { s, l } = hexToHsl(hex);
    return l < 0.25 && s < 0.30;
  }

  /** Brown/tan/burgundy leather family. */
  function isBrownFamily(hex) {
    const { h, s, l } = hexToHsl(hex);
    return h >= 10 && h <= 45 && s >= 0.12 && l >= 0.10 && l <= 0.65;
  }

  /* ---------------------- naming ---------------------- */

  const HUE_NAMES = [
    [15, 'red'], [40, 'orange'], [65, 'yellow'], [95, 'chartreuse'], [165, 'green'],
    [190, 'teal'], [210, 'sky blue'], [250, 'blue'], [280, 'violet'], [320, 'magenta'], [360, 'red']
  ];

  /** Human-readable color name, tuned for clothes rather than paint chips. */
  function name(hex) {
    const { h, s, l } = hexToHsl(hex);

    if (s < 0.14) {
      if (l > 0.92) return 'white';
      if (l > 0.75) return 'light grey';
      if (l > 0.45) return 'grey';
      if (l > 0.18) return 'charcoal';
      return 'black';
    }
    if (l < 0.06) return 'black';  // below this the hue is not perceivable

    // Wardrobe staples worth naming precisely.
    if (h >= 195 && h <= 255 && l < 0.32) return 'navy';
    if (h >= 195 && h <= 250 && s < 0.60 && l >= 0.32 && l <= 0.65) return 'denim blue';
    if (h >= 50 && h <= 110 && s < 0.55 && l < 0.50) return 'olive';
    if (h >= 15 && h <= 50 && l > 0.80 && s < 0.60) return 'cream';
    if (h >= 20 && h <= 55 && s < 0.45 && l > 0.55 && l <= 0.80) return 'khaki';
    if (h >= 10 && h <= 40 && s < 0.70 && l < 0.35) return 'brown';
    if (h >= 5 && h <= 30 && s >= 0.30 && l >= 0.30 && l <= 0.52) return 'rust';
    if (h >= 20 && h <= 50 && s < 0.55 && l >= 0.30 && l <= 0.55) return 'tan';
    if (h >= 340 || h <= 12) { if (l < 0.35) return 'burgundy'; }
    if ((h >= 330 || h <= 18) && l > 0.70) return 'pink';

    let base = 'color';
    for (const [limit, n] of HUE_NAMES) { if (h <= limit) { base = n; break; } }

    if (l > 0.75) return base.includes(' ') ? base : 'light ' + base;  // avoid 'light sky blue'
    if (l < 0.30) return 'dark ' + base;
    if (s < 0.30) return 'muted ' + base;
    return base;
  }

  /* ---------------------- parsing a typed color ---------------------- */

  /**
   * Garment colors people actually say, each mapped to a representative shade.
   * Every entry round-trips: name(NAMED[x]) === x, which a test enforces, so
   * what you type is what the app calls it back to you.
   */
  const NAMED = {
    'white': '#f2f2f0',
    'cream': '#eadfc8',
    'light grey': '#c8cace',
    'grey': '#8a8f98',
    'charcoal': '#3a3d44',
    'black': '#1a1a1c',
    'navy': '#22304d',
    'denim blue': '#4a6fa5',
    'sky blue': '#a8c4e0',
    'blue': '#2b6cb0',
    'teal': '#2b6f6a',
    'olive': '#556b2f',
    'green': '#2f7a3f',
    'dark green': '#1a4d2e',
    'khaki': '#c4b08b',
    'tan': '#a8814f',
    'brown': '#5a3b23',
    'rust': '#8a3f2f',
    'burgundy': '#7d2230',
    'red': '#cc2222',
    'pink': '#e6bec4',
    'orange': '#e8862e',
    'yellow': '#d4a017',
    'violet': '#6b4a8a',
    'magenta': '#a9459b'
  };

  // Words people use for the same thing.
  const SYNONYMS = {
    'gray': 'grey', 'light gray': 'light grey', 'off-white': 'cream',
    'off white': 'cream', 'ivory': 'cream', 'ecru': 'cream', 'beige': 'khaki',
    'stone': 'khaki', 'sand': 'khaki', 'camel': 'tan', 'maroon': 'burgundy',
    'wine': 'burgundy', 'oxblood': 'burgundy', 'light blue': 'sky blue',
    'pale blue': 'sky blue', 'denim': 'denim blue', 'indigo': 'navy',
    'chocolate': 'brown', 'coffee': 'brown', 'terracotta': 'rust',
    'purple': 'violet', 'lilac': 'violet', 'mustard': 'yellow',
    'forest green': 'dark green', 'bottle green': 'dark green',
    'racing green': 'dark green', 'emerald': 'green', 'sage': 'olive',
    'slate': 'grey', 'dark blue': 'navy', 'midnight': 'navy', 'silver': 'light grey', 'ash': 'light grey'
  };

  /** Every name worth offering as a suggestion, alphabetically. */
  const paletteNames = () =>
    Object.keys(NAMED).concat(Object.keys(SYNONYMS)).sort();

  /**
   * Turn typed text into a color. Accepts a name, a synonym, a light/dark
   * modifier on either, or a raw hex. Returns null when it means nothing, so
   * the caller can say so rather than silently picking something wrong.
   */
  function parse(text) {
    if (!text) return null;
    const raw = String(text).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!raw) return null;

    if (/^#?[0-9a-f]{6}$/.test(raw)) return '#' + raw.replace('#', '');
    if (/^#?[0-9a-f]{3}$/.test(raw)) {
      const h = raw.replace('#', '');
      return '#' + h.split('').map(c => c + c).join('');
    }

    const direct = NAMED[raw] || NAMED[SYNONYMS[raw]];
    if (direct) return direct;

    // "light olive", "dark khaki", "pale pink" and so on.
    const m = raw.match(/^(light|pale|dark|deep|bright|muted)\s+(.*)$/);
    if (!m) return null;
    const base = NAMED[m[2]] || NAMED[SYNONYMS[m[2]]];
    if (!base) return null;

    const { h, s, l } = hexToHsl(base);
    const shift = { light: 0.18, pale: 0.24, dark: -0.16, deep: -0.20 };
    if (m[1] === 'bright') return hslToHexLocal(h, Math.min(1, s + 0.25), l);
    if (m[1] === 'muted') return hslToHexLocal(h, Math.max(0, s - 0.25), l);
    return hslToHexLocal(h, s, Math.max(0.04, Math.min(0.96, l + shift[m[1]])));
  }

  function hslToHexLocal(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const t = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
            : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return rgbToHex((t[0] + m) * 255, (t[1] + m) * 255, (t[2] + m) * 255);
  }

  /* ---------------------- extraction from a photo ---------------------- */

  /**
   * Pull the garment's color out of a photo.
   *
   * Photos of clothes are mostly background, so we (1) estimate the background
   * from the border pixels, (2) drop anything that looks like it, (3) weight
   * the center of the frame where the garment sits, then (4) bucket what's
   * left in HSL and take the heaviest bucket. Returns up to `count` candidate
   * hexes, best first, so the UI can offer alternatives when we guess wrong.
   */
  function extractPalette(image, count = 4) {
    const SIZE = 96;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, SIZE, SIZE);
    const data = ctx.getImageData(0, 0, SIZE, SIZE).data;

    const at = (x, y) => {
      const i = (y * SIZE + x) * 4;
      return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
    };

    // 1. Background estimate: average of the frame's border ring.
    let br = 0, bg = 0, bb = 0, bn = 0;
    for (let x = 0; x < SIZE; x++) {
      for (const y of [0, 1, SIZE - 2, SIZE - 1]) {
        const p = at(x, y); if (p.a < 128) continue;
        br += p.r; bg += p.g; bb += p.b; bn++;
      }
    }
    for (let y = 0; y < SIZE; y++) {
      for (const x of [0, 1, SIZE - 2, SIZE - 1]) {
        const p = at(x, y); if (p.a < 128) continue;
        br += p.r; bg += p.g; bb += p.b; bn++;
      }
    }
    const bgc = bn ? { r: br / bn, g: bg / bn, b: bb / bn } : null;

    // 2-3. Weighted histogram over the remaining pixels.
    const buckets = new Map();
    const cx = SIZE / 2, cy = SIZE / 2, maxD = Math.hypot(cx, cy);

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = at(x, y);
        if (p.a < 128) continue;

        if (bgc) {
          const diff = Math.abs(p.r - bgc.r) + Math.abs(p.g - bgc.g) + Math.abs(p.b - bgc.b);
          if (diff < 60) continue; // too close to the backdrop
        }

        const { h, s, l } = rgbToHsl(p.r, p.g, p.b);
        if (l > 0.97 || l < 0.03) continue; // blown highlights and dead shadow

        // Center pixels count for more; a garment photo is centered.
        const d = Math.hypot(x - cx, y - cy) / maxD;
        const weight = 1 + 2.2 * (1 - d) ** 2;

        // Coarse HSL buckets keep folds and lighting variation together.
        const key = [
          s < 0.10 ? -1 : Math.round(h / 18),
          Math.round(s * 6),
          Math.round(l * 8)
        ].join(':');

        const entry = buckets.get(key) || { w: 0, r: 0, g: 0, b: 0 };
        entry.w += weight;
        entry.r += p.r * weight;
        entry.g += p.g * weight;
        entry.b += p.b * weight;
        buckets.set(key, entry);
      }
    }

    if (!buckets.size) return ['#7f8c9b'];

    // 4. Rank buckets. Slightly favor buckets that aren't near-white, since a
    // white wall or hanger that survived step 2 shouldn't win by volume alone.
    const ranked = [...buckets.values()].map(e => {
      const hex = rgbToHex(e.r / e.w, e.g / e.w, e.b / e.w);
      const { s, l } = hexToHsl(hex);
      let score = e.w;
      if (l > 0.88 && s < 0.12) score *= 0.45;
      if (l < 0.10) score *= 0.7;
      return { hex, score };
    }).sort((a, b) => b.score - a.score);

    // Drop near-duplicates so the suggestions are actually different options.
    const out = [];
    for (const c of ranked) {
      if (out.every(prev => distance(prev, c.hex) > 42)) out.push(c.hex);
      if (out.length >= count) break;
    }
    return out;
  }

  function distance(hexA, hexB) {
    const a = hexToRgb(hexA), b = hexToRgb(hexB);
    return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  }

  /* ---------------------- harmony ---------------------- */

  /**
   * Score how well two garment colors sit together (0-100), with plain-English
   * reasons. The rules are the ones people actually dress by:
   *
   *   - a neutral next to a color is the safest pairing there is
   *   - neighbours on the wheel (analogous) read as deliberate
   *   - opposites (complementary) read as deliberate too
   *   - the arc in between is the awkward zone
   *   - two loud saturated colors fight
   *   - and whatever the hues do, the two pieces need lightness contrast
   *     or they blur into one shape
   */
  function pairScore(hexA, hexB) {
    const a = hexToHsl(hexA), b = hexToHsl(hexB);
    const ta = tier(hexA), tb = tier(hexB);
    const notes = [];
    let score;

    const aNeutral = ta !== 'color', bNeutral = tb !== 'color';

    if (aNeutral && bNeutral) {
      score = 84;
      if (ta === 'soft' && tb === 'soft' && hueDistance(a.h, b.h) > 90) {
        score -= 8;
        notes.push('two off-neutrals pulling in different directions');
      } else if (ta === 'soft' || tb === 'soft') {
        const soft = ta === 'soft' ? hexA : hexB;
        notes.push(`${name(soft)} works like a neutral here`);
      } else {
        notes.push('neutral on neutral — quiet and safe');
      }
    } else if (aNeutral || bNeutral) {
      score = 89;
      const colorHex = aNeutral ? hexB : hexA;
      const neutralHex = aNeutral ? hexA : hexB;
      notes.push(`${name(neutralHex)} anchors the ${name(colorHex)}`);
    } else {
      const d = hueDistance(a.h, b.h);
      if (d <= 15) {
        score = 71;
        notes.push('same hue family — needs contrast to avoid looking like a uniform');
      } else if (d <= 45) {
        score = 79;
        notes.push('analogous colors — neighbours on the wheel');
      } else if (d <= 95) {
        score = 43;
        notes.push('hues too far apart to relate, too close to contrast');
      } else if (d <= 140) {
        score = 52;
        notes.push('an awkward interval between the two hues');
      } else {
        score = 76;
        notes.push('complementary colors — opposites that play off each other');
      }

      if (a.s > 0.55 && b.s > 0.55) {
        score -= 18;
        notes.push('both pieces are saturated — they compete');
      }
    }

    // Lightness contrast. Measured on perceived brightness, not HSL L.
    const contrast = Math.abs(luminance(hexA) - luminance(hexB));
    if (contrast < 0.08) {
      score -= 15;
      notes.push('almost no contrast — the two pieces blend together');
    } else if (contrast < 0.16) {
      score -= 5;
      notes.push('a little flat on contrast');
    } else if (contrast <= 0.70) {
      score += 8;
      notes.push('good light/dark separation');
    } else {
      score += 3;
      notes.push('high contrast');
    }

    // Anything screaming-bright is a lot for an office.
    if (Math.max(a.s, b.s) > 0.82 && Math.max(a.l, b.l) > 0.45) {
      score -= 7;
      notes.push('bright for work');
    }

    return { score: clamp(score), notes };
  }

  /**
   * Shoes answer mostly to the pants they sit under, and secondarily to the
   * shirt. The two hard rules are the classic ones: black shoes fight brown
   * or tan trousers, and brown shoes fight black trousers.
   */
  function shoeScore(shoeHex, shirtHex, pantsHex) {
    const vsPants = pairScore(shoeHex, pantsHex);
    const vsShirt = pairScore(shoeHex, shirtHex);
    let score = 0.65 * vsPants.score + 0.35 * vsShirt.score;
    const notes = [];

    if (isNeutralish(shoeHex)) score += 6;

    // pairScore docks low contrast because clothes that match tone blur together,
    // but shoes are meant to sit quietly under the trousers.
    if (isNeutralish(shoeHex) && isNeutralish(pantsHex) &&
        Math.abs(luminance(shoeHex) - luminance(pantsHex)) < 0.16) {
      score += 11;
      notes.push('shoes tone into the trousers');
    }

    const { s } = hexToHsl(shoeHex);
    if (s > 0.5 && !isBrownFamily(shoeHex)) {
      score -= 10;
      notes.push('loud shoes for an office');
    }

    if (isBlackFamily(shoeHex) && isBrownFamily(pantsHex) && !isBlackFamily(pantsHex)) {
      score -= 18;
      notes.push('black shoes clash with brown/tan trousers');
    }
    if (isBrownFamily(shoeHex) && isBlackFamily(pantsHex)) {
      score -= 14;
      notes.push('brown shoes under black trousers is a hard look to pull off');
    }

    if (!notes.length) notes.push(`${name(shoeHex)} shoes sit well under the ${name(pantsHex)}`);
    return { score: clamp(score), notes };
  }

  const clamp = n => Math.max(0, Math.min(100, Math.round(n)));

  /** Readable text color for a swatch background. */
  function contrastText(hex) {
    return luminance(hex) > 0.55 ? '#16181d' : '#ffffff';
  }

  return {
    hexToRgb, rgbToHex, rgbToHsl, hexToHsl, luminance, hueDistance,
    tier, isNeutralish, isBlackFamily, isBrownFamily,
    name, parse, paletteNames, NAMED, extractPalette, distance,
    pairScore, shoeScore, contrastText
  };
})();
