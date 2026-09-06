// --- Tests de l'historique des élections de groupe (js/activity.js) ---
// Retour utilisateur : "Historique des élections de groupe" — chaque
// élection (set_chosen_proposal, migrations/020) log déjà un événement
// 'proposal_chosen' dans activity_events (migrations/019). loadActivity()
// gagne un filtre eventType optionnel plutôt qu'une fonction dédiée
// dupliquée : une liste "Historique des élections" (js/groups.js) l'appelle
// avec eventType: 'proposal_chosen', le fil d'activité général l'appelle
// toujours sans (tous types confondus) — même fonction, deux usages.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const eqCalls = [];
  let limitArg = null;
  const query = {
    select(){ return query; },
    eq(col, val){ eqCalls.push([col, val]); return query; },
    order(){ return query; },
    limit(n){ limitArg = n; return query; },
    // .limit() (comme le vrai query builder Supabase) reste chaînable —
    // .eq('group_id', ...)/.eq('event_type', ...) peuvent encore s'ajouter
    // APRÈS elle (voir loadActivity()) — la requête n'est vraiment résolue
    // qu'à l'await final, donc `query` lui-même doit être un thenable.
    then(resolve){ return Promise.resolve({ data: [], error: null }).then(resolve); },
  };
  const ctx = createContext({
    document: stubDocument(),
    friendProfiles: {},
    cacheProfile(){},
    friendDisplayName(id){ return id; },
    supabaseClient: { from: () => query },
  });
  loadFiles(ctx, ['js/activity.js']);
  return { ctx, eqCalls, getLimitArg: () => limitArg };
}

test('loadActivity() : sans eventType, ne filtre PAS sur event_type (fil général, tous types confondus)', async () => {
  const { ctx, eqCalls } = buildContext();
  await ctx.loadActivity({ scope: 'group', groupId: 7 });
  assert.ok(eqCalls.some(([col, val]) => col === 'scope' && val === 'group'));
  assert.ok(eqCalls.some(([col, val]) => col === 'group_id' && val === 7));
  assert.ok(!eqCalls.some(([col]) => col === 'event_type'), 'aucun filtre event_type quand il n\'est pas demandé');
});

test('loadActivity() : avec eventType, ajoute le filtre event_type ET utilise sa propre limite', async () => {
  const { ctx, eqCalls, getLimitArg } = buildContext();
  await ctx.loadActivity({ scope: 'group', groupId: 7, eventType: 'proposal_chosen', limit: 30 });
  assert.ok(eqCalls.some(([col, val]) => col === 'event_type' && val === 'proposal_chosen'));
  assert.strictEqual(getLimitArg(), 30);
});

test('activityEventLabel() : formule dédiée pour une élection ("a élu « Titre » comme prochaine séance")', () => {
  const { ctx } = buildContext();
  const label = ctx.activityEventLabel({ eventType: 'proposal_chosen', actorId: 'ami', targetLabel: 'Paprika' });
  // friendDisplayName() n'est pas stubbée ici -> pas appelée pour ce test,
  // seule la FORME du message compte (le nom lui-même est déjà couvert
  // ailleurs, ex. le fil d'activité général).
  assert.ok(label.includes('a élu « Paprika » comme prochaine séance'));
});

module.exports = run('election-history.test.js');
