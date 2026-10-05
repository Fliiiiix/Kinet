// --- Tests du calcul de rareté hors app (supabase/scripts/tcg-rarity.js) ---
// On teste la logique pure : scores de personnes, paliers par percentile,
// SQL généré. Pas de fichiers IMDb ici (ils pèsent plusieurs centaines de Mo).
const path = require('path');
const { createSuite, assert } = require('./helpers/tiny-test');
const { test, run } = createSuite();

const { personMetrics, assignTiers, buildSql, lirePoids, POIDS_DEFAUT, MIN_VOTES, MIN_RUNTIME } = require(path.join(__dirname, '..', 'supabase', 'scripts', 'tcg-rarity.js'));

test('les seuils correspondent à la règle : 5000 votes et 60 minutes minimum', () => {
  assert.strictEqual(MIN_VOTES, 5000);
  assert.strictEqual(MIN_RUNTIME, 60);
});

test('personMetrics : le pic est la moyenne des 5 meilleurs WR, le volume le nombre de films', () => {
  const movies = new Map();
  [9, 8, 7, 6, 5, 4, 3].forEach((wr, i) => movies.set('t' + i, { WR: wr }));
  const person = { films: new Set(['t0', 't1', 't2', 't3', 't4', 't5', 't6']) };
  const m = personMetrics(person, movies);
  assert.strictEqual(m.volume, 7);
  // Top 5 : 9, 8, 7, 6, 5 -> moyenne 7
  assert.strictEqual(m.pic, 7);
});

test('personMetrics : un acteur avec peu de films garde un pic correct', () => {
  const movies = new Map([['a', { WR: 7.5 }], ['b', { WR: 6.5 }]]);
  const m = personMetrics({ films: new Set(['a', 'b']) }, movies);
  assert.strictEqual(m.volume, 2);
  assert.strictEqual(m.pic, 7);
});

test('assignTiers : répartition 83 / 11 / 4 / 2 sur un grand lot', () => {
  const items = Array.from({ length: 1001 }, (_, i) => ({ id: i, score: i }));
  const tiers = assignTiers(items);
  const count = (r) => tiers.filter(t => t.rarity === r).length;
  // Les proportions doivent tomber très près de 83/11/4/2 (au plus une carte d'écart).
  assert.ok(Math.abs(count('commun') - 830) <= 2, 'commun ' + count('commun'));
  assert.ok(Math.abs(count('rare') - 110) <= 2, 'rare ' + count('rare'));
  assert.ok(Math.abs(count('epique') - 40) <= 2, 'epique ' + count('epique'));
  assert.ok(Math.abs(count('legendaire') - 20) <= 2, 'legendaire ' + count('legendaire'));
});

test('assignTiers : le meilleur score est légendaire, le plus faible commun', () => {
  const tiers = assignTiers([{ id: 1, score: 0.2 }, { id: 2, score: 0.9 }, { id: 3, score: 0.5 }]);
  const byId = Object.fromEntries(tiers.map(t => [t.id, t.rarity]));
  assert.strictEqual(byId[2], 'legendaire');
  assert.strictEqual(byId[1], 'commun');
});

test('assignTiers : un seul élément reçoit la rareté la plus haute (percentile 1)', () => {
  const tiers = assignTiers([{ id: 7, score: 0.4 }]);
  assert.strictEqual(tiers[0].rarity, 'legendaire');
});

test('assignTiers : liste vide renvoie une liste vide', () => {
  assert.deepStrictEqual(assignTiers([]), []);
});

test('buildSql : respecte la surcharge admin (coalesce) et encadre par begin/commit', () => {
  const sql = buildSql([{ id: 12, rarity: 'rare' }]);
  assert.ok(sql.startsWith('begin;'));
  assert.ok(sql.trim().endsWith('commit;'));
  assert.ok(sql.includes("rarity_auto = 'rare'"));
  assert.ok(sql.includes("coalesce(rarity_override, 'rare')"));
  assert.ok(sql.includes('where id = 12;'));
});

test('lirePoids : les poids sont normalisés à 1, et une entrée invalide est refusée', () => {
  const p = lirePoids('2,1,1');
  assert.ok(Math.abs(p.pic - 0.5) < 1e-9 && Math.abs(p.reach - 0.25) < 1e-9 && Math.abs(p.volume - 0.25) < 1e-9);
  assert.ok(Math.abs((POIDS_DEFAUT.pic + POIDS_DEFAUT.reach + POIDS_DEFAUT.volume) - 1) < 1e-9);
  assert.throws(() => lirePoids('a,b,c'));
  assert.throws(() => lirePoids('0,0,0'));
});

module.exports = run('tcg-rarity.test.js');
