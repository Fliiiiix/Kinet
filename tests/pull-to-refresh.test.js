// --- Tests du geste de rafraîchissement façon app native (js/ui.js) ---
// Retour utilisateur : tirer vers le bas en haut d'une page recharge ses
// données. Ne peut pas être vérifié en direct dans un vrai navigateur
// desktop (aucun écran tactile ici, 'ontouchstart' absent de window) —
// testé hors-ligne à la place, avec des touchstart/touchmove/touchend
// simulés via stubEventTarget() (vm-harness.js), qui stocke vraiment les
// handlers plutôt que d'être un no-op comme les autres stubs.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubElement, stubEventTarget } = require('./helpers/vm-harness');
const { test, run } = createSuite();

// classList réel (Set) plutôt que le stub no-op de stubElement() (toggle()
// ne fait rien, contains() renvoie toujours false) — nécessaire ici :
// touchend décide de rafraîchir ou non en LISANT classList.contains('ready'),
// posé par touchmove un peu plus tôt dans le même geste.
function stubElementWithRealClassList(){
  const classes = new Set();
  return stubElement({
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => { (force === undefined ? !classes.has(c) : force) ? classes.add(c) : classes.delete(c); },
      contains: (c) => classes.has(c),
    },
  });
}

function buildContext({ scrollY = 0, overlayOpen = false } = {}){
  const pullIndicator = stubElementWithRealClassList();
  const eventTarget = stubEventTarget();
  const refreshCalls = [];
  const doc = Object.assign(eventTarget, {
    getElementById: (id) => (id === 'pullRefreshIndicator' ? pullIndicator : stubElement()),
    querySelector: (sel) => (sel === '.overlay.open' && overlayOpen ? stubElement() : null),
    querySelectorAll(){ return []; },
    createElement(){ return stubElement(); },
    body: stubElement(),
  });
  const ctx = createContext({
    document: doc,
    // 'ontouchstart' in window doit être vrai pour que js/ui.js câble le
    // geste — une simple présence de la clé suffit, peu importe sa valeur.
    window: { addEventListener(){}, removeEventListener(){}, matchMedia: () => ({ matches: false, addEventListener(){} }), scrollY, ontouchstart: null },
    location: { hash: '#/watchlist' },
    loadFilms(){ return Promise.resolve(); },
    loadViewings(){ return Promise.resolve(); },
    buildGenreFilterOptions(){},
    render(){},
    renderRoute(){ refreshCalls.push('renderRoute'); return Promise.resolve(); },
  });
  loadFiles(ctx, ['js/ui.js']);
  return { ctx, pullIndicator, doc, refreshCalls };
}

function touch(y){
  return { touches: [{ clientY: y }] };
}

test('geste complet : tirer au-delà du seuil puis relâcher déclenche refreshCurrentPage()', async () => {
  const { doc, refreshCalls } = buildContext({ scrollY: 0 });
  doc.dispatch('touchstart', { target: { closest: () => null }, touches: [{ clientY: 100 }] });
  doc.dispatch('touchmove', touch(200)); // delta 100 > seuil 70
  doc.dispatch('touchend', {}); // le handler réel est async — dispatch() lance son exécution sans l'attendre
  // Laisse le temps à l'await refreshCurrentPage() (interne au handler) de se résoudre.
  await new Promise(r => setTimeout(r, 20));
  assert.deepStrictEqual(refreshCalls, ['renderRoute'], 'un tirer au-delà du seuil doit recharger la page courante');
});

test('ne se déclenche pas si on n\'est pas tout en haut de la page (scrollY > 0)', () => {
  const { doc } = buildContext({ scrollY: 50 });
  let started = false;
  // touchstart avec scrollY > 0 : pulling ne doit jamais s'activer — on le
  // vérifie indirectement via un touchmove qui, sans pulling actif, ne doit
  // rien tenter (pas d'exception, aucun état modifié).
  assert.doesNotThrow(() => {
    doc.dispatch('touchstart', { target: { closest: () => null }, touches: [{ clientY: 100 }] });
    doc.dispatch('touchmove', touch(300));
    doc.dispatch('touchend', {});
  });
});

test('ne vole pas le geste à un contrôle interactif (slider, input...)', () => {
  const { doc, refreshCalls } = buildContext({ scrollY: 0 });
  // e.target.closest('input, textarea, select, button, a, [role="button"]')
  // renvoie un élément -> le geste ne doit jamais démarrer.
  doc.dispatch('touchstart', { target: { closest: () => stubElement() }, touches: [{ clientY: 100 }] });
  doc.dispatch('touchmove', touch(250));
  doc.dispatch('touchend', {});
  assert.deepStrictEqual(refreshCalls, [], 'aucun rafraîchissement déclenché depuis un contrôle interactif');
});

test('ne se déclenche pas si une modale est ouverte (son propre scroll interne)', () => {
  const { doc, refreshCalls } = buildContext({ scrollY: 0, overlayOpen: true });
  doc.dispatch('touchstart', { target: { closest: () => null }, touches: [{ clientY: 100 }] });
  doc.dispatch('touchmove', touch(250));
  doc.dispatch('touchend', {});
  assert.deepStrictEqual(refreshCalls, [], 'aucun rafraîchissement déclenché pendant qu\'une modale est ouverte');
});

test('un tirer trop court (sous le seuil) ne déclenche rien au relâchement', async () => {
  const { doc, refreshCalls } = buildContext({ scrollY: 0 });
  doc.dispatch('touchstart', { target: { closest: () => null }, touches: [{ clientY: 100 }] });
  doc.dispatch('touchmove', touch(130)); // delta 30 < seuil 70
  doc.dispatch('touchend', {});
  await new Promise(r => setTimeout(r, 0));
  assert.deepStrictEqual(refreshCalls, [], 'un tirer sous le seuil ne doit pas recharger la page');
});

test('refreshCurrentPage() sur le catalogue (hash vide) recharge films/viewings plutôt que renderRoute()', async () => {
  const pullIndicator = stubElement();
  const eventTarget = stubEventTarget();
  const doc = Object.assign(eventTarget, {
    getElementById: (id) => (id === 'pullRefreshIndicator' ? pullIndicator : stubElement()),
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    createElement(){ return stubElement(); },
    body: stubElement(),
  });
  const calls = [];
  const ctx = createContext({
    document: doc,
    window: { addEventListener(){}, removeEventListener(){}, matchMedia: () => ({ matches: false, addEventListener(){} }), scrollY: 0, ontouchstart: null },
    location: { hash: '' }, // catalogue : cas spécial de refreshCurrentPage()
    loadFilms(){ calls.push('loadFilms'); return Promise.resolve(); },
    loadViewings(){ calls.push('loadViewings'); return Promise.resolve(); },
    buildGenreFilterOptions(){ calls.push('buildGenreFilterOptions'); },
    render(){ calls.push('render'); },
    renderRoute(){ calls.push('renderRoute'); return Promise.resolve(); },
  });
  loadFiles(ctx, ['js/ui.js']);
  await ctx.refreshCurrentPage();
  assert.ok(calls.includes('loadFilms') && calls.includes('loadViewings') && calls.includes('render'), 'le catalogue doit recharger films/viewings, pas juste re-render');
  assert.ok(!calls.includes('renderRoute'), 'renderRoute() ne doit pas être appelée pour le catalogue (elle ne rechargerait rien, voir resetHomeView())');
});

module.exports = run('pull-to-refresh.test.js');
