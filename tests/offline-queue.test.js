// --- Tests de la file d'attente hors ligne (js/offlineQueue.js) ---
// Retour utilisateur : "File d'attente hors ligne" — les actions à faible
// risque (toggle favori, épisode vu/pas vu, retirer un item watchlist/
// journal) restent possibles hors ligne, mises en file et rejouées au
// retour du réseau (voir le listener 'online', js/offline.js). Portée
// volontairement limitée aux écritures qui ciblent un id déjà connu ou une
// clé naturelle — jamais une création (nouveau film, nouvelle réaction...).
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument, fakeLocalStorage } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(overrides = {}){
  const ctx = createContext(Object.assign({
    document: stubDocument(),
    currentUser: { id: 'u1' },
    localStorage: fakeLocalStorage(),
    showToast(){},
  }, overrides));
  loadFiles(ctx, ['js/offlineQueue.js']);
  return ctx;
}

test('enqueueOfflineWrite() : ajoute l\'entrée à la file ET la persiste en localStorage tout de suite', () => {
  const ctx = buildContext();
  ctx.enqueueOfflineWrite({ table: 'films', op: 'update', match: { id: 1 }, payload: { fav: true } });
  const queue = JSON.parse(JSON.stringify(getState(ctx, 'offlineQueue')));
  assert.strictEqual(queue.length, 1);
  assert.strictEqual(queue[0].table, 'films');
  assert.ok(typeof queue[0].queuedAt === 'number', 'un horodatage doit être ajouté automatiquement');
  // Persistée : une nouvelle lecture depuis localStorage (loadOfflineQueue())
  // doit retrouver la même entrée, pas juste l'état en mémoire.
  setState(ctx, { offlineQueue: [] });
  ctx.loadOfflineQueue();
  assert.strictEqual(getState(ctx, 'offlineQueue').length, 1, 'doit survivre à un rechargement depuis localStorage');
});

test('loadOfflineQueue() : file vide (jamais rien enregistré) -> tableau vide, pas d\'exception', () => {
  const ctx = buildContext();
  ctx.loadOfflineQueue();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(getState(ctx, 'offlineQueue'))), []);
});

test('replayOfflineQueue() : rejoue delete/update/upsert dans l\'ordre, vide la file avant même de commencer', async () => {
  const calls = [];
  // .eq() doit rester chaînable plusieurs fois de suite (un match à
  // plusieurs colonnes, ex. { id, user_id }, appelle .eq() une fois par
  // colonne) — un chain thenable plutôt qu'un Promise renvoyé dès le
  // premier .eq(), qui casserait le 2e appel ("query.eq is not a function").
  function makeEqChain(record){
    return {
      eq(col, val){ record.eq.push([col, val]); return this; },
      then(resolve){ calls.push(record); return Promise.resolve({ error: null }).then(resolve); },
    };
  }
  const ctx = buildContext({
    supabaseClient: {
      from(table){
        return {
          delete(){ return makeEqChain({ table, op: 'delete', eq: [] }); },
          update(payload){ return makeEqChain({ table, op: 'update', payload, eq: [] }); },
          upsert(payload, options){ calls.push({ table, op: 'upsert', payload, options }); return Promise.resolve({ error: null }); },
        };
      },
    },
  });
  ctx.enqueueOfflineWrite({ table: 'watchlist', op: 'delete', match: { id: 7 } });
  ctx.enqueueOfflineWrite({ table: 'films', op: 'update', match: { id: 1, user_id: 'u1' }, payload: { fav: true } });
  ctx.enqueueOfflineWrite({ table: 'tv_episodes_watched', op: 'upsert', payload: { tv_show_id: 5, season_number: 1, episode_number: 1 }, upsertOptions: { onConflict: 'x', ignoreDuplicates: true } });

  const replayPromise = ctx.replayOfflineQueue();
  // La file doit être vidée SYNCHRONEMENT, avant même que les appels réseau
  // ci-dessus ne se résolvent — sinon fermer l'onglet pendant la boucle
  // rejouerait les mêmes entrées deux fois au prochain retour en ligne.
  assert.strictEqual(getState(ctx, 'offlineQueue').length, 0);
  await replayPromise;

  assert.strictEqual(calls.length, 3);
  assert.strictEqual(calls[0].op, 'delete');
  assert.strictEqual(calls[0].table, 'watchlist');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls[0].eq)), [['id', 7]]);
  assert.strictEqual(calls[1].op, 'update');
  assert.strictEqual(JSON.parse(JSON.stringify(calls[1].payload)).fav, true);
  // Un match à PLUSIEURS colonnes (id + user_id) doit se traduire par
  // autant d'appels .eq() chaînés, pas un seul.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls[1].eq)), [['id', 1], ['user_id', 'u1']]);
  assert.strictEqual(calls[2].op, 'upsert');
  assert.strictEqual(calls[2].table, 'tv_episodes_watched');
  assert.strictEqual(JSON.parse(JSON.stringify(calls[2].options)).onConflict, 'x');
});

test('replayOfflineQueue() : file vide -> ne fait rien (aucun appel réseau)', async () => {
  const ctx = buildContext({ supabaseClient: { from(){ throw new Error('ne doit jamais être appelé, file vide'); } } });
  await ctx.replayOfflineQueue();
});

test('replayOfflineQueue() : une entrée en échec n\'empêche pas les suivantes d\'être rejouées (best-effort)', async () => {
  const calls = [];
  const ctx = buildContext({
    supabaseClient: {
      from(table){
        return {
          delete(){
            return { eq(){
              if(table === 'watchlist') return Promise.resolve({ error: { message: 'boom' } });
              calls.push(table);
              return Promise.resolve({ error: null });
            } };
          },
        };
      },
    },
  });
  ctx.enqueueOfflineWrite({ table: 'watchlist', op: 'delete', match: { id: 1 } }); // échoue
  ctx.enqueueOfflineWrite({ table: 'viewings', op: 'delete', match: { id: 2 } }); // doit quand même être tentée
  await ctx.replayOfflineQueue();
  assert.deepStrictEqual(calls, ['viewings']);
});

module.exports = run('offline-queue.test.js');
