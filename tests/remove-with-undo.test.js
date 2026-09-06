// --- Tests des suppressions avec annulation (js/watchlist.js, js/journal.js) ---
// Retour utilisateur : "Annuler une action destructrice" (v2.8), qui
// complète l'audit confirmations (v2.7) plutôt que de le remplacer —
// retirer un film de la watchlist / une entrée de journal retire l'élément
// de l'écran tout de suite mais ne le supprime réellement en base qu'après
// un délai (voir showUndoToast(), js/ui.js), annulable entre-temps.
//
// showUndoToast() est ici un mock, pas la vraie fonction de js/ui.js
// (déjà testée isolément dans undo-toast.test.js) : le mock capture
// (message, onCommit, onUndo) tels quels, et chaque test choisit
// lui-même d'appeler l'un ou l'autre pour simuler "le délai a expiré" ou
// "l'utilisateur a cliqué Annuler", sans dépendre du vrai timer.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument, stubElement, fakeLocalStorage } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function makeUndoToastMock(){
  const calls = [];
  const showUndoToast = (message, onCommit, onUndo) => { calls.push({ message, onCommit, onUndo }); };
  return { showUndoToast, calls };
}

// stubDocument() par défaut suffit tant que renderWatchlist() n'a qu'un
// seul item restant à dessiner (elle s'arrête avant la boucle forEach dans
// ce cas, voir quick-rate.test.js) — ici il en reste toujours au moins un
// après le retrait, donc la boucle tourne pour de vrai et interroge
// row.querySelector('[data-action="..."]').addEventListener(...) sur
// chaque ligne créée : le querySelector() par défaut de stubElement()
// renvoie null, ce qui ferait planter .addEventListener. On fournit donc
// un createElement() dont l'élément a un querySelector qui renvoie un
// stub non-null (peu importe le sélecteur, seul le fait de ne pas planter
// compte ici — le contenu réel des lignes n'est pas ce que ce test vérifie).
function stubDocumentForRender(){
  const doc = stubDocument();
  doc.createElement = () => stubElement({ querySelector: () => stubElement(), querySelectorAll: () => [] });
  return doc;
}

// --- js/watchlist.js : handleRemoveFromWatchlist() ---

function buildWatchlistContext(){
  const deletedIds = [];
  const { showUndoToast, calls } = makeUndoToastMock();
  const ctx = createContext({
    document: stubDocumentForRender(),
    goToWatchlist(){}, goHome(){}, closeOverlay(){}, openOverlay(){},
    blockIfOffline(){ return false; },
    showToast(){},
    escapeHtml(s){ return s; },
    FILM_PLACEHOLDER_SVG: '',
    showUndoToast,
    // currentUser/localStorage : nécessaires à offlineQueueKey()/
    // saveOfflineQueueToStorage() (js/offlineQueue.js, file d'attente hors
    // ligne) — chargé ci-dessous aux côtés de js/watchlist.js pour tester
    // l'enfilement réel plutôt que de re-simuler enqueueOfflineWrite() ici.
    currentUser: { id: 'u1' },
    localStorage: fakeLocalStorage(),
    supabaseClient: {
      from(table){
        if(table !== 'watchlist') throw new Error(`table inattendue dans ce test : ${table}`);
        return { delete(){ return { eq(col, id){ deletedIds.push(id); return Promise.resolve({ error: null }); } }; } };
      },
    },
  });
  loadFiles(ctx, ['js/offlineQueue.js', 'js/watchlist.js']);
  setState(ctx, {
    watchlist: [
      { id: 7, title: 'Paprika', note: null, tmdbId: 42, posterUrl: null, overview: null, releaseYear: 2006, originalTitle: null, added: 111 },
      { id: 8, title: 'Whiplash', note: null, tmdbId: 43, posterUrl: null, overview: null, releaseYear: 2014, originalTitle: null, added: 222 },
    ],
  });
  return { ctx, deletedIds, calls };
}

test('handleRemoveFromWatchlist() : retire l\'item de l\'état local tout de suite, sans supprimer en base avant l\'appel à onCommit', () => {
  const { ctx, deletedIds, calls } = buildWatchlistContext();
  ctx.handleRemoveFromWatchlist(7);
  assert.deepStrictEqual(getState(ctx, 'watchlist').map(w => w.id), [8], 'retiré de l\'écran immédiatement');
  assert.strictEqual(deletedIds.length, 0, 'aucune suppression en base tant que le délai n\'a pas expiré');
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].message.includes('Paprika'));
});

test('handleRemoveFromWatchlist() : onCommit (délai expiré) supprime réellement en base', async () => {
  const { ctx, deletedIds, calls } = buildWatchlistContext();
  ctx.handleRemoveFromWatchlist(7);
  await calls[0].onCommit();
  assert.deepStrictEqual(deletedIds, [7]);
});

