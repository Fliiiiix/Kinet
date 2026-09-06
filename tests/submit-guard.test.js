// --- Tests de withSubmitGuard() (js/ui.js) ---
// Répasse "balayage double-soumission partout" (retour utilisateur) suite
// au bug réel trouvé sur "Note rapide" (js/watchlist.js) : un double-clic,
// ou Entrée puis clic, sur un bouton qui déclenche une écriture Supabase
// pouvait insérer le même enregistrement deux fois faute de désactivation
// pendant la requête. withSubmitGuard() généralise ce filet à tous les
// sites d'appel plutôt que de le réécrire à la main partout.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  // js/ui.js fait aussi du wiring de bas de fichier (view-toggle, etc.) —
  // stubDocument() suffit, aucun élément précis n'est interrogé par
  // withSubmitGuard() lui-même (il reçoit btn en paramètre direct).
  const ctx = createContext({ document: stubDocument() });
  loadFiles(ctx, ['js/ui.js']);
  return ctx;
}

test('withSubmitGuard() : désactive le bouton avant d\'appeler le handler, le réactive une fois résolu', async () => {
  const ctx = buildContext();
  const btn = stubElement();
  let handlerCalls = 0;
  const guarded = ctx.withSubmitGuard(btn, async () => {
    handlerCalls++;
    assert.strictEqual(btn.disabled, true, 'le bouton doit déjà être désactivé pendant l\'exécution du handler');
  });
  const p = guarded();
  assert.strictEqual(btn.disabled, true, 'le bouton doit être désactivé dès l\'appel, avant même que le handler async ne s\'exécute');
  await p;
  assert.strictEqual(btn.disabled, false, 'le bouton doit être réactivé une fois le handler résolu');
  assert.strictEqual(handlerCalls, 1);
});

test('withSubmitGuard() : réactive le bouton même si le handler échoue (throw)', async () => {
  const ctx = buildContext();
  const btn = stubElement();
  const guarded = ctx.withSubmitGuard(btn, async () => { throw new Error('échec réseau simulé'); });
  await assert.rejects(guarded());
  assert.strictEqual(btn.disabled, false, 'le filet finally doit réactiver le bouton même après une erreur');
});

test('withSubmitGuard() : un second appel pendant que le premier est en cours est ignoré (pas de double exécution)', async () => {
  const ctx = buildContext();
  const btn = stubElement();
  let handlerCalls = 0;
  const guarded = ctx.withSubmitGuard(btn, async () => {
    handlerCalls++;
    await new Promise(resolve => setTimeout(resolve, 5));
  });
  const first = guarded();
  const second = guarded(); // le bouton est déjà désactivé à ce stade -> no-op
  await Promise.all([first, second]);
  assert.strictEqual(handlerCalls, 1, 'le handler ne doit avoir tourné qu\'une seule fois malgré les deux appels');
});

test('withSubmitGuard() : transmet les arguments et la valeur de retour du handler', async () => {
  const ctx = buildContext();
  const btn = stubElement();
  const guarded = ctx.withSubmitGuard(btn, async (a, b) => a + b);
  const result = await guarded(2, 3);
  assert.strictEqual(result, 5);
});

module.exports = run('submit-guard.test.js');
