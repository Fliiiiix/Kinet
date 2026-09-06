// --- Tests de la visibilité publique des Nouveautés (js/changelog.js) ---
// Retour utilisateur : "après 7 jours une nouveauté disparaît... en terme
// de visibilité du public" — loadChangelogEntries() (utilisée par la
// modale/liste publique) ne garde que les entrées publiées il y a moins de
// CHANGELOG_PUBLIC_VISIBILITY_DAYS jours. N'affecte PAS
// loadAdminChangelogEntries() (js/admin.js), un historique complet
// séparé pour la gestion.
//
// Piège évité ici (voir le commentaire dans js/changelog.js) : le numéro
// de version affiché près du logo (#versionTagValue) doit rester la VRAIE
// dernière version publiée même si son annonce est sortie de la fenêtre
// de 7 jours — sinon il retomberait sur le "2.0" codé en dur d'index.html,
// une régression visible bien pire que l'absence d'annonce.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

const DAY_MS = 24 * 60 * 60 * 1000;

function buildContext(rows){
  const versionTagEl = stubElement();
  const ctx = createContext({
    document: stubDocument({ versionTagValue: versionTagEl, changelogList: stubElement() }),
    escapeHtml(s){ return s; },
    loadActivityState(){ return Promise.resolve(); },
    activityState: null,
    supabaseClient: {
      from(table){
        assert.strictEqual(table, 'changelog_entries');
        return {
          select(){ return this; },
          eq(){ return this; },
          order(){ return this; },
          limit(){ return Promise.resolve({ data: rows, error: null }); },
        };
      },
    },
  });
  loadFiles(ctx, ['js/changelog.js']);
  return { ctx, versionTagEl };
}

test('loadChangelogEntries() : ne garde que les entrées publiées il y a moins de 7 jours dans la liste publique', async () => {
  const now = Date.now();
  const { ctx } = buildContext([
    { id: 3, version: '3.3', title: 'Récente', body: '...', published_at: new Date(now - 2 * DAY_MS).toISOString() },
    { id: 2, version: '3.2', title: 'Pile à la limite', body: '...', published_at: new Date(now - 6 * DAY_MS).toISOString() },
    { id: 1, version: '3.1', title: 'Trop vieille', body: '...', published_at: new Date(now - 10 * DAY_MS).toISOString() },
  ]);
  await ctx.loadChangelogEntries();
  const visible = JSON.parse(JSON.stringify(getState(ctx, 'changelogEntries')));
  assert.strictEqual(visible.length, 2, 'seules les 2 entrées de moins de 7 jours doivent rester visibles');
  assert.deepStrictEqual(visible.map(e => e.id), [3, 2]);
});

test('updateVersionTag() : affiche la VRAIE dernière version publiée même si son annonce a expiré de la fenêtre de 7 jours', async () => {
  const now = Date.now();
  const { ctx, versionTagEl } = buildContext([
    { id: 1, version: '3.3', title: 'Vieille annonce', body: '...', published_at: new Date(now - 30 * DAY_MS).toISOString() },
  ]);
  await ctx.loadChangelogEntries();
  assert.strictEqual(getState(ctx, 'changelogEntries').length, 0, 'plus rien de visible dans la liste publique');
  ctx.updateVersionTag();
  assert.strictEqual(versionTagEl.textContent, '3.3', 'le tag ne doit JAMAIS retomber sur la valeur codée en dur d\'index.html tant qu\'une vraie version a été publiée un jour');
});

test('updateVersionTag() : aucune entrée publiée du tout -> ne touche pas au tag (garde la valeur HTML par défaut)', async () => {
  const { ctx, versionTagEl } = buildContext([]);
  await ctx.loadChangelogEntries();
  const before = versionTagEl.textContent;
  ctx.updateVersionTag();
  assert.strictEqual(versionTagEl.textContent, before, 'rien à afficher -> aucune écriture, le HTML garde sa valeur par défaut');
});

test('hasUnreadChangelog() : jamais "non lu" pour une annonce sortie de la fenêtre de 7 jours (même jamais vue)', async () => {
  const now = Date.now();
  const { ctx } = buildContext([
    { id: 1, version: '3.3', title: 'Vieille annonce', body: '...', published_at: new Date(now - 30 * DAY_MS).toISOString() },
  ]);
  await ctx.loadChangelogEntries();
  setState(ctx, { activityState: null }); // jamais consultée par cet utilisateur
  assert.strictEqual(await ctx.hasUnreadChangelog(), false, 'la fenêtre de 7 jours prime : rien à signaler comme "nouveau" une fois expirée');
});

test('hasUnreadChangelog() : "non lu" pour une annonce récente jamais consultée', async () => {
  const now = Date.now();
  const { ctx } = buildContext([
    { id: 1, version: '3.3', title: 'Récente', body: '...', published_at: new Date(now - 1 * DAY_MS).toISOString() },
  ]);
  await ctx.loadChangelogEntries();
  setState(ctx, { activityState: null });
  assert.strictEqual(await ctx.hasUnreadChangelog(), true);
});

module.exports = run('changelog-visibility.test.js');
