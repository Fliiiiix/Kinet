// --- Tests des actions groupées sur le catalogue (js/app.js) ---
// Retour utilisateur : "Actions groupées sur le catalogue" — cocher
// plusieurs films (#bulkSelectBtn bascule le mode) puis les marquer
// favoris/retirer des favoris, les supprimer, ou exporter juste la
// sélection en JSON.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

// render() construit un vrai DOM de lignes via document.createElement() —
// même piège que documenté dans tests/README.md pour remove-with-undo.test.js :
// le querySelector() par défaut de stubElement() renvoie null, ce qui ferait
// planter `row.querySelector('.star-btn').addEventListener(...)` dès qu'une
// ligne est effectivement dessinée. createElement() renvoie donc ici un
// élément dont le querySelector répond toujours par un stub non-null.
function stubDocumentForRender(elements){
  const doc = stubDocument(elements);
  doc.createElement = () => stubElement({ querySelector: () => stubElement(), querySelectorAll: () => [] });
  return doc;
}

function buildContext(overrides = {}){
  const updateCalls = [];
  const deleteCalls = [];
  function makeFilmsQuery(){
    const call = { update: null, delete: false, in: null, eq: [] };
    const chain = {
      update(payload){ call.update = payload; updateCalls.push(call); return chain; },
      delete(){ call.delete = true; deleteCalls.push(call); return chain; },
      in(col, ids){ call.in = ids; return chain; },
      eq(col, val){ call.eq.push([col, val]); return chain; },
      then(resolve){ return Promise.resolve({ error: null }).then(resolve); },
    };
    return chain;
  }
  const elements = Object.assign({
    bulkActionsBar: stubElement({ hidden: false }),
    bulkActionsCount: stubElement(),
    bulkSelectBtn: stubElement(),
    filmList: stubElement(),
    countLine: stubElement(),
    pagination: stubElement(),
    search: stubElement({ value: '' }),
    sortBy: stubElement({ value: 'note-desc' }),
    sortCriterion: stubElement({ value: '' }),
    critFilterMin: stubElement({ value: '0' }),
    genreFilter: stubElement({ value: '' }),
    yearFilter: stubElement({ value: '' }),
    filtersToggleBtn: stubElement(),
  }, overrides.elements || {});
  const ctx = createContext(Object.assign({
    document: stubDocumentForRender(elements),
    escapeHtml(s){ return s; },
    GENRE_MAP: {},
    CRITERIA: [{ key: 'scenario', label: 'Scénario' }],
    currentUser: { id: 'u1' },
    blockIfOffline(){ return false; },
    showToast(){},
    getSearchTerms(){ return []; },
    normalizeSearch(s){ return s; },
    noteColorClass(){ return ''; },
    getDisplayNote(f){ return f.manualNote; },
    getClickHappeningForFilm(){ return null; },
    makeRowClickable(){},
    rewatchCount(){ return 0; },
    pulseElement(){},
    FILM_PLACEHOLDER_SVG: '',
    supabaseClient: { from: () => makeFilmsQuery() },
  }, overrides.contextExtra || {}));
  loadFiles(ctx, ['js/app.js']);
  setState(ctx, {
    films: [
      { id: 1, title: 'A', manualNote: 3, crit: {}, fav: false, genreIds: [], releaseYear: 2020 },
      { id: 2, title: 'B', manualNote: 4, crit: {}, fav: false, genreIds: [], releaseYear: 2021 },
      { id: 3, title: 'C', manualNote: 5, crit: {}, fav: true, genreIds: [], releaseYear: 2022 },
    ],
    viewings: [{ id: 10, filmId: 1, watchedAt: 111 }, { id: 11, filmId: 2, watchedAt: 222 }],
  });
  return { ctx, updateCalls, deleteCalls, elements };
}

test('toggleFilmSelection() : ajoute/retire un id de selectedFilmIds', () => {
  const { ctx } = buildContext();
  ctx.toggleFilmSelection(1);
  assert.ok(getState(ctx, 'selectedFilmIds').has(1));
  ctx.toggleFilmSelection(1);
  assert.ok(!getState(ctx, 'selectedFilmIds').has(1));
});

