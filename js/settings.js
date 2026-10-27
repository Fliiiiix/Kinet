// --- Paramètres (#/parametres) ---
// Draft Profil du 15/10 (choix de Flix) : une vraie page aux rangées du
// Profil, rangée par thème (Apparence, Sons, À voir, Confidentialité,
// Données, Aide, Compte), à la place de la fenêtre aux pictos colorés. Les
// commandes d'origine y vivent avec leurs ids : sound.js (#soundToggle,
// #soundVolume), ui.js (#reduceMotionToggle), onboarding.js
// (#replayOnboardingBtn), pwa.js (#installSectionContent) et auth.js
// (#logoutBtn, #deleteAccountBtn) restent branchés dessus. Ce fichier ne
// fait que remplir la page et brancher ce qui est nouveau (thème en trois
// choix, abonnements, profil partagé, données).
//
// #openSettingsBtn (dans #profileOverlay, masqué) reste le point d'entrée
// relayé par la rangée « Paramètres » du Profil : il mène désormais ici.

function goToSettings(){ location.hash = '#/parametres'; }

function renderSettingsThemeChoice(){
  const choice = getThemeChoice();
  document.querySelectorAll('#settingsPage [data-theme-choice]').forEach(btn => {
    btn.setAttribute('aria-checked', String(btn.dataset.themeChoice === choice));
  });
}

function renderSettingsVolumeRow(){
  document.getElementById('settingsVolumeRow').hidden = !getSoundEnabled();
}

// « Netflix, Canal+, Prime Video » : les clés sont en minuscules (voir
// groupStreamingServices(), js/watchlist.js), on remet les majuscules.
function settingsServiceLabel(key){
  return String(key).replace(/(^|[\s-])(\S)/g, (m, sep, c) => sep + c.toUpperCase());
}

function renderSettingsSubs(){
  const mine = Array.from(getMyStreamingServices()).sort((a, b) => a.localeCompare(b, 'fr'));
  document.getElementById('settingsSubsSub').textContent = mine.length
    ? mine.map(settingsServiceLabel).join(', ')
    : 'Aucun : toutes les plateformes s’affichent sur tes affiches';
}

// Pays des plateformes (getWatchRegion(), js/tmdb.js) : les 139 pays de
// TMDB, par nom français. La liste est construite une fois.
function renderSettingsRegion(){
  const sel = document.getElementById('settingsRegionSelect');
  if(!sel.options.length){
    sel.innerHTML = WATCH_REGIONS
      .map(code => ({ code, name: watchRegionName(code) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .map(r => `<option value="${r.code}">${escapeHtml(r.name)}</option>`)
      .join('');
  }
  sel.value = getWatchRegion();
}

function renderSettingsPublic(){
  const on = !!(currentProfile && currentProfile.public_profile);
  document.getElementById('settingsPublicToggle').checked = on;
  document.getElementById('settingsPublicSub').textContent = on
    ? 'Visible avec ton lien, sans tes films privés ni tes commentaires'
    : 'Personne ne peut le voir';
}

// Appelée par renderRoute() (js/router.js).
function openSettingsPage(){
  renderSettingsThemeChoice();
  document.getElementById('reduceMotionToggle').checked = getReduceMotion();
  document.getElementById('soundToggle').checked = getSoundEnabled();
  renderSettingsVolumeRow();
  renderSettingsSubs();
  renderSettingsRegion();
  renderSettingsPublic();
  // Installation en app (js/pwa.js) : reconstruite à chaque ouverture, le
  // prompt natif peut être devenu disponible depuis la dernière fois.
  updateInstallUI();
}

// Ancienne fenêtre, plus jamais ouverte : gardée pour ses ids
// (#lightThemeToggle, #openHeaderOrderBtn) lus au chargement par js/ui.js.
function openSettingsModal(){ goToSettings(); }
function closeSettingsModal(){ closeOverlay('settingsOverlay'); }

document.getElementById('openSettingsBtn').addEventListener('click', () => {
  closeProfileModal();
  goToSettings();
});
document.getElementById('closeSettings').addEventListener('click', closeSettingsModal);
document.getElementById('settingsPageBack').addEventListener('click', () => returnToProfile());

document.querySelectorAll('#settingsPage [data-theme-choice]').forEach(btn => {
  btn.addEventListener('click', () => {
    setTheme(btn.dataset.themeChoice);
    renderSettingsThemeChoice();
  });
});
// sound.js enregistre le choix ; ici, seulement montrer ou cacher le volume.
document.getElementById('soundToggle').addEventListener('change', renderSettingsVolumeRow);

// « Mes abonnements » : le choix se fait là où sont les plateformes, sur À
// voir, dans le panneau déjà en place. On y va et on l'ouvre.
document.getElementById('settingsSubsBtn').addEventListener('click', () => {
  goToWatchlist();
  if(typeof openMyServicesPanelWhenReady === 'function') openMyServicesPanelWhenReady();
});

// Pris en compte à la prochaine lecture des plateformes (À voir, fiche,
// Bientôt) : le cache est rangé par pays (fetchWatchProviders(), js/tmdb.js).
document.getElementById('settingsRegionSelect').addEventListener('change', (e) => {
  setWatchRegion(e.target.value);
  showToast(`Plateformes : ${watchRegionName(getWatchRegion())}`);
});

document.getElementById('settingsPublicToggle').addEventListener('change', async (e) => {
  const on = e.target.checked;
  const ok = await savePublicProfile(on);
  if(!ok) e.target.checked = !on;
  renderSettingsPublic();
});

// Rangées relais (Letterboxd) : un clic = un clic sur le bouton d'origine,
// comme sur la page Profil.
document.getElementById('settingsPage').addEventListener('click', (e) => {
  const row = e.target.closest('[data-proxy]');
  if(!row) return;
  const target = document.getElementById(row.dataset.proxy);
  if(target) target.click();
});
