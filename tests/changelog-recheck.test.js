// --- Tests de la relecture des Nouveautés au retour sur l'appli (js/changelog.js) ---
// Retour de Flix (15/10) : après la publication de la v4.0, l'entête d'une
// appli déjà ouverte affichait encore v3.4. Au retour sur l'appli, la
// dernière version publiée est relue (au plus toutes les 5 minutes) ; si
// elle a changé, l'entête et la note se mettent à jour comme à une connexion.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(latest){
  const versionTagEl = stubElement();
  const calls = { queries: 0 };
  const ctx = createContext({
    document: stubDocument({ versionTagValue: versionTagEl, versionTag: stubElement(), changelogList: stubElement() }),
    escapeHtml(s){ return s; },
    loadActivityState(){ return Promise.resolve(); },
    activityState: null,
    supabaseClient: {
      from(){
        calls.queries++;
        return {
          select(){ return this; }, eq(){ return this; }, order(){ return this; },
          limit(){ return Promise.resolve({ data: [{ id: 15, version: latest, title: 't', body: 'b', published_at: new Date().toISOString() }], error: null }); },
        };
      },
    },
  });
  loadFiles(ctx, ['js/changelog.js']);
  setState(ctx, { currentUser: { id: 'me' }, currentProfile: { onboarding_seen: true }, latestPublishedVersion: '3.4' });
  ctx.initChangelog = async () => { calls.init = (calls.init || 0) + 1; };
  return { ctx, calls, versionTagEl };
}

test('une nouvelle version publiée pendant que l\'appli est ouverte relance les Nouveautés', async () => {
  const { ctx, calls } = buildContext('4.0');
  const changed = await ctx.recheckChangelogIfStale(10 * 60 * 1000);
  assert.strictEqual(changed, true);
  assert.strictEqual(calls.init, 1);
});

test('même version : rien ne change', async () => {
  const { ctx, calls } = buildContext('3.4');
  assert.strictEqual(await ctx.recheckChangelogIfStale(10 * 60 * 1000), false);
  assert.strictEqual(calls.init, undefined);
});

test('au plus une relecture toutes les 5 minutes', async () => {
  const { ctx, calls } = buildContext('3.4');
  await ctx.recheckChangelogIfStale(10 * 60 * 1000);
  await ctx.recheckChangelogIfStale(12 * 60 * 1000);
  assert.strictEqual(calls.queries, 1);
  await ctx.recheckChangelogIfStale(16 * 60 * 1000);
  assert.strictEqual(calls.queries, 2);
});

test('sans session, aucune requête', async () => {
  const { ctx, calls } = buildContext('4.0');
  setState(ctx, { currentUser: null });
  assert.strictEqual(await ctx.recheckChangelogIfStale(10 * 60 * 1000), false);
  assert.strictEqual(calls.queries, 0);
});

module.exports = run('changelog-recheck.test.js');
