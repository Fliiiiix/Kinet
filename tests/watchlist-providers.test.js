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

test('loadWatchlistProviders() : jamais plus de 6 requêtes TMDB à la fois (audit C2, erreurs 429)', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  let calls = 0;
  const ctx = buildContext({
    fetchWatchProviders(){
      calls++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise(resolve => setTimeout(() => {
        inFlight--;
        resolve({ flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] });
      }, 2));
    },
  });
  const items = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, tmdbId: i + 1, title: `Film ${i + 1}` }));
  setState(ctx, { watchlist: items });
  await ctx.loadWatchlistProviders();
  assert.strictEqual(calls, 40); // tous les films finissent par être interrogés
  assert.ok(maxInFlight <= 6, `au plus 6 en vol, vu ${maxInFlight}`);
  assert.strictEqual(Object.keys(getState(ctx, 'watchlistProviders')).length, 40);
});

test('buildWatchlistProviderFilterOptions() : masqué (display:none) si aucune plateforme connue', () => {
  const sel = stubElement();
  const ctx = buildContext({ elements: { wlProviderFilter: sel } });
  setState(ctx, { watchlistProviders: { 1: [] } });
  ctx.buildWatchlistProviderFilterOptions();
  assert.strictEqual(sel.style.display, 'none');
});

test('buildWatchlistProviderFilterOptions() : une option par service présent, variantes regroupées, triée', () => {
  const sel = stubElement();
  const ctx = buildContext({ elements: { wlProviderFilter: sel } });
  setState(ctx, {
    watchlist: [{ id: 1, tmdbId: 1 }, { id: 2, tmdbId: 2 }],
    watchlistProviders: {
      1: [{ provider_id: 8, provider_name: 'Netflix' }],
      2: [{ provider_id: 8, provider_name: 'Netflix' }, { provider_id: 1796, provider_name: 'Netflix Standard with Ads' }, { provider_id: 119, provider_name: 'Amazon Prime Video' }],
    },
  });
  ctx.buildWatchlistProviderFilterOptions();
  assert.strictEqual(sel.style.display, '');
  // Netflix avant Prime Video (ordre alphabétique), une seule entrée Netflix
  // malgré 2 films et la variante « with Ads ».
  const order = [...sel.innerHTML.matchAll(/value="([^"]*)"/g)].map(m => m[1]);
  assert.deepStrictEqual(order, ['', 'netflix', 'prime video']);
});

test('buildWatchlistProviderFilterOptions() : préserve la sélection si la plateforme choisie est toujours présente', () => {
  const sel = stubElement({ value: 'netflix' });
  const ctx = buildContext({ elements: { wlProviderFilter: sel } });
  setState(ctx, { watchlist: [{ id: 1, tmdbId: 1 }], watchlistProviders: { 1: [{ provider_id: 8, provider_name: 'Netflix' }] } });
  ctx.buildWatchlistProviderFilterOptions();
  assert.strictEqual(sel.value, 'netflix');
});

// --- Plateformes sur les affiches et « Mes abonnements » (draft du 15/10,
// option A) --- Une plateforme, un nom ; deux logos au plus puis « +n » ;
// avec des abonnements cochés, seulement ceux-là.
test('streamingServiceName() : variantes TMDB ramenées au service', () => {
  const ctx = buildContext();
  const cases = [
    ['Netflix Standard with Ads', 'Netflix'],
    ['Amazon Prime Video with Ads', 'Prime Video'],
    ['HBO Max Amazon Channel', 'HBO Max'],
    ['Paramount+ Amazon Channel', 'Paramount+'],
    ['Paramount Plus Premium', 'Paramount+'],
    ['Disney Plus', 'Disney+'],
    ['Cine+ OCS Amazon Channel ', 'Ciné+ OCS'],
    ['Sony Pictures Core Amazon Channel', 'Sony Pictures Core'],
    ['Canal+', 'Canal+'],
  ];
  for(const [raw, expected] of cases) assert.strictEqual(ctx.streamingServiceName(raw), expected, raw);
});

test('groupStreamingServices() : un service par nom, ordre TMDB, logo du service plutôt que de sa variante', () => {
  const ctx = buildContext();
  const groups = ctx.groupStreamingServices([
    { provider_name: 'HBO Max Amazon Channel', logo_path: '/chaine.png', display_priority: 3 },
    { provider_name: 'Netflix', logo_path: '/netflix.png', display_priority: 0 },
    { provider_name: 'HBO Max', logo_path: '/hbo.png', display_priority: 71 },
    { provider_name: 'Netflix Standard with Ads', logo_path: '/pub.png', display_priority: 50 },
  ]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(groups.map(g => [g.name, g.logoPath]))), [['Netflix', '/netflix.png'], ['HBO Max', '/hbo.png']]);
});

