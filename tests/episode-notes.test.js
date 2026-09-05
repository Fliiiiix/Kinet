// --- Tests de la note par épisode + nombre de fois vu (js/series.js) ---
// Retour utilisateur : "je veux que l'essentiel soit la note globale et si
// on veut vraiment on met une note par ep", puis "Pouvoir mettre un nb de
// fois vu aussi sur les séries" — updateEpisodeNote()/changeEpisodeTimesWatched()
// sont les deux seules fonctions qui touchent ces colonnes optionnelles
// (note/times_watched sur tv_episodes_watched), bonne cible de test.
//
// supabaseClient est mocké ici avec une chaîne .from().update().eq().eq().eq()
// qui enregistre chaque appel plutôt que de toucher un vrai réseau/DB.
//
// Piège vm (voir tests/README.md) : `watchedEpisodeExtras` est un `let` de
// script top-level dans series.js, donc `ctx.watchedEpisodeExtras` depuis le
// realm hôte ne lit RIEN (une déclaration `let`/`const` top-level ne devient
// pas une propriété de l'objet contexte, contrairement aux fonctions
// déclarées avec `function`). On récupère la vraie référence avec
// getState(ctx, 'watchedEpisodeExtras') juste après le chargement/setState,
// puis on la réutilise : c'est un objet, sa mutation par les fonctions
// testées (elles, exécutées dans le contexte) reste visible depuis cette
// référence côté hôte.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const updateCalls = [];
  function makeQuery(table){
    const call = { table, update: null, eq: [] };
    updateCalls.push(call);
    const chain = {
      update(payload){ call.update = payload; return chain; },
      eq(col, val){ call.eq.push([col, val]); return chain; },
      // await supabaseClient.from(...).update(...).eq(...).eq(...).eq(...)
      // attend un thenable — le chain lui-même en fait office.
      then(resolve){ return Promise.resolve({ error: null }).then(resolve); },
    };
    return chain;
  }
  const ctx = createContext({
    document: stubDocument(),
    // Externes référencées par series.js mais définies ailleurs (router.js,
    // app.js, offline.js) — jamais appelées par les deux fonctions testées
    // ici sauf blockIfOffline()/showToast()/escapeHtml(), stubbées pour de
    // vrai ; goToSeries est un no-op uniquement nécessaire pour que le
    // wiring de bas de fichier ne plante pas au chargement.
    goToSeries(){},
    blockIfOffline(){ return false; },
    showToast(){},
    escapeHtml(s){ return s; },
    supabaseClient: { from: (table) => makeQuery(table) },
  });
  loadFiles(ctx, ['js/series.js']);
  setState(ctx, {
    currentShowId: 42,
    watchedEpisodeSet: new Set(['1-1']),
    watchedEpisodeExtras: { '1-1': { note: null, timesWatched: 1 } },
    loadedSeasonEpisodes: { 1: [{ episode_number: 1, name: 'Pilote', air_date: null }] },
  });
  const extras = getState(ctx, 'watchedEpisodeExtras');
  return { ctx, extras, updateCalls };
}

test('updateEpisodeNote() : enregistre la note (clampée 0-5) et met à jour l\'état local', async () => {
  const { ctx, extras, updateCalls } = buildContext();
  await ctx.updateEpisodeNote(1, 1, '4.5');
  assert.strictEqual(extras['1-1'].note, 4.5);
  const call = updateCalls.find(c => c.update && 'note' in c.update);
  assert.ok(call, 'un update() avec la colonne note doit avoir été envoyé');
  assert.strictEqual(call.update.note, 4.5);
  assert.deepStrictEqual(call.eq, [['tv_show_id', 42], ['season_number', 1], ['episode_number', 1]]);
});

test('updateEpisodeNote() : une valeur hors bornes est clampée à 5', async () => {
  const { ctx, extras } = buildContext();
  await ctx.updateEpisodeNote(1, 1, '9');
  assert.strictEqual(extras['1-1'].note, 5);
});

test('updateEpisodeNote() : une valeur vide efface la note (note -> null), pas d\'erreur', async () => {
  const { ctx, extras } = buildContext();
  extras['1-1'].note = 3;
  await ctx.updateEpisodeNote(1, 1, '');
  assert.strictEqual(extras['1-1'].note, null);
});

