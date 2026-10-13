// --- Tests des films similaires sur la fiche film (js/filmDetail.js,
// fetchSimilarMovies() de js/tmdb.js) ---
// Retour utilisateur (étude comparative Letterboxd/Goodreads — "Readers
// also enjoyed") : vérifié avant d'écrire la fonctionnalité que js/tmdb.js
// n'utilisait pas encore /recommendations ni /similar. Chaque carte
// transmet la liste affichée comme navList à goToFilmDetail() (mêmes
// flèches prev/next que partout ailleurs) — on peut enchaîner les
// recommandations flèche après flèche.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(fetchSimilarMoviesImpl){
  const sectionEl = stubElement();
  const wrapEl = stubElement();
  const goToFilmDetailCalls = [];
  const doc = stubDocument({
    filmDetailSimilarSection: sectionEl,
    filmDetailSimilar: wrapEl,
  });
  const ctx = createContext({
    document: doc,
    goHome(){},
    escapeHtml(s){ return s; },
    blockIfOffline(){ return false; },
    showToast(){},
    currentUser: { id: 'me' },
    friendProfiles: {},
    friendDisplayName(){ return ''; },
    friendAvatarHtml(){ return ''; },
    cacheProfile(){},
    films: [], watchlist: [],
    getDisplayNote(){ return null; },
    noteColorClass(){ return ''; },
    TMDB_IMG_BASE: 'https://img/',
    FILM_PLACEHOLDER_SVG: '<svg></svg>',
    fetchSimilarMovies: fetchSimilarMoviesImpl,
    goToFilmDetail(tmdbId, navList){ goToFilmDetailCalls.push({ tmdbId, navList }); },
    supabaseClient: { from(){ throw new Error('non utilisé dans ce test'); }, rpc(){ throw new Error('non utilisé dans ce test'); } },
  });
  loadFiles(ctx, ['js/filmDetail.js']);
  return { ctx, sectionEl, wrapEl, goToFilmDetailCalls };
}

test('renderFilmDetailSimilar() : aucune recommandation -> section entière masquée', async () => {
  const { ctx, sectionEl } = buildContext(async () => []);
  await ctx.renderFilmDetailSimilar(550);
  assert.strictEqual(sectionEl.style.display, 'none');
});

test('renderFilmDetailSimilar() : des recommandations -> section affichée avec une carte par film', async () => {
  const { ctx, sectionEl, wrapEl } = buildContext(async () => [
    { id: 101, title: 'Fight Club', poster_path: '/f.jpg', release_year: 1999 },
    { id: 102, title: 'Seven', poster_path: null, release_year: 1995 },
  ]);
  await ctx.renderFilmDetailSimilar(550);
  assert.strictEqual(sectionEl.style.display, '');
  assert.ok(wrapEl.innerHTML.includes('Fight Club'));
  assert.ok(wrapEl.innerHTML.includes('Seven'));
  assert.strictEqual((wrapEl.innerHTML.match(/similar-card"/g) || []).length, 2);
});

test('renderFilmDetailSimilar() : erreur réseau -> section masquée, pas d\'exception', async () => {
  const { ctx, sectionEl } = buildContext(async () => { throw new Error('boom'); });
  await ctx.renderFilmDetailSimilar(550);
  assert.strictEqual(sectionEl.style.display, 'none');
});

module.exports = run('film-similar.test.js');
