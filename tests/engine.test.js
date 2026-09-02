/*
 * Tests for the two pure modules — color.js and outfit.js.
 * No dependencies; run with:  node tests/engine.test.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.join(__dirname, '..');
const ctx = { console, Math, Date, Intl, Map, Set, JSON };
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const [file, name] of [['js/color.js', 'Color'], ['js/outfit.js', 'Outfit']]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8') + `;globalThis.${name}=${name};`, ctx);
}
const { Color, Outfit } = ctx;

let passed = 0, failed = 0;
function check(label, actual, predicate, expectation) {
  const ok = predicate(actual);
  if (ok) { passed++; }
  else { failed++; console.log(`  FAIL  ${label}\n        got ${JSON.stringify(actual)}, expected ${expectation}`); }
}
const is = v => [x => x === v, `${JSON.stringify(v)}`];
const atLeast = n => [x => x >= n, `>= ${n}`];
const atMost = n => [x => x <= n, `<= ${n}`];
const t = (label, actual, [pred, exp]) => check(label, actual, pred, exp);
const section = s => console.log('\n' + s);

/* ---------------------------- color naming ---------------------------- */
section('color naming');
[
  ['#ffffff', 'white'], ['#111111', 'black'], ['#1b2a4a', 'navy'], ['#8a8f98', 'grey'],
  ['#c8b394', 'khaki'], ['#556b2f', 'olive'], ['#8b1a1a', 'burgundy'], ['#e8d9c0', 'cream'],
  ['#e6bec4', 'pink'], ['#eeeeea', 'white'], ['#6b4a2f', 'brown'], ['#8a3f2f', 'rust']
].forEach(([hex, expected]) => t(`${hex} is ${expected}`, Color.name(hex), is(expected)));

/* ---------------------------- neutrals ---------------------------- */
section('neutral classification');
['#ffffff', '#111111', '#1b2a4a', '#8a8f98', '#c8b394', '#e8d9c0', '#556b2f']
  .forEach(h => t(`${h} (${Color.name(h)}) behaves like a neutral`, Color.isNeutralish(h), is(true)));
['#d94f3d', '#8b1a1a', '#e6bec4', '#2fa84f']
  .forEach(h => t(`${h} (${Color.name(h)}) is a color`, Color.isNeutralish(h), is(false)));

/* ---------------------------- harmony ---------------------------- */
section('shirt + pants harmony');
const pair = (a, b) => Color.pairScore(a, b).score;
t('white shirt / navy pants scores well', pair('#ffffff', '#1b2a4a'), atLeast(80));
t('blue shirt / charcoal pants scores well', pair('#a8c4e0', '#3a3f4a'), atLeast(80));
t('cream shirt / tan pants scores well', pair('#e8d9c0', '#6b5a3f'), atLeast(80));
t('bright red / bright green is rejected', pair('#d94f3d', '#2fa84f'), atMost(50));
t('sky blue / lime is rejected', pair('#5aa8d8', '#7fbf3f'), atMost(55));
t('charcoal on charcoal is docked for no contrast',
  pair('#3a3f4a', '#3d424d'), atMost(pair('#ffffff', '#1b2a4a') - 10));
t('a neutral lifts a loud color',
  pair('#d94f3d', '#3a3f4a'), atLeast(pair('#d94f3d', '#2fa84f') + 20));

section('shoe rules');
const shoe = (sh, shirt, pants) => Color.shoeScore(sh, shirt, pants).score;
t('brown shoes beat black under tan trousers',
  shoe('#5a3a22', '#a8c4e0', '#c8a878') - shoe('#151515', '#a8c4e0', '#c8a878'), atLeast(10));
t('black shoes beat brown under black trousers',
  shoe('#151515', '#ffffff', '#151515') - shoe('#5a3a22', '#ffffff', '#151515'), atLeast(5));
t('shoes matching the trouser tone are not penalised',
  shoe('#151515', '#ffffff', '#151515'), atLeast(80));

/* ---------------------------- dates ---------------------------- */
section('dates');
t('weekStart of a Wednesday is the Monday before',
  Outfit.toKey(Outfit.weekStart(new Date(2026, 8, 2))), is('2026-08-31'));
