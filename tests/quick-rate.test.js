// --- Tests de la note rapide depuis la watchlist (js/watchlist.js) ---
// Retour utilisateur : convertir un item de la watchlist en film noté avec
// une seule note globale, sans ouvrir la grille complète à 7 critères.
// handleQuickRate() est la seule fonction qui fait ce travail (insert direct
// dans `films`, un visionnage automatique, puis suppression de l'item de la
// watchlist) — bonne cible de test, symétrique de la branche création de
// handleSave() (js/app.js) mais sans modale.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const insertedFilms = [];
  const addViewingCalls = [];
  const deletedWatchlistIds = [];
  function makeFilmsInsertQuery(payload){
    const chain = {
      select(){ return chain; },
      single(){
        const row = { id: 501, added: payload.added, ...payload };
        insertedFilms.push(row);
        return Promise.resolve({ data: row, error: null });
      },
    };
    return chain;
  }
  const ctx = createContext({
    document: stubDocument(),
    // Externes référencées par le wiring de bas de fichier (router.js/ui.js)
    // ou par app.js — no-op ou mocks minimaux, aucun n'est appelé par
    // handleQuickRate() sauf ceux réellement mockés ci-dessous.
    goToWatchlist(){}, goHome(){}, closeOverlay(){}, openOverlay(){},
    blockIfOffline(){ return false; },
    showToast(){},
    escapeHtml(s){ return s; },
    FILM_PLACEHOLDER_SVG: '',
    TMDB_IMG_BASE: '',
    rowToFilm(row){ return { id: row.id, title: row.title, manualNote: row.manual_note }; },
    buildGenreFilterOptions(){},
    render(){},
    addViewing(filmId, watchedAt){ addViewingCalls.push({ filmId, watchedAt }); return Promise.resolve(); },
    supabaseClient: {
      from(table){
        if(table === 'films'){
          return { insert: (payload) => makeFilmsInsertQuery(payload) };
        }
        if(table === 'watchlist'){
          return {
            delete(){ return { eq(col, id){ deletedWatchlistIds.push(id); return Promise.resolve({ error: null }); } }; },
          };
        }
        throw new Error(`table inattendue dans ce test : ${table}`);
      },
    },
  });
  loadFiles(ctx, ['js/watchlist.js']);
  setState(ctx, {
    films: [],
    watchlist: [
      { id: 7, title: 'Paprika', note: null, tmdbId: 42, posterUrl: null, overview: null, releaseYear: 2006, originalTitle: null, added: 111 },
    ],
  });
  return { ctx, insertedFilms, addViewingCalls, deletedWatchlistIds };
}

test('handleQuickRate() : crée le film en note manuelle et retire l\'item de la watchlist', async () => {
  const { ctx, insertedFilms, addViewingCalls, deletedWatchlistIds } = buildContext();
  const item = getState(ctx, 'watchlist')[0];
  await ctx.handleQuickRate(item, '4.5');

  assert.strictEqual(insertedFilms.length, 1);
  assert.strictEqual(insertedFilms[0].manual_note, 4.5);
  // JSON.parse(JSON.stringify()) avant de comparer (voir tests/README.md) :
  // {} produit dans le contexte vm vient d'un autre realm que celui du test.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(insertedFilms[0].crit)), {}, 'note manuelle -> pas de grille de critères');
  assert.strictEqual(insertedFilms[0].tmdb_id, 42, 'la fiche TMDB déjà connue de l\'item watchlist est reportée sur le film');

  assert.strictEqual(addViewingCalls.length, 1, 'un premier visionnage doit être créé automatiquement');
  assert.strictEqual(addViewingCalls[0].filmId, 501);

  assert.deepStrictEqual(deletedWatchlistIds, [7], 'l\'item doit être supprimé de la watchlist une fois le film enregistré');
  const films = getState(ctx, 'films');
  assert.strictEqual(films.length, 1);
  const watchlistAfter = getState(ctx, 'watchlist');
  assert.strictEqual(watchlistAfter.length, 0);
});

test('handleQuickRate() : une note hors bornes est clampée à 5', async () => {
  const { ctx, insertedFilms } = buildContext();
  const item = getState(ctx, 'watchlist')[0];
  await ctx.handleQuickRate(item, '9');
  assert.strictEqual(insertedFilms[0].manual_note, 5);
});

test('handleQuickRate() : une valeur vide refuse d\'enregistrer (pas d\'insert)', async () => {
  const { ctx, insertedFilms, addViewingCalls } = buildContext();
  const item = getState(ctx, 'watchlist')[0];
  await ctx.handleQuickRate(item, '   ');
  assert.strictEqual(insertedFilms.length, 0);
  assert.strictEqual(addViewingCalls.length, 0);
});

// --- Régression : double-soumission (clic "OK" + Entrée, ou double-clic) ---
// Rien ne retire la ligne de l'écran avant la fin de l'await dans
// handleQuickRate() (renderWatchlist() n'arrive qu'au tout dernier moment) —
// sans le verrou confirmBtn.disabled, deux appels concurrents avant la
// résolution du premier inséreraient le même film deux fois.
test('handleQuickRate() : un second appel pendant que le premier est en cours n\'insère pas deux fois (bouton déjà désactivé)', async () => {
  const { ctx, insertedFilms } = buildContext();
  const item = getState(ctx, 'watchlist')[0];
  const fakeBtn = { disabled: false };
  const fakeInput = { disabled: false };
  const first = ctx.handleQuickRate(item, '4', fakeBtn, fakeInput);
  assert.strictEqual(fakeBtn.disabled, true, 'le bouton doit être désactivé dès le début de l\'appel, avant même la résolution de l\'insert');
  // Deuxième appel synchrone AVANT que `first` ne se résolve — simule un
  // double-clic ou Entrée+clic quasi simultanés.
  await ctx.handleQuickRate(item, '4', fakeBtn, fakeInput);
  await first;
  assert.strictEqual(insertedFilms.length, 1, 'un seul insert doit avoir eu lieu malgré les deux appels');
});

module.exports = run('quick-rate.test.js');
