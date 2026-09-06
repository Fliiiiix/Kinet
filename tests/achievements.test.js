// --- Tests des succès (js/achievements.js) ---
// Couvre en particulier les paliers/succès secrets ajoutés pour les
// séries et les amis (retour utilisateur : "je veux de nouveaux succès vu
// qu'on a des nouvelles features") — trackedShows/watchedEpisodeCounts/
// friendships/groups ne sont normalement chargés QUE sur leur propre page,
// donc les métriques doivent être correctes qu'ils soient présents ou
// absents (jamais confondre "pas encore chargé" et "vraiment zéro", même
// classe de bug que le "0" corrigé dans Top films).
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(overrides = {}){
  const ctx = createContext(Object.assign({
    document: stubDocument(),
    escapeHtml: (s) => s,
    getDisplayNote: (f) => f.manualNote,
    films: [],
    viewings: [],
  }, overrides));
  loadFiles(ctx, ['js/achievements.js']);
  return ctx;
}

test('episodesWatched / friendCount : calculés correctement quand les données sont chargées', () => {
  const ctx = buildContext({
    watchedEpisodeCounts: { 10: 30, 11: 5 },
    trackedShows: [{ id: 10, numberOfEpisodes: 24 }, { id: 11, numberOfEpisodes: 100 }],
    friendships: [{ status: 'accepted' }, { status: 'accepted' }, { status: 'pending' }],
    groups: [{ id: 1 }],
  });
  const a = ctx.computeAchievements();
  const serievore = a.cumulative.find(g => g.key === 'serievore');
  const sociable = a.cumulative.find(g => g.key === 'sociable');
  assert.strictEqual(serievore.value, 35, '30 + 5 épisodes vus');
  assert.strictEqual(sociable.value, 2, 'seuls les amis "accepted" comptent, pas "pending"');
});

test('episodesWatched / friendCount : jamais "0" par erreur quand les données ne sont PAS chargées (undefined), pas plantées non plus', () => {
  const ctx = buildContext({}); // pas de trackedShows/watchedEpisodeCounts/friendships/groups du tout
  const a = ctx.computeAchievements();
  const serievore = a.cumulative.find(g => g.key === 'serievore');
  const sociable = a.cumulative.find(g => g.key === 'sociable');
  assert.strictEqual(serievore.value, 0);
  assert.strictEqual(sociable.value, 0);
  // Le point important n'est pas la valeur (0 est correct ici, rien n'est
  // suivi) mais qu'aucune exception ne soit levée par computeAchievements()
  // en l'absence de ces globals — déjà vérifié par le fait qu'on arrive ici.
});

test('showrunner : débloqué à partir de 10 séries suivies', () => {
  const few = buildContext({ trackedShows: Array.from({ length: 9 }, (_, i) => ({ id: i, numberOfEpisodes: 10 })), watchedEpisodeCounts: {}, friendships: [], groups: [] });
  const many = buildContext({ trackedShows: Array.from({ length: 10 }, (_, i) => ({ id: i, numberOfEpisodes: 10 })), watchedEpisodeCounts: {}, friendships: [], groups: [] });
  assert.strictEqual(few.computeAchievements().hidden.find(h => h.key === 'showrunner').unlocked, false);
  assert.strictEqual(many.computeAchievements().hidden.find(h => h.key === 'showrunner').unlocked, true);
});

test('"Jusqu\'au bout" : débloqué quand une série suivie est vue à 100%, pas avant', () => {
  const partial = buildContext({ trackedShows: [{ id: 1, numberOfEpisodes: 24 }], watchedEpisodeCounts: { 1: 23 }, friendships: [], groups: [] });
  const complete = buildContext({ trackedShows: [{ id: 1, numberOfEpisodes: 24 }], watchedEpisodeCounts: { 1: 24 }, friendships: [], groups: [] });
  assert.strictEqual(partial.computeAchievements().hidden.find(h => h.key === 'serie-terminee').unlocked, false);
  assert.strictEqual(complete.computeAchievements().hidden.find(h => h.key === 'serie-terminee').unlocked, true);
});

test('Table ronde : débloqué en faisant partie d\'au moins un groupe', () => {
  const none = buildContext({ trackedShows: [], watchedEpisodeCounts: {}, friendships: [], groups: [] });
  const one = buildContext({ trackedShows: [], watchedEpisodeCounts: {}, friendships: [], groups: [{ id: 1 }] });
  assert.strictEqual(none.computeAchievements().hidden.find(h => h.key === 'table-ronde').unlocked, false);
  assert.strictEqual(one.computeAchievements().hidden.find(h => h.key === 'table-ronde').unlocked, true);
});

// --- Note par épisode + nombre de fois vu (v2.39) — retour utilisateur :
// "je veux de nouveaux succès vu qu'on a des nouvelles features".
// maxEpisodeTimesWatched/notedEpisodeCount (js/series.js) sont calculés en
// un seul select groupé dans loadTrackedShows(), même préchargement que
// Sérievore/Showrunner ci-dessus — mêmes garde-fous "jamais 0 par erreur
// si pas chargé" à vérifier.
test('Objet de culte : débloqué à partir de 3 visionnages d\'un même épisode', () => {
  const few = buildContext({ maxEpisodeTimesWatched: 2 });
  const many = buildContext({ maxEpisodeTimesWatched: 3 });
  assert.strictEqual(few.computeAchievements().hidden.find(h => h.key === 'objet-de-culte').unlocked, false);
  assert.strictEqual(many.computeAchievements().hidden.find(h => h.key === 'objet-de-culte').unlocked, true);
});

test('Le noteur : débloqué à partir de 10 épisodes notés individuellement', () => {
  const few = buildContext({ notedEpisodeCount: 9 });
  const many = buildContext({ notedEpisodeCount: 10 });
  assert.strictEqual(few.computeAchievements().hidden.find(h => h.key === 'le-noteur').unlocked, false);
  assert.strictEqual(many.computeAchievements().hidden.find(h => h.key === 'le-noteur').unlocked, true);
});

test('Objet de culte / Le noteur : jamais débloqués par erreur quand les données ne sont pas chargées', () => {
  const ctx = buildContext({}); // pas de maxEpisodeTimesWatched/notedEpisodeCount du tout
  const a = ctx.computeAchievements();
  assert.strictEqual(a.hidden.find(h => h.key === 'objet-de-culte').unlocked, false);
  assert.strictEqual(a.hidden.find(h => h.key === 'le-noteur').unlocked, false);
});

module.exports = run('achievements.test.js');
