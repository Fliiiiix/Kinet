// --- Tests du profil partagé (js/publicProfile.js, piste A du 15/10) ---
// Un visiteur sans compte voit « Rejoindre Kinet » ; connecté, on propose
// d'ajouter en ami ; sur son propre profil ou entre amis, rien à proposer.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument, fakeLocalStorage } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const ctx = createContext({
    document: stubDocument(),
    localStorage: fakeLocalStorage(),
    escapeHtml(s){ return String(s); }, goHome(){}, showAuthScreen(){},
  });
  loadFiles(ctx, ['js/publicProfile.js']);
  return ctx;
}

test('résumé : nombre de films notés et note moyenne', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.publicProfileSummary([{ note: 4 }, { note: 3 }, { note: null }]), '3 films notés · note moyenne 3.5');
  assert.strictEqual(ctx.publicProfileSummary([]), '0 film noté');
});

test('visiteur sans compte : « Rejoindre Kinet », l\'ami est promis', () => {
  const ctx = buildContext();
  const html = ctx.publicProfileActionHtml('u1', 'Flix', 'visitor');
  assert.ok(html.includes('Rejoindre Kinet'));
  assert.ok(html.includes('Flix sera déjà dans tes amis'));
});

test('connecté sans lien d\'amitié : « Ajouter en ami » ; soi-même ou ami : pas d\'invitation', () => {
  const ctx = buildContext();
  assert.ok(ctx.publicProfileActionHtml('u1', 'Flix', 'stranger').includes('Ajouter en ami'));
  assert.ok(!ctx.publicProfileActionHtml('u1', 'Flix', 'self').includes('btn'));
  assert.strictEqual(ctx.publicProfileActionHtml('u1', 'Flix', 'friend'), '');
});

test('« Rejoindre Kinet » retient le profil pour après l\'inscription', () => {
  const ctx = buildContext();
  ctx.rememberProfileInvite('u1');
  assert.strictEqual(ctx.localStorage.getItem('kinetProfileInvite'), 'u1');
});

module.exports = run('public-profile.test.js');
