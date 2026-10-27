// --- Tests des critères de Surprends-moi et de « pourquoi ce film » ---
// Idées retenues par Flix le 28/10 : piocher dans À voir ou dans les mieux
// notés de ses abonnements, filtrer par durée et par genre ; sous le film
// tiré, sa durée, ses genres, sa note TMDB et ce qu'en pensent ses amis.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

const plain = (v) => JSON.parse(JSON.stringify(v));

// Durées et genres déjà connus sur l'appareil (fetchFilmFacts(), js/tmdb.js).
const FACTS = {
  1: { runtime: 96, genres: [35, 18], vote: 7.4, votes: 900, directors: [] },   // comédie dramatique, 1 h 36
  2: { runtime: 169, genres: [878, 18], vote: 8.5, votes: 30000, directors: [] }, // SF, 2 h 49
  3: { runtime: 130, genres: [27], vote: 6.1, votes: 40, directors: [] },          // horreur, 2 h 10
};

function buildContext(){
  const els = { wlProviderFilter: stubElement({ value: '' }), surpriseCriteria: stubElement({ hidden: true }), surpriseWhy: stubElement() };
  const ctx = createContext({
    document: stubDocument(els),
    goToWatchlist(){}, goHome(){}, closeOverlay(){}, openOverlay(){}, blockIfOffline(){ return false; }, showToast(){},
    escapeHtml(s){ return String(s); },
    fetch(){ return new Promise(() => {}); },
    TMDB_API_KEY: 'test', TMDB_IMG_BASE: 'https://img/', FILM_PLACEHOLDER_SVG: '',
    supabaseClient: { rpc(){ throw new Error('non utilisé par ce test'); } },
  });
  const now = Date.now();
  ctx.localStorage.setItem('kinetFilmFacts', JSON.stringify(Object.fromEntries(Object.entries(FACTS).map(([id, v]) => [id, { t: now, v }]))));
  loadFiles(ctx, ['js/data.js', 'js/tmdb.js', 'js/watchlist.js', 'js/streamingTop.js']);
  setState(ctx, {
    watchlist: [{ id: 11, tmdbId: 1, title: 'Comédie' }, { id: 12, tmdbId: 2, title: 'SF' }, { id: 13, tmdbId: 3, title: 'Horreur' }, { id: 14, tmdbId: null, title: 'Sans fiche' }],
    watchlistFriendRatings: { 12: [{ friendId: 'u-sam', note: 4.5 }] },
  });
  ctx.friendDisplayName = () => 'Sam';
  return { ctx, els };
}

const ids = (pool) => plain(pool).map(i => i.id);

test('sans critère : tout À voir, film sans fiche compris', () => {
  const { ctx } = buildContext();
  assert.deepStrictEqual(ids(ctx.surprisePool()), [11, 12, 13, 14]);
});

test('durée : « moins de 1 h 45 » ne garde que le film de 1 h 36, un film sans durée connue sort', () => {
  const { ctx } = buildContext();
  setState(ctx, { surpriseCriteria: { source: 'list', duration: '105', genre: '' } });
  assert.deepStrictEqual(ids(ctx.surprisePool()), [11]);
  setState(ctx, { surpriseCriteria: { source: 'list', duration: '135', genre: '' } });
  assert.deepStrictEqual(ids(ctx.surprisePool()), [11, 13]);
});

test('genre : Drame garde la comédie dramatique et la SF ; les genres proposés, les plus présents d’abord', () => {
  const { ctx } = buildContext();
  setState(ctx, { surpriseCriteria: { source: 'list', duration: '', genre: '18' } });
  assert.deepStrictEqual(ids(ctx.surprisePool()), [11, 12]);
  assert.strictEqual(plain(ctx.surpriseGenreChoices())[0], 18, 'Drame : deux films');
});

test('piocher dans les mieux notés : leurs films, marqués pour « Ajouter à À voir »', () => {
  const { ctx } = buildContext();
  setState(ctx, {
    streamingTopFilms: [{ id: 2, title: 'SF', poster_path: '/sf.jpg', release_date: '2014-11-05' }],
    surpriseCriteria: { source: 'top', duration: '', genre: '' },
  });
  const pool = plain(ctx.surprisePool());
  assert.strictEqual(pool.length, 1);
  assert.strictEqual(pool[0].fromTop, true);
  assert.strictEqual(pool[0].posterUrl, 'https://img//sf.jpg');
  assert.strictEqual(pool[0].releaseYear, 2014);
});

test('pourquoi ce film : durée, deux genres, note TMDB, et l’ami qui l’a noté', () => {
  const { ctx, els } = buildContext();
  ctx.renderSurpriseWhy({ id: 12, tmdbId: 2, title: 'SF' });
  assert.ok(els.surpriseWhy.innerHTML.includes('2 h 49 · Science-fiction, Drame · TMDB 8,5'));
  assert.ok(els.surpriseWhy.innerHTML.includes('Sam a mis 4.5'));
});

test('pourquoi ce film : pas de note TMDB sur trop peu de votes', () => {
  const { ctx } = buildContext();
  assert.strictEqual(ctx.surpriseWhyText({}, FACTS[3]), '2 h 10 · Horreur');
});

module.exports = run('surprise-criteria.test.js');
