// --- Tests de la page Paramètres (js/settings.js) ---
// Draft Profil du 15/10 (choix de Flix) : Paramètres devient une page
// (#/parametres) aux rangées du Profil, rangée par thème. Le thème se choisit
// en trois (Sombre, Clair, Auto), le volume n'apparaît qu'avec le son, et
// « Mes abonnements » résume les plateformes cochées.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument, stubElement, stubEventTarget } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(opts = {}){
  const els = {
    reduceMotionToggle: stubElement({ checked: false }),
    soundToggle: Object.assign(stubEventTarget(), { checked: false }),
    settingsVolumeRow: stubElement({ hidden: false }),
    settingsSubsSub: stubElement(),
    settingsPublicToggle: Object.assign(stubEventTarget(), { checked: false }),
    settingsPublicSub: stubElement(),
    openSettingsBtn: stubEventTarget(),
    settingsPageBack: stubEventTarget(),
    settingsRegionSelect: Object.assign(stubEventTarget(), { options: [], value: '' }),
  };
  const themeButtons = ['dark', 'light', 'auto'].map(choice => {
    const attrs = {};
    return Object.assign(stubEventTarget(), {
      dataset: { themeChoice: choice },
      setAttribute(k, v){ attrs[k] = v; }, getAttribute(k){ return attrs[k]; },
    });
  });
  const doc = stubDocument(els);
  doc.querySelectorAll = (sel) => sel.includes('data-theme-choice') ? themeButtons : [];
  const calls = { install: 0, closeProfile: 0, toProfile: 0, theme: [] };
  const ctx = createContext({
    document: doc,
    location: { hash: '' },
    closeProfileModal(){ calls.closeProfile++; },
    returnToProfile(){ calls.toProfile++; },
    getThemeChoice(){ return opts.theme || 'dark'; },
    setTheme(choice){ calls.theme.push(choice); },
    getReduceMotion(){ return true; },
    getSoundEnabled(){ return opts.sound !== false; },
    getMyStreamingServices(){ return new Set(opts.subs || []); },
    updateInstallUI(){ calls.install++; },
    closeOverlay(){},
    showToast(m){ calls.toast = m; },
    escapeHtml(s){ return String(s); },
  });
  // js/tmdb.js pour le pays des plateformes (getWatchRegion(), WATCH_REGIONS).
  loadFiles(ctx, ['js/tmdb.js', 'js/settings.js']);
  setState(ctx, { currentProfile: opts.profile || { public_profile: false } });
  return { ctx, els, themeButtons, calls };
}

test('openSettingsPage() : recale les interrupteurs, le thème choisi et reconstruit l\'installation', () => {
  const { ctx, els, themeButtons, calls } = buildContext({ theme: 'auto' });
  ctx.openSettingsPage();
  assert.strictEqual(els.reduceMotionToggle.checked, true);
  assert.strictEqual(els.soundToggle.checked, true);
  assert.deepStrictEqual(themeButtons.map(b => b.getAttribute('aria-checked')), ['false', 'false', 'true']);
  assert.strictEqual(calls.install, 1, 'le prompt natif peut être devenu disponible depuis la dernière fois');
});

test('le volume n\'apparaît qu\'avec les effets sonores', () => {
  const on = buildContext({ sound: true });
  on.ctx.openSettingsPage();
  assert.strictEqual(on.els.settingsVolumeRow.hidden, false);
  const off = buildContext({ sound: false });
  off.ctx.openSettingsPage();
  assert.strictEqual(off.els.settingsVolumeRow.hidden, true);
});

test('Mes abonnements : les plateformes cochées, avec leurs majuscules, sinon « Aucun »', () => {
  const some = buildContext({ subs: ['netflix', 'canal+', 'prime video'] });
  some.ctx.openSettingsPage();
  assert.strictEqual(some.els.settingsSubsSub.textContent, 'Canal+, Netflix, Prime Video');
  const none = buildContext();
  none.ctx.openSettingsPage();
  assert.ok(none.els.settingsSubsSub.textContent.startsWith('Aucun'));
});

test('Profil partagé : interrupteur et phrase suivent le profil', () => {
  const { ctx, els } = buildContext({ profile: { public_profile: true } });
  ctx.openSettingsPage();
  assert.strictEqual(els.settingsPublicToggle.checked, true);
  assert.ok(els.settingsPublicSub.textContent.includes('sans tes films privés'));
});

test('un choix de thème l\'applique tout de suite', () => {
  const { themeButtons, calls } = buildContext();
  themeButtons[1].dispatch('click', {});
  assert.deepStrictEqual(calls.theme, ['light']);
});

test('« Paramètres » depuis le Profil mène à #/parametres, « ← Profil » y ramène', () => {
  const { ctx, els, calls } = buildContext();
  els.openSettingsBtn.dispatch('click', {});
  assert.strictEqual(ctx.location.hash, '#/parametres');
  assert.strictEqual(calls.closeProfile, 1);
  els.settingsPageBack.dispatch('click', {});
  assert.strictEqual(calls.toProfile, 1);
});

// Pays des plateformes (retour de Flix, 27/10, en Afrique du Sud).
test('Pays : la liste des pays en français, la France par défaut', () => {
  const { ctx, els } = buildContext();
  ctx.openSettingsPage();
  const html = els.settingsRegionSelect.innerHTML;
  assert.ok(html.includes('<option value="ZA">Afrique du Sud</option>'));
  assert.ok(html.indexOf('value="ZA"') < html.indexOf('value="FR"'), 'trié par nom : Afrique du Sud avant France');
  assert.strictEqual(els.settingsRegionSelect.value, 'FR');
});

test('Pays : le choix est gardé sur l’appareil, la France efface le réglage', () => {
  const { ctx, els, calls } = buildContext();
  els.settingsRegionSelect.dispatch('change', { target: { value: 'ZA' } });
  assert.strictEqual(ctx.localStorage.getItem('kinetWatchRegion'), 'ZA');
  assert.strictEqual(ctx.getWatchRegion(), 'ZA');
  assert.strictEqual(calls.toast, 'Plateformes : Afrique du Sud');
  els.settingsRegionSelect.dispatch('change', { target: { value: 'FR' } });
  assert.strictEqual(ctx.localStorage.getItem('kinetWatchRegion'), null);
  assert.strictEqual(ctx.getWatchRegion(), 'FR');
});

module.exports = run('settings-page.test.js');
