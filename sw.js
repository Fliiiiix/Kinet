// Service worker : ce qui permet à Kinet de s'ouvrir et de tourner sans réseau.
// - L'app elle-même (HTML/CSS/JS) : gardée d'un coup à l'installation, la liste
//   se lit dans index.html, rien à maintenir à la main.
// - TMDB (fiches, saisons, épisodes) : réseau d'abord, sinon la dernière réponse.
// - Affiches et polices : gardées au premier affichage.
// - Catalogue de recherche (data/) : gardé jusqu'à la version suivante.
// Les données Supabase et les écritures vivent côté page, voir js/offlineNet.js.

// Le nom de ce cache change à chaque mise en ligne : un sw.js identique au
// précédent n'est jamais redétecté par le navigateur, et c'est ce nom qui
// déclenche l'installation d'une nouvelle version, donc le bandeau
// « Actualiser » (watchForUpdate(), js/offline.js). Il purge aussi l'ancien
// cache. La construction le remplace par une empreinte du site
// (vite.config.mjs) : rien à monter à la main. Ce v325 ne sert qu'en
// développement, et à reconnaître les caches d'avant Vite.
const CACHE_NAME = 'critique-films-shell-v325';
const TMDB_CACHE = 'kinet-tmdb-v1';
const IMAGE_CACHE = 'kinet-images-v1';
const FONT_CACHE = 'kinet-polices-v1';
const CATALOGUE_CACHE = 'kinet-catalogue-v1';
// Survivent aux déploiements, contrairement à CACHE_NAME.
const KEPT_CACHES = [TMDB_CACHE, IMAGE_CACHE, FONT_CACHE, CATALOGUE_CACHE, 'kinet-donnees-v1'];
const TMDB_MAX_ENTRIES = 4000;
const IMAGE_MAX_ENTRIES = 2500;
const NAVIGATION_WAIT_MS = 3000;
const TMDB_WAIT_MS = 4000;
const TMDB_GIVE_UP_MS = 8000;
// La page sait, elle, que le réseau ne répond plus (js/offlineNet.js) : plus la
// peine d'attendre, surtout sur un Wi-Fi d'avion qui ne répond jamais. Elle le
// redit à chaque essai : une page fermée entre-temps ne laisse pas tout coupé.
const PAGE_OFFLINE_MEMORY_MS = 60000;
let pageOfflineUntil = 0;
const isPageOffline = () => Date.now() < pageOfflineUntil;
// La v321 cassait toutes les affiches déjà vues : qui l'a reçue passe tout de
// suite à la correction, sans attendre le bandeau « Actualiser ».
const VERSION_A_REPARER = 'critique-films-shell-v321';

// Tout ce que index.html charge, gardé dès l'installation : sinon la toute
// première visite, faite avant que ce fichier ne prenne la main, ne garde rien.
async function precacheShell(){
  const cache = await caches.open(CACHE_NAME);
  const res = await fetch('index.html', { cache: 'no-store' });
  if(!res.ok) return;
  const html = await res.clone().text();
  await cache.put('index.html', res);
  const urls = [...html.matchAll(/(?:src|href)="(?:\.\/)?((?:assets|js|css|icons)\/[^"]+|manifest\.json[^"]*)"/g)].map(m => m[1]);
  await Promise.all(urls.map(url => cache.add(url).catch(() => {})));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await precacheShell().catch(e => console.error(e));
    if(await caches.has(VERSION_A_REPARER)) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  // Nettoie le cache de toute version antérieure (voir CACHE_NAME
  // ci-dessus, désormais bumpé à chaque déploiement).
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME && !KEPT_CACHES.includes(k)).map(k => caches.delete(k))
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
  if(event.data && typeof event.data.kinetOffline === 'boolean'){
    pageOfflineUntil = event.data.kinetOffline ? Date.now() + PAGE_OFFLINE_MEMORY_MS : 0;
  }
});

