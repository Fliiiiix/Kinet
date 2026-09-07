// --- Tests de l'ordre personnalisable des icônes de l'entête (js/ui.js) ---
// Retour utilisateur : "Personnaliser l'ordre des icônes de l'entête" —
// préférence PAR APPAREIL (localStorage, comme kinetViewMode/kinetTheme),
// appliquée en déplaçant (appendChild, pas clone) les boutons déjà dans le
// DOM — jamais leurs listeners à reposer. installHeaderBtn (PWA) exclu
// délibérément de la liste réordonnable.
//
// Édition EN PLACE (retour utilisateur : "si on clique dessus on revient
// sur la page d'accueil sauf que cette fois on peut modifier les icones",
// avec un indicateur pour comprendre qu'il faut les sélectionner/
// déplacer) — plus de liste séparée à part : enterHeaderEditMode()/
// exitHeaderEditMode() posent/retirent .edit-mode sur .header-nav
// (indicateur visuel, en tremblement, voir css/style.css), et le
// glisser-déposer (wireHeaderNavDrag()) agit directement sur les VRAIS
// .header-nav-btn. Ce que ces tests NE vérifient PAS : le repositionnement
// pendant pointermove lui-même — il dépend de getBoundingClientRect() sur
// les voisins, une vraie géométrie de layout que le harnais vm ne simule
// pas. Ce qui EST vérifié : les points réellement risqués du code — "hors
// édition, un pointerdown/clic ne fait jamais rien", "l'ordre final
// enregistré au relâchement est bien celui du DOM à cet instant" (en
// simulant un glisser déjà effectué via un insertBefore() direct, ce que
// pointermove ferait lui-même une fois la géométrie en jeu), "installHeaderBtn
// n'est jamais draggable ni inclus dans l'ordre enregistré", et "un clic
// pendant l'édition est bloqué (jamais de navigation accidentelle)".
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument, stubElement, stubEventTarget, fakeLocalStorage } = require('./helpers/vm-harness');
const { test, run } = createSuite();

const ALL_IDS = ['globalSearchBtn', 'watchlistBtn', 'upcomingBtn', 'friendsBtn', 'topBtn', 'feedbackBtn', 'changelogBtn'];

// classList réel (Set), même recette que stubElementWithRealClassList()
// dans pull-to-refresh.test.js — nécessaire ici : on vérifie que
// pointerdown/pointerup posent/retirent bien la classe "dragging", et que
// enterHeaderEditMode()/exitHeaderEditMode() posent/retirent "edit-mode".
function realClassList(){
  const classes = new Set();
  return {
    add: (c) => classes.add(c),
    remove: (c) => classes.delete(c),
    contains: (c) => classes.has(c),
  };
}

// style/cloneNode/remove/removeAttribute/setAttribute : nécessaires depuis
// que pointerdown crée un "ghost" (clone en position:fixed qui suit le
// pointeur, retour utilisateur — "je dois pouvoir une fois prise la
// déplacer librement", voir wireHeaderNavDrag() dans js/ui.js). Ces tests
// ne vérifient PAS le positionnement du ghost lui-même (géométrie de
// layout, même limite documentée en tête de fichier) — seulement que
// pointerdown/pointerup ne plantent plus maintenant qu'ils manipulent ces
// méthodes en plus de classList/dataset.
function makeItem(id){
  const item = Object.assign(stubEventTarget(), {
    id,
    dataset: { id },
    classList: realClassList(),
    style: {},
    setPointerCapture(){},
    getBoundingClientRect(){ return { left: 0, top: 0, width: 40, height: 40 }; }, // jamais lue pour la géométrie par les tests ci-dessous (pas de pointermove déclenché)
    closest(sel){
      if(sel === '.header-nav-btn') return this;
      if(sel === '#installHeaderBtn') return this.id === 'installHeaderBtn' ? this : null;
      return null;
    },
    cloneNode(){ return makeItem(id); },
    remove(){},
    removeAttribute(){},
    setAttribute(){},
  });
  return item;
}

