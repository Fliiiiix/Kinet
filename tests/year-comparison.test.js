// --- Tests de la comparaison année sur année (js/stats.js) ---
// Retour utilisateur : "cette année vs l'année dernière" dans
// Statistiques. renderYearComparison() réutilise computeRecap() (js/recap.js,
// déjà testé pour sa propre logique dans tests/recap.test.js) plutôt que de
// dupliquer le calcul "vu cette année-là" — ce test se concentre sur ce que
// renderYearComparison() ajoute par-dessus : les deux colonnes, le delta, et
// les cas où une année (ou les deux) n'a rien à montrer.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

const THIS_YEAR = new Date().getFullYear();
const LAST_YEAR = THIS_YEAR - 1;

function buildContext(){
  const ctx = createContext({
    document: stubDocument(),
    escapeHtml(s){ return s; },
    getDisplayNote(f){ return f.manualNote != null ? f.manualNote : null; },
    GENRE_MAP: { 18: 'Drame', 35: 'Comédie' },
    CRITERIA: [{ key: 'scenario', label: 'Scénario' }],
    openOverlay(){}, closeOverlay(){}, showToast(){},
    currentProfile: { display_name: 'Test' },
  });
  loadFiles(ctx, ['js/recap.js', 'js/stats.js']);
  return ctx;
}

test('renderYearComparison() : affiche les deux colonnes avec les bons totaux quand les deux années ont des films vus', () => {
  const ctx = buildContext();
  setState(ctx, {
    films: [
      { id: 1, title: 'A', manualNote: 4, fav: false, genreIds: [18], posterUrl: null },
      { id: 2, title: 'B', manualNote: 3, fav: false, genreIds: [18], posterUrl: null },
      { id: 3, title: 'C', manualNote: 5, fav: false, genreIds: [35], posterUrl: null },
    ],
    viewings: [
      { filmId: 1, watchedAt: new Date(THIS_YEAR, 0, 1).getTime() },
      { filmId: 2, watchedAt: new Date(THIS_YEAR, 0, 2).getTime() },
      { filmId: 3, watchedAt: new Date(LAST_YEAR, 0, 1).getTime() },
    ],
  });
  const html = ctx.renderYearComparison();
  assert.ok(html.includes(String(THIS_YEAR)) && html.includes(String(LAST_YEAR)), 'les deux années doivent être affichées');
  // 2 films cette année, 1 l'an dernier -> delta "+1".
  assert.ok(html.includes('1 film de plus'), `le delta doit signaler 1 film de plus (html: ${html.slice(0, 200)})`);
});

test('renderYearComparison() : aucun film vu ni cette année ni l\'an dernier -> chaîne vide (rien à afficher)', () => {
  const ctx = buildContext();
  setState(ctx, {
    films: [{ id: 1, title: 'A', manualNote: 4, fav: false, genreIds: [], posterUrl: null }],
    viewings: [{ filmId: 1, watchedAt: new Date(THIS_YEAR - 5, 0, 1).getTime() }], // ni l'une ni l'autre année
  });
  assert.strictEqual(ctx.renderYearComparison(), '', 'pas de section du tout si rien à comparer d\'un côté comme de l\'autre');
});

test('renderYearComparison() : rien vu l\'an dernier -> la colonne de cette année s\'affiche quand même, sans delta ni exception', () => {
  const ctx = buildContext();
  setState(ctx, {
    films: [{ id: 1, title: 'A', manualNote: 4, fav: false, genreIds: [], posterUrl: null }],
    viewings: [{ filmId: 1, watchedAt: new Date(THIS_YEAR, 0, 1).getTime() }],
  });
  const html = ctx.renderYearComparison();
  assert.ok(html.includes(String(THIS_YEAR)));
  assert.ok(html.includes('Rien de vu cette année-là'), 'la colonne vide (année dernière) doit avoir un message explicite, pas juste vide');
  assert.ok(!html.includes('film de plus') && !html.includes('film de moins'), 'pas de delta affiché quand une des deux années n\'a rien');
});

test('renderYearComparison() : un nombre identique de films les deux années -> pas de delta affiché (0 n\'est pas un "progrès")', () => {
  const ctx = buildContext();
  setState(ctx, {
    films: [
      { id: 1, title: 'A', manualNote: 4, fav: false, genreIds: [], posterUrl: null },
      { id: 2, title: 'B', manualNote: 3, fav: false, genreIds: [], posterUrl: null },
    ],
    viewings: [
      { filmId: 1, watchedAt: new Date(THIS_YEAR, 0, 1).getTime() },
      { filmId: 2, watchedAt: new Date(LAST_YEAR, 0, 1).getTime() },
    ],
  });
  const html = ctx.renderYearComparison();
  assert.ok(!html.includes('film de plus') && !html.includes('film de moins'), 'delta nul -> rien à signaler');
});

module.exports = run('year-comparison.test.js');
