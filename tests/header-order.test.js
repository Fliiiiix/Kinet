// --- Tests de l'ordre personnalisable des icônes de l'entête (js/ui.js) ---
// Retour utilisateur : "Personnaliser l'ordre des icônes de l'entête" —
// préférence PAR APPAREIL (localStorage, comme kinetViewMode/kinetTheme),
// appliquée en déplaçant (appendChild, pas clone) les boutons déjà dans le
// DOM — jamais leurs listeners à reposer. installHeaderBtn (PWA) exclu
// délibérément de la liste réordonnable.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument, stubElement, fakeLocalStorage } = require('./helpers/vm-harness');
const { test, run } = createSuite();

const ALL_IDS = ['globalSearchBtn', 'watchlistBtn', 'upcomingBtn', 'friendsBtn', 'topBtn', 'feedbackBtn', 'changelogBtn'];

function buildContext(){
  const buttons = {};
  ALL_IDS.forEach(id => { buttons[id] = stubElement(); });
  const appended = [];
  const nav = stubElement({ appendChild(el){ appended.push(el.__id); } });
  // Chaque bouton mémorise son propre id pour qu'appendChild() (au-dessus)
  // puisse tracer l'ordre réel dans lequel applyHeaderNavOrder() les
  // redéplace, sans avoir besoin d'un vrai DOM.
  ALL_IDS.forEach(id => { buttons[id].__id = id; });
  const picker = stubElement();
  const elements = Object.assign({ headerOrderPicker: picker }, buttons);
  const doc = stubDocument(elements);
  doc.querySelector = (sel) => (sel === '.header-nav' ? nav : null);
  const ctx = createContext({
    document: doc,
    localStorage: fakeLocalStorage(),
    escapeHtml(s){ return s; },
  });
  loadFiles(ctx, ['js/ui.js']);
  return { ctx, appended, picker };
}

test('getHeaderNavOrder() : ordre par défaut si rien n\'est enregistré', () => {
  const { ctx } = buildContext();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.getHeaderNavOrder())), ALL_IDS);
});

test('getHeaderNavOrder() : relit un ordre personnalisé enregistré', () => {
  const { ctx } = buildContext();
  const custom = ['topBtn', 'globalSearchBtn', 'watchlistBtn', 'upcomingBtn', 'friendsBtn', 'feedbackBtn', 'changelogBtn'];
  ctx.saveHeaderNavOrder(custom);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.getHeaderNavOrder())), custom);
});

test('getHeaderNavOrder() : un id obsolète est filtré, un id manquant est rajouté à la fin', () => {
  const { ctx } = buildContext();
  ctx.localStorage.setItem('kinetHeaderOrder', JSON.stringify(['topBtn', 'idQuiNexistePlus', 'watchlistBtn']));
  const order = JSON.parse(JSON.stringify(ctx.getHeaderNavOrder()));
  assert.ok(!order.includes('idQuiNexistePlus'));
  assert.deepStrictEqual(order.slice(0, 2), ['topBtn', 'watchlistBtn']);
  assert.deepStrictEqual(new Set(order), new Set(ALL_IDS), 'tous les vrais boutons doivent être présents, aucun perdu');
});

test('applyHeaderNavOrder() : déplace les boutons (.header-nav) dans l\'ordre enregistré', () => {
  const { ctx, appended } = buildContext();
  ctx.saveHeaderNavOrder(['changelogBtn', 'globalSearchBtn', 'watchlistBtn', 'upcomingBtn', 'friendsBtn', 'topBtn', 'feedbackBtn']);
  assert.deepStrictEqual(appended.slice(-7), ['changelogBtn', 'globalSearchBtn', 'watchlistBtn', 'upcomingBtn', 'friendsBtn', 'topBtn', 'feedbackBtn']);
});

test('moveHeaderNavItem() : échange avec le voisin, ignore un déplacement hors bornes', () => {
  const { ctx } = buildContext();
  ctx.moveHeaderNavItem('watchlistBtn', -1); // 2e élément -> monte en 1er
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.getHeaderNavOrder())).slice(0, 2), ['watchlistBtn', 'globalSearchBtn']);
  // Le premier élément ne peut pas monter davantage -> aucun changement.
  const before = JSON.parse(JSON.stringify(ctx.getHeaderNavOrder()));
  ctx.moveHeaderNavItem('watchlistBtn', -1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.getHeaderNavOrder())), before);
});

test('renderHeaderOrderPicker() : une ligne par bouton, ↑ désactivé en tête, ↓ désactivé en queue', () => {
  const { ctx, picker } = buildContext();
  ctx.renderHeaderOrderPicker();
  assert.strictEqual((picker.innerHTML.match(/top-film-chip"/g) || []).length, 7);
  const firstChipIdx = picker.innerHTML.indexOf('data-id="globalSearchBtn"');
  const firstChipSlice = picker.innerHTML.slice(firstChipIdx, firstChipIdx + 400);
  assert.ok(/data-move="up"[^>]*disabled/.test(firstChipSlice), 'premier bouton -> ↑ désactivé');
});

module.exports = run('header-order.test.js');
