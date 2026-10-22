// --- Tests de la plateforme du tirage « Surprends-moi » (js/watchlist.js) ---
// Retour de Flix (22/10) : « je ne veux que la catégorie de film dans Netflix
// par ex ou Prime ». La fenêtre propose Toutes, Mes abonnements puis chaque
// service présent dans À voir ; le choix pose le filtre de la liste
// (#wlProviderFilter) et reste gardé pour le tirage suivant.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const overlay = { open: false };
  const els = {
    wlProviderFilter: stubElement({ value: '' }),
    surpriseServices: stubElement(),
    surpriseOverlay: stubElement({ classList: { add(){}, remove(){}, toggle(){}, contains: (c) => c === 'open' && overlay.open } }),
    surpriseRoulette: stubElement(),
    surpriseRouletteTrack: stubElement(),
    surpriseContent: stubElement(),
    surpriseRerollBtn: stubElement(),
    surpriseRateBtn: stubElement(),
  };
  const ctx = createContext({
    document: stubDocument(els),
    goToWatchlist(){}, goHome(){}, closeOverlay(){ overlay.open = false; },
    openOverlay(){ overlay.open = true; },
    blockIfOffline(){ return false; },
    showToast(){},
    escapeHtml(s){ return String(s); },
    fetchWatchProviders(){ throw new Error('non utilisé par ce test'); },
    supabaseClient: { rpc(){ throw new Error('non utilisé par ce test'); } },
  });
  loadFiles(ctx, ['js/watchlist.js']);
  // La liste sous la fenêtre et la bande animée ne sont pas l'objet de ces
  // tests : on garde seulement le lot dans lequel chaque tirage pioche.
  const spins = [];
  ctx.renderWatchlist = () => {};
  ctx.spinSurpriseRoulette = (pool) => { spins.push(pool.map(i => i.id)); };
  setState(ctx, {
    watchlist: [{ id: 1, tmdbId: 1, title: 'A' }, { id: 2, tmdbId: 2, title: 'B' }, { id: 3, tmdbId: 3, title: 'C' }, { id: 4, tmdbId: null, title: 'Sans fiche' }],
    watchlistProviders: {
      1: [{ provider_name: 'Netflix', logo_path: '/n.png' }],
      2: [{ provider_name: 'Netflix Standard with Ads' }, { provider_name: 'Amazon Prime Video', logo_path: '/p.png' }],
      3: [{ provider_name: 'Amazon Prime Video' }],
    },
    watchlistProvidersReady: true,
  });
  return { ctx, els, spins, overlay };
}

const plain = (v) => JSON.parse(JSON.stringify(v));

test('choix proposés : Toutes, Mes abonnements, puis les services, le plus fourni d\'abord', () => {
  const { ctx } = buildContext();
  ctx.localStorage.setItem('kinetMyStreamingServices', JSON.stringify(['prime video']));
  const choices = plain(ctx.surpriseServiceChoices()).map(c => [c.value, c.label, c.n]);
  assert.deepStrictEqual(choices, [
    ['', 'Toutes', 4],
    ['__mine', 'Mes abonnements', 2],
    ['netflix', 'Netflix', 2],
    ['prime video', 'Prime Video', 2],
  ]);
});

test('pastilles : celle du filtre actif cochée, « Mes abonnements » à 0 désactivée', () => {
  const { ctx, els } = buildContext();
  ctx.localStorage.setItem('kinetMyStreamingServices', JSON.stringify(['canal+']));
  els.wlProviderFilter.value = 'netflix';
  ctx.renderSurpriseServices();
  const html = els.surpriseServices.innerHTML;
  assert.strictEqual(els.surpriseServices.style.display, '');
  assert.ok(/aria-checked="true" data-surprise-service="netflix"/.test(html), 'Netflix coché');
  assert.ok(/data-surprise-service="__mine" data-empty="1" disabled/.test(html), 'aucun film sur tes abonnements');
});

