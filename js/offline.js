// --- Mode hors ligne ---
// Dans l'avion, Kinet marche comme au sol : voir, noter, chercher, À voir, cocher
// ses épisodes (retour de Flix, 01/11). Quatre pièces :
// - sw.js : l'app elle-même, les fiches TMDB et les affiches ;
// - js/offlineNet.js : les données Supabase, gardées et corrigées par la file ;
// - js/offlineQueue.js : les écritures, envoyées au retour du réseau ;
// - js/offlinePrep.js : la recherche sans réseau et ce qui est gardé d'avance.
// Ce fichier fait le lien avec l'écran. Ce qui suppose les autres (amis, groupes,
// commentaires, listes, cartes) reste bloqué par blockIfOffline(), ou échoue avec
// le message d'erreur habituel.

function updateOfflineBanner(){
  const banner = document.getElementById('offlineBanner');
  if(!banner) return;
  const pending = offlineQueue.length;
  const parts = [];
  if(isOfflineMode) parts.push('Hors ligne');
  if(pending) parts.push(`${pending} action${pending > 1 ? 's' : ''} à envoyer`);
  banner.textContent = parts.join(' · ');
  banner.style.display = parts.length ? '' : 'none';
}

// Le service worker cesse d'attendre TMDB : sans réseau, il répond tout de suite.
function tellServiceWorkerNetwork(){
  const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
  if(sw) sw.postMessage({ kinetOffline: isOfflineMode });
}

function onOfflineChange(){
  loadOfflineQueue();
  updateOfflineBanner();
  tellServiceWorkerNetwork();
}

// Garde des actions qui supposent le réseau : renvoie true (et prévient) si
// l'action doit être bloquée.
function blockIfOffline(){
  if(!isOfflineMode) return false;
  showToast('Hors ligne, reconnecte-toi pour ça');
  return true;
}

// Ce qui n'a pas pu se faire sans réseau : résumé et saisons (le catalogue gardé
// n'en a pas), cartes à collectionner.
async function completeOfflineCreation({ table, row, saved }){
  if(!saved || !row.tmdb_id) return;
  try{
    if(table === 'tv_shows'){
      const d = await fetchTvDetails(row.tmdb_id);
      await supabaseClient.from('tv_shows').update({
        overview: d.overview || null, status: d.status || null, in_production: !!d.in_production,
        number_of_seasons: d.number_of_seasons || null, number_of_episodes: d.number_of_episodes || null,
      }).eq('id', saved.id);
    }else if(table === 'films' || table === 'watchlist'){
      generateTcgCardsForFilm(row.tmdb_id);
      if(saved.overview) return;
      const d = await fetchMovieDetails(row.tmdb_id);
      const fields = { overview: d.overview || null };
      if(table === 'watchlist') fields.release_date = d.release_date || null; // le catalogue n'a que l'année
      await supabaseClient.from(table).update(fields).eq('id', saved.id);
    }
  }catch(e){
    console.error(e);
  }
}

// Envoie ce qui attend. Renvoie le bilan, ou null si rien n'est parti.
async function syncOfflineWrites(){
  loadOfflineQueue();
  updateOfflineBanner();
  if(isOfflineMode) return null;
  const result = await replayOfflineQueue();
  updateOfflineBanner();
  if(!result) return null;
  if(result.sent) showToast(`${result.sent} action${result.sent > 1 ? 's' : ''} envoyée${result.sent > 1 ? 's' : ''}`);
  if(result.refused) showToast(`${result.refused} action${result.refused > 1 ? 's' : ''} refusée${result.refused > 1 ? 's' : ''} par le serveur`);
  result.created.forEach(c => { completeOfflineCreation(c); });
  return result;
}

// Une série suivie en vol porte un numéro provisoire jusque dans l'adresse.
function offlineRouteAfterSync(hash, idMap){
  const m = hash.match(/^#\/series\/(-\d{13,})/);
  return m && idMap[m[1]] != null ? `#/series/${idMap[m[1]]}` : hash;
}

// Appelée par probeNetwork() (js/offlineNet.js) : le réseau répond de nouveau.
async function onBackOnline(){
  updateOfflineBanner();
  tellServiceWorkerNetwork();
  if(!currentUser) return;
  const stale = servedFromDevice;
  servedFromDevice = false;
  const result = await syncOfflineWrites();
  if(!result && !stale) return; // simple raté de quelques secondes
  await Promise.all([loadFilms(), loadViewings(), loadWatchlist(), loadTrackedShows()]);
  const route = offlineRouteAfterSync(location.hash, result ? result.idMap : {});
  if(route !== location.hash) location.hash = route;
  render();
  renderRoute();
  if(!result) showToast('De retour en ligne');
}

// Sans réseau, ce qui suppose les autres (amis, groupes, listes, commentaires)
// n'arrive jamais : une phrase plutôt que des lignes grises sans fin.
// Appelée par skeletonRows() (js/ui.js), le seul endroit qui les crée.
const OFFLINE_SKELETON_WAIT_MS = 1500;
function settleOfflineSkeletonsSoon(){
  if(!isOfflineMode) return;
  setTimeout(() => {
    document.querySelectorAll('.skeleton-row:first-child').forEach(row => {
      row.parentElement.innerHTML = '<div class="tmdb-empty">Disponible au retour du réseau.</div>';
    });
  }, OFFLINE_SKELETON_WAIT_MS);
}

// Une affiche jamais vue n'est pas sur l'appareil : un cadre vide plutôt que
// l'icône d'image cassée du navigateur.
document.addEventListener('error', (e) => {
  if(isOfflineMode && e.target && e.target.tagName === 'IMG') e.target.style.visibility = 'hidden';
}, true);

// Anciennes copies, remplacées par js/offlineNet.js : elles occupaient le
// localStorage pour rien.
try{
  Object.keys(localStorage).filter(k => k.startsWith('offlineCache_')).forEach(k => localStorage.removeItem(k));
}catch(e){ /* stockage indisponible */ }

// --- Service worker (app shell) ---
// register() peut échouer silencieusement (navigation privée, navigateur
// sans support...) — dégradation normale, le reste de l'app fonctionne
// pareil, juste sans le filet de secours "page qui s'ouvre sans réseau".
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => watchForUpdate(reg))
      .catch(err => console.error('Échec de l\'enregistrement du service worker', err));
    navigator.serviceWorker.ready.then(tellServiceWorkerNetwork);
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
