// --- Tests de la comparaison de goûts élargie (js/groups.js) ---
// Retour utilisateur : "Comparaison de goûts élargie (groupe entier)" —
// get_group_taste_comparison() (migrations/038) renvoie, pour les mêmes
// films que "Goûts du groupe" (notés par ≥2 membres), le détail par
// membre plutôt que la seule moyenne.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(overrides = {}){
  const listEl = stubElement();
  const ctx = createContext(Object.assign({
    document: stubDocument({ groupTasteComparisonList: listEl, groupDetailBack: stubElement() }),
    escapeHtml(s){ return s; },
    noteColorClass(n){ return n >= 4 ? 'rate-high' : (n >= 2.5 ? 'rate-mid' : 'rate-low'); },
    friendDisplayName(id){ return id; },
    FILM_PLACEHOLDER_SVG: '',
    makeRowClickable(){},
    goToFilmDetail(){},
    goToGroups(){},
    goHome(){},
    supabaseClient: { rpc(){ throw new Error('non utilisé par ces tests'); } },
  }, overrides));
  loadFiles(ctx, ['js/groups.js']);
  return { ctx, listEl };
}

test('loadGroupTasteComparison() : renvoie les lignes de la RPC, [] en cas d\'erreur', async () => {
  const okCtx = buildContext({
    supabaseClient: { rpc: (name, args) => {
      assert.strictEqual(name, 'get_group_taste_comparison');
      assert.deepStrictEqual(JSON.parse(JSON.stringify(args)), { p_group_id: 7, p_limit: 15 });
      return Promise.resolve({ data: [{ tmdb_id: 1, title: 'A' }], error: null });
    } },
  }).ctx;
  const rows = await okCtx.loadGroupTasteComparison(7);
  assert.strictEqual(rows.length, 1);

  const errCtx = buildContext({
    supabaseClient: { rpc: () => Promise.resolve({ data: null, error: { message: 'boom' } }) },
  }).ctx;
  const rowsOnError = await errCtx.loadGroupTasteComparison(7);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rowsOnError)), []);
});

test('renderGroupTasteComparison() : liste vide -> message explicite, pas de plantage', () => {
  const { ctx, listEl } = buildContext();
  ctx.renderGroupTasteComparison([]);
  assert.ok(listEl.innerHTML.includes('Pas encore de film noté par au moins 2 membres'));
});

test('renderGroupTasteComparison() : une pastille par membre, avec le bon barème de couleur (noteColorClass)', () => {
  const { ctx, listEl } = buildContext();
  ctx.renderGroupTasteComparison([{
    tmdb_id: 42,
    title: 'Paprika',
    release_year: 2006,
    poster_url: null,
    avg_note: 3.5,
    notes: [{ user_id: 'alice', note: 5 }, { user_id: 'bob', note: 2 }],
  }]);
  assert.ok(listEl.innerHTML.includes('Paprika'));
  assert.ok(listEl.innerHTML.includes('alice 5.0'));
  assert.ok(listEl.innerHTML.includes('bob 2.0'));
  assert.ok(/taste-note-pill rate-high">alice 5\.0/.test(listEl.innerHTML), 'note haute (5) -> rate-high');
  assert.ok(/taste-note-pill rate-low">bob 2\.0/.test(listEl.innerHTML), 'note basse (2) -> rate-low');
});

module.exports = run('group-taste-comparison.test.js');
