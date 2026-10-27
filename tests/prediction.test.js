// --- Tests de « Ta note prévue » (js/prediction.js) ---
// Idée 6 du 28/10 : la note probable d'un film, d'après tes notes : ta
// moyenne, ton lien avec la note TMDB, tes écarts par genre et réalisateur.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const ctx = createContext({});
  loadFiles(ctx, ['js/data.js', 'js/prediction.js']);
  return ctx;
}

const DRAME = 18, SF = 878, HORREUR = 27;
const VILLENEUVE = { id: 137427, name: 'Denis Villeneuve' };
const film = (note, genres, vote, directors = []) => ({ note, genres, facts: { vote, votes: 1000, genres, directors } });

test('moins de 8 films notés : pas d’estimation', () => {
  const ctx = buildContext();
  const rated = Array.from({ length: 7 }, () => film(4, [DRAME], 7));
  assert.strictEqual(ctx.predictNote({ genres: [DRAME] }, rated), null);
});

test('tu suis la note TMDB : un film mieux noté sur TMDB est mieux prévu', () => {
  const ctx = buildContext();
  // Tes notes suivent TMDB : 6 -> 2,5, 7 -> 3,25, 8 -> 4.
  const rated = [];
  for(let i = 0; i < 12; i++){ const v = 6 + (i % 3); rated.push(film(2.5 + (v - 6) * 0.75, [DRAME], v)); }
  const high = ctx.predictNote({ genres: [DRAME], facts: { vote: 8.5, votes: 5000, genres: [DRAME] } }, rated);
  const low = ctx.predictNote({ genres: [DRAME], facts: { vote: 6, votes: 5000, genres: [DRAME] } }, rated);
  assert.ok(high.note > low.note + 0.8, `${high.note} contre ${low.note}`);
});

test('genre aimé : la SF, notée au-dessus de ta moyenne, remonte l’estimation', () => {
  const ctx = buildContext();
  const rated = [
    ...Array.from({ length: 6 }, () => film(4.5, [SF], 7)),
    ...Array.from({ length: 6 }, () => film(2.5, [HORREUR], 7)),
  ];
  const sf = ctx.predictNote({ genres: [SF] }, rated);
  const horreur = ctx.predictNote({ genres: [HORREUR] }, rated);
  assert.ok(sf.note > sf.mean && horreur.note < horreur.mean);
  assert.ok(ctx.predictionReason(sf).includes('tes notes en Science-fiction'));
});

test('réalisateur : tes films de Denis Villeneuve tirent l’estimation vers le haut', () => {
  const ctx = buildContext();
  const rated = [
    ...Array.from({ length: 8 }, () => film(3, [DRAME], 7)),
    film(5, [DRAME], 7, [VILLENEUVE]), film(5, [DRAME], 7, [VILLENEUVE]), film(4.5, [DRAME], 7, [VILLENEUVE]),
  ];
  const pred = ctx.predictNote({ genres: [DRAME], facts: { vote: 7, votes: 5000, genres: [DRAME], directors: [VILLENEUVE] } }, rated);
  const without = ctx.predictNote({ genres: [DRAME], facts: { vote: 7, votes: 5000, genres: [DRAME], directors: [] } }, rated);
  assert.ok(pred.note > without.note + 0.5);
  assert.ok(ctx.predictionReason(pred).includes('ton avis sur Denis Villeneuve'));
});

test('un seul film d’un genre ne suffit pas à conclure (rapproché de zéro)', () => {
  const ctx = buildContext();
  const rated = [...Array.from({ length: 10 }, () => film(3, [DRAME], 7)), film(5, [HORREUR], 7)];
  const pred = ctx.predictNote({ genres: [HORREUR] }, rated);
  assert.ok(pred.note - pred.mean < 0.4, `un seul film d'horreur à 5 : ${pred.note}`);
});

test('bornes : jamais au-dessus de 5 ni sous 0,5 ; sans raison forte, « ta moyenne »', () => {
  const ctx = buildContext();
  const rated = Array.from({ length: 10 }, () => film(5, [SF], 7));
  const pred = ctx.predictNote({ genres: [SF] }, rated);
  assert.ok(pred.note <= 5);
  const flat = ctx.predictNote({ genres: [] }, Array.from({ length: 10 }, () => film(3.5, [DRAME], 7)));
  assert.strictEqual(flat.note, 3.5);
  assert.strictEqual(ctx.predictionReason(flat), 'd’après ta moyenne');
});

module.exports = run('prediction.test.js');
