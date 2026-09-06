// --- Tests du toggle favori hors ligne (js/app.js) ---
// Retour utilisateur : "File d'attente hors ligne" (js/offlineQueue.js) —
// marquer/retirer un favori cible un id déjà connu, mis en file plutôt que
// bloqué par blockIfOffline() comme avant cette version. toggleFilmFavorite()
// a été extraite du click .star-btn pour rester testable isolément, sans
// dépendre du DOM construit par render().
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument, fakeLocalStorage } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(overrides = {}){
  const updateCalls = [];
  const ctx = createContext(Object.assign({
    document: stubDocument(),
    escapeHtml(s){ return s; },
    GENRE_MAP: {}, CRITERIA: [{ key: 'scenario', label: 'Scénario' }],
    currentUser: { id: 'u1' },
    localStorage: fakeLocalStorage(),
    showToast(){},
    supabaseClient: {
      from(){
        return {
          update(payload){
            updateCalls.push(payload);
            return { eq(){ return this; }, then(r){ return Promise.resolve({ error: null }).then(r); } };
          },
        };
      },
    },
  }, overrides));
  loadFiles(ctx, ['js/offlineQueue.js', 'js/app.js']);
  return { ctx, updateCalls };
}

test('toggleFilmFavorite() en ligne : appelle Supabase, met à jour l\'état local, renvoie true', async () => {
  const { ctx, updateCalls } = buildContext({ isOfflineMode: false });
  const f = { id: 1, fav: false };
  const changed = await ctx.toggleFilmFavorite(f);
  assert.strictEqual(changed, true);
  assert.strictEqual(f.fav, true);
  assert.strictEqual(updateCalls.length, 1);
  assert.strictEqual(JSON.parse(JSON.stringify(updateCalls[0])).fav, true);
});

test('toggleFilmFavorite() en ligne : erreur réseau -> état local inchangé, renvoie false', async () => {
  const { ctx } = buildContext({
    isOfflineMode: false,
    supabaseClient: { from(){ return { update(){ return { eq(){ return this; }, then(r){ return Promise.resolve({ error: { message: 'boom' } }).then(r); } }; } }; } },
  });
  const f = { id: 1, fav: false };
  const changed = await ctx.toggleFilmFavorite(f);
  assert.strictEqual(changed, false);
  assert.strictEqual(f.fav, false, 'ne doit pas changer localement si l\'écriture a échoué');
});

test('toggleFilmFavorite() hors ligne : met à jour localement tout de suite, met en file, jamais d\'appel Supabase', async () => {
  const { ctx, updateCalls } = buildContext({ isOfflineMode: true });
  const f = { id: 1, fav: false };
  const changed = await ctx.toggleFilmFavorite(f);
  assert.strictEqual(changed, true);
  assert.strictEqual(f.fav, true, 'mis à jour localement même hors ligne, comme en ligne');
  assert.strictEqual(updateCalls.length, 0, 'aucun appel réseau hors ligne');
  const queue = JSON.parse(JSON.stringify(getState(ctx, 'offlineQueue')));
  assert.strictEqual(queue.length, 1);
  assert.strictEqual(queue[0].table, 'films');
  assert.strictEqual(queue[0].op, 'update');
  assert.deepStrictEqual(queue[0].match, { id: 1, user_id: 'u1' });
  assert.deepStrictEqual(queue[0].payload, { fav: true });
});

test('toggleFilmFavorite() hors ligne : retirer un favori (fav: true -> false) met en file le bon payload', async () => {
  const { ctx } = buildContext({ isOfflineMode: true });
  const f = { id: 2, fav: true };
  await ctx.toggleFilmFavorite(f);
  assert.strictEqual(f.fav, false);
  const queue = JSON.parse(JSON.stringify(getState(ctx, 'offlineQueue')));
  assert.deepStrictEqual(queue[0].payload, { fav: false });
});

module.exports = run('favorite-offline.test.js');