test('handleRemoveFromWatchlist() : onUndo restaure l\'item à sa place d\'origine, jamais supprimé en base', () => {
  const { ctx, deletedIds, calls } = buildWatchlistContext();
  ctx.handleRemoveFromWatchlist(7);
  calls[0].onUndo();
  assert.deepStrictEqual(getState(ctx, 'watchlist').map(w => w.id), [7, 8], 'restauré à sa position d\'origine');
  assert.strictEqual(deletedIds.length, 0);
});

// File d'attente hors ligne (retour utilisateur, js/offlineQueue.js) :
// retirer un item de la watchlist cible un id déjà connu, donc plus
// bloqué hors ligne (blockIfOffline() retiré de cette fonction) — la
// suppression optimiste + le toast d'annulation se comportent pareil en
// ligne et hors ligne, seul onCommit change de chemin (met en file au lieu
// d'appeler Supabase pour de vrai).
test('handleRemoveFromWatchlist() : hors ligne, la suppression optimiste + le toast d\'annulation proposés comme en ligne', () => {
  const { ctx, calls } = buildWatchlistContext();
  setState(ctx, { isOfflineMode: true });
  ctx.handleRemoveFromWatchlist(7);
  assert.strictEqual(calls.length, 1, 'le toast d\'annulation doit être proposé même hors ligne');
  assert.deepStrictEqual(getState(ctx, 'watchlist').map(w => w.id), [8], 'retiré de l\'écran tout de suite, comme en ligne');
});

test('handleRemoveFromWatchlist() : onCommit hors ligne met en file plutôt que d\'appeler Supabase', async () => {
  const { ctx, deletedIds, calls } = buildWatchlistContext();
  setState(ctx, { isOfflineMode: true, offlineQueue: [] });
  ctx.handleRemoveFromWatchlist(7);
  await calls[0].onCommit();
  assert.strictEqual(deletedIds.length, 0, 'aucun appel réseau hors ligne');
  const queue = JSON.parse(JSON.stringify(getState(ctx, 'offlineQueue')));
  assert.strictEqual(queue.length, 1);
  assert.strictEqual(queue[0].table, 'watchlist');
  assert.strictEqual(queue[0].op, 'delete');
  assert.deepStrictEqual(queue[0].match, { id: 7 });
  assert.strictEqual(getState(ctx, 'watchlist').length, 1, 'rien ne doit avoir bougé');
});

// --- js/journal.js : removeViewingWithUndo() ---

function buildJournalContext(){
  const deletedIds = [];
  const { showUndoToast, calls } = makeUndoToastMock();
  const renderCalls = [];
  const ctx = createContext({
    document: stubDocument(),
    escapeHtml(s){ return s; },
    FILM_PLACEHOLDER_SVG: '',
    showToast(){},
    showUndoToast,
    render(){ renderCalls.push('render'); },
    films: [{ id: 1, title: 'Paprika' }],
    supabaseClient: {
      from(table){
        if(table !== 'viewings') throw new Error(`table inattendue dans ce test : ${table}`);
        return { delete(){ return { eq(col, id){ deletedIds.push(id); return Promise.resolve({ error: null }); } }; } };
      },
    },
  });
  loadFiles(ctx, ['js/journal.js']);
  setState(ctx, {
    viewings: [
      { id: 100, filmId: 1, watchedAt: 111, note: null },
      { id: 101, filmId: 1, watchedAt: 222, note: null },
    ],
  });
  return { ctx, deletedIds, calls, renderCalls };
}

test('removeViewingWithUndo() : retire le visionnage de l\'état local tout de suite, sans supprimer en base avant onCommit', () => {
  const { ctx, deletedIds, calls, renderCalls } = buildJournalContext();
  ctx.removeViewingWithUndo(100, 1);
  assert.deepStrictEqual(getState(ctx, 'viewings').map(v => v.id), [101]);
  assert.strictEqual(deletedIds.length, 0);
  assert.strictEqual(calls.length, 1);
  assert.ok(renderCalls.length >= 1, 'render() doit être rappelé (compteurs "revu Nx" dans le catalogue)');
});

test('removeViewingWithUndo() : onCommit (délai expiré) supprime réellement en base', async () => {
  const { ctx, deletedIds, calls } = buildJournalContext();
  ctx.removeViewingWithUndo(100, 1);
  await calls[0].onCommit();
  assert.deepStrictEqual(deletedIds, [100]);
});

test('removeViewingWithUndo() : onUndo restaure le visionnage à sa place d\'origine, jamais supprimé en base', () => {
  const { ctx, deletedIds, calls } = buildJournalContext();
  ctx.removeViewingWithUndo(100, 1);
  calls[0].onUndo();
  assert.deepStrictEqual(getState(ctx, 'viewings').map(v => v.id), [100, 101], 'restauré à sa position d\'origine');
  assert.strictEqual(deletedIds.length, 0);
});

module.exports = run('remove-with-undo.test.js');