t('weekStart of a Monday is itself',
  Outfit.toKey(Outfit.weekStart(new Date(2026, 7, 31))), is('2026-08-31'));
t('weekStart of a Sunday is the Monday six days earlier',
  Outfit.toKey(Outfit.weekStart(new Date(2026, 8, 6))), is('2026-08-31'));
t('Mon-Thu yields four dates',
  Outfit.workDatesFor(Outfit.weekStart(new Date(2026, 8, 2)), [1, 2, 3, 4]).length, is(4));
t('daysBetween counts forward', Outfit.daysBetween('2026-08-31', '2026-09-04'), is(4));

/* ---------------------------- generation ---------------------------- */
section('week generation');
const mk = (id, name, category, color) =>
  ({ id, name, category, color, wearCount: 0, lastWorn: null, inRotation: true });

const closet = [
  ['white oxford', '#f2f2f0'], ['light blue oxford', '#b9d0e6'], ['navy knit', '#26334f'],
  ['pink poplin', '#e6bec4'], ['grey tee', '#8d9299'], ['olive shirt', '#5b6b3a'],
  ['charcoal henley', '#3a3d44'], ['cream linen', '#eadfc8'], ['burgundy shirt', '#7d2230'],
  ['striped blue', '#7ba3c9']
].map((r, i) => mk('s' + i, r[0], 'shirt', r[1])).concat(
  [['navy chinos', '#22304d'], ['grey wool', '#7c8189'], ['khaki chinos', '#c4b08b'],
   ['charcoal trousers', '#33363c'], ['olive chinos', '#54603a'], ['black jeans', '#1a1a1c'],
   ['stone chinos', '#cfc3ab']].map((r, i) => mk('p' + i, r[0], 'pants', r[1])),
  [['brown loafers', '#5a3b23'], ['black derbies', '#161618'], ['white sneakers', '#eeeeea'],
   ['suede chukkas', '#8a6a48']].map((r, i) => mk('h' + i, r[0], 'shoes', r[1]))
);

const settings = { workDays: [1, 2, 3, 4], colorWeight: 0.5, minGapDays: 10, pairGapDays: 90 };
const dates = Outfit.workDatesFor(Outfit.weekStart(new Date(2026, 0, 5)), settings.workDays);

const week = Outfit.generateWeek({ dates, items: closet, outfits: [], settings });
t('fills every work day', week.days.length, is(4));
t('every day has a shirt, pants and shoes',
  week.days.every(d => d.shirtId && d.pantsId && d.shoesId), is(true));
t('no shirt repeats within the week', new Set(week.days.map(d => d.shirtId)).size, is(4));
t('no pants repeat within the week', new Set(week.days.map(d => d.pantsId)).size, is(4));

section('degenerate closets');
t('no items at all reports a clear error',
  typeof Outfit.generateWeek({ dates, items: [], outfits: [], settings }).error, is('string'));
t('shirts but no pants reports a clear error',
  typeof Outfit.generateWeek({ dates, items: [mk('a', 'tee', 'shirt', '#fff')], outfits: [], settings }).error,
  is('string'));

const twoAndTwo = [mk('s1', 'white', 'shirt', '#ffffff'), mk('s2', 'blue', 'shirt', '#b9d0e6'),
                   mk('p1', 'navy', 'pants', '#26334f'), mk('p2', 'grey', 'pants', '#7c8189')];
const small = Outfit.generateWeek({ dates, items: twoAndTwo, outfits: [], settings });
t('a two-shirt closet still fills four days', small.days.length, is(4));
const shirtUse = {};
small.days.forEach(d => { shirtUse[d.shirtId] = (shirtUse[d.shirtId] || 0) + 1; });
t('and splits those two shirts evenly rather than leaning on one',
  Math.max(...Object.values(shirtUse)), is(2));

t('a closet with no shoes still generates',
  Outfit.generateWeek({ dates, items: twoAndTwo, outfits: [], settings }).days.every(d => d.shoesId === null),
  is(true));

