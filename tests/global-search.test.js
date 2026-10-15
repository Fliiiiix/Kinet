// --- Tests de la recherche unique (js/globalSearch.js, audit M2) ---
// La recherche du catalogue montre, sous les films (ou sous les séries),
// les séries suivies, films, amis et groupes qui correspondent. Ce test
// couvre la logique propre à ce fichier (rubriques selon la page, limite
// par rubrique, exclusion des amis pas encore acceptés, chargement des
// données, raccourci « / ») — pas normalizeSearch()/getSearchTerms()
// elles-mêmes (accents/casse), déjà une responsabilité de js/app.js,
// stubbées ici avec une version minimale suffisante pour ces cas.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument, stubElement, stubEventTarget } = require('./helpers/vm-harness');
const { test, run } = createSuite();

// Externes (app.js/data.js/router.js/ui.js/friends.js/series.js) : des
// versions minimales suffisantes pour exercer ce fichier.
function externals(overrides = {}){
  return Object.assign({
    normalizeSearch(s){ return s.toLowerCase(); },
    getSearchTerms(f){ return [f.title.toLowerCase()]; },
    escapeHtml(s){ return s; },
    getDisplayNote(f){ return f.manualNote != null ? f.manualNote : null; },
    noteColorClass(){ return 'rate-high'; },
    showStatusLabel(s){ return s; },
    otherUserId(f){ return f.otherUserId; },
    friendDisplayName(userId){ return ({ u1: 'Alice', u2: 'Bob' })[userId] || 'Utilisateur'; },
    friendAvatarUrl(){ return null; },
    FILM_PLACEHOLDER_SVG: '', TV_PLACEHOLDER_SVG: '',
    makeRowClickable(){},
    openModal(){}, goToFilmDetail(){}, goToSeriesDetail(){}, openFriendProfile(){}, goToGroup(){},
    parseRoute(){ return { name: 'home' }; }, goHome(){},
    loadTrackedShows(){ return Promise.resolve(); }, loadFriendships(){ return Promise.resolve(); }, loadGroups(){ return Promise.resolve(); },
  }, overrides);
}

function buildContext(overrides = {}){
  const filmsEl = stubElement();
  const seriesEl = stubElement();
  const searchInput = stubElement({ value: '' });
  const ctx = createContext(Object.assign({
    document: stubDocument({ searchExtras: filmsEl, seriesSearchExtras: seriesEl, search: searchInput }),
  }, externals(overrides)));
  loadFiles(ctx, ['js/globalSearch.js']);
  setState(ctx, {
    films: [
      { id: 1, title: 'Paprika', manualNote: 5, tmdbId: 42, posterUrl: null, releaseYear: 2006 },
      { id: 2, title: 'Papillon', manualNote: null, tmdbId: null, posterUrl: null, releaseYear: 1973 },
    ],
    trackedShows: [
      { id: 10, title: 'Chernobyl', status: 'Ended', posterUrl: null, numberOfEpisodes: 5, manualNote: 5 },
    ],
    friendships: [
      { status: 'accepted', otherUserId: 'u1' },
      { status: 'pending', otherUserId: 'u2' }, // pas encore ami -> ne doit jamais apparaître
    ],
    groups: [
      { id: 20, name: 'Papa et les copains' },
    ],
    watchedEpisodeCounts: { 10: 3 },
    // Données déjà là : pas de chargement à la volée dans ces tests-ci.
    searchExtrasDataReady: true,
  });
  return { ctx, filmsEl, seriesEl, searchInput };
}

test('page Films : "pap" montre le groupe mais pas les films, déjà dans la grille', () => {
  const { ctx, filmsEl } = buildContext();
  ctx.renderSearchExtras('films', 'pap');
  assert.ok(filmsEl.innerHTML.includes('Papa et les copains'));
  assert.ok(filmsEl.innerHTML.includes('Groupes'));
  assert.ok(!filmsEl.innerHTML.includes('Paprika'), 'les films sont dans la grille, pas répétés dessous');
  assert.ok(!filmsEl.innerHTML.includes('Chernobyl'), '"pap" ne doit pas matcher Chernobyl');
});

test('page Films : une série suivie qui correspond apparaît, avec sa progression', () => {
  const { ctx, filmsEl } = buildContext();
  ctx.renderSearchExtras('films', 'chern');
  assert.ok(filmsEl.innerHTML.includes('Séries'));
  assert.ok(filmsEl.innerHTML.includes('Chernobyl'));
  assert.ok(filmsEl.innerHTML.includes('3/5 épisodes vus'));
});

