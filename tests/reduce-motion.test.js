// --- Tests de "Réduire les animations" (js/ui.js) ---
// Retour utilisateur (Paramètres, proposition validée sur draft) : un
// réglage DANS Kinet, en plus du système déjà respecté partout ailleurs
// (prefers-reduced-motion) — même principe que getTheme()/setTheme()
// (tests/theme.test.js) : préférence PAR APPAREIL (localStorage), jamais
// synchronisée à Supabase.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument, stubElement, fakeLocalStorage } = require('./helpers/vm-harness');
const { test, run } = createSuite();

// classList réel (Set), même recette qu'ailleurs dans ce projet — nécessaire
// ici : setReduceMotion() pose/retire "reduce-motion" sur <html>, un
// classList no-op ne laisserait rien à vérifier après coup.
function realClassList(){
  const classes = new Set();
  return {
    add: (c) => classes.add(c),
    remove: (c) => classes.delete(c),
    toggle(c, force){ if(force === undefined) force = !classes.has(c); if(force) classes.add(c); else classes.delete(c); },
    contains: (c) => classes.has(c),
  };
}

function buildContext(){
  const toggle = stubElement({ checked: false });
  const html = stubElement({ classList: realClassList() });
  const doc = stubDocument({ lightThemeToggle: stubElement(), reduceMotionToggle: toggle });
  doc.documentElement = html;
  const ctx = createContext({ document: doc, localStorage: fakeLocalStorage() });
  loadFiles(ctx, ['js/ui.js']);
  return { ctx, toggle, html };
}

test('getReduceMotion() : false par défaut (aucune préférence enregistrée)', () => {
  const { ctx } = buildContext();
  assert.strictEqual(ctx.getReduceMotion(), false);
});

test('getReduceMotion() : relit true une fois enregistré', () => {
  const { ctx } = buildContext();
  ctx.setReduceMotion(true);
  assert.strictEqual(ctx.getReduceMotion(), true);
  ctx.setReduceMotion(false);
  assert.strictEqual(ctx.getReduceMotion(), false);
});

test('setReduceMotion(true) : pose la classe "reduce-motion" sur <html>, jamais sur <body>', () => {
  const { ctx, html } = buildContext();
  ctx.setReduceMotion(true);
  assert.ok(html.classList.contains('reduce-motion'));
});

test('setReduceMotion(false) : retire la classe', () => {
  const { ctx, html } = buildContext();
  ctx.setReduceMotion(true);
  ctx.setReduceMotion(false);
  assert.ok(!html.classList.contains('reduce-motion'));
});

test('setReduceMotion() : synchronise la case à cocher de Paramètres (#reduceMotionToggle)', () => {
  const { ctx, toggle } = buildContext();
  ctx.setReduceMotion(true);
  assert.strictEqual(toggle.checked, true);
  ctx.setReduceMotion(false);
  assert.strictEqual(toggle.checked, false);
});

test('setReduceMotion() : appelée automatiquement au chargement avec la préférence déjà enregistrée', () => {
  const toggle = stubElement({ checked: false });
  const html = stubElement({ classList: realClassList() });
  const doc = stubDocument({ lightThemeToggle: stubElement(), reduceMotionToggle: toggle });
  doc.documentElement = html;
  const storage = fakeLocalStorage();
  storage.setItem('kinetReduceMotion', '1');
  const ctx = createContext({ document: doc, localStorage: storage });
  loadFiles(ctx, ['js/ui.js']);
  assert.ok(html.classList.contains('reduce-motion'));
  assert.strictEqual(toggle.checked, true);
});

module.exports = run('reduce-motion.test.js');