test('changeEpisodeTimesWatched() : +1 incrémente et envoie le bon payload', async () => {
  const { ctx, extras, updateCalls } = buildContext();
  await ctx.changeEpisodeTimesWatched(1, 1, 1);
  assert.strictEqual(extras['1-1'].timesWatched, 2);
  const call = updateCalls.find(c => c.update && 'times_watched' in c.update);
  assert.ok(call, 'un update() avec la colonne times_watched doit avoir été envoyé');
  assert.strictEqual(call.update.times_watched, 2);
});

test('changeEpisodeTimesWatched() : ne descend jamais sous 1 (repasser à 0 = décocher l\'épisode, pas ce bouton)', async () => {
  const { ctx, extras, updateCalls } = buildContext();
  await ctx.changeEpisodeTimesWatched(1, 1, -1);
  assert.strictEqual(extras['1-1'].timesWatched, 1, 'déjà à 1, le "-" ne doit rien changer');
  // Comme next === current (1 === 1), la fonction retourne avant d'appeler
  // supabaseClient : aucun update() ne doit avoir été envoyé.
  const call = updateCalls.find(c => c.update && 'times_watched' in c.update);
  assert.strictEqual(call, undefined, 'aucun update() envoyé quand la valeur ne change pas');
});

test('ensureEpisodeExtras() : n\'écrase jamais les extras d\'un épisode déjà vu (marquage en masse)', () => {
  const { ctx, extras } = buildContext();
  extras['1-1'].note = 4;
  extras['1-1'].timesWatched = 3;
  ctx.ensureEpisodeExtras('1-1');
  assert.strictEqual(extras['1-1'].note, 4, 'un épisode déjà présent ne doit pas être réinitialisé');
  assert.strictEqual(extras['1-1'].timesWatched, 3);
  ctx.ensureEpisodeExtras('2-5');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(extras['2-5'])), { note: null, timesWatched: 1 });
});

// --- Régression : migration 036 pas encore appliquée ---
// Bug réel constaté en vérifiant ce déploiement en direct : avant que la
// migration 036 (colonnes note/times_watched) ne soit exécutée sur la
// vraie base, le SELECT qui les demande échoue (colonnes inexistantes) et
// loadWatchedEpisodes() vidait purement et simplement watchedEpisodeSet --
// TOUS les épisodes s'affichaient comme non-vus, y compris ceux déjà
// cochés depuis longtemps. loadWatchedEpisodes() doit se rabattre sur un
// SELECT sans ces deux colonnes plutôt que de casser le statut vu/pas-vu,
// qui existait bien avant elles.
function buildContextWithoutMigration(){
  function makeSelectQuery(table){
    const chain = {
      select(cols){ chain._cols = cols; return chain; },
      eq(){ return chain; },
      then(resolve, reject){
        // Seul le SELECT qui demande note/times_watched échoue : simule une
        // base où la migration 036 n'a pas encore tourné.
        const result = chain._cols.includes('note')
          ? { data: null, error: { message: 'column tv_episodes_watched.note does not exist' } }
          : { data: [{ season_number: 1, episode_number: 1 }, { season_number: 1, episode_number: 2 }], error: null };
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return chain;
  }
  const ctx = createContext({
    document: stubDocument(),
    goToSeries(){},
    blockIfOffline(){ return false; },
    showToast(){},
    escapeHtml(s){ return s; },
    supabaseClient: { from: (table) => makeSelectQuery(table) },
  });
  loadFiles(ctx, ['js/series.js']);
  return ctx;
}

test('loadWatchedEpisodes() : se rabat sur season_number/episode_number si note/times_watched n\'existent pas encore (migration non appliquée)', async () => {
  const ctx = buildContextWithoutMigration();
  await ctx.loadWatchedEpisodes(23);
  const watchedSet = getState(ctx, 'watchedEpisodeSet');
  assert.ok(watchedSet.has('1-1'), 'un épisode déjà vu en base doit rester marqué vu malgré l\'échec du SELECT enrichi');
  assert.ok(watchedSet.has('1-2'));
  assert.strictEqual(watchedSet.size, 2);
});

module.exports = run('episode-notes.test.js');