test('pastilles : en attente tant que les plateformes ne sont pas vérifiées', () => {
  const { ctx, els } = buildContext();
  setState(ctx, { watchlistProvidersReady: false });
  ctx.renderSurpriseServices();
  assert.ok(els.surpriseServices.innerHTML.includes('Vérification des plateformes'));
});

test('choisir Netflix dans la fenêtre : filtre posé, choix gardé, tirage dans Netflix seulement', () => {
  const { ctx, els, spins } = buildContext();
  const chip = { disabled: false, dataset: { surpriseService: 'netflix' }, getAttribute: () => 'false' };
  ctx.handleSurpriseServiceClick({ target: { closest: () => chip } });
  assert.strictEqual(els.wlProviderFilter.value, 'netflix');
  assert.strictEqual(ctx.localStorage.getItem('kinetSurpriseService'), 'netflix');
  assert.deepStrictEqual(spins, [[1, 2]]);
});

test('ouverture : repart du dernier choix', () => {
  const { ctx, els, spins } = buildContext();
  ctx.localStorage.setItem('kinetSurpriseService', 'prime video');
  ctx.openSurprise();
  assert.strictEqual(els.wlProviderFilter.value, 'prime video');
  assert.deepStrictEqual(spins, [[2, 3]]);
});

test('ouverture avant la vérification des plateformes : attend, puis tire sur le bon choix', () => {
  const { ctx, els, spins } = buildContext();
  ctx.localStorage.setItem('kinetSurpriseService', 'netflix');
  setState(ctx, { watchlistProvidersReady: false });
  ctx.openSurprise();
  assert.deepStrictEqual(spins, [], 'pas de tirage dans une liste à moitié connue');
  assert.ok(els.surpriseContent.innerHTML.includes('Vérification des plateformes'));
  assert.strictEqual(els.surpriseRerollBtn.disabled, true);
  setState(ctx, { watchlistProvidersReady: true });
  ctx.onSurpriseProvidersReady();
  assert.deepStrictEqual(spins, [[1, 2]]);
});

test('ouverture : un choix qui n\'existe plus retombe sur Toutes', () => {
  const { ctx, els, spins } = buildContext();
  ctx.localStorage.setItem('kinetSurpriseService', 'canal+');
  ctx.openSurprise();
  assert.strictEqual(els.wlProviderFilter.value, '');
  assert.deepStrictEqual(spins, [[1, 2, 3, 4]]);
});

test('aucun film sur le choix : message, pas de tirage', () => {
  const { ctx, els, spins } = buildContext();
  ctx.localStorage.setItem('kinetMyStreamingServices', JSON.stringify(['canal+']));
  els.wlProviderFilter.value = '__mine';
  ctx.startSurpriseDraw();
  assert.deepStrictEqual(spins, []);
  assert.ok(els.surpriseContent.innerHTML.includes('Aucun film à voir sur cette plateforme'));
  assert.strictEqual(els.surpriseRoulette.style.display, 'none');
});

test('résultat : dit où le regarder, tes abonnements d\'abord', () => {
  const { ctx, els } = buildContext();
  ctx.renderSurpriseContent({ id: 2, tmdbId: 2, title: 'B' });
  assert.ok(els.surpriseContent.innerHTML.includes('Sur Netflix, Prime Video'));
  ctx.localStorage.setItem('kinetMyStreamingServices', JSON.stringify(['prime video']));
  ctx.renderSurpriseContent({ id: 2, tmdbId: 2, title: 'B' });
  assert.ok(els.surpriseContent.innerHTML.includes('Sur Prime Video<'));
  els.wlProviderFilter.value = 'netflix'; // tiré sur Netflix : Netflix est dit aussi
  ctx.renderSurpriseContent({ id: 2, tmdbId: 2, title: 'B' });
  assert.ok(els.surpriseContent.innerHTML.includes('Sur Netflix, Prime Video<'));
});

module.exports = run('surprise-platform.test.js');