section('locking and re-rolling');
const locked = { [week.days[0].date]: week.days[0] };
const relocked = Outfit.generateWeek({ dates, items: closet, outfits: [], settings, locked });
t('a locked day keeps its outfit', relocked.days[0].shirtId, is(week.days[0].shirtId));
t('a locked day is flagged as locked', relocked.days[0].locked, is(true));
t('a locked item is not reused later in the week',
  relocked.days.slice(1).some(d => d.shirtId === week.days[0].shirtId), is(false));

const reroll = Outfit.regenerateDay({
  date: dates[1], items: closet, outfits: [], settings, weekOutfits: week.days
});
const takenElsewhere = new Set(week.days.filter((_, i) => i !== 1).flatMap(d => [d.shirtId, d.pantsId]));
t('re-rolling one day avoids the rest of the week',
  takenElsewhere.has(reroll.days[0].shirtId) || takenElsewhere.has(reroll.days[0].pantsId), is(false));

/* ---------------------------- long-run rotation ---------------------------- */
section('rotation over 12 weeks');
const sim = closet.map(i => Object.assign({}, i));
const history = [];
let monday = Outfit.weekStart(new Date(2026, 0, 5));
let colorTotal = 0, outfitCount = 0, weekDupes = 0;

for (let w = 0; w < 12; w++) {
  const ds = Outfit.workDatesFor(monday, settings.workDays);
  const res = Outfit.generateWeek({ dates: ds, items: sim, outfits: history, settings });
  const seen = new Set();
  for (const d of res.days) {
    if (seen.has(d.shirtId) || seen.has(d.pantsId)) weekDupes++;
    seen.add(d.shirtId); seen.add(d.pantsId);
    colorTotal += d.colorScore; outfitCount++;
    for (const f of ['shirtId', 'pantsId', 'shoesId']) {
      const item = sim.find(i => i.id === d[f]);
      if (item) { item.wearCount++; item.lastWorn = d.date; }
    }
    history.push(Object.assign({}, d, { status: 'worn' }));
  }
  monday = new Date(monday);
  monday.setDate(monday.getDate() + 7);
}

const spread = cat => {
  const counts = sim.filter(i => i.category === cat).map(i => i.wearCount);
  return Math.max(...counts) - Math.min(...counts);
};
t('no item repeats inside a single week', weekDupes, is(0));
t('shirt wear counts stay within one of each other', spread('shirt'), atMost(1));
t('pants wear counts stay within one of each other', spread('pants'), atMost(1));
t('every shirt gets worn', sim.filter(i => i.category === 'shirt' && !i.wearCount).length, is(0));
t('every pair of pants gets worn', sim.filter(i => i.category === 'pants' && !i.wearCount).length, is(0));
t('average color score stays high', colorTotal / outfitCount, atLeast(85));
t('no outfit scores badly on color',
  history.filter(o => o.colorScore < 55).length, is(0));
t('pairings are mostly fresh',
  new Set(history.map(o => o.shirtId + '|' + o.pantsId)).size, atLeast(25));

/* ---------------------------- variety weighting ---------------------------- */
section('variety weighting');
const stale = closet.map(i => Object.assign({}, i));
const target = stale.find(i => i.id === 's4');
stale.forEach(i => { if (i.category === 'shirt') { i.wearCount = 9; i.lastWorn = '2026-01-01'; } });
target.wearCount = 0; target.lastWorn = null;

const varietyFirst = Outfit.generateWeek({
  dates, items: stale, outfits: [], settings: Object.assign({}, settings, { colorWeight: 0 })
});
t('with variety weighted fully, the never-worn shirt is scheduled',
  varietyFirst.days.some(d => d.shirtId === 's4'), is(true));

const stats = Outfit.buildStats(stale);
const fresh = Outfit.itemVariety(target, stats.shirt, '2026-03-01', settings).score;
const worn = Outfit.itemVariety(stale.find(i => i.id === 's0'), stats.shirt, '2026-03-01', settings).score;
t('a never-worn item outranks a heavily worn one', fresh > worn, is(true));
t('an item worn yesterday is heavily discounted',
  Outfit.itemVariety(
    Object.assign({}, target, { wearCount: 5, lastWorn: '2026-02-28' }),
    stats.shirt, '2026-03-01', settings).score,
  atMost(40));

/* ---------------------------- result ---------------------------- */
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
