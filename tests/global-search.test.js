// --- Tests des suggestions sous la recherche (js/globalSearch.js) ---
// Draft du 15/10, option A : dès 2 lettres, le meilleur résultat en tête
// (quel que soit son type), puis des rubriques dans un ordre fixe (3 lignes
// chacune), puis les films ou séries à ajouter depuis TMDB à partir de 3
// lettres. Barre vide : les 3 derniers résultats ouverts. Ce test couvre
// la logique propre à ce fichier ; normalizeSearch()/getDisplayNote()...
// sont des versions minimales suffisantes pour ces cas.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument, stubElement, stubEventTarget } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function externals(overrides = {}){
  return Object.assign({
    normalizeSearch(s){ return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); },
    escapeHtml(s){ return String(s); },
    getDisplayNote(f){ return f.manualNote != null ? f.manualNote : null; },
    noteColorClass(){ return 'rate-high'; },
    showStatusLabel(s){ return s; },
    otherUserId(f){ return f.otherUserId; },
    friendDisplayName(userId){ return ({ u1: 'boulonbill', u2: 'Bob' })[userId] || 'Utilisateur'; },
    friendAvatarUrl(){ return null; },
    FILM_PLACEHOLDER_SVG: '', TV_PLACEHOLDER_SVG: '', TMDB_IMG_BASE: 'https://img/',
    openModal(){}, openAddFromSearch(){}, goToFilmDetail(){}, goToSeriesDetail(){}, goToWatchlist(){},
    openFriendProfile(){}, goToGroup(){}, selectSeriesTmdbResult(){},
    parseRoute(){ return { name: 'home' }; }, goHome(){},
    searchTmdb(){ return Promise.resolve([]); }, searchTmdbTv(){ return Promise.resolve([]); },
    loadTrackedShows(){ return Promise.resolve(); }, loadFriendships(){ return Promise.resolve(); },
    loadGroups(){ return Promise.resolve(); }, loadWatchlist(){ return Promise.resolve(); },
  }, overrides);
}

function buildContext(overrides = {}){
  const elements = {
    search: stubElement({ value: '' }),
    searchSuggest: stubElement(),
    seriesTitleInput: stubElement({ value: '' }),
    seriesSuggest: stubElement(),
  };
  const ctx = createContext(Object.assign({ document: stubDocument(elements) }, externals(overrides)));
  loadFiles(ctx, ['js/globalSearch.js']);
  setState(ctx, {
    films: [
      { id: 1, title: 'Godzilla Minus One', originalTitle: null, releaseYear: 2023, manualNote: 4.5, tmdbId: 940721, posterUrl: null },
      { id: 2, title: 'Le Parrain', originalTitle: 'The Godfather', releaseYear: 1972, manualNote: null, tmdbId: 238, posterUrl: null },
      { id: 3, title: 'Tempête de boulettes géantes', originalTitle: null, releaseYear: 2009, manualNote: null, tmdbId: 22794, posterUrl: null },
      { id: 4, title: 'Silent Voice', originalTitle: null, releaseYear: 2016, manualNote: null, tmdbId: 378064, posterUrl: null },
    ],
    watchlist: [
      { id: 10, title: 'Godzilla Minus One', tmdbId: 940721, releaseYear: 2023 }, // aussi noté : ne sort qu'une fois
      { id: 11, title: 'La Famille Tenenbaum', tmdbId: 9428, releaseYear: 2001 },
    ],
    trackedShows: [{ id: 20, tmdbId: 125988, title: 'Silo', status: 'Returning Series', numberOfEpisodes: 31, manualNote: null, posterUrl: null }],
    watchedEpisodeCounts: { 20: 11 },
    friendships: [
      { status: 'accepted', otherUserId: 'u1' },
      { status: 'pending', otherUserId: 'u2' }, // pas encore ami : jamais proposé
    ],
    groups: [{ id: 30, name: 'Famille' }],
    searchExtrasDataReady: true,
  });
  return { ctx, elements };
}

const labels = (built) => JSON.parse(JSON.stringify(built.sections.map(s => s.label)));
const titles = (section) => JSON.parse(JSON.stringify(section.items.map(i => i.title)));

