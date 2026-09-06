// --- Mode hors ligne ---
// Repose sur trois mécanismes complémentaires :
// 1. Un service worker (sw.js, enregistré plus bas) qui met en cache l'app
//    shell (HTML/CSS/JS) au fil des visites en ligne, pour que la page
//    elle-même s'ouvre encore sans réseau — sans lui, le cache de données
//    ci-dessous ne servirait à rien puisque le navigateur ne pourrait même
//    pas charger index.html/js/*.js en premier lieu.
// 2. Un cache localStorage des dernières listes chargées avec succès
//    (films/watchlist/viewings), utilisé en repli quand une requête
//    Supabase échoue — voir loadFilms()/loadViewings()/loadWatchlist().
// 3. File d'attente hors ligne (retour utilisateur, js/offlineQueue.js) :
//    les écritures à faible risque qui ciblent un id déjà connu ou une clé
//    naturelle (toggle favori, épisode vu/pas vu, retirer un item
//    watchlist/journal) restent possibles hors ligne, mises en file et
//    rejouées au retour du réseau (voir le listener 'online' plus bas).
//
// Le RESTE reste bloqué tant que le réseau n'est pas revenu
// (blockIfOffline(), toujours appelé depuis les CRÉATIONS — nouveau film,
// nouvel item watchlist, nouveau commentaire... — dont le résultat
// dépendrait d'un id généré par le serveur, jamais réconciliable après
// coup sans risque). Les fonctionnalités sociales (amis/groupes/
// propositions...) ne sont pas couvertes par la file non plus : elles
// supposent du réseau par nature (synchroniser avec quelqu'un d'autre),
// échouent proprement avec le toast d'erreur déjà en place si le réseau
// manque, comme avant cette version.

let isOfflineMode = false;

function offlineCacheKey(name){
  // Une clé par compte : pas de fuite d'un catalogue vers un autre si
  // plusieurs comptes se sont connectés sur le même navigateur.
  return `offlineCache_${name}_${currentUser.id}`;
}

function saveOfflineCache(name, value){
  if(!currentUser) return;
  try{
    localStorage.setItem(offlineCacheKey(name), JSON.stringify({ savedAt: Date.now(), data: value }));
  }catch(e){
    // Quota dépassé ou stockage désactivé (navigation privée...) : le mode
    // hors ligne ne marchera juste pas pour cette liste, pas la peine de
    // bloquer le reste de l'appli pour ça.
    console.error(e);
  }
}

function loadOfflineCache(name){
  if(!currentUser) return null;
  try{
    const raw = localStorage.getItem(offlineCacheKey(name));
    return raw ? JSON.parse(raw) : null;
  }catch(e){
    console.error(e);
    return null;
  }
}

