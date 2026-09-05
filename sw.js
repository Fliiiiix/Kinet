// Service worker minimal : met en cache au fil de l'eau ce qui a été
// chargé avec succès (stratégie "réseau, puis repli sur le cache"), pour
// que l'app s'ouvre encore sans réseau après une 1re visite en ligne. Pas
// de liste de fichiers à pré-charger ni à maintenir à la main : chaque
// ?v=N (voir index.html) est une URL différente, donc se met en cache
// tout seul dès la 1re visite après un déploiement. Voir js/offline.js
// pour l'enregistrement et le cache des DONNÉES (films/watchlist/
// viewings) ; ce fichier ne s'occupe que de l'app shell (HTML/CSS/JS).

// IMPORTANT — à bumper à CHAQUE déploiement, en même temps que ?v=N dans
// index.html (retour utilisateur, v2.1.x : l'app restait bloquée sur une
// vieille version tant qu'on ne faisait pas ctrl+maj+r à la main). Un
// sw.js dont les octets n'ont pas changé n'est jamais redétecté comme
// "nouveau" par le navigateur (le fichier lui-même ne référence aucun
// ?v=N) — ce numéro EST le seul signal qui déclenche l'installation d'un
// nouveau service worker, et donc la détection de mise à jour côté client
// (voir watchForUpdate() dans js/offline.js). Il purge aussi le cache
// ci-dessous à chaque déploiement plutôt que de le laisser grossir sans
// fin (chaque ?v=N étant une URL distincte, jamais réutilisée).
const CACHE_NAME = 'critique-films-shell-v105';

self.addEventListener('activate', (event) => {
  // Nettoie le cache de toute version antérieure (voir CACHE_NAME
  // ci-dessus, désormais bumpé à chaque déploiement).
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// Permet à js/offline.js de forcer l'activation d'un SW resté "en
// attente" (registration.waiting) dès que l'utilisateur clique
// "Actualiser" sur le bandeau de mise à jour, plutôt que d'attendre que
// tous les onglets de l'ancienne version se ferment d'eux-mêmes.
self.addEventListener('message', (event) => {
  if(event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  if(event.request.method !== 'GET') return; // jamais les écritures (Supabase POST/PATCH/DELETE...)
  const url = new URL(event.request.url);
  // Seulement l'app elle-même (même origine) : jamais Supabase/TMDB
  // (données vivantes, aucun sens à les servir depuis un cache statique —
  // c'est le rôle du cache localStorage de js/offline.js) ni le CDN
  // supabase-js (déjà mis en cache HTTP par le navigateur comme n'importe
  // quelle ressource externe).
  if(url.origin !== self.location.origin) return;

  // no-store : ignore le cache HTTP du navigateur pour cette requête réseau
  // (GitHub Pages sert index.html avec Cache-Control: max-age=600 — sans
  // ça, un simple F5 dans les 10 min suivant un déploiement pouvait encore
  // récupérer l'ancienne page depuis le cache disque plutôt que le réseau,
  // stratégie "réseau d'abord" ci-dessus ou pas).
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then(res => {
        if(res.ok){
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
