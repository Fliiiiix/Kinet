// --- Tests du pays des plateformes (js/tmdb.js) ---
// Retour de Flix (27/10, en Afrique du Sud) : « Once Upon a Time… in
// Hollywood » était annoncé sur Prime Video, vrai en France (abonnement)
// mais pas là où il regardait (location seulement). fetchWatchProviders()
// lit le pays choisi dans Paramètres, la France par défaut, avec un cache
// séparé par pays.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles } = require('./helpers/vm-harness');
const { test, run } = createSuite();

// Réponse TMDB réelle (raccourcie) du 27/10 pour le film 466272.
const PROVIDERS_466272 = {
  results: {
    FR: { link: 'https://www.themoviedb.org/movie/466272/watch?locale=FR', flatrate: [{ provider_id: 119, provider_name: 'Amazon Prime Video' }], rent: [{ provider_id: 10, provider_name: 'Amazon Video' }] },
    ZA: { link: 'https://www.themoviedb.org/movie/466272/watch?locale=ZA', rent: [{ provider_id: 2, provider_name: 'Apple TV Store' }], buy: [{ provider_id: 2, provider_name: 'Apple TV Store' }] },
  },
};

function buildContext(){
  const calls = [];
  const ctx = createContext({
    TMDB_API_KEY: 'test',
    escapeHtml(s){ return String(s); },
    fetch(url){
      calls.push(url);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(PROVIDERS_466272) });
    },
  });
  loadFiles(ctx, ['js/tmdb.js']);
  return { ctx, calls };
}

test('France par défaut : Prime Video en abonnement', async () => {
  const { ctx } = buildContext();
  assert.strictEqual(ctx.getWatchRegion(), 'FR');
  const p = await ctx.fetchWatchProviders(466272, 'movie');
  assert.strictEqual(p.flatrate[0].provider_name, 'Amazon Prime Video');
});

test('Afrique du Sud : plus d’abonnement, la location reste', async () => {
  const { ctx } = buildContext();
  ctx.setWatchRegion('ZA');
  const p = await ctx.fetchWatchProviders(466272, 'movie');
  assert.strictEqual(p.flatrate, undefined);
  assert.strictEqual(p.rent[0].provider_name, 'Apple TV Store');
});

test('cache rangé par pays : changer de pays relit TMDB, revenir ne le relit pas', async () => {
  const { ctx, calls } = buildContext();
  await ctx.fetchWatchProviders(466272, 'movie');
  ctx.setWatchRegion('ZA');
  await ctx.fetchWatchProviders(466272, 'movie');
  assert.strictEqual(calls.length, 2, 'le résultat français ne sert pas pour l’Afrique du Sud');
  ctx.setWatchRegion('FR');
  const p = await ctx.fetchWatchProviders(466272, 'movie');
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(p.flatrate[0].provider_name, 'Amazon Prime Video');
});

test('un code inconnu ou effacé retombe sur la France', () => {
  const { ctx } = buildContext();
  ctx.localStorage.setItem('kinetWatchRegion', 'XX');
  assert.strictEqual(ctx.getWatchRegion(), 'FR');
});

test('textes : « en France » comme avant, ailleurs le pays et le lien JustWatch le disent', () => {
  const { ctx } = buildContext();
  assert.strictEqual(ctx.watchRegionPhrase(), 'en France');
  assert.strictEqual(ctx.watchProvidersCreditLabel(), 'Données JustWatch');
  ctx.setWatchRegion('ZA');
  assert.strictEqual(ctx.watchRegionPhrase(), 'dans ce pays (Afrique du Sud)');
  assert.strictEqual(ctx.watchProvidersCreditLabel(), 'Données JustWatch · Afrique du Sud');
  assert.ok(ctx.renderWatchProvidersHtml(null).includes('dans ce pays (Afrique du Sud)'));
});

module.exports = run('watch-region.test.js');