test('suggestScore() : début du nom 3, début d\'un mot 2, ailleurs 1, absent 0', () => {
  const { ctx } = buildContext();
  assert.strictEqual(ctx.suggestScore('Godzilla Minus One', 'god'), 3);
  assert.strictEqual(ctx.suggestScore('Only God Forgives', 'god'), 2);
  assert.strictEqual(ctx.suggestScore('Le Parrain', 'god'), 0);
  assert.strictEqual(ctx.suggestScore('Tempête de boulettes géantes', 'oulet'), 1);
});

test('« boul » : boulonbill en meilleur résultat, avant le film qui contient « boulettes »', () => {
  const { ctx } = buildContext();
  const built = ctx.buildSuggestions('films', 'boul');
  assert.deepStrictEqual(labels(built), ['Meilleur résultat', 'Tes films']);
  assert.deepStrictEqual(titles(built.sections[0]), ['boulonbill']);
  assert.deepStrictEqual(titles(built.sections[1]), ['Tempête de boulettes géantes']);
});

test('« god » : Godzilla en tête, Le Parrain trouvé par son titre d\'origine, une seule fois Godzilla', () => {
  const { ctx } = buildContext();
  const built = ctx.buildSuggestions('films', 'god');
  assert.deepStrictEqual(titles(built.sections[0]), ['Godzilla Minus One']);
  assert.deepStrictEqual(labels(built), ['Meilleur résultat', 'Tes films'], 'Godzilla, aussi dans À voir, ne revient pas dans À voir');
  assert.strictEqual(built.sections[1].items[0].sub, 'The Godfather · 1972');
  assert.strictEqual(built.ownCount, 2);
});

test('à pertinence égale, le type de la page passe devant (film sur Films, série sur Séries)', () => {
  const { ctx } = buildContext();
  assert.strictEqual(ctx.buildSuggestions('films', 'sil').sections[0].items[0].title, 'Silent Voice');
  const series = ctx.buildSuggestions('series', 'sil');
  assert.strictEqual(series.sections[0].items[0].title, 'Silo');
  assert.deepStrictEqual(labels(series), ['Meilleur résultat', 'Films']);
});

test('« fam » : le groupe en tête, le film d\'À voir dans sa rubrique', () => {
  const { ctx } = buildContext();
  const built = ctx.buildSuggestions('films', 'fam');
  assert.deepStrictEqual(labels(built), ['Meilleur résultat', 'À voir']);
  assert.deepStrictEqual(titles(built.sections[0]), ['Famille']);
});

test('un ami pas encore accepté n\'est jamais proposé', () => {
  const { ctx } = buildContext();
  assert.deepStrictEqual(labels(ctx.buildSuggestions('films', 'bob')), []);
});

test('3 lignes au plus par rubrique, moins de 2 lettres : rien', () => {
  const { ctx } = buildContext();
  setState(ctx, { groups: Array.from({ length: 6 }, (_, i) => ({ id: i, name: `Groupe ${i}` })) });
  const built = ctx.buildSuggestions('films', 'groupe');
  assert.strictEqual(built.sections[0].label, 'Meilleur résultat');
  assert.strictEqual(built.sections[1].items.length, 3);
  assert.deepStrictEqual(labels(ctx.buildSuggestions('films', 'g')), []);
});

test('TMDB : pas sous 3 lettres, jamais un film déjà chez toi, titres qui commencent par la recherche d\'abord', () => {
  const { ctx } = buildContext();
  const tmdb = [
    { id: 77987, title: 'Only God Forgives', release_year: 2013, poster_path: '/a.jpg' },
    { id: 940721, title: 'Godzilla Minus One', release_year: 2023, poster_path: '/b.jpg' }, // déjà noté
    { id: 808396, title: 'God Is a Bullet', release_year: 2023, poster_path: '/c.jpg' },
    { id: 836225, title: 'Exorcism of God', release_year: 2022, poster_path: null },
    { id: 1, title: 'Agnès de Dieu', original_title: 'Agnes of God', release_year: 1985, poster_path: null },
  ];
  const built = ctx.buildSuggestions('films', 'god', tmdb);
  const section = built.sections.find(s => s.tmdb);
  assert.strictEqual(section.label, 'À ajouter, depuis TMDB');
  assert.deepStrictEqual(titles(section), ['God Is a Bullet', 'Only God Forgives', 'Exorcism of God']);
  assert.strictEqual(section.items[0].type, 'tmdb');
  assert.ok(!ctx.buildSuggestions('films', 'go', tmdb).sections.some(s => s.tmdb), 'pas de TMDB sous 3 lettres');
});

