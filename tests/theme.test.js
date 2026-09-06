// --- Tests du thème clair en option (js/ui.js) ---
// Retour utilisateur : "Thème clair en option" — sombre par défaut, un
// simple bouton l'active/le désactive, jamais de suivi automatique du
// système. getTheme()/setTheme() suivent le même principe que
// getViewMode()/setViewMode() (grille/liste) : préférence PAR APPAREIL
// (localStorage), jamais synchronisée à Supabase.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument, stubElement, fakeLocalStorage } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const toggle = stubElement({ checked: false });
  const html = stubElement();
  const doc = stubDocument({ lightThemeToggle: toggle });
  doc.documentElement = html;
  const ctx = createContext({ document: doc, localStorage: fakeLocalStorage() });
  loadFiles(ctx, ['js/ui.js']);
  return { ctx, toggle, html };
}

test('getTheme() : "dark" par défaut (aucune préférence enregistrée)', () => {
  const { ctx } = buildContext();
  assert.strictEqual(ctx.getTheme(), 'dark');
});

test('getTheme() : relit "light" une fois enregistré, ignore toute autre valeur', () => {
  const { ctx } = buildContext();
  ctx.setTheme('light');
  assert.strictEqual(ctx.getTheme(), 'light');
  ctx.setTheme('n\'importe quoi');
  assert.strictEqual(ctx.getTheme(), 'dark', 'toute valeur qui n\'est pas exactement "light" retombe sur "dark"');
});

test('setTheme() : pose data-theme sur <html> (document.documentElement), pas sur <body>', () => {
  const { ctx, html } = buildContext();
  ctx.setTheme('light');
  assert.strictEqual(html.dataset.theme, 'light');
});

test('setTheme() : synchronise la case à cocher du profil (#lightThemeToggle)', () => {
  const { ctx, toggle } = buildContext();
  ctx.setTheme('light');
  assert.strictEqual(toggle.checked, true);
  ctx.setTheme('dark');
  assert.strictEqual(toggle.checked, false);
});

test('setTheme() : appelée automatiquement au chargement avec la préférence déjà enregistrée', () => {
  // Un deuxième contexte, avec localStorage pré-rempli AVANT le chargement
  // du fichier (setTheme(getTheme()) tourne dès le chargement de js/ui.js,
  // comme setViewMode(getViewMode()) juste au-dessus dans le même fichier).
  const toggle = stubElement({ checked: false });
  const html = stubElement();
  const doc = stubDocument({ lightThemeToggle: toggle });
  doc.documentElement = html;
  const storage = fakeLocalStorage();
  storage.setItem('kinetTheme', 'light');
  const ctx = createContext({ document: doc, localStorage: storage });
  loadFiles(ctx, ['js/ui.js']);
  assert.strictEqual(html.dataset.theme, 'light');
  assert.strictEqual(toggle.checked, true);
});

module.exports = run('theme.test.js');
