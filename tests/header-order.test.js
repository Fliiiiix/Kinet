// --- Tests de l'ordre personnalisable des icônes de l'entête (js/ui.js) ---
// Retour utilisateur : "Personnaliser l'ordre des icônes de l'entête" —
// préférence PAR APPAREIL (localStorage, comme kinetViewMode/kinetTheme),
// appliquée en déplaçant (appendChild, pas clone) les boutons déjà dans le
// DOM — jamais leurs listeners à reposer. installHeaderBtn (PWA) exclu
// délibérément de la liste réordonnable.
//
// Réglage par glisser-déposer (retour utilisateur : "en prenant les
// icônes avec clic + maintien souris", pas des boutons ↑/↓), voir
// wireHeaderOrderDrag(). Ce que ces tests NE vérifient PAS : le
// repositionnement pendant pointermove lui-même — il dépend de
// getBoundingClientRect() sur les voisins, une vraie géométrie de layout
// que le harnais vm ne simule pas. Ce qui EST vérifié : le point réellement
// risqué du code, "l'ordre final enregistré au relâchement est bien celui
// du DOM à cet instant" — en simulant un glisser déjà effectué via un
// insertBefore() direct (ce que pointermove ferait lui-même une fois la
// géométrie en jeu), puis en relâchant.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument, stubElement, stubEventTarget, fakeLocalStorage } = require('./helpers/vm-harness');
const { test, run } = createSuite();

const ALL_IDS = ['globalSearchBtn', 'watchlistBtn', 'upcomingBtn', 'friendsBtn', 'topBtn', 'feedbackBtn', 'changelogBtn'];

// classList réel (Set), même recette que stubElementWithRealClassList()
// dans pull-to-refresh.test.js — nécessaire ici : on vérifie que
// pointerdown/pointerup posent/retirent bien la classe "dragging".
function realClassList(){
  const classes = new Set();
  return {
    add: (c) => classes.add(c),
    remove: (c) => classes.delete(c),
    contains: (c) => classes.has(c),
  };
}

function makeItem(id){
  return Object.assign(stubEventTarget(), {
    dataset: { id },
    classList: realClassList(),
    setPointerCapture(){},
    getBoundingClientRect(){ return { top: 0, height: 40 }; }, // jamais lue par les tests ci-dessous (pas de pointermove déclenché)
  });
}

// Conteneur "DOM" minimal qui garde une vraie liste ordonnée d'items —
// insertBefore()/appendChild() la mutent pour de vrai, comme le ferait un
// vrai navigateur, pour pouvoir relire l'ordre final au relâchement.
function makeWrap(itemIds){
  let children = itemIds.map(makeItem);
  return Object.assign(stubEventTarget(), {
    querySelectorAll(sel){
      if(sel === '.header-order-dnd-item:not(.dragging)') return children.filter(c => !c.classList.contains('dragging'));
      return children.slice();
    },
    insertBefore(el, ref){
      children = children.filter(c => c !== el);
      children.splice(children.indexOf(ref), 0, el);
    },
    appendChild(el){
      children = children.filter(c => c !== el);
      children.push(el);
    },
  });
}

function buildContext(){
  const buttons = {};
  ALL_IDS.forEach(id => { buttons[id] = stubElement({ querySelector: () => stubElement({ outerHTML: `<span class="nav-pip">${id}</span>` }) }); });
  const appended = [];
  const nav = stubElement({ appendChild(el){ appended.push(el.__id); } });
  ALL_IDS.forEach(id => { buttons[id].__id = id; });
  const dndList = stubElement();
  const doc = stubDocument(Object.assign({ headerOrderDndList: dndList }, buttons));
  doc.querySelector = (sel) => (sel === '.header-nav' ? nav : null);
  const ctx = createContext({
    document: doc,
    localStorage: fakeLocalStorage(),
    escapeHtml(s){ return s; },
    closeProfileModal(){}, openProfileModal(){}, openOverlay(){}, closeOverlay(){},
  });
  loadFiles(ctx, ['js/ui.js']);
  return { ctx, appended, dndList };
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

test('renderHeaderOrderList() : une ligne par bouton, avec sa poignée et son libellé', () => {
  const { ctx, dndList } = buildContext();
  ctx.renderHeaderOrderList();
  assert.strictEqual((dndList.innerHTML.match(/header-order-dnd-item"/g) || []).length, 7);
  assert.ok(dndList.innerHTML.includes('header-order-drag-handle'));
  assert.ok(dndList.innerHTML.includes('À voir'), 'le libellé du bouton doit apparaître');
  assert.ok(dndList.innerHTML.includes('nav-pip'), 'l\'icône du vrai bouton d\'entête doit être réutilisée');
});

test('wireHeaderOrderDrag() : pointerdown pose .dragging, pointerup le retire et enregistre l\'ordre (inchangé si rien n\'a bougé)', () => {
  const { ctx } = buildContext();
  const wrap = makeWrap(ALL_IDS);
  ctx.wireHeaderOrderDrag(wrap);
  const item = wrap.querySelectorAll('.header-order-dnd-item')[0];
  item.dispatch('pointerdown', { pointerId: 1 });
  assert.ok(item.classList.contains('dragging'));
  wrap.dispatch('pointerup', {});
  assert.ok(!item.classList.contains('dragging'));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.getHeaderNavOrder())), ALL_IDS);
});

test('wireHeaderOrderDrag() : l\'ordre enregistré au relâchement est celui du DOM à cet instant (glisser simulé)', () => {
  const { ctx } = buildContext();
  const wrap = makeWrap(ALL_IDS);
  ctx.wireHeaderOrderDrag(wrap);
  const items = wrap.querySelectorAll('.header-order-dnd-item');
  const dragged = items.find(i => i.dataset.id === 'topBtn');
  const target = items.find(i => i.dataset.id === 'globalSearchBtn');
  dragged.dispatch('pointerdown', { pointerId: 1 });
  // Simule ce que pointermove aurait fait une fois le pointeur passé
  // au-dessus du milieu de "globalSearchBtn" (géométrie non simulée ici,
  // voir le commentaire en tête de fichier) : topBtn inséré juste avant.
  wrap.insertBefore(dragged, target);
  wrap.dispatch('pointerup', {});
  const order = JSON.parse(JSON.stringify(ctx.getHeaderNavOrder()));
  assert.strictEqual(order[0], 'topBtn');
  assert.strictEqual(order[1], 'globalSearchBtn');
});

test('wireHeaderOrderDrag() : pointercancel termine le glisser comme pointerup (jamais bloqué en mode "dragging")', () => {
  const { ctx } = buildContext();
  const wrap = makeWrap(ALL_IDS);
  ctx.wireHeaderOrderDrag(wrap);
  const item = wrap.querySelectorAll('.header-order-dnd-item')[0];
  item.dispatch('pointerdown', { pointerId: 1 });
  wrap.dispatch('pointercancel', {});
  assert.ok(!item.classList.contains('dragging'));
});

module.exports = run('header-order.test.js');
