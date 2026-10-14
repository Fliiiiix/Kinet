// --- Tests du flux d'activité amis élargi (js/activity.js) ---
// Retour utilisateur (étude comparative Strava/Goodreads — un flux social
// mélange plusieurs types d'événements, pas seulement le plus "riche") :
// le fil scope='friend' (migrations/021) ne logait jusqu'ici qu'un seul
// type d'événement (film_rated). Deux ajouts (migrations/060) :
// watchlist_added et list_created — vérifiés ici au niveau du libellé/
// icône, les triggers SQL eux-mêmes ne sont pas testables depuis ce
// harnais (voir tests/README.md : seul le code js/ est exécuté ici).
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, getState, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const ctx = createContext({
    document: stubDocument(),
    friendDisplayName(id){ return id === 'ami1' ? 'Sam' : 'Utilisateur'; },
    friendAvatarHtml(){ return ''; },
    cacheProfile(){},
    formatViewingDate(){ return ''; },
    escapeHtml(s){ return s; },
    renderCollapsible(){},
    supabaseClient: { from(){ throw new Error('non utilisé dans ce test'); } },
  });
  loadFiles(ctx, ['js/activity.js']);
  return ctx;
}

test('activityEventLabel() : watchlist_added -> "a ajouté « titre » à sa liste À voir" (audit T1)', () => {
  const ctx = buildContext();
  const label = ctx.activityEventLabel({ actorId: 'ami1', eventType: 'watchlist_added', targetLabel: 'Paprika' });
  assert.strictEqual(label, 'Sam a ajouté « Paprika » à sa liste À voir');
});

test('activityEventLabel() : list_created -> "a créé la liste « titre »"', () => {
  const ctx = buildContext();
  const label = ctx.activityEventLabel({ actorId: 'ami1', eventType: 'list_created', targetLabel: 'Mes comédies' });
  assert.strictEqual(label, 'Sam a créé la liste « Mes comédies »');
});

test('ACTIVITY_ICON : une icône dédiée pour chaque nouveau type d\'événement, jamais le repli générique "•"', () => {
  const ctx = buildContext();
  // const top-level : pas une propriété du contexte (contrairement à une
  // fonction déclarée avec `function`), voir tests/README.md — getState()
  // retrouve la vraie liaison lexicale.
  const icons = getState(ctx, 'ACTIVITY_ICON');
  assert.ok(icons.watchlist_added && icons.watchlist_added !== '•');
  assert.ok(icons.list_created && icons.list_created !== '•');
});

test('rowToActivityEvent() : mappe un événement watchlist_added comme n\'importe quel autre type (aucun traitement spécial nécessaire)', () => {
  const ctx = buildContext();
  const event = ctx.rowToActivityEvent({
    id: 1, scope: 'friend', actor_id: 'ami1', group_id: null,
    event_type: 'watchlist_added', target_label: 'Paprika', target_poster_url: null,
    target_note: null, created_at: '2026-01-01',
  });
  assert.strictEqual(JSON.parse(JSON.stringify(event)).eventType, 'watchlist_added');
});

module.exports = run('activity-feed.test.js');
