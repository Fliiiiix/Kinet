// --- Installation en app (PWA, v2.0.7, v2.0.8, entête v2.1) ---
// Kinet est installable comme une vraie application — téléphone (Android/
// iOS) et PC (Chrome/Edge) — sans passer par un store, en s'appuyant sur
// le manifest (manifest.json) et le service worker déjà enregistré pour le
// mode hors ligne (sw.js, voir js/offline.js). Deux surfaces pilotées
// d'ici : #installSection (modale profil, référence permanente une fois
// qu'on sait où la trouver) et #installHeaderBtn (v2.1, icône d'entête —
// accès direct sans ouvrir le profil). #installBanner (v2.0.8, bandeau
// pleine largeur) retiré en v3.2, retour utilisateur : "le rectangle pour
// télécharger l'app... franchement pas beau" — doublonnait les deux
// surfaces restantes pour un rectangle de plus dans un écran qui n'en
// avait déjà pas besoin.

let deferredInstallPrompt = null;

function isStandaloneDisplay(){
  // navigator.standalone : propriété historique Safari iOS, jamais
  // standardisée mais toujours le seul moyen fiable d'y détecter le mode
  // installé — matchMedia('display-mode: standalone') n'y fonctionne pas.
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function isIOSDevice(){
  // iPadOS 13+ se présente en desktop (Macintosh) mais avec un écran
  // tactile — MSStream exclu (IE11 sur Windows Phone partageait autrefois
  // ce user-agent iPhone-like, précaution qui ne coûte rien).
  const isIOSUA = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isIPadOS13Plus = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return (isIOSUA || isIPadOS13Plus) && !window.MSStream;
}

// Chrome/Edge annoncent l'installabilité via cet évènement plutôt qu'un
// bouton toujours affiché — preventDefault() + stockage pour le déclencher
// nous-mêmes depuis #installSection, quand l'utilisateur le décide,
// plutôt que la mini-barre d'adresse automatique du navigateur.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  updateInstallUI();
  updateInstallHeaderBtn();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  updateInstallUI();
  updateInstallHeaderBtn();
  showToast('Kinet est installé');
  logEvent('pwa_install'); // voir js/logging.js, section "Croissance" de l'onglet admin
});

async function handleInstallClick(){
  if(!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice; // { outcome: 'accepted' | 'dismissed' }
  // Un choix (accepté ou refusé) consomme l'évènement : Chrome n'en
  // redonne pas un identique tant que rien n'a changé côté app/navigateur.
  deferredInstallPrompt = null;
  updateInstallUI();
  updateInstallHeaderBtn();
}

// Appelée à l'ouverture de la modale profil (js/profile.js) et par les
// deux évènements ci-dessus — reconstruit #installSectionContent selon
// l'état courant plutôt que de le supposer figé depuis le chargement de
// la page (le prompt natif peut apparaître après coup).
function updateInstallUI(){
  const el = document.getElementById('installSectionContent');
  if(!el) return;

  if(isStandaloneDisplay()){
    el.innerHTML = `<div class="wl-note">✓ Déjà installée sur cet appareil.</div>`;
    return;
  }

  if(deferredInstallPrompt){
    el.innerHTML = `
      <div class="wl-note">Ajoute Kinet à ton écran d'accueil ou ton bureau. Ça s'ouvre comme une vraie app, plein écran, sans passer par le navigateur.</div>
      <button class="btn secondary" id="installNowBtn" type="button">Installer l'app</button>
    `;
    document.getElementById('installNowBtn').addEventListener('click', handleInstallClick);
    return;
  }

  if(isIOSDevice()){
    el.innerHTML = `<div class="wl-note">Sur iPhone/iPad : bouton <b>Partager</b> de Safari (le carré avec la flèche vers le haut), puis <b>Sur l'écran d'accueil</b>.</div>`;
    return;
  }

  // Ni prompt natif ni iOS : soit un navigateur sans support (Firefox
  // desktop, par ex.), soit un Chrome/Edge qui n'a pas encore jugé le site
  // "installable" (le prompt met parfois quelques instants/visites à
  // apparaître) — un message générique plutôt qu'un bouton mort.
  el.innerHTML = `<div class="wl-note">Ton navigateur ne propose pas encore l'installation ici. Essaie avec Chrome ou Edge (téléphone ou PC), ou reviens dans quelques instants.</div>`;
}

// --- Icône d'entête (#installHeaderBtn, v2.1) ---
// Masquée si déjà installée ou si rien de concret à proposer (jamais de
// bouton mort) — accès permanent au même titre que Watchlist/Amis/Top
// juste à côté, pas de mémoire de fermeture à gérer ici.
function updateInstallHeaderBtn(){
  const btn = document.getElementById('installHeaderBtn');
  if(!btn) return;
  btn.style.display = (!isStandaloneDisplay() && (deferredInstallPrompt || isIOSDevice())) ? '' : 'none';
}

// Prompt natif dispo : un seul clic suffit, comme les 2 autres surfaces.
// iOS n'a pas de prompt déclenchable en JS (Safari ne l'expose pas) —
// mêmes instructions manuelles qu'ailleurs, en toast plutôt qu'en modale
// pour un simple rappel qu'on connaît déjà en général la 2e fois.
document.getElementById('installHeaderBtn').addEventListener('click', () => {
  if(deferredInstallPrompt) handleInstallClick();
  else if(isIOSDevice()) showToast("Bouton Partager de Safari, puis \"Sur l'écran d'accueil\"");
});

// Premier calcul au chargement : iOS n'a pas d'évènement à attendre
// (isIOSDevice() est vrai ou faux dès le départ), donc sans cet appel
// l'icône resterait masquée indéfiniment sur iPhone/iPad tant qu'aucun
// beforeinstallprompt ne se déclenche — ce qui n'arrive jamais là-bas.
updateInstallHeaderBtn();
