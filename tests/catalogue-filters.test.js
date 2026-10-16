// --- Tests des filtres du catalogue en pastilles (js/app.js) ---
// Audit des six écrans, piste A choisie le 16/10 : trier (note, ajout récent,
// titre, par critère), afficher (tous, favoris, sans note, revus), genres
// (plusieurs) et décennie, au lieu de trois menus déroulants. Remplace les
// anciens tests du menu Genre (« Sans note ») et du menu Année.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(films, rewatched){
  const chips = stubElement();
  const search = stubElement({ value: '' });
  const ctx = createContext({
    document: stubDocument({ filterChips: chips, search }),
    escapeHtml(s){ return String(s); },
    GENRE_MAP: { 18: 'Drame', 35: 'Comédie', 28: 'Action' },
    CRITERIA: [{ key: 'scenario', label: 'Scénario' }, { key: 'jeu', label: 'Jeu d\'acteur' }],
    rewatchCount(id){ return (rewatched || []).includes(id) ? 2 : 1; },
  });
  loadFiles(ctx, ['js/app.js']);
  ctx.render = () => {}; // le rendu de la grille n'est pas l'objet de ces tests
  ctx.escapeHtml = (x) => String(x); // la vraie passe par un élément du DOM
  setState(ctx, { films });
  return { ctx, chips, search };
}

const FILMS = [
  { id: 1, title: 'Whiplash', manualNote: 4.5, crit: { scenario: 0.85 }, genreIds: [18], releaseYear: 2014, fav: true, added: 3 },
  { id: 2, title: 'Arrival', manualNote: null, crit: { scenario: 0.9, jeu: 0.95 }, genreIds: [18], releaseYear: 2016, fav: false, added: 5 },
  { id: 3, title: 'Paprika', manualNote: 5, crit: {}, genreIds: [], releaseYear: 2006, fav: false, added: 1 },
  { id: 4, title: 'November', manualNote: null, crit: {}, genreIds: [18], releaseYear: 2004, fav: false, added: 4 },
  { id: 5, title: 'Speed', manualNote: null, crit: {}, genreIds: [28], releaseYear: 1994, fav: false, added: 2 },
  { id: 6, title: 'Un poisson nommé Wanda', manualNote: 3.5, crit: {}, genreIds: [35], releaseYear: 1988, fav: true, added: 6 },
];
const ids = (list) => Array.from(list, f => f.id).join(',');

test('par défaut : trié par note, les films sans note à la fin', () => {
  const { ctx } = buildContext(FILMS);
  const out = ctx.getFilteredSortedFilms();
  assert.ok(ids(out).startsWith('3,1,2,6'), ids(out));
  assert.deepStrictEqual(Array.from(out.slice(-2), f => ctx.getDisplayNote(f)), [null, null]);
});

test('Favoris, Sans note, Revus', () => {
  const { ctx } = buildContext(FILMS, [6]);
  setState(ctx, { catFilter: { sort: 'note', crit: 'scenario', show: 'fav', genres: [], decade: null } });
  assert.strictEqual(ids(ctx.getFilteredSortedFilms()), '1,6');
  setState(ctx, { catFilter: { sort: 'note', crit: 'scenario', show: 'unrated', genres: [], decade: null } });
  assert.strictEqual(ids(ctx.getFilteredSortedFilms()).split(',').sort().join(','), '4,5');
  setState(ctx, { catFilter: { sort: 'note', crit: 'scenario', show: 'rewatch', genres: [], decade: null } });
  assert.strictEqual(ids(ctx.getFilteredSortedFilms()), '6');
});

test('plusieurs genres : un film qui a l\'un ou l\'autre', () => {
  const { ctx } = buildContext(FILMS);
  setState(ctx, { catFilter: { sort: 'title', crit: 'scenario', show: 'all', genres: [28, 35], decade: null } });
  assert.strictEqual(ids(ctx.getFilteredSortedFilms()), '5,6');
});