function buildServicesContext(mine){
  const ctx = buildContext();
  if(mine) ctx.localStorage.setItem('kinetMyStreamingServices', JSON.stringify(mine));
  setState(ctx, {
    watchlist: [{ id: 1, tmdbId: 1 }, { id: 2, tmdbId: 2 }, { id: 3, tmdbId: 3 }],
    watchlistProviders: {
      1: [
        { provider_name: 'Netflix', logo_path: '/n.png', display_priority: 0 },
        { provider_name: 'Amazon Prime Video', logo_path: '/p.png', display_priority: 2 },
        { provider_name: 'HBO Max', logo_path: '/h.png', display_priority: 71 },
      ],
      2: [{ provider_name: 'Canal+', logo_path: '/c.png', display_priority: 8 }],
      3: [],
    },
  });
  return ctx;
}

test('watchlistServicesHtml() : deux logos au plus, puis « +1 »', () => {
  const ctx = buildServicesContext();
  const html = ctx.watchlistServicesHtml({ tmdbId: 1 });
  assert.strictEqual((html.match(/<img /g) || []).length, 2);
  assert.ok(html.includes('/n.png') && html.includes('/p.png') && !html.includes('/h.png'));
  assert.ok(html.includes('+1'));
  assert.ok(html.includes('Netflix, Prime Video, HBO Max'), 'les trois noms restent lisibles au lecteur d\'écran');
});

test('watchlistServicesHtml() : rien sur un film sans plateforme', () => {
  const ctx = buildServicesContext();
  assert.strictEqual(ctx.watchlistServicesHtml({ tmdbId: 3 }), '');
});

test('Mes abonnements : seules les plateformes cochées restent sur l\'affiche', () => {
  const ctx = buildServicesContext(['hbo max']);
  const html = ctx.watchlistServicesHtml({ tmdbId: 1 });
  assert.ok(html.includes('/h.png'));
  assert.ok(!html.includes('/n.png') && !html.includes('+'));
  assert.strictEqual(ctx.watchlistServicesHtml({ tmdbId: 2 }), '', 'Canal+ n\'est pas coché');
});

test('Mes abonnements : cocher puis décocher, gardé sur l\'appareil', () => {
  const ctx = buildServicesContext();
  ctx.toggleMyStreamingService('netflix');
  ctx.toggleMyStreamingService('canal+');
  assert.deepStrictEqual(JSON.parse(ctx.localStorage.getItem('kinetMyStreamingServices')), ['netflix', 'canal+']);
  ctx.toggleMyStreamingService('netflix');
  assert.deepStrictEqual(JSON.parse(ctx.localStorage.getItem('kinetMyStreamingServices')), ['canal+']);
});

test('filtre « Mes abonnements » : ne garde que les films disponibles sur tes abonnements', () => {
  const sel = stubElement({ value: '__mine' });
  const ctx = buildContext({ elements: { wlProviderFilter: sel } });
  ctx.localStorage.setItem('kinetMyStreamingServices', JSON.stringify(['canal+']));
  setState(ctx, {
    watchlist: [{ id: 1, tmdbId: 1 }, { id: 2, tmdbId: 2 }],
    watchlistProviders: { 1: [{ provider_name: 'Netflix' }], 2: [{ provider_name: 'Canal+' }] },
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.getFilteredWatchlist().map(i => i.id))), [2]);
  sel.value = 'netflix';
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.getFilteredWatchlist().map(i => i.id))), [1]);
});

test('buildWatchlistProviderFilterOptions() : « Mes abonnements » n\'apparaît qu\'avec des abonnements cochés', () => {
  const sel = stubElement();
  const toggle = stubElement();
  const ctx = buildContext({ elements: { wlProviderFilter: sel, wlSubsToggle: toggle } });
  setState(ctx, { watchlist: [{ id: 1, tmdbId: 1 }], watchlistProviders: { 1: [{ provider_name: 'Netflix' }] } });
  ctx.buildWatchlistProviderFilterOptions();
  assert.ok(!sel.innerHTML.includes('__mine'));
  assert.strictEqual(toggle.textContent, 'Mes abonnements');
  ctx.toggleMyStreamingService('netflix');
  ctx.buildWatchlistProviderFilterOptions();
  assert.ok(sel.innerHTML.includes('value="__mine"'));
  assert.strictEqual(toggle.textContent, 'Mes abonnements · 1');
});

test('rappel : avec des abonnements cochés, compte les films disponibles dessus', () => {
  const reminder = stubElement();
  const ctx = buildContext({ elements: { wlReminder: reminder } });
  ctx.localStorage.setItem('kinetMyStreamingServices', JSON.stringify(['netflix']));
  setState(ctx, {
    watchlist: [{ id: 1, tmdbId: 1 }, { id: 2, tmdbId: 2 }, { id: 3, tmdbId: 3 }],
    watchlistProviders: { 1: [{ provider_name: 'Netflix' }], 2: [{ provider_name: 'Netflix Standard with Ads' }], 3: [{ provider_name: 'Canal+' }] },
  });
  ctx.renderWatchlistReminder();
  assert.strictEqual(reminder.textContent, '2 films à voir disponibles sur tes abonnements.');
});

module.exports = run('watchlist-providers.test.js');