test('toggleBulkSelectMode() : bascule le mode et vide la sélection en cours', () => {
  const { ctx } = buildContext();
  ctx.toggleFilmSelection(1);
  ctx.toggleBulkSelectMode();
  assert.strictEqual(getState(ctx, 'bulkSelectMode'), true);
  assert.strictEqual(getState(ctx, 'selectedFilmIds').size, 0, 'la sélection précédente ne doit pas survivre à l\'activation du mode');
});

test('handleBulkFavorite(true) : marque favoris uniquement les films sélectionnés, envoie le bon payload', async () => {
  const { ctx, updateCalls } = buildContext();
  setState(ctx, { selectedFilmIds: new Set([1, 2]) });
  await ctx.handleBulkFavorite(true);
  const films = getState(ctx, 'films');
  assert.strictEqual(films.find(f => f.id === 1).fav, true);
  assert.strictEqual(films.find(f => f.id === 2).fav, true);
  assert.strictEqual(films.find(f => f.id === 3).fav, true, 'déjà favori, pas sélectionné -> inchangé (déjà true)');
  assert.strictEqual(updateCalls.length, 1);
  // JSON.parse(JSON.stringify()) avant de comparer (voir tests/README.md) :
  // ce payload vient d'un objet créé DANS le contexte vm (realm différent
  // de celui du test), deepStrictEqual échoue sinon sur la comparaison de
  // prototype malgré une structure identique.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(updateCalls[0].update)), { fav: true });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(updateCalls[0].in)), [1, 2]);
});

test('handleBulkFavorite(false) : retire des favoris', async () => {
  const { ctx } = buildContext();
  setState(ctx, { selectedFilmIds: new Set([3]) });
  await ctx.handleBulkFavorite(false);
  assert.strictEqual(getState(ctx, 'films').find(f => f.id === 3).fav, false);
});

test('handleBulkFavorite() : ne fait rien si rien n\'est sélectionné (pas d\'appel réseau)', async () => {
  const { ctx, updateCalls } = buildContext();
  await ctx.handleBulkFavorite(true);
  assert.strictEqual(updateCalls.length, 0);
});

test('handleBulkExport() : ne construit l\'export qu\'à partir des films sélectionnés', () => {
  const { ctx } = buildContext();
  setState(ctx, { selectedFilmIds: new Set([2]) });
  let exported = null;
  // downloadFilmsJson() manipule le DOM réel (Blob/URL/<a>) — remplacé ici
  // pour ne vérifier que CE que handleBulkExport() lui passe, pas la
  // mécanique de téléchargement elle-même (déjà exercée par exportFilms()
  // en usage normal, jamais couverte par un test unitaire côté Blob/URL).
  // Une fonction déclarée avec `function` (comme downloadFilmsJson) EST une
  // propriété du contexte, contrairement à un `let` — la réassigner ainsi
  // depuis l'hôte redirige bien l'appel fait depuis l'intérieur du contexte
  // vm (même liaison globale), pas besoin de setState() ici.
  ctx.downloadFilmsJson = (filmsToExport) => { exported = filmsToExport; };
  ctx.handleBulkExport();
  assert.strictEqual(exported.length, 1);
  assert.strictEqual(exported[0].id, 2);
});

test('handleBulkDelete() : annulé (confirm() refusé) -> aucun film supprimé', async () => {
  const { ctx, deleteCalls } = buildContext({ contextExtra: { confirm: () => false } });
  setState(ctx, { selectedFilmIds: new Set([1]) });
  await ctx.handleBulkDelete();
  assert.strictEqual(deleteCalls.length, 0);
  assert.strictEqual(getState(ctx, 'films').length, 3, 'rien ne doit avoir été retiré localement non plus');
});

test('handleBulkDelete() : confirmé -> supprime les films ET leurs visionnages (cascade locale)', async () => {
  const { ctx, deleteCalls } = buildContext({ contextExtra: { confirm: () => true } });
  setState(ctx, { selectedFilmIds: new Set([1, 2]) });
  await ctx.handleBulkDelete();
  const films = getState(ctx, 'films');
  assert.deepStrictEqual(films.map(f => f.id), [3]);
  const viewings = getState(ctx, 'viewings');
  assert.strictEqual(viewings.length, 0, 'les visionnages des 2 films supprimés doivent disparaître localement aussi');
  assert.strictEqual(deleteCalls.length, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(deleteCalls[0].in)), [1, 2]);
  assert.strictEqual(getState(ctx, 'selectedFilmIds').size, 0, 'la sélection est vidée après suppression');
});

module.exports = run('bulk-actions.test.js');