test('décennie, et « Avant 1990 »', () => {
  const { ctx } = buildContext(FILMS);
  setState(ctx, { catFilter: { sort: 'title', crit: 'scenario', show: 'all', genres: [], decade: 2000 } });
  assert.strictEqual(ids(ctx.getFilteredSortedFilms()), '4,3');
  setState(ctx, { catFilter: { sort: 'title', crit: 'scenario', show: 'all', genres: [], decade: 0 } });
  assert.strictEqual(ids(ctx.getFilteredSortedFilms()), '6');
});

test('par critère : notés sur ce critère d\'abord, puis notés sans critères, puis sans note', () => {
  const { ctx } = buildContext(FILMS);
  setState(ctx, { catFilter: { sort: 'crit', crit: 'scenario', show: 'all', genres: [], decade: null } });
  const out = ids(ctx.getFilteredSortedFilms()).split(',');
  assert.deepStrictEqual(out.slice(0, 2), ['2', '1'], 'Arrival (0.9) avant Whiplash (0.85)');
  assert.deepStrictEqual(out.slice(2, 4), ['3', '6'], 'puis Paprika (5.0) et Wanda (3.5), notés sans critères');
  assert.deepStrictEqual(out.slice(4).sort(), ['4', '5']);
});

test('les pastilles : seuls les genres et décennies présents, Sans note avec son nombre', () => {
  const { ctx, chips } = buildContext(FILMS);
  ctx.renderFilterChips();
  const html = chips.innerHTML;
  assert.ok(html.includes('data-filter="show:unrated"') && html.includes('Sans note <small>2</small>'), 'Sans note (2)');
  assert.ok(html.includes('Favoris <small>2</small>'));
  assert.ok(!html.includes('show:rewatch'), 'pas de « Revus » sans revisionnage');
  assert.ok(html.includes('genre:28') && html.includes('genre:35') && html.includes('genre:18'));
  assert.ok(html.includes('decade:2010') && html.includes('decade:0') && !html.includes('decade:2020'));
  assert.ok(html.indexOf('decade:2010') < html.indexOf('decade:0'), '« Avant 1990 » en dernier');
});

test('Par critère montre les critères en pastilles, aux noms courts', () => {
  const { ctx, chips } = buildContext(FILMS);
  ctx.applyCatFilter('sort:crit');
  assert.ok(chips.innerHTML.includes('data-filter="crit:jeu"') && chips.innerHTML.includes('>Jeu<'));
});

test('re-toucher un filtre d\'affichage le retire ; « Tout effacer » garde le critère choisi', () => {
  const { ctx } = buildContext(FILMS);
  ctx.applyCatFilter('show:fav');
  assert.strictEqual(getState(ctx, 'catFilter.show'), 'fav');
  ctx.applyCatFilter('show:fav');
  assert.strictEqual(getState(ctx, 'catFilter.show'), 'all');
  ctx.applyCatFilter('crit:jeu');
  ctx.applyCatFilter('genre:18');
  ctx.applyCatFilter('clear');
  assert.strictEqual(getState(ctx, 'catFilter.genres.length'), 0);
  assert.strictEqual(getState(ctx, 'catFilter.crit'), 'jeu');
});

test('après un changement du catalogue, un genre ou une décennie disparus quittent les filtres', () => {
  const { ctx } = buildContext(FILMS);
  setState(ctx, { catFilter: { sort: 'note', crit: 'scenario', show: 'all', genres: [28, 18], decade: 0 } });
  setState(ctx, { films: FILMS.filter(f => f.id !== 5 && f.id !== 6) });
  ctx.buildGenreFilterOptions();
  assert.strictEqual(getState(ctx, 'catFilter.genres.join(",")'), '18');
  assert.strictEqual(getState(ctx, 'catFilter.decade'), null);
});

module.exports = run('catalogue-filters.test.js');
