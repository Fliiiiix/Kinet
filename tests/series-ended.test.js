// --- Tests des séries terminées (js/series.js) ---
// Retour de Flix (15/10) : une série qui ne sortira plus rien ne descend
// dans « Séries terminées » qu'une fois vue en entier. Pas encore rattrapée,
// elle reste dans la liste avec sa progression.
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

test('terminée et vue en entier : descend dans « Séries terminées »', () => {
  const ctx = buildContext();
  setState(ctx, { watchedEpisodeCounts: { 1: 20, 2: 8 } });
  assert.strictEqual(ctx.isShowDone({ id: 1, status: 'Ended', numberOfEpisodes: 20 }), true);
  assert.strictEqual(ctx.isShowDone({ id: 2, status: 'Cancelled', numberOfEpisodes: 8 }), true);
});

test('terminée mais pas finie : reste en haut', () => {
  const ctx = buildContext();
  setState(ctx, { watchedEpisodeCounts: { 1: 12 } });
  assert.strictEqual(ctx.isShowDone({ id: 1, status: 'Ended', numberOfEpisodes: 20 }), false);
  assert.strictEqual(ctx.isShowDone({ id: 2, status: 'Ended', numberOfEpisodes: 10 }), false, 'aucun épisode vu');
});

test('toujours en diffusion, même à jour : reste en haut', () => {
  const ctx = buildContext();
  setState(ctx, { watchedEpisodeCounts: { 1: 30 } });
  assert.strictEqual(ctx.isShowDone({ id: 1, status: 'Returning Series', numberOfEpisodes: 30 }), false);
});

test('nombre d\'épisodes inconnu : reste en haut', () => {
  const ctx = buildContext();
  setState(ctx, { watchedEpisodeCounts: { 1: 12 } });
  assert.strictEqual(ctx.isShowDone({ id: 1, status: 'Ended', numberOfEpisodes: null }), false);
});

test('épisodes spéciaux cochés en plus : compte comme vue en entier', () => {
  const ctx = buildContext();
  setState(ctx, { watchedEpisodeCounts: { 1: 22 } });
  assert.strictEqual(ctx.isShowDone({ id: 1, status: 'Ended', numberOfEpisodes: 20 }), true);
});

module.exports = run('series-ended.test.js');