test('page Séries : les films qui correspondent apparaissent, pas les séries déjà listées', () => {
  const { ctx, seriesEl } = buildContext();
  ctx.renderSearchExtras('series', 'pap');
  assert.ok(seriesEl.innerHTML.includes('Films'));
  assert.ok(seriesEl.innerHTML.includes('Paprika'));
  assert.ok(seriesEl.innerHTML.includes('Papillon'));
  assert.ok(seriesEl.innerHTML.includes('Papa et les copains'));
  ctx.renderSearchExtras('series', 'chern');
  assert.ok(!seriesEl.innerHTML.includes('Chernobyl'), 'tes séries sont déjà dans la liste au-dessus');
});

test('un ami "pending" (pas encore accepté) n\'apparaît jamais', () => {
  const { ctx, filmsEl } = buildContext();
  ctx.renderSearchExtras('films', 'bob');
  assert.ok(!filmsEl.innerHTML.includes('Bob'), 'Bob a status "pending", pas "accepted"');
});

test('un ami accepté est bien trouvé, dans la rubrique Amis', () => {
  const { ctx, filmsEl } = buildContext();
  ctx.renderSearchExtras('films', 'ali');
  assert.ok(filmsEl.innerHTML.includes('Amis'));
  assert.ok(filmsEl.innerHTML.includes('Alice'));
});

test('moins de 2 caractères : rien sous la grille', () => {
  const { ctx, filmsEl } = buildContext();
  filmsEl.innerHTML = 'ancien contenu';
  ctx.renderSearchExtras('films', 'p');
  assert.strictEqual(filmsEl.innerHTML, '');
  ctx.renderSearchExtras('films', '');
  assert.strictEqual(filmsEl.innerHTML, '');
});

test('aucune correspondance ailleurs : rien sous la grille (pas de message en plus)', () => {
  const { ctx, filmsEl } = buildContext();
  ctx.renderSearchExtras('films', 'zzzzz');
  assert.strictEqual(filmsEl.innerHTML, '');
});

test('5 résultats au plus par rubrique', () => {
  const { ctx } = buildContext();
  setState(ctx, { groups: Array.from({ length: 8 }, (_, i) => ({ id: i, name: `Groupe ${i}` })) });
  const sections = ctx.buildSearchExtras('films', 'groupe');
  assert.strictEqual(sections.length, 1);
  assert.strictEqual(sections[0].label, 'Groupes');
  assert.strictEqual(sections[0].items.length, 5);
});

test('chaque ligne reçoit l\'action de sa propre rubrique, dans l\'ordre affiché', () => {
  const opened = [];
  const rows = [stubElement(), stubElement()];
  const { ctx, filmsEl } = buildContext({
    makeRowClickable(row, handler){ row.handler = handler; },
    goToSeriesDetail(id){ opened.push(['série', id]); },
    goToGroup(id){ opened.push(['groupe', id]); },
  });
  setState(ctx, { trackedShows: [{ id: 11, title: 'Papa Schultz', status: 'Ended', posterUrl: null }] });
  filmsEl.querySelectorAll = (sel) => (sel === '.sx-row' ? rows : []);
  ctx.renderSearchExtras('films', 'pap');
  rows[0].handler();
  rows[1].handler();
  assert.deepStrictEqual(opened, [['série', 11], ['groupe', 20]]);
});

// --- Chargement à la première recherche --- trackedShows/friendships/
// groups ne sont pas forcément chargés quand on tape dans le catalogue :
// ils le sont une seule fois, puis la rubrique se redessine.
test('données pas encore chargées : un seul chargement, puis la rubrique se redessine', async () => {
  let loads = 0;
  const { ctx, filmsEl, searchInput } = buildContext({
    loadGroups(){ loads++; return Promise.resolve().then(() => setState(ctx, { groups: [{ id: 30, name: 'Papas du dimanche' }] })); },
  });
  setState(ctx, { searchExtrasDataReady: false, groups: [] });
  searchInput.value = 'pap';
  ctx.renderSearchExtras('films', 'pap');
  ctx.renderSearchExtras('films', 'pap');
  assert.ok(!filmsEl.innerHTML.includes('Papas du dimanche'), 'pas encore chargé au premier rendu');
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(loads, 1, 'un seul chargement même après deux frappes');
  assert.ok(filmsEl.innerHTML.includes('Papas du dimanche'), 'redessiné une fois les groupes chargés');
});