// Les plus anciennes entrées partent quand un cache devient trop gros.
const trimCounts = {};
async function trimCache(name, max){
  trimCounts[name] = (trimCounts[name] || 0) + 1;
  if(trimCounts[name] % 50 !== 0) return;
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for(let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

const wait = (ms, value) => new Promise(resolve => setTimeout(() => resolve(value), ms));

// Réseau d'abord, mais pas plus de quelques secondes si on a de quoi répondre :
// le Wi-Fi d'un avion accepte les requêtes sans jamais y répondre.
async function tmdbResponse(event){
  const url = event.request.url;
  const cache = await caches.open(TMDB_CACHE);
  const hit = await cache.match(url, { ignoreVary: true });
  if(isPageOffline()) return hit || Response.error();
  const stop = new AbortController();
  const giveUp = setTimeout(() => stop.abort(), TMDB_GIVE_UP_MS);
  const network = fetch(event.request, { signal: stop.signal }).then(res => {
    if(res.ok){
      event.waitUntil(cache.put(url, res.clone()).then(() => trimCache(TMDB_CACHE, TMDB_MAX_ENTRIES)).catch(() => {}));
    }
    return res;
  }).finally(() => clearTimeout(giveUp));
  if(!hit) return network;
  return Promise.race([network.catch(() => hit), wait(TMDB_WAIT_MS, hit)]);
}

// Gardé au premier passage. En mode cors : Chrome compte une réponse opaque
// plusieurs Mo dans le quota, quelques centaines d'affiches le rempliraient.
// cache: 'reload' est indispensable : le cache du navigateur garde les images
// déjà affichées sans leur autorisation cors (un <img> ne la demande pas), et une
// requête cors qui tombe dessus échoue (retour de Flix du 02/11 : toutes les
// affiches déjà vues cassées en v321). En dernier recours, le <img> d'origine.
async function crossOriginCacheFirst(event, cacheName, max){
  const url = event.request.url;
  const cache = await caches.open(cacheName);
  const hit = await cache.match(url, { ignoreVary: true });
  if(hit) return hit;
  if(isPageOffline()) return Response.error();
  try{
    const res = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'reload' });
    if(res.ok) event.waitUntil(cache.put(url, res.clone()).then(() => trimCache(cacheName, max)).catch(() => {}));
    return res;
  }catch(e){
    return fetch(event.request);
  }
}

async function catalogueResponse(event){
  const cache = await caches.open(CATALOGUE_CACHE);
  const hit = await cache.match(event.request);
  if(hit) return hit;
  const res = await fetch(event.request);
  if(res.ok){
    const url = new URL(event.request.url);
    for(const key of await cache.keys()){
      if(new URL(key.url).pathname === url.pathname) await cache.delete(key); // version précédente
    }
    await cache.put(event.request, res.clone());
  }
  return res;
}

// La page : réseau d'abord, sinon la dernière gardée. Quelle que soit l'adresse
// d'ouverture (./, index.html, ?source=pwa), c'est toujours index.html.
async function navigationResponse(event){
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match('index.html');
  const network = fetch(event.request, { cache: 'no-store' }).then(res => {
    if(res.ok) event.waitUntil(cache.put('index.html', res.clone()).catch(() => {}));
    return res;
  });
  if(!hit) return network;
  return Promise.race([network.catch(() => hit), wait(NAVIGATION_WAIT_MS, hit)]);
}

self.addEventListener('fetch', (event) => {
  if(event.request.method !== 'GET') return; // jamais les écritures (Supabase POST/PATCH/DELETE...)
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin){
    if(url.hostname === 'api.themoviedb.org') event.respondWith(tmdbResponse(event));
    else if(url.hostname === 'image.tmdb.org') event.respondWith(crossOriginCacheFirst(event, IMAGE_CACHE, IMAGE_MAX_ENTRIES));
    else if(url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') event.respondWith(crossOriginCacheFirst(event, FONT_CACHE, IMAGE_MAX_ENTRIES));
    return; // Supabase passe par js/offlineNet.js
  }
  if(url.pathname.includes('/data/catalogue-')){ event.respondWith(catalogueResponse(event)); return; }
  if(event.request.mode === 'navigate'){ event.respondWith(navigationResponse(event)); return; }

  // Fichiers nommés selon leur contenu (assets/, voir vite.config.mjs) ou
  // numérotés (?v=N) : servis tout de suite depuis le cache, puis revérifiés en
  // arrière-plan (audit général du 16/10, T1 : chaque visite retéléchargeait
  // les 49 fichiers de l'app, 900 Ko). La revérification passe par le cache
  // HTTP normal : le plus souvent une petite réponse 304.
  if(url.pathname.includes('/assets/') || url.searchParams.has('v')){
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      const network = fetch(event.request)
        .then(res => {
          if(res.ok) cache.put(event.request, res.clone());
          return res;
        })
        .catch(() => cached);
      if(cached){
        event.waitUntil(network.then(() => {}, () => {}));
        return cached;
      }
      return network;
    }));
    return;
  }

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
