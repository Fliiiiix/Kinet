// --- Tests du tuto d'accueil interactif (js/onboarding.js) ---
// Retour utilisateur : "à la création d'un compte... un tuto
// intéractif... étape par étape... bien s'assurer que l'utilisateur soit
// nouveau [...] pas par appareil" puis "j'aime bien l'hybride [...] je
// veux que tu reproduises parfaitement".
//
// Ce que ces tests NE vérifient PAS : le positionnement réel de la carte
// (positionOnboardingCard() dépend de getBoundingClientRect()/offsetWidth,
// une vraie géométrie de layout que le harnais vm ne simule pas — même
// limite déjà documentée dans header-order.test.js) ni le rendu du HTML
// interne d'une carte (stubDocument().createElement() renvoie un élément
// générique dont querySelectorAll() ne retrouve jamais les boutons qu'on
// vient d'y injecter en innerHTML — même limite déjà documentée). Ce qui
// EST vérifié : toute la machine à états (bienvenue → étapes → clôture,
// Précédent/Suivant/Passer/Terminer, relecture vs première fois, cascade
// si une cible est introuvable) en appelant les fonctions directement,
// et le point réellement sensible du cahier des charges — onboarding_seen
// posé/lu PAR COMPTE (jamais par appareil), jamais touché en relecture.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument, stubElement, stubEventTarget, getState } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function realClassList(){
  const classes = new Set();
  return {
    add: (c) => classes.add(c),
    remove: (c) => classes.delete(c),
    contains: (c) => classes.has(c),
  };
}

// Cible "réelle" : assez équipée pour que showOnboardingSpot() aille au
// bout sans planter (scrollIntoView/cloneNode/getBoundingClientRect,
// jamais fournis par défaut par stubElement()) — le contenu exact du
// clone/de la carte n'est pas inspecté par ces tests, voir l'en-tête.
function makeRealTarget(){
  return Object.assign(stubElement(), {
    scrollIntoView(){},
    cloneNode(){ return stubElement(); },
    getBoundingClientRect(){ return { left:0, top:0, width:40, height:24, bottom:24, right:40 }; },
  });
}

const ALL_TARGET_IDS = [
  'openAddBtn', 'fabAddBtn', 'watchlistBtn', 'mobileTabWatchlist',
  'primaryTabSeries', 'friendsBtn', 'mobileTabFriends',
  'userAvatarBtn', 'mobileTabProfile'
];

function buildContext(opts){
  opts = opts || {};
  const layer = Object.assign(stubElement(), stubEventTarget(), { classList: realClassList() });
  const replayBtn = stubElement();
  const targets = opts.targets || {};
  const doc = stubDocument();
  doc.getElementById = (id) => {
    if(id === 'onboardingLayer') return layer;
    if(id === 'replayOnboardingBtn') return replayBtn;
    if(id in targets) return targets[id]; // peut être explicitement null (cible "introuvable")
    return makeRealTarget();
  };

  const closeProfileModalCalls = [];
  const goHomeCalls = [];
  const logEventCalls = [];
  const updateCalls = [];
  let mobile = !!opts.mobile;
  let reducedMotion = !!opts.reducedMotion;

  const supabaseClient = {
    from(table){
      return {
        update(payload){
          return { eq(col, val){ updateCalls.push({ table, payload, col, val }); return Promise.resolve({ error:null }); } };
        }
      };
    }
  };

  const ctx = createContext(Object.assign({
    document: doc,
    window: {
      addEventListener(){}, removeEventListener(){},
      innerWidth:1200, innerHeight:800,
      matchMedia: (q) => ({ matches: q.indexOf('prefers-reduced-motion') !== -1 ? reducedMotion : mobile }),
    },
    closeProfileModal(){ closeProfileModalCalls.push(true); },
    // "Revoir le tuto" vit dans Paramètres (#settingsOverlay, js/settings.js)
    // depuis la refonte du profil — startOnboarding() ferme aussi cette
    // modale (idempotent, no-op ici) en plus du profil.
    closeOverlay(){},
    goHome(){ goHomeCalls.push(true); },
    logEvent(type, detail){ logEventCalls.push({ type, detail }); },
    supabaseClient,
    OVERLAY_CLOSE_MS: 30,
    currentUser: { id:'u1' },
    currentProfile: Object.assign({ user_id:'u1' }, opts.profile),
  }, opts.contextProps));

  loadFiles(ctx, ['js/onboarding.js']);
  return { ctx, layer, closeProfileModalCalls, goHomeCalls, logEventCalls, updateCalls, setMobile:(v) => { mobile = v; } };
}

test('maybeStartOnboarding() : lance le tuto quand onboarding_seen est explicitement false', () => {
  const { ctx, layer } = buildContext({ profile: { onboarding_seen:false } });
  ctx.maybeStartOnboarding();
  assert.ok(layer.classList.contains('open'));
  assert.strictEqual(getState(ctx, 'onboardingState').phase, 'welcome');
});