// --- Raccourci clavier « / » --- Place le curseur dans la recherche
// (celle des séries sur la page Séries), sauf s'il vole le « / » à un
// champ déjà actif ou qu'une fenêtre est ouverte. stubEventTarget()
// garde vraiment les handlers, pour pouvoir les redéclencher.
function buildKeyboardShortcutContext({ overlayOpen = false, route = 'home' } = {}){
  const eventTarget = stubEventTarget();
  const focused = [];
  const inputs = {
    search: stubElement({ focus(){ focused.push('search'); } }),
    seriesTitleInput: stubElement({ focus(){ focused.push('seriesTitleInput'); } }),
  };
  const doc = Object.assign(eventTarget, {
    getElementById: (id) => inputs[id] || stubElement(),
    querySelector: (sel) => (sel === '.overlay.open' && overlayOpen ? stubElement() : null),
    querySelectorAll(){ return []; },
    createElement(){ return stubElement(); },
    body: stubElement(),
  });
  const win = stubEventTarget();
  let goHomeCalls = 0;
  const ctx = createContext(Object.assign({ document: doc, window: win }, externals({
    parseRoute(){ return { name: route }; },
    goHome(){ goHomeCalls++; },
  })));
  loadFiles(ctx, ['js/globalSearch.js']);
  return { doc, win, focused, getGoHomeCalls: () => goHomeCalls };
}

test('raccourci "/" : place le curseur dans la recherche du catalogue', () => {
  const { doc, focused } = buildKeyboardShortcutContext();
  let prevented = false;
  doc.dispatch('keydown', { key: '/', target: { tagName: 'DIV' }, preventDefault(){ prevented = true; } });
  assert.strictEqual(prevented, true, 'le "/" par défaut du navigateur doit être annulé');
  assert.deepStrictEqual(focused, ['search']);
});

test('raccourci "/" : sur la page Séries, place le curseur dans la recherche des séries', () => {
  const { doc, focused, getGoHomeCalls } = buildKeyboardShortcutContext({ route: 'seriesList' });
  doc.dispatch('keydown', { key: '/', target: { tagName: 'DIV' }, preventDefault(){} });
  assert.deepStrictEqual(focused, ['seriesTitleInput']);
  assert.strictEqual(getGoHomeCalls(), 0);
});

test('raccourci "/" : depuis une autre page, revient au catalogue puis place le curseur', async () => {
  const { doc, win, focused, getGoHomeCalls } = buildKeyboardShortcutContext({ route: 'amis' });
  doc.dispatch('keydown', { key: '/', target: { tagName: 'DIV' }, preventDefault(){} });
  assert.strictEqual(getGoHomeCalls(), 1);
  assert.deepStrictEqual(focused, [], 'le champ n\'est visible qu\'après le changement de page');
  win.dispatch('hashchange', {});
  await new Promise(r => setTimeout(r, 5));
  assert.deepStrictEqual(focused, ['search']);
});

test('raccourci "/" : ignoré si on tape déjà dans un champ (input/textarea/select)', () => {
  const { doc, focused } = buildKeyboardShortcutContext();
  ['INPUT', 'TEXTAREA', 'SELECT'].forEach(tag => {
    doc.dispatch('keydown', { key: '/', target: { tagName: tag }, preventDefault(){} });
  });
  assert.deepStrictEqual(focused, [], 'ne doit jamais voler le "/" à un champ de saisie actif');
});

test('raccourci "/" : ignoré si un élément contentEditable a le focus', () => {
  const { doc, focused } = buildKeyboardShortcutContext();
  doc.dispatch('keydown', { key: '/', target: { tagName: 'DIV', isContentEditable: true }, preventDefault(){} });
  assert.deepStrictEqual(focused, []);
});

test('raccourci "/" : ignoré si une fenêtre est déjà ouverte', () => {
  const { doc, focused } = buildKeyboardShortcutContext({ overlayOpen: true });
  doc.dispatch('keydown', { key: '/', target: { tagName: 'DIV' }, preventDefault(){} });
  assert.deepStrictEqual(focused, []);
});

test('raccourci "/" : une autre touche ne déclenche rien', () => {
  const { doc, focused } = buildKeyboardShortcutContext();
  doc.dispatch('keydown', { key: 'a', target: { tagName: 'DIV' }, preventDefault(){} });
  assert.deepStrictEqual(focused, []);
});

module.exports = run('global-search.test.js');
