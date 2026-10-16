// --- Tests de l'échappement du HTML (js/app.js, js/friends.js) ---
// Audit général du 16/10 : l'ancienne escapeHtml() (textContent puis
// innerHTML) laissait passer les guillemets. Un pseudo comme
// `Sam" onload="…` sortait de l'attribut alt de l'avatar et ajoutait le sien,
// exécuté chez tous les amis qui l'affichent.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const ctx = createContext({ document: stubDocument() });
  loadFiles(ctx, ['js/app.js']);
  return ctx;
}

test('escapeHtml() échappe les cinq caractères dangereux', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.escapeHtml(`<b>"Tom" & 'Jerry'</b>`), '&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;');
});

test('escapeHtml() : rien pour null et undefined, texte pour un nombre', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.escapeHtml(null), '');
  assert.strictEqual(ctx.escapeHtml(undefined), '');
  assert.strictEqual(ctx.escapeHtml(4.5), '4.5');
});

test('un pseudo avec guillemets ne sort plus de l’attribut de l’avatar', () => {
  const ctx = buildContext();
  const realEscape = ctx.escapeHtml;
  Object.assign(ctx, { uiIcon: () => '', goToAmis(){}, goToGroups(){}, goToLists(){}, goToFilmDetail(){}, goToPublicProfile(){}, goHome(){} });
  loadFiles(ctx, ['js/friends.js']);
  ctx.escapeHtml = realEscape;
  ctx.cacheProfile('u1', 'Sam" onload="alert(1)', 'https://image.tmdb.org/a.jpg" onerror="alert(2)');
  const html = ctx.friendAvatarHtml('u1', ctx.friendDisplayName('u1'));
  // Un attribut ajouté commencerait par « " onload=" » : il n'y en a plus.
  assert.ok(!html.includes('" onload="') && !html.includes('" onerror="'), html);
  assert.ok(html.includes('alt="Sam&quot; onload=&quot;alert(1)"'), html);
});

module.exports = run('escape-html.test.js');
