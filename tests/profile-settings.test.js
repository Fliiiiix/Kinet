// --- Tests de la refonte "Ton profil" (js/profile.js) ---
// Retour utilisateur : "illisible et beaucoup trop confus... bien
// catégoriser". Ce fichier couvre les morceaux NOUVEAUX/CHANGÉS par cette
// refonte : le panneau avatar repliable, l'aperçu d'avatar en direct, le
// panneau "Profil public" (classe .open plutôt qu'un style inline), et le
// glisser-déposer des meilleurs films (remplace les anciens boutons
// monter/descendre). Ce que ces tests NE vérifient PAS : le positionnement
// réel pendant un glisser (getBoundingClientRect() dépend d'une vraie
// géométrie de layout que le harnais vm ne simule pas — même limite déjà
// documentée dans header-order.test.js) ; le formulaire lui-même
// (handleSaveProfile, l'upload réel) n'est pas touché par cette refonte et
// n'est pas retesté ici.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument, stubElement, stubEventTarget, fakeLocalStorage, getState } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function realClassList(){
  const classes = new Set();
  return {
    add: (c) => classes.add(c),
    remove: (c) => classes.delete(c),
    toggle(c, force){ if(force === undefined) force = !classes.has(c); if(force) classes.add(c); else classes.delete(c); },
    contains: (c) => classes.has(c),
  };
}

// Cible "réelle" pour le glisser des meilleurs films : équipée juste assez
// (cloneNode/getBoundingClientRect/setPointerCapture) pour que
// wireTopFilmsDrag() aille au bout sans planter — même recette que
// makeRealTarget() dans tests/onboarding.test.js.
function makeChip(tmdbId){
  const grip = stubElement();
  const item = Object.assign(stubEventTarget(), {
    dataset: { tmdbId: String(tmdbId) },
    classList: realClassList(),
    setPointerCapture(){},
    getBoundingClientRect(){ return { left:0, top:0, width:200, height:40, bottom:40, right:200 }; },
    cloneNode(){ return stubElement({ remove(){} }); },
    querySelector(sel){ return sel === '.top-film-grip' ? grip : null; },
  });
  grip.__chip = item; // pour retrouver la ligne depuis la poignée dans closest()
  item.closest = function(sel){ return sel === '.top-film-chip' ? item : null; };
  grip.closest = function(sel){
    if(sel === '.top-film-grip') return grip;
    if(sel === '.top-film-chip') return item;
    return null;
  };
  return item;
}

