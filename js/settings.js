// --- Paramètres (retour utilisateur : "commencer une vraie section
// paramètre" plutôt que des réglages perdus au milieu de "Ton profil") ---
// Écran séparé, ouvert depuis "Ton profil" → Compte → Paramètres
// (#openSettingsBtn) — regroupe tout ce qui règle le COMPORTEMENT de
// l'app pour ce compte/cet appareil (thème, entête, accessibilité, aide,
// installation, déconnexion), par opposition à l'identité (pseudo,
// avatar, profil public) qui reste dans "Ton profil". Même pattern que
// Statistiques/Succès/Journal (js/stats.js, js/achievements.js,
// js/journal.js) : referme le profil à l'ouverture, le rouvre à la
// fermeture — sauf que celui-ci, ouvert DEPUIS le profil plutôt que
// depuis l'entête, mérite une flèche retour plutôt qu'un simple ✕
// (#closeSettings, voir index.html) : revenir à "Ton profil" est le
// vrai comportement attendu, pas juste "fermer".

function openSettingsModal(){
  closeProfileModal();
  document.getElementById('lightThemeToggle').checked = getTheme() === 'light';
  document.getElementById('reduceMotionToggle').checked = getReduceMotion();
  // Installation en app (js/pwa.js) : reconstruite à chaque ouverture — le
  // prompt natif peut être devenu disponible depuis la dernière fois.
  updateInstallUI();
  openOverlay('settingsOverlay');
}

function closeSettingsModal(){
  closeOverlay('settingsOverlay', () => openProfileModal());
}

document.getElementById('openSettingsBtn').addEventListener('click', openSettingsModal);
document.getElementById('closeSettings').addEventListener('click', closeSettingsModal);
document.getElementById('settingsOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'settingsOverlay') closeSettingsModal();
});
