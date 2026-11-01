// --- Ce que l'appareil garde pour l'avion (retour de Flix, 01/11) ---
// Chercher sans réseau : TMDB n'étant plus joignable, la recherche se fait dans
// un catalogue embarqué (data/, voir scripts/build-catalogue.js), sans résumé
// mais avec titre, année et affiche : de quoi noter ou ajouter à À voir. Le reste
// de la fiche arrive au retour du réseau, voir afterOfflineSync() (js/offline.js).
//
// prepareOffline() garde d'avance ce qui ne s'ouvre pas tout seul : les saisons
// et épisodes de tes séries. Une fois par jour en douceur, et d'un coup avec
// « Préparer le hors ligne » (Paramètres), affiches comprises.

const CATALOGUE_VERSION = 1; // à monter après avoir relancé scripts/build-catalogue.js
const CATALOGUE_FILES = { movie: 'catalogue-films', tv: 'catalogue-series' };
const OFFLINE_PREP_KEY = 'kinetOfflinePrep';
const OFFLINE_PREP_EVERY_MS = 24 * 60 * 60 * 1000;
const OFFLINE_SHOW_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OFFLINE_PREP_DELAY_MS = 15000;

const offlineCatalogues = {};

function catalogueUrl(mediaType){
  return `data/${CATALOGUE_FILES[mediaType]}.json?c=${CATALOGUE_VERSION}`;
}

// Une ligne du fichier, dans la forme de searchTmdbGeneric() (js/tmdb.js).
function catalogueRowToResult(row){
  return {
    id: row[0], title: row[1], original_title: row[2] || null,
    // Le fichier n'a que l'année, et les pages la lisent dans cette date.
    release_date: row[3] ? `${row[3]}-01-01` : null, release_year: row[3] || null,
    poster_path: row[4] ? `/${row[4]}` : null, overview: null,
    genre_ids: row[5] || [], popularity: row[6] || 0,
  };
}

async function loadOfflineCatalogue(mediaType){
  if(offlineCatalogues[mediaType]) return offlineCatalogues[mediaType];
  try{
    const res = await fetch(catalogueUrl(mediaType));
    if(!res.ok) return [];
    const rows = await res.json();
    offlineCatalogues[mediaType] = rows.map(row => ({ row, key: `${normalizeSearch(row[1])} ${normalizeSearch(row[2] || '')}` }));
    return offlineCatalogues[mediaType];
  }catch(e){
    console.error(e);
    return [];
  }
}

// Tous les mots de la recherche, dans n'importe quel ordre ; le titre exact,
// puis celui qui commence pareil, puis le plus connu.
function searchCatalogueEntries(entries, query){
  const queryNorm = normalizeSearch(query);
  const words = queryNorm.split(/\s+/).filter(Boolean);
  if(words.length === 0) return [];
  const score = (r) => tmdbRelevanceScore(r, queryNorm) + (normalizeSearch(r.title).startsWith(queryNorm) ? 1e5 : 0);
  return entries
    .filter(entry => words.every(w => entry.key.includes(w)))
    .map(entry => catalogueRowToResult(entry.row))
    .sort((a, b) => score(b) - score(a))
    .slice(0, 6);
}

async function searchOfflineCatalogue(query, mediaType){
  return searchCatalogueEntries(await loadOfflineCatalogue(mediaType), query);
}

// Fiche d'un film sans réseau : ce que l'appareil en sait.
async function offlineFilmData(tmdbId){
  const own = films.find(f => f.tmdbId === tmdbId) || watchlist.find(w => w.tmdbId === tmdbId);
  if(own){
    return {
      tmdb_id: tmdbId, title: own.title, original_title: own.originalTitle || null,
      poster_url: own.posterUrl || null, backdrop_path: null, overview: own.overview || null,
      release_year: own.releaseYear || null, release_date: own.releaseDate || null,
      genre_ids: own.genreIds || [], runtime: null,
    };
  }
  const entry = (await loadOfflineCatalogue('movie')).find(e => e.row[0] === tmdbId);
  if(!entry) return null;
  const r = catalogueRowToResult(entry.row);
  return {
    tmdb_id: r.id, title: r.title, original_title: r.original_title,
    poster_url: r.poster_path ? TMDB_IMG_BASE + r.poster_path : null, backdrop_path: null, overview: null,
    release_year: r.release_year, release_date: null, genre_ids: r.genre_ids, runtime: null,
  };
}

