// --- Tests de « Ton ADN ciné » (js/dna.js) ---
// Idée 7 du 28/10 : genres préférés et le moins aimé, décennies, critères
// généreux ou exigeants, réalisateurs les plus présents.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles } = require('./helpers/vm-harness');
const { test, run } = createSuite();
const plain = (v) => JSON.parse(JSON.stringify(v));

function buildContext(){
  const ctx = createContext({
    getDisplayNote(f){ return f.note == null ? null : f.note; },
    escapeHtml(s){ return String(s); },
  });
  loadFiles(ctx, ['js/data.js', 'js/dna.js']);
  return ctx;
}

const SF = 878, DRAME = 18, HORREUR = 27, COMEDIE = 35;
const crit = (scenario, esthetique) => ({ scenario, mise_en_scene: 0.7, jeu: 0.7, esthetique, son: 0.7, musique: 0.7, ressenti: 0.7 });
let id = 0;
const f = (note, genreIds, releaseYear, extra = {}) => Object.assign({ id: ++id, tmdbId: id, note, genreIds, releaseYear, crit: {} }, extra);

const CATALOGUE = [
  f(4.5, [SF], 2016, { crit: crit(0.6, 0.95) }), f(4.5, [SF], 2014, { crit: crit(0.6, 0.9) }), f(4, [SF], 2010, { crit: crit(0.6, 0.9) }),
  f(3.5, [DRAME], 2019, { crit: crit(0.6, 0.9) }), f(3.5, [DRAME], 2003, { crit: crit(0.6, 0.9) }), f(3.5, [DRAME], 1997),
  f(2, [HORREUR], 2018), f(2.5, [HORREUR], 2012), f(2, [HORREUR], 1999),
  f(3.5, [COMEDIE], 2011), f(3.5, [COMEDIE], 2015), f(3.5, [COMEDIE], 2001),
  f(null, [SF], 2021), // vu, pas noté : compte pour les décennies seulement
];

test('moins de 5 films notés : pas d’ADN', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.computeDna(CATALOGUE.slice(0, 4)), null);
});

test('genres : les trois mieux notés, et le moins aimé seulement s’il est nettement sous ta moyenne', () => {
  const ctx = buildContext();
  const dna = ctx.computeDna(CATALOGUE);
  assert.deepStrictEqual(plain(dna.best.map(g => g.name)), ['Science-fiction', 'Comédie', 'Drame']);
  assert.strictEqual(dna.worst.name, 'Horreur');
});

test('décennies : les plus présentes, films non notés compris, « années 90 » et « années 2010 »', () => {
  const ctx = buildContext();
  const dna = ctx.computeDna(CATALOGUE);
  assert.deepStrictEqual(plain(dna.decades.map(d => d.label)), ['années 2010', 'années 2000', 'années 90']);
  assert.strictEqual(dna.decades[0].n, 8);
});

test('critères : généreux sur l’Esthétique, exigeant sur le Scénario', () => {
  const ctx = buildContext();
  const lines = ctx.dnaLines(ctx.computeDna(CATALOGUE));
  const critLine = lines.find(l => l.label === 'Tes critères');
  assert.ok(critLine.value.startsWith('généreux sur Esthétique'), critLine.value);
  assert.ok(critLine.value.includes('exigeant sur Scénario (3,0)'));
});

test('réalisateurs : seulement à partir de deux films, le plus présent d’abord', () => {
  const ctx = buildContext();
  const villeneuve = { id: 1, name: 'Denis Villeneuve' }, nolan = { id: 2, name: 'Christopher Nolan' };
  const facts = { 1: [villeneuve], 2: [nolan], 3: [villeneuve], 4: [villeneuve], 5: [{ id: 3, name: 'Une seule fois' }] };
  const dna = ctx.computeDna(CATALOGUE, (tmdbId) => facts[tmdbId] ? { directors: facts[tmdbId] } : null);
  assert.deepStrictEqual(plain(dna.directors.map(d => [d.name, d.n])), [['Denis Villeneuve', 3]]);
  const line = ctx.dnaLines(dna).find(l => l.label === 'Tes réalisateurs');
  assert.strictEqual(line.value, 'Denis Villeneuve (3 films, 4,0)');
});

module.exports = run('dna.test.js');
