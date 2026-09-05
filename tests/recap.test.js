// --- Tests du bilan cinéphile partageable (js/recap.js) ---
// Retour utilisateur : une image exportable résumant l'ANNÉE EN COURS
// (films vus, note moyenne, genre préféré, top films). computeRecap() est
// la partie pure-données (pas de canvas ici) — la cible naturelle du test.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const ctx = createContext({
    document: stubDocument(),
    getDisplayNote(f){ return f.manualNote != null ? f.manualNote : null; },
    GENRE_MAP: { 18: 'Drame', 35: 'Comédie' },
    openOverlay(){}, closeOverlay(){}, showToast(){},
    currentProfile: { display_name: 'Test' },
  });
  loadFiles(ctx, ['js/recap.js']);
  return ctx;
}

test('computeRecap() : ne compte que les films VUS (viewings) cette année-là, pas ceux juste ajoutés', () => {
  const ctx = buildContext();
  setState(ctx, {
    films: [
      { id: 1, title: 'Film 2026', manualNote: 4, fav: false, genreIds: [18], posterUrl: null },
      { id: 2, title: 'Film ajouté mais jamais vu cette année', manualNote: 3, fav: false, genreIds: [35], posterUrl: null },
    ],
    viewings: [
      { filmId: 1, watchedAt: new Date(2026, 5, 1).getTime() },
      { filmId: 2, watchedAt: new Date(2024, 0, 1).getTime() }, // vu, mais en 2024
    ],
  });
  const recap = ctx.computeRecap(2026);
  assert.strictEqual(recap.total, 1);
  assert.strictEqual(recap.topFilms.length, 1);
  assert.strictEqual(recap.topFilms[0].title, 'Film 2026');
});

test('computeRecap() : note moyenne calculée uniquement sur les films notés de l\'année', () => {
  const ctx = buildContext();
  setState(ctx, {
    films: [
      { id: 1, title: 'A', manualNote: 5, fav: false, genreIds: [], posterUrl: null },
      { id: 2, title: 'B', manualNote: 3, fav: false, genreIds: [], posterUrl: null },
      { id: 3, title: 'C', manualNote: null, fav: false, genreIds: [], posterUrl: null }, // pas noté -> exclu de la moyenne
    ],
    viewings: [
      { filmId: 1, watchedAt: new Date(2026, 0, 1).getTime() },
      { filmId: 2, watchedAt: new Date(2026, 0, 2).getTime() },
      { filmId: 3, watchedAt: new Date(2026, 0, 3).getTime() },
    ],
  });
  const recap = ctx.computeRecap(2026);
  assert.strictEqual(recap.total, 3, 'les 3 films comptent pour "vus", même le non noté');
  assert.strictEqual(recap.avgNote, 4, '(5+3)/2 = 4, le non-noté n\'entre pas dans la moyenne');
});

test('computeRecap() : le genre le plus fréquent parmi les films vus cette année est retenu', () => {
  const ctx = buildContext();
  setState(ctx, {
    films: [
      { id: 1, title: 'A', manualNote: 4, fav: false, genreIds: [18], posterUrl: null },
      { id: 2, title: 'B', manualNote: 4, fav: false, genreIds: [18], posterUrl: null },
      { id: 3, title: 'C', manualNote: 4, fav: false, genreIds: [35], posterUrl: null },
    ],
    viewings: [
      { filmId: 1, watchedAt: new Date(2026, 0, 1).getTime() },
      { filmId: 2, watchedAt: new Date(2026, 0, 2).getTime() },
      { filmId: 3, watchedAt: new Date(2026, 0, 3).getTime() },
    ],
  });
  const recap = ctx.computeRecap(2026);
  assert.strictEqual(recap.topGenreLabel, 'Drame', 'Drame apparaît 2 fois contre 1 pour Comédie');
});

test('computeRecap() : aucun film vu cette année-là -> null (pas un bilan vide/cassé)', () => {
  const ctx = buildContext();
  setState(ctx, {
    films: [{ id: 1, title: 'A', manualNote: 4, fav: false, genreIds: [], posterUrl: null }],
    viewings: [{ filmId: 1, watchedAt: new Date(2020, 0, 1).getTime() }],
  });
  const recap = ctx.computeRecap(2026);
  assert.strictEqual(recap, null);
});

test('computeRecap() : top films limité à 5, triés par note décroissante', () => {
  const ctx = buildContext();
  const films = [];
  const viewingsList = [];
  for(let i = 1; i <= 7; i++){
    films.push({ id: i, title: `Film ${i}`, manualNote: i, fav: false, genreIds: [], posterUrl: null });
    viewingsList.push({ filmId: i, watchedAt: new Date(2026, 0, i).getTime() });
  }
  setState(ctx, { films, viewings: viewingsList });
  const recap = ctx.computeRecap(2026);
  assert.strictEqual(recap.topFilms.length, 5);
  assert.strictEqual(recap.topFilms[0].title, 'Film 7', 'la meilleure note (7) doit être en tête');
  assert.strictEqual(recap.topFilms[4].title, 'Film 3');
});

module.exports = run('recap.test.js');