function offlinePrepState(){
  try{ return JSON.parse(localStorage.getItem(OFFLINE_PREP_KEY)) || { at: 0, shows: {} }; }
  catch(e){ return { at: 0, shows: {} }; }
}

function saveOfflinePrepState(state){
  try{ localStorage.setItem(OFFLINE_PREP_KEY, JSON.stringify(state)); }catch(e){ console.error(e); }
}

async function forEachLimited(items, limit, fn){
  let next = 0;
  const worker = async () => {
    while(next < items.length){
      const i = next++;
      await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function prepareShowForOffline(show, state, refreshTmdb){
  // Même lecture que loadWatchedEpisodes() (js/series.js) : c'est elle qui sera
  // resservie à l'ouverture de la fiche.
  await supabaseClient.from('tv_episodes_watched').select(WATCHED_EPISODES_SELECT).eq('tv_show_id', show.id);
  if(!refreshTmdb || !show.tmdbId) return;
  const details = await fetchTvDetails(show.tmdbId);
  const seasons = (details.seasons || []).filter(s => s.season_number > 0);
  for(const s of seasons) await fetchTvSeason(show.tmdbId, s.season_number);
  state.shows[show.tmdbId] = Date.now();
}

let offlinePrepRunning = null;

// full : tout, affiches et fiches d'À voir comprises (bouton des Paramètres).
function prepareOffline(full, onProgress){
  if(offlinePrepRunning) return offlinePrepRunning;
  offlinePrepRunning = runOfflinePrep(full, onProgress).finally(() => { offlinePrepRunning = null; });
  return offlinePrepRunning;
}

async function runOfflinePrep(full, onProgress){
  if(isOfflineMode) return false;
  if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  await Promise.all(Object.keys(CATALOGUE_FILES).map(m => fetch(catalogueUrl(m)).catch(e => console.error(e))));
  await Promise.all([loadWatchlist(), loadTrackedShows()]);

  const state = offlinePrepState();
  const now = Date.now();
  const staleShow = (show) => full || now - (state.shows[show.tmdbId] || 0) > OFFLINE_SHOW_TTL_MS;
  const posters = full ? [...new Set([...trackedShows, ...watchlist, ...films].map(x => x.posterUrl).filter(Boolean))] : [];
  const fiches = full ? watchlist.filter(w => w.tmdbId) : [];
  const total = trackedShows.length + fiches.length + posters.length;
  let done = 0;
  const tick = () => { done++; if(onProgress) onProgress(done, total); };

  await forEachLimited(trackedShows, 3, async show => {
    try{ await prepareShowForOffline(show, state, staleShow(show)); }
    catch(e){ console.error(e); }
    tick();
  });
  await forEachLimited(fiches, 4, async item => {
    try{ await fetchMovieDetails(item.tmdbId); }catch(e){ console.error(e); }
    tick();
  });
  await forEachLimited(posters, 6, async url => {
    try{ await fetch(url, { mode: 'cors', credentials: 'omit' }); }catch(e){ console.error(e); }
    tick();
  });
  state.at = Date.now();
  saveOfflinePrepState(state);
  return !isOfflineMode;
}

// Une fois par jour, un peu après le démarrage, jamais en mode économie de données.
function scheduleOfflinePrep(){
  if(navigator.connection && navigator.connection.saveData) return;
  if(Date.now() - offlinePrepState().at < OFFLINE_PREP_EVERY_MS) return;
  setTimeout(() => { prepareOffline(false).catch(e => console.error(e)); }, OFFLINE_PREP_DELAY_MS);
}

// --- Rangée des Paramètres ---
function renderSettingsOffline(){
  const sub = document.getElementById('settingsOfflineSub');
  if(!sub) return;
  const at = offlinePrepState().at;
  sub.textContent = at
    ? `Prêt depuis le ${new Date(at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}, tes séries et le catalogue sont sur l’appareil`
    : 'Pour noter et chercher dans l’avion : garde tes séries et le catalogue sur l’appareil';
}

async function handlePrepareOffline(){
  if(blockIfOffline()) return;
  const sub = document.getElementById('settingsOfflineSub');
  sub.textContent = 'Préparation…';
  const ok = await prepareOffline(true, (done, total) => { sub.textContent = `Préparation : ${done} sur ${total}`; }).catch(e => { console.error(e); return false; });
  renderSettingsOffline();
  showToast(ok ? 'Prêt pour le hors ligne' : 'Préparation interrompue, réessaie');
}

document.getElementById('settingsOfflineBtn').addEventListener('click', handlePrepareOffline);