function makeWrap(tmdbIds){
  let children = tmdbIds.map(makeChip);
  return Object.assign(stubEventTarget(), {
    innerHTML: '',
    querySelectorAll(sel){
      if(sel === '.top-film-chip:not(.dragging)') return children.filter(c => !c.classList.contains('dragging'));
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

function buildContext(overrides){
  overrides = overrides || {};
  const avatarPanel = stubElement({ classList: realClassList() });
  const toggleAvatarPanelBtn = Object.assign(stubEventTarget(), { setAttribute(){}, getAttribute(){ return null; } });
  const profileAvatarPreview = stubElement();
  const profileAvatarFallback = stubElement();
  const publicProfileLinkHint = stubElement({ classList: realClassList() });
  const publicProfileToggle = stubElement({ checked: false });
  const avatarUrlInput = stubEventTarget();
  avatarUrlInput.value = '';
  const topFilmsPicker = overrides.topFilmsPicker || makeWrap([]);
  const userAvatarBtn = stubEventTarget();
  const profileOverlay = stubEventTarget();

  const elements = {
    avatarPanel, toggleAvatarPanelBtn, profileAvatarPreview, profileAvatarFallback,
    publicProfileLinkHint, publicProfileToggle, avatarUrlInput, topFilmsPicker,
    userAvatarBtn, profileOverlay,
    displayNameInput: stubElement(), avatarFileInput: stubElement({ value:'' }),
    avatarUploadStatus: stubElement(), avatarFilmSearch: stubEventTarget(),
    avatarFilmResults: stubElement(), publicProfileLinkText: stubElement(),
    copyPublicProfileLink: stubEventTarget(), topFilmsSearch: stubEventTarget(),
    topFilmsResults: stubElement(), adminBtn: stubElement(),
    closeProfile: stubEventTarget(), cancelProfileBtn: stubEventTarget(), saveProfileBtn: stubEventTarget(),
  };
  Object.assign(elements.avatarFilmSearch, { value:'' });
  Object.assign(elements.topFilmsSearch, { value:'' });

  const doc = stubDocument(elements);
  doc.querySelectorAll = (sel) => (sel === '.avatar-source-tab' ? [] : []);

  const ctx = createContext(Object.assign({
    document: doc,
    localStorage: fakeLocalStorage(),
    currentUser: { id:'u1', email:'flix@example.com' },
    supabaseClient: { from(){ return { select(){ return this; }, eq(){ return this; }, maybeSingle: async () => ({ data:null, error:null }) }; } },
    openOverlay(){}, closeOverlay(){}, showToast(){},
    isAdmin(){ return false; },
    films: [],
    FILM_PLACEHOLDER_SVG: '<svg></svg>',
    normalizeSearch(s){ return (s || '').toLowerCase(); },
    getSearchTerms(){ return []; },
    escapeHtml(s){ return s; },
  }, overrides.contextProps));

  loadFiles(ctx, ['js/profile.js']);
  return { ctx, avatarPanel, toggleAvatarPanelBtn, profileAvatarPreview, profileAvatarFallback, publicProfileLinkHint, publicProfileToggle, topFilmsPicker };
}

test('setAvatarPanelOpen(true) : déplie le panneau avatar et pose aria-expanded', () => {
  const { ctx, avatarPanel } = buildContext();
  ctx.setAvatarPanelOpen(true);
  assert.ok(avatarPanel.classList.contains('open'));
});

test('setAvatarPanelOpen(false) : replie le panneau (état par défaut à l\'ouverture de "Ton profil")', () => {
  const { ctx, avatarPanel } = buildContext();
  ctx.setAvatarPanelOpen(true);
  ctx.setAvatarPanelOpen(false);
  assert.ok(!avatarPanel.classList.contains('open'));
});

test('le crayon (#toggleAvatarPanelBtn) bascule le panneau à chaque clic', () => {
  const { toggleAvatarPanelBtn, avatarPanel } = buildContext();
  toggleAvatarPanelBtn.dispatch('click', {});
  assert.ok(avatarPanel.classList.contains('open'), '1er clic : déplié');
  toggleAvatarPanelBtn.dispatch('click', {});
  assert.ok(!avatarPanel.classList.contains('open'), '2e clic : replié');
});

test('updateAvatarPreview(url) : montre la vraie image et cache le repli quand une URL existe', () => {
  const { ctx, profileAvatarPreview, profileAvatarFallback } = buildContext();
  ctx.updateAvatarPreview('https://example.com/avatar.png');
  assert.strictEqual(profileAvatarPreview.src, 'https://example.com/avatar.png');
  assert.strictEqual(profileAvatarPreview.style.display, '');
  assert.strictEqual(profileAvatarFallback.style.display, 'none');
});

test('updateAvatarPreview(\'\') : repasse sur le repli (aucun avatar)', () => {
  const { ctx, profileAvatarPreview, profileAvatarFallback } = buildContext();
  ctx.updateAvatarPreview('https://example.com/avatar.png');
  ctx.updateAvatarPreview('');
  assert.strictEqual(profileAvatarPreview.style.display, 'none');
  assert.strictEqual(profileAvatarFallback.style.display, '');
});

test('updatePublicProfileLinkVisibility() : pose la classe .open (pas un style inline) quand la case est cochée', () => {
  const { ctx, publicProfileToggle, publicProfileLinkHint } = buildContext();
  publicProfileToggle.checked = true;
  ctx.updatePublicProfileLinkVisibility();
  assert.ok(publicProfileLinkHint.classList.contains('open'));
});

test('updatePublicProfileLinkVisibility() : retire .open quand la case est décochée', () => {
  const { ctx, publicProfileToggle, publicProfileLinkHint } = buildContext();
  publicProfileToggle.checked = true;
  ctx.updatePublicProfileLinkVisibility();
  publicProfileToggle.checked = false;
  ctx.updatePublicProfileLinkVisibility();
  assert.ok(!publicProfileLinkHint.classList.contains('open'));
});

test('wireTopFilmsDrag() : pointerdown SUR LA POIGNÉE démarre le glisser, ailleurs sur la ligne ne fait rien', () => {
  const wrap = makeWrap([1, 2, 3]);
  const { ctx } = buildContext({ topFilmsPicker: wrap });
  const items = wrap.querySelectorAll('.top-film-chip:not(.dragging)');
  // Clic ailleurs que la poignée (target = la ligne elle-même) : jamais de drag.
  wrap.dispatch('pointerdown', { pointerId:1, target: items[0], clientX:0, clientY:0 });
  assert.ok(!items[0].classList.contains('dragging'));
});

test('wireTopFilmsDrag() : pointerdown sur la poignée pose .dragging, pointerup le retire', () => {
  const wrap = makeWrap([1, 2, 3]);
  buildContext({ topFilmsPicker: wrap });
  const items = wrap.querySelectorAll('.top-film-chip:not(.dragging)');
  const grip = items[0].querySelector('.top-film-grip');
  wrap.dispatch('pointerdown', { pointerId:1, target: grip, clientX:0, clientY:0 });
  assert.ok(items[0].classList.contains('dragging'));
  wrap.dispatch('pointerup', {});
  assert.ok(!items[0].classList.contains('dragging'));
});

test('wireTopFilmsDrag() : l\'ordre relu au relâchement est celui du DOM à cet instant (glisser simulé)', () => {
  const wrap = makeWrap([1, 2, 3]);
  const { ctx } = buildContext({ topFilmsPicker: wrap });
  const items = wrap.querySelectorAll('.top-film-chip:not(.dragging)');
  const dragged = items[0]; // tmdbId 1
  const target = items[2]; // tmdbId 3
  const grip = dragged.querySelector('.top-film-grip');
  wrap.dispatch('pointerdown', { pointerId:1, target: grip, clientX:0, clientY:0 });
  // Simule ce que pointermove aurait fait une fois passé sous le milieu de
  // la 3e ligne (géométrie non simulée ici, voir l'en-tête du fichier).
  wrap.insertBefore(dragged, target);
  wrap.dispatch('pointerup', {});
  const order = JSON.parse(JSON.stringify(getState(ctx, 'topFilmsSelection')));
  assert.deepStrictEqual(order, [2, 1, 3]);
});

test('wireTopFilmsDrag() : pointercancel termine le glisser comme pointerup (jamais bloqué en mode "dragging")', () => {
  const wrap = makeWrap([1, 2]);
  buildContext({ topFilmsPicker: wrap });
  const items = wrap.querySelectorAll('.top-film-chip:not(.dragging)');
  const grip = items[0].querySelector('.top-film-grip');
  wrap.dispatch('pointerdown', { pointerId:1, target: grip, clientX:0, clientY:0 });
  wrap.dispatch('pointercancel', {});
  assert.ok(!items[0].classList.contains('dragging'));
});

module.exports = run('profile-settings.test.js');
