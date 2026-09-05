// --- Tests de la recherche globale unifiée (js/globalSearch.js) ---
// Retour utilisateur : une seule barre, cherchant à la fois dans le
// catalogue, les séries suivies, les amis et les groupes déjà en mémoire.
// Ce test couvre la logique propre à ce fichier (filtrage par catégorie,
// limite par groupe, exclusion des amis pas encore acceptés) — pas
// normalizeSearch()/getSearchTerms() elles-mêmes (accents/casse), déjà
// une responsabilité de js/app.js, stubbées ici avec une version minimale
// suffisante pour ces cas.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const resultsEl = stubElement();
  const ctx = createContext({
    document: stubDocument({ globalSearchResults: resultsEl, globalSearchInput: stubElement() }),
    // Externes (app.js/data.js/router.js/ui.js/friends.js/series.js) — des
    // versions minimales suffisantes pour exercer performGlobalSearch(),
    // pas les vraies implémentations (accents/casse hors sujet ici).
    normalizeSearch(s){ return s.toLowerCase(); },
    getSearchTerms(f){ return [f.title.toLowerCase()]; },
    escapeHtml(s){ return s; },
    getDisplayNote(f){ return f.manualNote != null ? f.manualNote : null; },
    showStatusLabel(s){ return s; },
    otherUserId(f){ return f.otherUserId; },
    friendDisplayName(userId){ return ({ u1: 'Alice', u2: 'Bob' })[userId] || 'Utilisateur'; },
    friendAvatarUrl(){ return null; },
    FILM_PLACEHOLDER_SVG: '', TV_PLACEHOLDER_SVG: '',
    makeRowClickable(){}, // pas de simulation de clic dans ce test — voir plus haut
    openOverlay(){}, closeOverlay(){}, openModal(){}, goToFilmDetail(){}, goToSeriesDetail(){}, openFriendProfile(){}, goToGroup(){},
    loadTrackedShows(){ return Promise.resolve(); }, loadFriendships(){ return Promise.resolve(); }, loadGroups(){ return Promise.resolve(); },
  });
  loadFiles(ctx, ['js/globalSearch.js']);
  setState(ctx, {
    films: [
      { id: 1, title: 'Paprika', manualNote: 5, tmdbId: 42, posterUrl: null },
      { id: 2, title: 'Papillon', manualNote: null, tmdbId: null, posterUrl: null },
    ],
    trackedShows: [
      { id: 10, title: 'Chernobyl', status: 'Ended', posterUrl: null },
    ],
    friendships: [
      { status: 'accepted', otherUserId: 'u1' },
      { status: 'pending', otherUserId: 'u2' }, // pas encore ami -> ne doit jamais apparaître
    ],
    groups: [
      { id: 20, name: 'Papa et les copains' },
    ],
  });
  return { ctx, resultsEl };
}

test('performGlobalSearch() : "pap" trouve les films ET le groupe correspondants, pas les autres', () => {
  const { ctx, resultsEl } = buildContext();
  ctx.performGlobalSearch('pap');
  assert.ok(resultsEl.innerHTML.includes('Paprika'));
  assert.ok(resultsEl.innerHTML.includes('Papillon'));
  assert.ok(resultsEl.innerHTML.includes('Papa et les copains'));
  assert.ok(!resultsEl.innerHTML.includes('Chernobyl'), '"pap" ne doit pas matcher Chernobyl');
});

test('performGlobalSearch() : un ami "pending" (pas encore accepté) n\'apparaît jamais dans les résultats', () => {
  const { ctx, resultsEl } = buildContext();
  ctx.performGlobalSearch('bob');
  assert.ok(!resultsEl.innerHTML.includes('Bob'), 'Bob a status "pending", pas "accepted"');
});

test('performGlobalSearch() : un ami accepté est bien trouvé', () => {
  const { ctx, resultsEl } = buildContext();
  ctx.performGlobalSearch('ali');
  assert.ok(resultsEl.innerHTML.includes('Alice'));
});

test('performGlobalSearch() : une requête de moins de 2 caractères n\'affiche aucun résultat, juste l\'invite', () => {
  const { ctx, resultsEl } = buildContext();
  ctx.performGlobalSearch('p');
  assert.ok(!resultsEl.innerHTML.includes('Paprika'));
  assert.ok(resultsEl.innerHTML.includes('2 caractères'));
});

test('performGlobalSearch() : aucune correspondance -> message explicite, pas une page vide muette', () => {
  const { ctx, resultsEl } = buildContext();
  ctx.performGlobalSearch('zzzzz');
  assert.ok(resultsEl.innerHTML.includes('Rien ne correspond'));
});

module.exports = run('global-search.test.js');
