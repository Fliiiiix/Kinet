// --- Tests du filtre "dispo sur ma plateforme" de la watchlist (js/watchlist.js) ---
// loadWatchlistProviders() interroge TMDB (flatrate uniquement, même
// endpoint que "Où regarder") pour chaque item avec une fiche TMDB, en
// parallèle, sans jamais faire échouer tout le lot pour un seul titre en
// erreur. buildWatchlistProviderFilterOptions() construit le <select> à
// partir des seules plateformes réellement présentes, masqué s'il n'y en a
// aucune — même principe que buildGenreFilterOptions() (js/app.js).
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(overrides = {}){
  const elements = overrides.elements || {};
  delete overrides.elements;
  const ctx = createContext(Object.assign({
    document: stubDocument(elements),
    goToWatchlist(){}, goHome(){}, closeOverlay(){}, openOverlay(){},
    blockIfOffline(){ return false; },
    showToast(){},
    escapeHtml(s){ return s; },
    fetchWatchProviders(){ throw new Error('non utilisé par ce test'); },
    supabaseClient: { rpc(){ throw new Error('non utilisé par ce test'); } },
  }, overrides));
  loadFiles(ctx, ['js/watchlist.js']);
  return ctx;
}

test('loadWatchlistProviders() : ne garde que le flatrate, ignore les items sans fiche TMDB', async () => {
  const calls = [];
  const ctx = buildContext({
    fetchWatchProviders(tmdbId, mediaType){
      calls.push([tmdbId, mediaType]);
      if(tmdbId === 42) return Promise.resolve({ flatrate: [{ provider_id: 8, provider_name: 'Netflix' }], buy: [{ provider_id: 2, provider_name: 'Apple TV' }] });
      return Promise.resolve(null);
    },
  });
  setState(ctx, { watchlist: [
    { id: 1, tmdbId: 42, title: 'A' },
    { id: 2, tmdbId: 99, title: 'B' },      // pas de flatrate FR -> []
    { id: 3, tmdbId: null, title: 'Sans fiche TMDB' }, // jamais interrogé
  ] });
  await ctx.loadWatchlistProviders();
  assert.strictEqual(calls.length, 2); // pas d'appel pour l'item sans tmdbId
  const providers = getState(ctx, 'watchlistProviders');
  assert.strictEqual(providers[42].length, 1);
  assert.strictEqual(providers[42][0].provider_name, 'Netflix');
  // JSON round-trip : providers[99] est un tableau du realm vm (créé par le
  // code chargé dans le contexte), []  littéral ici celui du realm hôte —
  // deepStrictEqual les distingue malgré une structure identique (même
  // raison que dans watchlist-friend-ratings.test.js).
  assert.deepStrictEqual(JSON.parse(JSON.stringify(providers[99])), []); // vérifié, mais rien en FR
});

test('loadWatchlistProviders() : un film en erreur réseau -> [] pour lui, les autres aboutissent', async () => {
  const ctx = buildContext({
    fetchWatchProviders(tmdbId){
      if(tmdbId === 1) return Promise.reject(new Error('boom'));
      return Promise.resolve({ flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] });
    },
  });
  setState(ctx, { watchlist: [{ id: 1, tmdbId: 1, title: 'A' }, { id: 2, tmdbId: 2, title: 'B' }] });
  await ctx.loadWatchlistProviders();
  const providers = getState(ctx, 'watchlistProviders');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(providers[1])), []);
  assert.strictEqual(providers[2].length, 1);
});

test('buildWatchlistProviderFilterOptions() : masqué (display:none) si aucune plateforme connue', () => {
  const sel = stubElement();
  const ctx = buildContext({ elements: { wlProviderFilter: sel } });
  setState(ctx, { watchlistProviders: { 1: [] } });
  ctx.buildWatchlistProviderFilterOptions();
  assert.strictEqual(sel.style.display, 'none');
});

test('buildWatchlistProviderFilterOptions() : une option par plateforme présente, dédupliquée, triée', () => {
  const sel = stubElement();
  const ctx = buildContext({ elements: { wlProviderFilter: sel } });
  setState(ctx, { watchlistProviders: {
    1: [{ provider_id: 8, provider_name: 'Netflix' }],
    2: [{ provider_id: 8, provider_name: 'Netflix' }, { provider_id: 119, provider_name: 'Amazon Prime Video' }],
  } });
  ctx.buildWatchlistProviderFilterOptions();
  assert.strictEqual(sel.style.display, '');
  // Amazon avant Netflix (ordre alphabétique), une seule entrée Netflix
  // malgré 2 films qui l'ont tous les deux.
  const order = [...sel.innerHTML.matchAll(/value="(\d+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(order, ['119', '8']);
});

test('buildWatchlistProviderFilterOptions() : préserve la sélection si la plateforme choisie est toujours présente', () => {
  const sel = stubElement({ value: '8' });
  const ctx = buildContext({ elements: { wlProviderFilter: sel } });
  setState(ctx, { watchlistProviders: { 1: [{ provider_id: 8, provider_name: 'Netflix' }] } });
  ctx.buildWatchlistProviderFilterOptions();
  assert.strictEqual(sel.value, '8');
});

module.exports = run('watchlist-providers.test.js');