function formatOfflineTimestamp(ms){
  return new Date(ms).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

// savedAt : celui du catalogue (source principale) — passé par loadFilms()
// quand il bascule en repli, seul appelant qui a cette info sous la main.
function enterOfflineMode(savedAt){
  isOfflineMode = true;
  // File d'attente hors ligne (js/offlineQueue.js) : recharge une file
  // laissée par une session précédente restée hors ligne (page fermée
  // sans être jamais revenue en ligne) — sans ça, une nouvelle action mise
  // en file cette session écraserait silencieusement celles d'avant au
  // premier saveOfflineQueueToStorage().
  loadOfflineQueue();
  const banner = document.getElementById('offlineBanner');
  banner.textContent = `📴 Hors ligne, dernières données synchronisées le ${formatOfflineTimestamp(savedAt)}. Tu peux quand même cocher/décocher, marquer favori, retirer un item — ce sera synchronisé au retour du réseau. Le reste (ajouter, commenter…) attend la reconnexion.`;
  banner.style.display = '';
}

function exitOfflineMode(){
  if(!isOfflineMode) return;
  isOfflineMode = false;
  document.getElementById('offlineBanner').style.display = 'none';
  showToast('De retour en ligne');
}

// Garde partagée pour les points d'entrée d'écriture du catalogue/
// watchlist (voir js/app.js, js/watchlist.js) — retourne true (et prévient
// l'utilisateur) si l'action doit être bloquée.
function blockIfOffline(){
  if(!isOfflineMode) return false;
  showToast('Hors ligne, reconnecte-toi pour modifier');
  return true;
}

// Retente un chargement complet quand le navigateur signale un retour de
// connexion — sans ça, l'utilisateur devrait recharger la page à la main
// pour sortir du mode hors ligne même une fois le réseau revenu.
// navigator.onLine n'est qu'un indice (peut rester true sur un réseau
// captif sans vraie sortie internet) : c'est loadFilms() qui tranche pour
// de vrai en retentant une requête réelle.
window.addEventListener('online', async () => {
  if(!isOfflineMode || !currentUser) return;
  // File d'attente hors ligne (retour utilisateur, js/offlineQueue.js) :
  // rejouée AVANT de recharger films/viewings, pour que la vraie source de
  // vérité relue juste après reflète déjà ce qui vient d'être synchronisé.
  await replayOfflineQueue();
  loadFilms().then(() => { render(); });
  loadViewings();
});

// --- Service worker (app shell) ---
// register() peut échouer silencieusement (navigation privée, navigateur
// sans support...) — dégradation normale, le reste de l'app fonctionne
// pareil, juste sans le filet de secours "page qui s'ouvre sans réseau".
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => watchForUpdate(reg))
      .catch(err => console.error('Échec de l\'enregistrement du service worker', err));
  });
}

// --- Détection de nouvelle version (v2.1.x, retour utilisateur : l'app
// restait sur une vieille version sans ctrl+maj+r, y compris chez des
// gens qui laissent l'onglet/l'app installée ouverte des jours entiers,
// donc rien ne redéclenche naturellement un chargement réseau) ---
// sw.js change de CACHE_NAME à CHAQUE déploiement (voir ce fichier) : le
// navigateur le détecte comme un fichier différent et installe un
// nouveau service worker "en attente" à côté de celui qui contrôle déjà
// la page — c'est cette installation qu'on écoute ici plutôt que de
// comparer un numéro de version nous-mêmes.
let updateReloadArmed = false;

function showUpdateBanner(reg){
  const el = document.getElementById('updateBanner');
  if(!el || el.style.display === 'flex') return;
  el.style.display = 'flex';
  document.getElementById('updateBannerBtn').onclick = () => {
    // skipWaiting() fait passer le SW en attente à "activé" ; le
    // controllerchange qui suit (voir plus bas) recharge la page — c'est
    // LUI qui sert enfin les nouveaux fichiers, pas ce clic en soi.
    if(reg.waiting) reg.waiting.postMessage('skipWaiting');
    else location.reload();
  };
}

function watchForUpdate(reg){
  if(reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg);

  reg.addEventListener('updatefound', () => {
    const installing = reg.installing;
    if(!installing) return;
    installing.addEventListener('statechange', () => {
      // "installed" + un controller déjà actif = une mise à jour vient
      // d'arriver derrière la version en cours d'utilisation (le tout
      // 1er install, sans controller, ne concerne personne qui utilise
      // déjà l'app — rien à annoncer).
      if(installing.state === 'installed' && navigator.serviceWorker.controller){
        showUpdateBanner(reg);
      }
    });
  });

  // Revérifie à chaque retour au premier plan : sur un onglet/PWA resté
  // ouvert plusieurs jours, c'est le seul moment où on a une chance
  // raisonnable de retenter — le navigateur ne revérifie sw.js tout seul
  // qu'au mieux une fois par jour.
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible') reg.update().catch(() => {});
  });

  // Le nouveau SW devient contrôleur juste après skipWaiting() ci-dessus —
  // recharger ICI (pas dans le clic lui-même) garantit que la page
  // rechargée est bien servie par le SW qui vient de prendre le relais.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if(updateReloadArmed) return;
    updateReloadArmed = true;
    location.reload();
  });
}
