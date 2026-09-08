// --- Tests de l'écran Paramètres (js/settings.js) ---
// Retour utilisateur : "illisible et beaucoup trop confus... commencer une
// vraie section paramètre" — Paramètres devient un écran séparé de "Ton
// profil", ouvert/fermé selon le même principe que Statistiques/Succès/
// Journal (referme le déclencheur, rouvre "Ton profil" à la sortie) mais
// avec une flèche retour plutôt qu'un ✕, voir index.html.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument, stubElement, stubEventTarget } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const lightThemeToggle = stubElement({ checked: false });
  const reduceMotionToggle = stubElement({ checked: false });
  const openBtn = stubEventTarget();
  const closeBtn = stubEventTarget();
  const overlay = stubEventTarget();

  const closeProfileModalCalls = [];
  const openOverlayCalls = [];
  const closeOverlayCalls = [];
  const updateInstallUICalls = [];

  const doc = stubDocument({
    lightThemeToggle, reduceMotionToggle,
    openSettingsBtn: openBtn, closeSettings: closeBtn, settingsOverlay: overlay,
  });

  const ctx = createContext({
    document: doc,
    closeProfileModal(){ closeProfileModalCalls.push(true); },
    openProfileModal(){},
    getTheme(){ return 'light'; },
    getReduceMotion(){ return true; },
    updateInstallUI(){ updateInstallUICalls.push(true); },
    openOverlay(id){ openOverlayCalls.push(id); },
    closeOverlay(id, cb){ closeOverlayCalls.push(id); if(cb) cb(); },
  });
  loadFiles(ctx, ['js/settings.js']);
  return { ctx, lightThemeToggle, reduceMotionToggle, openBtn, closeBtn, overlay, closeProfileModalCalls, openOverlayCalls, closeOverlayCalls, updateInstallUICalls };
}

test('openSettingsModal() : referme "Ton profil", synchronise les interrupteurs, reconstruit l\'installation, ouvre Paramètres', () => {
  const { ctx, lightThemeToggle, reduceMotionToggle, closeProfileModalCalls, openOverlayCalls, updateInstallUICalls } = buildContext();
  ctx.openSettingsModal();
  assert.strictEqual(closeProfileModalCalls.length, 1);
  assert.strictEqual(lightThemeToggle.checked, true, 'reflète getTheme() = "light"');
  assert.strictEqual(reduceMotionToggle.checked, true, 'reflète getReduceMotion() = true');
  assert.strictEqual(updateInstallUICalls.length, 1, 'le prompt natif peut être devenu disponible depuis la dernière ouverture');
  assert.deepStrictEqual(openOverlayCalls, ['settingsOverlay']);
});

test('closeSettingsModal() : ferme Paramètres ET rouvre "Ton profil" (même convention que Statistiques/Succès/Journal)', () => {
  const { ctx, closeOverlayCalls } = buildContext();
  let reopenedProfile = false;
  ctx.openProfileModal = () => { reopenedProfile = true; };
  ctx.closeSettingsModal();
  assert.deepStrictEqual(closeOverlayCalls, ['settingsOverlay']);
  assert.ok(reopenedProfile, 'closeOverlay() doit être appelée avec un callback qui rouvre "Ton profil"');
});

test('le bouton "Paramètres" (#openSettingsBtn) ouvre bien Paramètres au clic', () => {
  const { openBtn, openOverlayCalls } = buildContext();
  openBtn.dispatch('click', {});
  assert.deepStrictEqual(openOverlayCalls, ['settingsOverlay']);
});

test('la flèche retour (#closeSettings) referme Paramètres et rouvre "Ton profil"', () => {
  const { closeBtn, closeOverlayCalls } = buildContext();
  closeBtn.dispatch('click', {});
  assert.deepStrictEqual(closeOverlayCalls, ['settingsOverlay']);
});

test('un clic sur le fond de #settingsOverlay referme Paramètres (même convention que les autres .overlay)', () => {
  const { overlay, closeOverlayCalls } = buildContext();
  overlay.dispatch('click', { target: { id: 'settingsOverlay' } });
  assert.deepStrictEqual(closeOverlayCalls, ['settingsOverlay']);
});

test('un clic À L\'INTÉRIEUR de #settingsOverlay (sur le fond, pas la modale) ne referme rien', () => {
  const { overlay, closeOverlayCalls } = buildContext();
  overlay.dispatch('click', { target: { id: 'lightThemeToggle' } });
  assert.strictEqual(closeOverlayCalls.length, 0);
});

module.exports = run('settings-modal.test.js');