test('maybeStartOnboarding() : ne fait rien si onboarding_seen est déjà true', () => {
  const { ctx, layer } = buildContext({ profile: { onboarding_seen:true } });
  ctx.maybeStartOnboarding();
  assert.ok(!layer.classList.contains('open'));
});

test('maybeStartOnboarding() : ne fait rien si onboarding_seen est absent (repli synthétique après double échec réseau)', () => {
  const { ctx, layer } = buildContext({ profile: {} });
  ctx.maybeStartOnboarding();
  assert.ok(!layer.classList.contains('open'));
});

test('startOnboarding({replay:false}) : referme le profil, ramène sur l\'accueil, ouvre sur la Bienvenue', () => {
  const { ctx, layer, closeProfileModalCalls, goHomeCalls } = buildContext();
  ctx.startOnboarding({ replay:false });
  assert.strictEqual(closeProfileModalCalls.length, 1);
  assert.strictEqual(goHomeCalls.length, 1);
  assert.ok(layer.classList.contains('open'));
  const state = getState(ctx, 'onboardingState');
  assert.strictEqual(state.phase, 'welcome');
  assert.strictEqual(state.replay, false);
});

test('startOnboarding({replay:true}) : saute directement à la 1re étape, jamais la Bienvenue', () => {
  const { ctx } = buildContext();
  ctx.startOnboarding({ replay:true });
  const state = getState(ctx, 'onboardingState');
  assert.strictEqual(state.phase, 'spot');
  assert.strictEqual(state.stepIndex, 0);
  assert.strictEqual(state.replay, true);
});

test('startOnboarding() : un 2e appel pendant que le tuto est déjà ouvert ne fait rien (jamais deux tutos empilés)', () => {
  const { ctx, closeProfileModalCalls } = buildContext();
  ctx.startOnboarding({ replay:false });
  ctx.startOnboarding({ replay:true }); // devrait être ignoré
  assert.strictEqual(closeProfileModalCalls.length, 1);
  assert.strictEqual(getState(ctx, 'onboardingState').phase, 'welcome');
});

test('"Découvrir" (welcome-start) : passe de la Bienvenue à la 1re étape', () => {
  const { ctx } = buildContext();
  ctx.startOnboarding({ replay:false });
  ctx.handleOnboardingAction('welcome-start');
  const state = getState(ctx, 'onboardingState');
  assert.strictEqual(state.phase, 'spot');
  assert.strictEqual(state.stepIndex, 0);
});

test('advanceOnboarding() : une cible introuvable à chaque étape fait cascader jusqu\'à la clôture, sans planter', () => {
  const targets = {};
  ALL_TARGET_IDS.forEach(id => { targets[id] = null; });
  const { ctx } = buildContext({ targets });
  ctx.startOnboarding({ replay:true }); // cascade synchrone dès le rendu initial
  assert.strictEqual(getState(ctx, 'onboardingState').phase, 'closing');
});

test('advanceOnboarding(-1) à la toute première étape reste bloqué à 0 (jamais d\'index négatif)', () => {
  const { ctx } = buildContext();
  ctx.startOnboarding({ replay:true });
  ctx.advanceOnboarding(-1);
  const state = getState(ctx, 'onboardingState');
  assert.strictEqual(state.phase, 'spot');
  assert.strictEqual(state.stepIndex, 0);
});

test('advanceOnboarding(1) répété jusqu\'au bout des étapes passe en clôture', () => {
  const { ctx } = buildContext();
  ctx.startOnboarding({ replay:true });
  for(let i = 0; i < 5; i++) ctx.advanceOnboarding(1);
  assert.strictEqual(getState(ctx, 'onboardingState').phase, 'closing');
});

test('skipOnboarding() en première visite : marque onboarding_seen vu (mémoire + Supabase), log "first"', async () => {
  const { ctx, layer, logEventCalls, updateCalls } = buildContext({ reducedMotion:true, profile:{ onboarding_seen:false } });
  ctx.startOnboarding({ replay:false });
  ctx.skipOnboarding();
  await new Promise(r => setTimeout(r, 5));
  assert.deepStrictEqual(logEventCalls, [{ type:'onboarding_skipped', detail:'first' }]);
  assert.strictEqual(updateCalls.length, 1);
  // JSON.parse(JSON.stringify(...)) : updateCalls[0].payload vient du
  // contexte vm (autre "realm") — deepStrictEqual échouerait sur un objet
  // de structure identique mais construit dans un autre realm que celui-ci,
  // voir tests/README.md.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(updateCalls[0])), { table:'profiles', payload:{ onboarding_seen:true }, col:'user_id', val:'u1' });
  assert.strictEqual(getState(ctx, 'currentProfile').onboarding_seen, true);
  assert.ok(!layer.classList.contains('open'));
  assert.strictEqual(getState(ctx, 'onboardingState'), null);
});

