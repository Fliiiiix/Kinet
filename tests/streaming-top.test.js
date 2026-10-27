// --- Tests de « Les mieux notés sur tes abonnements » (js/streamingTop.js) ---
// Idée retenue par Flix le 28/10 : les films les mieux notés en abonnement sur
// ses plateformes, dans son pays, jamais un film déjà noté ou déjà dans À voir.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

const plain = (v) => JSON.parse(JSON.stringify(v));

// Plateformes TMDB en France (extrait), variantes comprises.
const PROVIDERS_FR = { results: [
  { provider_id: 8, provider_name: 'Netflix' },
  { provider_id: 1796, provider_name: 'Netflix Standard with Ads' },
  { provider_id: 119, provider_name: 'Amazon Prime Video' },
  { provider_id: 2100, provider_name: 'Amazon Prime Video with Ads' },
  { provider_id: 381, provider_name: 'Canal+' },
] };

function buildContext({ mine = [], region = null, discover = [] } = {}){
  const calls = [];
  const els = {
    streamingTopSection: stubElement({ style: { display: 'none' } }),
    streamingTopList: stubElement(),
    streamingTopTitle: stubElement(),
    streamingTopHint: stubElement(),
  };
  const ctx = createContext({
    document: stubDocument(els),
    URLSearchParams, // absent d'un contexte vm neuf
    TMDB_API_KEY: 'test', TMDB_IMG_BASE: 'https://image.tmdb.org/t/p/w342', FILM_PLACEHOLDER_SVG: '',
    escapeHtml(s){ return String(s); },
    withSubmitGuard: (btn, h) => h,
    goToFilmDetail(){}, showToast(){}, renderWatchlist(){},
    goToWatchlist(){}, goHome(){}, closeOverlay(){}, openOverlay(){}, blockIfOffline(){ return false; },
    supabaseClient: { from(){ throw new Error('non utilisé par ce test'); } },
    fetch(url){
      calls.push(url);
      const body = url.includes('/watch/providers/movie') ? PROVIDERS_FR : { results: discover };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    },
  });
  loadFiles(ctx, ['js/tmdb.js', 'js/watchlist.js', 'js/streamingTop.js']);
  if(mine.length) ctx.localStorage.setItem('kinetMyStreamingServices', JSON.stringify(mine));
  if(region) ctx.localStorage.setItem('kinetWatchRegion', region);
  setState(ctx, { films: [{ tmdbId: 1 }], watchlist: [{ tmdbId: 2 }] });
  return { ctx, els, calls };
}

test('plateformes cochées -> leurs identifiants TMDB, variantes comprises', async () => {
  const { ctx } = buildContext();
  const ids = plain(await ctx.streamingTopProviderIds('FR', new Set(['netflix', 'prime video'])));
  assert.deepStrictEqual(ids, [8, 1796, 119, 2100]);
});

test('jamais un film déjà noté ou déjà dans À voir, le mieux noté d’abord, 20 au plus', () => {
  const { ctx } = buildContext();
  const results = [
    { id: 1, vote_average: 9 },   // déjà noté
    { id: 2, vote_average: 8.9 }, // déjà dans À voir
    { id: 3, vote_average: 8.1 },
    { id: 4, vote_average: 8.6 },
    ...Array.from({ length: 30 }, (_, i) => ({ id: 100 + i, vote_average: 7 })),
  ];
  const picked = plain(ctx.pickStreamingTop(results, [{ tmdbId: 1 }], [{ tmdbId: 2 }]));
  assert.deepStrictEqual(picked.slice(0, 2).map(r => r.id), [4, 3]);
  assert.strictEqual(picked.length, 20);
});

test('chargement : la recherche TMDB vise le pays, l’abonnement et les plateformes cochées', async () => {
  const { ctx, els, calls } = buildContext({ mine: ['netflix'], region: 'ZA', discover: [{ id: 3, title: 'Parasite', vote_average: 8.5, poster_path: '/p.jpg', release_date: '2019-05-30' }] });
  await ctx.loadStreamingTop();
  const discover = calls.filter(u => u.includes('/discover/movie'));
  assert.strictEqual(discover.length, 3, 'trois pages de candidats');
  assert.ok(discover[0].includes('watch_region=ZA'));
  assert.ok(discover[0].includes('with_watch_monetization_types=flatrate'));
  assert.ok(discover[0].includes('with_watch_providers=8%7C1796'), 'Netflix et sa variante avec pub');
  assert.ok(discover[0].includes('vote_count.gte=1000'));
  assert.strictEqual(els.streamingTopSection.style.display, '');
  assert.strictEqual(els.streamingTopTitle.textContent, 'Les mieux notés sur tes abonnements');
  assert.strictEqual(els.streamingTopHint.textContent, 'Netflix · Afrique du Sud');
  assert.ok(els.streamingTopList.innerHTML.includes('8,5') && els.streamingTopList.innerHTML.includes('+ À voir'));
});

test('sans abonnement coché : toutes les plateformes du pays, titre adapté', async () => {
  const { ctx, els, calls } = buildContext({ discover: [{ id: 3, title: 'Parasite', vote_average: 8.5 }] });
  await ctx.loadStreamingTop();
  assert.ok(!calls.some(u => u.includes('/watch/providers/movie')), 'pas besoin de la liste des plateformes');
  assert.ok(!calls.find(u => u.includes('/discover/movie')).includes('with_watch_providers'));
  assert.strictEqual(els.streamingTopTitle.textContent, 'Les mieux notés en streaming');
  assert.strictEqual(els.streamingTopHint.textContent, '');
});

test('abonnements cochés absents du pays : la rangée reste cachée', async () => {
  const { ctx, els, calls } = buildContext({ mine: ['hbo max'], discover: [{ id: 3 }] });
  await ctx.loadStreamingTop();
  assert.ok(!calls.some(u => u.includes('/discover/movie')));
  assert.strictEqual(els.streamingTopSection.style.display, 'none');
});

module.exports = run('streaming-top.test.js');