test('TMDB côté Séries : « À suivre », jamais une série déjà suivie', () => {
  const { ctx } = buildContext();
  const built = ctx.buildSuggestions('series', 'silo', [
    { id: 125988, title: 'Silo', release_year: 2023 },
    { id: 5, title: 'Silo Killer', release_year: 2021 },
  ]);
  const section = built.sections.find(s => s.tmdb);
  assert.strictEqual(section.label, 'À suivre, depuis TMDB');
  assert.deepStrictEqual(titles(section), ['Silo Killer']);
  assert.strictEqual(section.items[0].type, 'tmdbtv');
});

test('suggestHighlight() : les lettres tapées en gras, accents ignorés', () => {
  const { ctx } = buildContext();
  assert.strictEqual(ctx.suggestHighlight('Amélie', 'mel'), 'A<b>mél</b>ie');
  assert.strictEqual(ctx.suggestHighlight('Silo', 'xyz'), 'Silo');
});

test('derniers résultats ouverts : 3 au plus, sans doublon, un film TMDB revient comme film', () => {
  const { ctx } = buildContext();
  ctx.rememberRecentResult({ type: 'ami', title: 'boulonbill', ref: { userId: 'u1' } });
  ctx.rememberRecentResult({ type: 'tmdb', title: 'Only God Forgives', posterUrl: 'x', sub: '2013', ref: { tmdb: { id: 77987 } } });
  ctx.rememberRecentResult({ type: 'groupe', title: 'Famille', ref: { id: 30 } });
  ctx.rememberRecentResult({ type: 'ami', title: 'boulonbill', ref: { userId: 'u1' } });
  ctx.rememberRecentResult({ type: 'serie', title: 'Silo', ref: { id: 20 } });
  const recents = JSON.parse(JSON.stringify(ctx.getRecentResults()));
  assert.deepStrictEqual(recents.map(r => r.title), ['Silo', 'boulonbill', 'Famille']);
  ctx.rememberRecentResult({ type: 'tmdb', title: 'Only God Forgives', ref: { tmdb: { id: 77987 } } });
  const first = JSON.parse(JSON.stringify(ctx.getRecentResults()))[0];
  assert.deepStrictEqual([first.type, first.ref.tmdbId], ['film', 77987]);
});

test('openSuggestion() : chaque type ouvre le bon écran', () => {
  const opened = [];
  const { ctx } = buildContext({
    openFriendProfile(id){ opened.push(['ami', id]); },
    goToGroup(id){ opened.push(['groupe', id]); },
    goToSeriesDetail(id){ opened.push(['série', id]); },
    goToFilmDetail(id){ opened.push(['fiche', id]); },
    openModal(id){ opened.push(['notation', id]); },
    selectSeriesTmdbResult(r){ opened.push(['suivre', r.id]); },
  });
  ctx.openSuggestion({ type: 'ami', ref: { userId: 'u1' } });
  ctx.openSuggestion({ type: 'groupe', ref: { id: 30 } });
  ctx.openSuggestion({ type: 'serie', ref: { id: 20 } });
  ctx.openSuggestion({ type: 'film', ref: { id: 2, tmdbId: 238 } });
  ctx.openSuggestion({ type: 'film', ref: { id: 9, tmdbId: null } }); // entrée manuelle sans fiche TMDB
  ctx.openSuggestion({ type: 'tmdb', ref: { tmdb: { id: 77987 } } });
  ctx.openSuggestion({ type: 'tmdbtv', ref: { tmdb: { id: 5 } } });
  assert.deepStrictEqual(opened, [['ami', 'u1'], ['groupe', 30], ['série', 20], ['fiche', 238], ['notation', 9], ['fiche', 77987], ['suivre', 5]]);
});

