// --- Tests du badge "nouvel épisode" (js/series.js) ---
// Retour utilisateur : "Badge 'nouvel épisode' sur les séries en cours" —
// hasNewEpisode() est un signal léger dérivé de données déjà chargées
// (numberOfEpisodes/watchedEpisodeCounts), sans appel TMDB dédié.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const ctx = createContext({
    document: stubDocument(),
    goToSeries(){}, blockIfOffline(){ return false; }, showToast(){}, escapeHtml(s){ return s; },
    supabaseClient: { from(){ throw new Error('non utilisé par ce test'); } },
  });
  loadFiles(ctx, ['js/series.js']);
  return ctx;
}

test('hasNewEpisode() : vrai quand une série en cours a moins d\'épisodes vus que connus', () => {
  const ctx = buildContext();
  setState(ctx, { watchedEpisodeCounts: { 1: 5 } });
  assert.strictEqual(ctx.hasNewEpisode({ id: 1, status: 'Returning Series', numberOfEpisodes: 6 }), true);
});

test('hasNewEpisode() : faux si tous les épisodes connus sont déjà vus (à jour)', () => {
  const ctx = buildContext();
  setState(ctx, { watchedEpisodeCounts: { 1: 6 } });
  assert.strictEqual(ctx.hasNewEpisode({ id: 1, status: 'Returning Series', numberOfEpisodes: 6 }), false);
});

test('hasNewEpisode() : jamais vrai sur une série terminée/annulée, même en retard', () => {
  const ctx = buildContext();
  setState(ctx, { watchedEpisodeCounts: { 1: 5, 2: 5 } });
  assert.strictEqual(ctx.hasNewEpisode({ id: 1, status: 'Ended', numberOfEpisodes: 6 }), false);
  assert.strictEqual(ctx.hasNewEpisode({ id: 2, status: 'Cancelled', numberOfEpisodes: 6 }), false);
});

test('hasNewEpisode() : faux si le nombre d\'épisodes n\'est pas encore connu (jamais un badge sur une donnée manquante)', () => {
  const ctx = buildContext();
  setState(ctx, { watchedEpisodeCounts: {} });
  assert.strictEqual(ctx.hasNewEpisode({ id: 1, status: 'Returning Series', numberOfEpisodes: null }), false);
});

test('hasNewEpisode() : aucun épisode vu chargé pour cette série (undefined) -> traité comme 0, pas une exception', () => {
  const ctx = buildContext();
  setState(ctx, { watchedEpisodeCounts: {} });
  assert.strictEqual(ctx.hasNewEpisode({ id: 99, status: 'Returning Series', numberOfEpisodes: 3 }), true);
});

module.exports = run('new-episode-badge.test.js');