// Conteneur "DOM" minimal représentant .header-nav — garde une vraie liste
// ordonnée d'items (7 icônes réordonnables + installHeaderBtn, comme dans
// index.html) — insertBefore()/appendChild() la mutent pour de vrai, comme
// le ferait un vrai navigateur, pour pouvoir relire l'ordre final au
// relâchement. Hérite de stubEventTarget() : addEventListener/dispatch
// réels, nécessaires pour rejouer pointerdown/pointermove/pointerup/
// pointercancel/click comme un vrai geste.
function makeNav(itemIds){
  let children = itemIds.map(makeItem);
  children.splice(5, 0, makeItem('installHeaderBtn')); // même position relative que index.html (entre feedbackBtn et changelogBtn)
  return Object.assign(stubEventTarget(), {
    classList: realClassList(),
    querySelectorAll(sel){
      if(sel === '.header-nav-btn:not(.dragging)') return children.filter(c => !c.classList.contains('dragging'));
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
  const nav = stubElement({ appendChild(el){ appended.push(el.__id); }, classList: realClassList() });
  ALL_IDS.forEach(id => { buttons[id].__id = id; });
  const doc = stubDocument(buttons);
  doc.querySelector = (sel) => (sel === '.header-nav' ? nav : null);
  const closeProfileModalCalls = [];
  const goHomeCalls = [];
  const banner = stubElement();
  doc.getElementById = (id) => {
    if(id === 'headerEditBanner') return banner;
    return buttons[id] || stubElement();
  };
  const ctx = createContext({
    document: doc,
    localStorage: fakeLocalStorage(),
    escapeHtml(s){ return s; },
    closeProfileModal(){ closeProfileModalCalls.push(true); },
    openProfileModal(){}, openOverlay(){}, closeOverlay(){},
    goHome(){ goHomeCalls.push(true); },
  });
  loadFiles(ctx, ['js/ui.js']);
  return { ctx, appended, nav, banner, closeProfileModalCalls, goHomeCalls };
}

// buildContext() ci-dessus sert getHeaderNavOrder()/applyHeaderNavOrder()/
// enterHeaderEditMode() (nav minimaliste, sans querySelectorAll réel) ; les
// tests de glisser-déposer ci-dessous construisent leur propre nav réel
// (makeNav()) via un contexte dédié, wireHeaderNavDrag() s'y attachant au
// chargement de js/ui.js.
function buildDragContext(){
  const nav = makeNav(ALL_IDS);
  const closeProfileModalCalls = [];
  const goHomeCalls = [];
  const banner = stubElement();
  const doc = stubDocument();
  doc.querySelector = (sel) => (sel === '.header-nav' ? nav : null);
  // Résout les ids vers les VRAIS items de nav (pas un stub jetable) —
  // applyHeaderNavOrder(), appelée au chargement de js/ui.js, doit
  // retrouver les mêmes objets que ceux déjà dans nav.children pour que
  // ses appendChild() réordonnent réellement plutôt que d'en injecter des
  // doublons fantômes.
  doc.getElementById = (id) => {
    if(id === 'headerEditBanner') return banner;
    return nav.querySelectorAll('.header-nav-btn').find(el => el.id === id) || stubElement();
  };
  // Suit les ghosts (retour utilisateur : "je dois pouvoir une fois prise
  // la déplacer librement" — clone en position:fixed qui suit le pointeur,
  // ajouté à document.body au pointerdown, retiré au relâchement, voir
  // wireHeaderNavDrag() dans js/ui.js) sans dupliquer le nav réel.
  const bodyAppended = [];
  doc.body = stubElement({ appendChild(el){ bodyAppended.push(el); } });
  const ctx = createContext({
    document: doc,
    localStorage: fakeLocalStorage(),
    escapeHtml(s){ return s; },
    closeProfileModal(){ closeProfileModalCalls.push(true); },
    openProfileModal(){}, openOverlay(){}, closeOverlay(){},
    goHome(){ goHomeCalls.push(true); },
  });
  loadFiles(ctx, ['js/ui.js']);
  return { ctx, nav, banner, closeProfileModalCalls, goHomeCalls, bodyAppended };
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

test('enterHeaderEditMode() : referme le profil, ramène sur l\'accueil, active .edit-mode et le bandeau', () => {
  const { ctx, nav, banner, closeProfileModalCalls, goHomeCalls } = buildContext();
  ctx.enterHeaderEditMode();
  assert.strictEqual(closeProfileModalCalls.length, 1);
  assert.strictEqual(goHomeCalls.length, 1);
  assert.ok(nav.classList.contains('edit-mode'));
  assert.strictEqual(banner.style.display, '');
});

test('exitHeaderEditMode() : retire .edit-mode et masque le bandeau', () => {
  const { ctx, nav, banner } = buildContext();
  ctx.enterHeaderEditMode();
  ctx.exitHeaderEditMode();
  assert.ok(!nav.classList.contains('edit-mode'));
  assert.strictEqual(banner.style.display, 'none');
});

test('wireHeaderNavDrag() : hors édition, pointerdown sur une icône ne démarre aucun glisser', () => {
  const { ctx, nav } = buildDragContext();
  const item = nav.querySelectorAll('.header-nav-btn:not(.dragging)')[0];
  nav.dispatch('pointerdown', { pointerId: 1, target: item });
  assert.ok(!item.classList.contains('dragging'));
});

test('wireHeaderNavDrag() : en édition, pointerdown pose .dragging, pointerup le retire et enregistre l\'ordre (inchangé si rien n\'a bougé)', () => {
  const { ctx, nav } = buildDragContext();
  ctx.enterHeaderEditMode();
  const item = nav.querySelectorAll('.header-nav-btn:not(.dragging)').find(el => el.id === ALL_IDS[0]);
  nav.dispatch('pointerdown', { pointerId: 1, target: item });
  assert.ok(item.classList.contains('dragging'));
  nav.dispatch('pointerup', {});
  assert.ok(!item.classList.contains('dragging'));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.getHeaderNavOrder())), ALL_IDS);
});

test('wireHeaderNavDrag() : l\'ordre enregistré au relâchement est celui du DOM à cet instant (glisser simulé)', () => {
  const { ctx, nav } = buildDragContext();
  ctx.enterHeaderEditMode();
  const items = nav.querySelectorAll('.header-nav-btn:not(.dragging)');
  const dragged = items.find(i => i.id === 'topBtn');
  const target = items.find(i => i.id === 'globalSearchBtn');
  nav.dispatch('pointerdown', { pointerId: 1, target: dragged });
  // Simule ce que pointermove aurait fait une fois le pointeur passé
  // au-dessus du milieu de "globalSearchBtn" (géométrie non simulée ici,
  // voir le commentaire en tête de fichier) : topBtn inséré juste avant.
  nav.insertBefore(dragged, target);
  nav.dispatch('pointerup', {});
  const order = JSON.parse(JSON.stringify(ctx.getHeaderNavOrder()));
  assert.strictEqual(order[0], 'topBtn');
  assert.strictEqual(order[1], 'globalSearchBtn');
});

test('wireHeaderNavDrag() : pointercancel termine le glisser comme pointerup (jamais bloqué en mode "dragging")', () => {
  const { ctx, nav } = buildDragContext();
  ctx.enterHeaderEditMode();
  const item = nav.querySelectorAll('.header-nav-btn:not(.dragging)')[0];
  nav.dispatch('pointerdown', { pointerId: 1, target: item });
  nav.dispatch('pointercancel', {});
  assert.ok(!item.classList.contains('dragging'));
});

test('wireHeaderNavDrag() : installHeaderBtn n\'est jamais draggable, même en édition', () => {
  const { ctx, nav } = buildDragContext();
  ctx.enterHeaderEditMode();
  const installBtn = nav.querySelectorAll('.header-nav-btn:not(.dragging)').find(el => el.id === 'installHeaderBtn');
  nav.dispatch('pointerdown', { pointerId: 1, target: installBtn });
  assert.ok(!installBtn.classList.contains('dragging'));
});

test('wireHeaderNavDrag() : installHeaderBtn n\'apparaît jamais dans l\'ordre enregistré', () => {
  const { ctx, nav } = buildDragContext();
  ctx.enterHeaderEditMode();
  const items = nav.querySelectorAll('.header-nav-btn:not(.dragging)');
  const dragged = items.find(i => i.id === 'changelogBtn');
  nav.dispatch('pointerdown', { pointerId: 1, target: dragged });
  nav.appendChild(dragged); // glisser jusqu'à la toute fin, après installHeaderBtn
  nav.dispatch('pointerup', {});
  const order = JSON.parse(JSON.stringify(ctx.getHeaderNavOrder()));
  assert.ok(!order.includes('installHeaderBtn'));
  assert.strictEqual(order.length, 7);
});

test('bloqueur de clic : un clic sur une icône pendant l\'édition est bloqué (preventDefault + stopImmediatePropagation)', () => {
  const { ctx, nav } = buildDragContext();
  ctx.enterHeaderEditMode();
  // Sélectionné par id plutôt que par index : applyHeaderNavOrder(), déjà
  // exécutée au chargement de js/ui.js, a réordonné nav.children (voir son
  // propre commentaire dans js/ui.js — installHeaderBtn, jamais réinséré
  // par cette boucle, se retrouve en tête) ; un index positionnel ne
  // pointerait pas de façon fiable vers une icône réordonnable.
  const item = nav.querySelectorAll('.header-nav-btn:not(.dragging)').find(el => el.id === 'watchlistBtn');
  let prevented = false, stopped = false;
  const event = { target: item, preventDefault(){ prevented = true; }, stopImmediatePropagation(){ stopped = true; } };
  nav.dispatch('click', event);
  assert.ok(prevented);
  assert.ok(stopped);
});

test('bloqueur de clic : hors édition, un clic sur une icône n\'est jamais intercepté', () => {
  const { ctx, nav } = buildDragContext();
  const item = nav.querySelectorAll('.header-nav-btn:not(.dragging)').find(el => el.id === 'watchlistBtn');
  let prevented = false;
  const event = { target: item, preventDefault(){ prevented = true; }, stopImmediatePropagation(){} };
  nav.dispatch('click', event);
  assert.ok(!prevented);
});

test('wireHeaderNavDrag() : pointerdown crée un ghost (document.body), pointerup le retire', () => {
  const { ctx, nav, bodyAppended } = buildDragContext();
  ctx.enterHeaderEditMode();
  const item = nav.querySelectorAll('.header-nav-btn:not(.dragging)').find(el => el.id === 'watchlistBtn');
  nav.dispatch('pointerdown', { pointerId: 1, target: item, clientX: 100, clientY: 10 });
  assert.strictEqual(bodyAppended.length, 1);
  const ghost = bodyAppended[0];
  assert.ok(ghost.classList.contains('header-nav-drag-ghost'));
  let removed = false;
  ghost.remove = () => { removed = true; };
  nav.dispatch('pointerup', {});
  assert.ok(removed, 'le ghost doit être retiré au relâchement');
});

test('wireHeaderNavDrag() : le ghost suit le pointeur (transform posé sur pointermove)', () => {
  const { ctx, nav, bodyAppended } = buildDragContext();
  ctx.enterHeaderEditMode();
  const item = nav.querySelectorAll('.header-nav-btn:not(.dragging)').find(el => el.id === 'watchlistBtn');
  nav.dispatch('pointerdown', { pointerId: 1, target: item, clientX: 100, clientY: 10 });
  const ghost = bodyAppended[0];
  nav.dispatch('pointermove', { clientX: 160, clientY: 40 });
  assert.ok(ghost.style.transform.includes('translate(60px, 30px)'), `transform inattendu : ${ghost.style.transform}`);
});

test('bloqueur de clic : installHeaderBtn reste cliquable même pendant l\'édition', () => {
  const { ctx, nav } = buildDragContext();
  ctx.enterHeaderEditMode();
  const installBtn = nav.querySelectorAll('.header-nav-btn:not(.dragging)').find(el => el.id === 'installHeaderBtn');
  let prevented = false;
  const event = { target: installBtn, preventDefault(){ prevented = true; }, stopImmediatePropagation(){} };
  nav.dispatch('click', event);
  assert.ok(!prevented);
});

module.exports = run('header-order.test.js');
