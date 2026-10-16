// --- Tests de critForSave() (js/app.js), audit N1 du 16/10 ---
// 52 films avaient une grille de 7 critères ET une note manuelle égale. La
// fenêtre de notation les ouvrait en « note manuelle », et « Enregistrer »
// envoyait crit: {} : la grille était effacée. En note manuelle, la grille
// déjà enregistrée doit rester, sauf si un curseur a bougé dans la fenêtre.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const ctx = createContext({
    document: stubDocument(),
    escapeHtml(s){ return s; },
    GENRE_MAP: {},
    CRITERIA: [{ key: 'scenario', label: 'Scénario' }, { key: 'ressenti', label: 'Ressenti' }],
  });
  loadFiles(ctx, ['js/app.js']);
  return ctx;
}

const grille = { scenario: 0.9, ressenti: 0.85 };
const form = { scenario: 0.5, ressenti: 0.5 };

test('note manuelle, curseurs pas touchés : la grille enregistrée reste', () => {
  const ctx = buildContext();
  const out = ctx.critForSave(true, { id: 1, crit: grille, manualNote: 4.5 }, false, null);
  assert.deepStrictEqual(out, grille);
});

test('note manuelle sans grille (film noté directement) : reste vide', () => {
  const ctx = buildContext();
  assert.strictEqual(JSON.stringify(ctx.critForSave(true, { id: 2, crit: {}, manualNote: 4 }, false, null)), '{}');
});

test('note manuelle pour un nouveau film : pas de grille inventée', () => {
  const ctx = buildContext();
  assert.strictEqual(JSON.stringify(ctx.critForSave(true, null, false, null)), '{}');
});

test('note manuelle mais un curseur a bougé : on garde ce qui a été réglé', () => {
  const ctx = buildContext();
  assert.deepStrictEqual(ctx.critForSave(true, { id: 1, crit: grille }, true, form), form);
});

test('notation par critères : on enregistre la grille de la fenêtre', () => {
  const ctx = buildContext();
  assert.deepStrictEqual(ctx.critForSave(false, { id: 1, crit: grille }, false, form), form);
});

module.exports = run('notation-keep-crit.test.js');