test('skipOnboarding() en relecture (Paramètres) : ne touche JAMAIS onboarding_seen, log "replay"', async () => {
  const { ctx, logEventCalls, updateCalls } = buildContext({ reducedMotion:true, profile:{ onboarding_seen:true } });
  ctx.startOnboarding({ replay:true });
  ctx.skipOnboarding();
  await new Promise(r => setTimeout(r, 5));
  assert.deepStrictEqual(logEventCalls, [{ type:'onboarding_skipped', detail:'replay' }]);
  assert.strictEqual(updateCalls.length, 0, 'aucun appel Supabase en relecture');
});

test('finishOnboarding() en première visite : marque vu, log "onboarding_completed"/"first"', async () => {
  const { ctx, logEventCalls, updateCalls } = buildContext({ reducedMotion:true, profile:{ onboarding_seen:false } });
  ctx.startOnboarding({ replay:false });
  ctx.finishOnboarding();
  await new Promise(r => setTimeout(r, 5));
  assert.deepStrictEqual(logEventCalls, [{ type:'onboarding_completed', detail:'first' }]);
  assert.strictEqual(updateCalls.length, 1);
});

test('finishOnboarding() en relecture : ne touche jamais onboarding_seen', async () => {
  const { ctx, updateCalls } = buildContext({ reducedMotion:true, profile:{ onboarding_seen:true } });
  ctx.startOnboarding({ replay:true });
  ctx.finishOnboarding();
  await new Promise(r => setTimeout(r, 5));
  assert.strictEqual(updateCalls.length, 0);
});

test('closeOnboardingLayer() : nettoyage synchrone immédiat sous prefers-reduced-motion', () => {
  const { ctx, layer } = buildContext({ reducedMotion:true });
  ctx.startOnboarding({ replay:false });
  ctx.closeOnboardingLayer(false);
  assert.ok(!layer.classList.contains('open'));
  assert.ok(!layer.classList.contains('closing'));
  assert.strictEqual(getState(ctx, 'onboardingState'), null);
});

test('closeOnboardingLayer() : pose "closing" tout de suite, nettoie après le délai de secours (animationend jamais déclenché ici)', async () => {
  const { ctx, layer } = buildContext({ reducedMotion:false });
  ctx.startOnboarding({ replay:false });
  ctx.closeOnboardingLayer(false);
  assert.ok(!layer.classList.contains('open'), '"open" retiré tout de suite');
  assert.ok(layer.classList.contains('closing'), '"closing" posé tout de suite, sinon le voile disparaîtrait avant toute animation');
  await new Promise(r => setTimeout(r, 50)); // > OVERLAY_CLOSE_MS (30 dans ce contexte de test)
  assert.ok(!layer.classList.contains('closing'), 'nettoyé par le filet de sécurité setTimeout');
  assert.strictEqual(getState(ctx, 'onboardingState'), null);
});

test('onboardingStepTargetEl()/onboardingStepPlace() : ciblent l\'entête desktop hors mobile', () => {
  const targets = { openAddBtn: Object.assign(makeRealTarget(), { __marker:'desktop-add' }) };
  const { ctx } = buildContext({ mobile:false, targets });
  const step = { key:'add', target:{ desktop:'openAddBtn', mobile:'fabAddBtn' }, place:{ desktop:'bottom', mobile:'top' } };
  assert.strictEqual(ctx.onboardingStepTargetEl(step).__marker, 'desktop-add');
  assert.strictEqual(ctx.onboardingStepPlace(step), 'bottom');
});

test('onboardingStepTargetEl()/onboardingStepPlace() : ciblent la barre mobile sous le seuil mobile', () => {
  const targets = { fabAddBtn: Object.assign(makeRealTarget(), { __marker:'fab' }) };
  const { ctx } = buildContext({ mobile:true, targets });
  const step = { key:'add', target:{ desktop:'openAddBtn', mobile:'fabAddBtn' }, place:{ desktop:'bottom', mobile:'top' } };
  assert.strictEqual(ctx.onboardingStepTargetEl(step).__marker, 'fab');
  assert.strictEqual(ctx.onboardingStepPlace(step), 'top');
});

test('onboardingStepPlace() : une étape qui pointe la même place des deux côtés (ex. Séries) reste cohérente', () => {
  const step = { key:'series', target:{ desktop:'primaryTabSeries', mobile:'primaryTabSeries' }, place:{ desktop:'bottom', mobile:'bottom' } };
  const desktopCtx = buildContext({ mobile:false }).ctx;
  const mobileCtx = buildContext({ mobile:true }).ctx;
  assert.strictEqual(desktopCtx.onboardingStepPlace(step), 'bottom');
  assert.strictEqual(mobileCtx.onboardingStepPlace(step), 'bottom');
});

module.exports = run('onboarding.test.js');