test('panneau : « boul » ouvre la liste, meilleur résultat en gras, lien vers la grille', () => {
  const { ctx, elements } = buildContext();
  elements.search.value = 'boul';
  ctx.renderSuggestPanel('films');
  const html = elements.searchSuggest.innerHTML;
  assert.strictEqual(elements.searchSuggest.hidden, false);
  assert.ok(html.includes('Meilleur résultat'));
  assert.ok(html.includes('<b>boul</b>onbill'));
  assert.ok(html.includes('Recherche sur TMDB'), 'TMDB pas encore répondu');
  assert.ok(html.includes('Voir ton film dans la grille'));
});

test('panneau : barre vide sans récents -> fermé ; 1 lettre -> « Continue à taper »', () => {
  const { ctx, elements } = buildContext();
  elements.search.value = '';
  ctx.renderSuggestPanel('films');
  assert.strictEqual(elements.searchSuggest.hidden, true);
  elements.search.value = 'b';
  ctx.renderSuggestPanel('films');
  assert.ok(elements.searchSuggest.innerHTML.includes('Continue à taper'));
});

test('panneau : barre vide avec des récents -> « Récents »', () => {
  const { ctx, elements } = buildContext();
  ctx.rememberRecentResult({ type: 'groupe', title: 'Famille', ref: { id: 30 } });
  elements.search.value = '';
  ctx.renderSuggestPanel('films');
  assert.ok(elements.searchSuggest.innerHTML.includes('Récents'));
  assert.ok(elements.searchSuggest.innerHTML.includes('Famille'));
});

test('clavier : flèche bas puis Entrée ouvre le meilleur résultat ; Entrée sans choix ferme la liste', () => {
  const opened = [];
  const { ctx, elements } = buildContext({ openFriendProfile(id){ opened.push(id); } });
  elements.search.value = 'boul';
  ctx.renderSuggestPanel('films');
  const key = (k) => ctx.onSuggestKeydown('films', { key: k, preventDefault(){} });
  key('ArrowDown');
  key('Enter');
  assert.deepStrictEqual(opened, ['u1']);
  assert.strictEqual(elements.searchSuggest.hidden, true, 'la liste se ferme après le choix');
  ctx.renderSuggestPanel('films');
  key('Enter');
  assert.strictEqual(elements.searchSuggest.hidden, true, 'Entrée sans choix : la grille filtrée reste');
});

test('TMDB : réponse arrivée -> rubrique « À ajouter » et « Plus de films » dans le panneau', async () => {
  const { ctx, elements } = buildContext({
    searchTmdb(){ return Promise.resolve([{ id: 808396, title: 'God Is a Bullet', release_year: 2023, poster_path: null }]); },
  });
  elements.search.value = 'god';
  ctx.refreshSuggestions('films');
  await new Promise(r => setTimeout(r, 400));
  const html = elements.searchSuggest.innerHTML;
  assert.ok(html.includes('À ajouter, depuis TMDB'));
  assert.ok(html.includes('<b>God</b> Is a Bullet'));
  assert.ok(html.includes('Plus de films « god » sur TMDB'));
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

test('raccourci "/" : ignoré pendant une saisie, dans un contentEditable ou avec une fenêtre ouverte', () => {
  const { doc, focused } = buildKeyboardShortcutContext();
  ['INPUT', 'TEXTAREA', 'SELECT'].forEach(tag => {
    doc.dispatch('keydown', { key: '/', target: { tagName: tag }, preventDefault(){} });
  });
  doc.dispatch('keydown', { key: '/', target: { tagName: 'DIV', isContentEditable: true }, preventDefault(){} });
  assert.deepStrictEqual(focused, []);
  const withOverlay = buildKeyboardShortcutContext({ overlayOpen: true });
  withOverlay.doc.dispatch('keydown', { key: '/', target: { tagName: 'DIV' }, preventDefault(){} });
  assert.deepStrictEqual(withOverlay.focused, []);
});

test('raccourci "/" : une autre touche ne déclenche rien', () => {
  const { doc, focused } = buildKeyboardShortcutContext();
  doc.dispatch('keydown', { key: 'a', target: { tagName: 'DIV' }, preventDefault(){} });
  assert.deepStrictEqual(focused, []);
});

module.exports = run('global-search.test.js');
