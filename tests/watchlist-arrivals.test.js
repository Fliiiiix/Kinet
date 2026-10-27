// --- Tests de « Arrivé sur tes abonnements » (js/watchlist.js) ---
// Idée 4 du 28/10 : un film d'À voir qui arrive sur un de tes abonnements est
// annoncé sous le rappel pendant 7 jours. On compare avec la vérification
// précédente, gardée sur l'appareil et par pays.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

const plain = (v) => JSON.parse(JSON.stringify(v));
const DAY = 86400000;
const NETFLIX = { provider_name: 'Netflix', logo_path: '/n.png' };
const PRIME = { provider_name: 'Amazon Prime Video', logo_path: '/p.png' };
const CANAL = { provider_name: 'Canal+', logo_path: '/c.png' };

function buildContext(mine = ['netflix', 'prime video']){
  const arrivals = stubElement({ hidden: true });
  const ctx = createContext({
    document: stubDocument({ wlArrivals: arrivals }),
    goToWatchlist(){}, goHome(){}, closeOverlay(){}, openOverlay(){}, blockIfOffline(){ return false; }, showToast(){},
    escapeHtml(s){ return String(s); },
    supabaseClient: { rpc(){ throw new Error('non utilisé par ce test'); } },
  });
  loadFiles(ctx, ['js/tmdb.js', 'js/watchlist.js']);
  ctx.localStorage.setItem('kinetMyStreamingServices', JSON.stringify(mine));
  setState(ctx, { watchlist: [{ id: 1, tmdbId: 10, title: 'Her' }, { id: 2, tmdbId: 20, title: 'Dune' }] });
  const check = (providers, now) => {
    setState(ctx, { watchlistProviders: providers });
    return plain(ctx.detectWatchlistArrivals(now));
  };
  return { ctx, arrivals, check };
}

test('première vérification : rien d’annoncé, on ne sait pas encore ce qui a changé', () => {
  const { check } = buildContext();
  assert.deepStrictEqual(check({ 10: [NETFLIX], 20: [] }, 1000), []);
});

test('Her arrive sur Netflix (coché) : annoncé, avec le nom du service', () => {
  const { check, ctx, arrivals } = buildContext();
  check({ 10: [], 20: [] }, 1000);
  const out = check({ 10: [NETFLIX], 20: [] }, 2000);
  assert.deepStrictEqual(out.map(a => [a.title, a.services]), [['Her', ['Netflix']]]);
  ctx.renderWatchlistArrivals(out);
  assert.strictEqual(arrivals.hidden, false);
  assert.ok(arrivals.innerHTML.startsWith('Arrivé sur tes abonnements : '));
  assert.ok(arrivals.innerHTML.includes('>Her</button> sur Netflix'));
});

test('arrivée sur une plateforme non cochée : rien', () => {
  const { check } = buildContext();
  check({ 10: [], 20: [] }, 1000);
  assert.deepStrictEqual(check({ 10: [CANAL], 20: [] }, 2000), []);
});

test('sans abonnement coché : toute arrivée en streaming compte', () => {
  const { check } = buildContext([]);
  check({ 10: [], 20: [] }, 1000);
  assert.strictEqual(check({ 10: [CANAL], 20: [] }, 2000).length, 1);
});

test('film ajouté après la dernière vérification : rien, même s’il est déjà sur Prime', () => {
  const { check, ctx } = buildContext();
  check({ 10: [] }, 1000); // Dune pas encore vérifié
  assert.deepStrictEqual(check({ 10: [], 20: [PRIME] }, 2000), []);
});

test('changer de pays : pas de fausses arrivées', () => {
  const { check, ctx } = buildContext();
  check({ 10: [], 20: [] }, 1000);
  ctx.setWatchRegion('ZA');
  assert.deepStrictEqual(check({ 10: [NETFLIX], 20: [] }, 2000), []);
});

test('l’annonce reste 7 jours, puis disparaît', () => {
  const { check } = buildContext();
  check({ 10: [], 20: [] }, 0);
  assert.strictEqual(check({ 10: [NETFLIX], 20: [] }, DAY).length, 1);
  assert.strictEqual(check({ 10: [NETFLIX], 20: [] }, 7 * DAY).length, 1, 'encore là le 7e jour');
  assert.strictEqual(check({ 10: [NETFLIX], 20: [] }, 8 * DAY + 1).length, 0);
});

test('un film retiré d’À voir n’est plus annoncé', () => {
  const { check, ctx, arrivals } = buildContext();
  check({ 10: [], 20: [] }, 1000);
  const out = check({ 10: [NETFLIX], 20: [] }, 2000);
  setState(ctx, { watchlist: [{ id: 2, tmdbId: 20, title: 'Dune' }] });
  ctx.renderWatchlistArrivals(out);
  assert.strictEqual(arrivals.hidden, true);
});

test('vérification en échec (réseau) : pas de fausse arrivée au retour', () => {
  const { check, ctx } = buildContext();
  check({ 10: [NETFLIX], 20: [] }, 1000);
  setState(ctx, { watchlistProvidersFailed: new Set([10]) });
  check({ 10: [], 20: [] }, 2000);           // Her : TMDB n'a pas répondu
  setState(ctx, { watchlistProvidersFailed: new Set() });
  assert.deepStrictEqual(check({ 10: [NETFLIX], 20: [] }, 3000), [], 'Her était déjà sur Netflix');
});

module.exports = run('watchlist-arrivals.test.js');
