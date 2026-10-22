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
      3: [{ provider_name: 'Amazon Prime Video' }, { provider_name: 'Canal+' }],
    },
    watchlistProvidersReady: true,
  });
  return { ctx, els, spins, overlay };
}

const plain = (v) => JSON.parse(JSON.stringify(v));

const front = (ctx) => plain(ctx.surpriseServiceChoices()).filter(c => c.front).map(c => c.value);

test('sans abonnement : Toutes et les deux plateformes les plus fournies devant', () => {
  const { ctx } = buildContext();
  const choices = plain(ctx.surpriseServiceChoices()).map(c => [c.value, c.n]);
  assert.deepStrictEqual(choices, [['', 4], ['netflix', 2], ['prime video', 2], ['canal+', 1]]);
  assert.deepStrictEqual(front(ctx), ['', 'netflix', 'prime video']);
});

test('un abonnement : il passe devant, pas de « Mes abonnements » qui le répéterait', () => {
  const { ctx } = buildContext();
  ctx.localStorage.setItem('kinetMyStreamingServices', JSON.stringify(['prime video']));
  assert.deepStrictEqual(front(ctx), ['', 'prime video']);
  assert.ok(!plain(ctx.surpriseServiceChoices()).some(c => c.value === '__mine'));
});

test('deux abonnements : Toutes, Mes abonnements et les deux plateformes devant', () => {
  const { ctx } = buildContext();
  ctx.localStorage.setItem('kinetMyStreamingServices', JSON.stringify(['netflix', 'prime video', 'disney+']));
  assert.deepStrictEqual(front(ctx), ['', '__mine', 'netflix', 'prime video']);
  assert.strictEqual(plain(ctx.surpriseServiceChoices()).find(c => c.value === '__mine').n, 3);
});

test('pastilles : les autres plateformes derrière « + n autres », révélées au toucher', () => {
  const { ctx, els } = buildContext();
  ctx.localStorage.setItem('kinetMyStreamingServices', JSON.stringify(['prime video']));
  ctx.renderSurpriseServices();
  let html = els.surpriseServices.innerHTML;
  assert.ok(/aria-checked="true" data-surprise-service=""/.test(html), 'Toutes coché');
  assert.ok(html.includes('data-surprise-service="prime video"'));
  assert.ok(!html.includes('data-surprise-service="netflix"') && !html.includes('data-surprise-service="canal+"'));
  assert.ok(html.includes('+ 2 autres'));
  ctx.handleSurpriseServiceClick({ target: { closest: (sel) => sel === '[data-surprise-more]' ? {} : null } });
  html = els.surpriseServices.innerHTML;
  assert.ok(html.includes('data-surprise-service="netflix"') && html.includes('data-surprise-service="canal+"'));
  assert.ok(!html.includes('autres'));
});

test('pastilles : un choix pris dans « + n autres » reste visible et coché', () => {
  const { ctx, els } = buildContext();
  ctx.localStorage.setItem('kinetMyStreamingServices', JSON.stringify(['prime video']));
  els.wlProviderFilter.value = 'canal+';
  ctx.renderSurpriseServices();
  const html = els.surpriseServices.innerHTML;
  assert.ok(/aria-checked="true" data-surprise-service="canal\+"/.test(html));
  assert.ok(html.includes('+ 1 autre<'));
});

test('« Mes abonnements » gardé avec un seul abonnement présent : devient cette plateforme', () => {
  const { ctx, els, spins } = buildContext();
  ctx.localStorage.setItem('kinetMyStreamingServices', JSON.stringify(['prime video']));
  ctx.localStorage.setItem('kinetSurpriseService', '__mine');
  ctx.openSurprise();
  assert.strictEqual(els.wlProviderFilter.value, 'prime video');
  assert.deepStrictEqual(spins, [[2, 3]]);
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
  ctx.handleSurpriseServiceClick({ target: { closest: (sel) => sel === '[data-surprise-service]' ? chip : null } });
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
  ctx.localStorage.setItem('kinetSurpriseService', 'disney+');
  ctx.openSurprise();
  assert.strictEqual(els.wlProviderFilter.value, '');
  assert.deepStrictEqual(spins, [[1, 2, 3, 4]]);
});

test('aucun film sur le choix : message, pas de tirage', () => {
  const { ctx, els, spins } = buildContext();
  ctx.localStorage.setItem('kinetMyStreamingServices', JSON.stringify(['disney+']));
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
