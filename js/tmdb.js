// --- Recherche TMDB (affiche, résumé, année) ---
// Docs : https://developer.themoviedb.org/reference/search-movie
// Le champ "Titre du film" fait office de recherche : on interroge TMDB en
// direct pendant la frappe (debounce), pas besoin d'un champ ni d'un bouton
// séparés. Choisir un résultat renseigne aussi le titre. Résultat choisi
// stocké dans tmdbSelected, lu par handleSave() (js/app.js) à l'enregistrement.

let tmdbSelected = null; // { tmdb_id, poster_url, overview, release_year, title, original_title, genre_ids }
let tmdbSearchTimer = null;

// Point d'entrée générique films/séries — /search/movie et /search/tv ne
// renvoient pas les mêmes noms de champs (title/release_date côté films,
// name/first_air_date côté séries) : on normalise ici une bonne fois vers
// la même forme déjà utilisée partout dans l'app plutôt que de dupliquer
// le mapping à chaque site d'appel. searchTmdb(query) (films, ci-dessous)
// et searchTmdbTv(query) (js/series.js) ne sont que des raccourcis dessus.
async function searchTmdbGeneric(query, mediaType){
  const url = `https://api.themoviedb.org/3/search/${mediaType}?language=fr-FR&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${TMDB_API_KEY}`,
      'Accept': 'application/json'
    }
  });
  if(!res.ok){
    throw new Error(res.status === 401 ? 'Clé TMDB invalide ou non configurée (voir js/tmdbConfig.js)' : `Erreur TMDB (${res.status})`);
  }
  const data = await res.json();
  return (data.results || []).slice(0, 6).map(r => {
    const title = mediaType === 'tv' ? r.name : r.title;
    const originalTitle = mediaType === 'tv' ? r.original_name : r.original_title;
    const dateStr = mediaType === 'tv' ? r.first_air_date : r.release_date;
    return {
      id: r.id,
      title,
      original_title: originalTitle && originalTitle !== title ? originalTitle : null,
      release_date: dateStr || null,
      release_year: dateStr ? parseInt(dateStr.slice(0, 4), 10) : null,
      poster_path: r.poster_path || null,
      overview: r.overview || null,
      // Ids bruts TMDB (voir GENRE_MAP, js/data.js) — /search/movie les
      // renvoie déjà, aucun appel supplémentaire nécessaire. Non pertinent
      // côté séries (taxonomie TMDB différente, jamais utilisé pour elles).
      genre_ids: r.genre_ids || [],
      // Popularité TMDB brute — utilisée par bestTmdbCandidate() (js/
      // importExternal.js) pour départager plusieurs fiches candidates au
      // même titre/année (ex. le vrai film vs un making-of homonyme).
      popularity: typeof r.popularity === 'number' ? r.popularity : 0
    };
  });
}

async function searchTmdb(query){
  return searchTmdbGeneric(query, 'movie');
}

// Wrapper symétrique à searchTmdb(), pour les séries (js/series.js).
async function searchTmdbTv(query){
  return searchTmdbGeneric(query, 'tv');
}

// Détail d'un film — résumé complet + genres, pour la fiche film (v2.1,
// js/filmDetail.js). Un film cliqué chez un ami/dans le Top n'est pas
// forcément dans notre propre catalogue/watchlist : toujours rappelé en
// direct plutôt que de dépendre d'une donnée déjà en mémoire.
// https://developer.themoviedb.org/reference/movie-details
async function fetchMovieDetails(tmdbId){
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}?language=fr-FR`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${TMDB_API_KEY}`, 'Accept': 'application/json' }
  });
  if(!res.ok) throw new Error(`Erreur TMDB (${res.status})`);
  return res.json();
}

// Détail d'une série — statut TMDB, saisons, prochain/dernier épisode.
// Jamais stocké tel quel côté Supabase au-delà de l'instantané pris à
// l'ajout (voir js/series.js) : toujours rappelé en direct pour rester à
// jour sur une série encore en diffusion.
// https://developer.themoviedb.org/reference/tv-series-details
async function fetchTvDetails(tmdbId){
  const url = `https://api.themoviedb.org/3/tv/${tmdbId}?language=fr-FR`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${TMDB_API_KEY}`, 'Accept': 'application/json' }
  });
  if(!res.ok) throw new Error(`Erreur TMDB (${res.status})`);
  return res.json();
}

// Épisodes d'une saison précise — appelé seulement à l'expansion de cette
// saison dans l'UI (js/series.js), jamais pour toutes les saisons d'un
// coup : une série avec beaucoup de saisons ne doit pas déclencher une
// rafale d'appels réseau à l'ouverture du détail.
// https://developer.themoviedb.org/reference/tv-season-details
async function fetchTvSeason(tmdbId, seasonNumber){
  const url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}?language=fr-FR`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${TMDB_API_KEY}`, 'Accept': 'application/json' }
  });
  if(!res.ok) throw new Error(`Erreur TMDB (${res.status})`);
  return res.json();
}

function renderTmdbResults(results){
  const wrap = document.getElementById('tmdbResults');
  if(!results.length){
    wrap.innerHTML = `<div class="tmdb-empty">Aucun résultat.</div>`;
    return;
  }
  wrap.innerHTML = '';
  results.forEach(r => {
    const year = r.release_date ? r.release_date.slice(0, 4) : '?';
    const poster = r.poster_path ? TMDB_IMG_BASE + r.poster_path : null;
    const item = document.createElement('div');
    item.className = 'tmdb-result';
    item.innerHTML = `
      ${poster ? `<img src="${poster}" alt="">` : `<div class="tmdb-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="tmdb-result-info">
        <div class="tmdb-result-title">${escapeHtml(r.title)}</div>
        <div class="tmdb-result-year">${year}</div>
      </div>
    `;
    // mousedown (pas click) : se déclenche avant le blur du champ titre,
    // qui sinon referme les résultats avant que le clic soit pris en compte.
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectTmdbResult(r); });
    wrap.appendChild(item);
  });
}

function selectTmdbResult(r){
  tmdbSelected = {
    tmdb_id: r.id,
    poster_url: r.poster_path ? TMDB_IMG_BASE + r.poster_path : null,
    overview: r.overview || null,
    release_year: r.release_date ? parseInt(r.release_date.slice(0, 4), 10) : null,
    title: r.title,
    // Titre en langue d'origine (déjà renvoyé par /search/movie, pas d'appel
    // TMDB supplémentaire) — permet à la recherche du catalogue de matcher
    // le titre FR ou VO indifféremment, voir getSearchTerms() dans app.js.
    original_title: r.original_title && r.original_title !== r.title ? r.original_title : null,
    genre_ids: r.genre_ids || []
  };
  document.getElementById('titleInput').value = r.title;
  document.getElementById('tmdbResults').innerHTML = '';
  updateTmdbSelectedUI();
}

function clearTmdbSelection(){
  tmdbSelected = null;
  updateTmdbSelectedUI();
}

// L'affiche (colonne dédiée, voir .film-modal-poster-col dans index.html)
// est découplée de la boîte texte (titre + "Retirer la fiche TMDB") : la
// première reste TOUJOURS visible (une vraie affiche une fois choisie,
// sinon le repli neutre .film-poster-placeholder déjà utilisé partout
// ailleurs dans l'app), la seconde ne s'affiche qu'une fois une fiche
// choisie, comme avant.
function updateTmdbSelectedUI(){
  const box = document.getElementById('tmdbSelected');
  const img = document.getElementById('tmdbSelectedPoster');
  const placeholder = document.getElementById('filmModalPosterPlaceholder');
  const posterUrl = tmdbSelected ? tmdbSelected.poster_url : null;
  if(posterUrl){
    img.src = posterUrl;
    img.style.display = '';
    placeholder.style.display = 'none';
  }else{
    img.style.display = 'none';
    placeholder.style.display = '';
  }
  if(!tmdbSelected){
    box.style.display = 'none';
    return;
  }
  box.style.display = '';
  document.getElementById('tmdbSelectedTitle').textContent =
    tmdbSelected.title + (tmdbSelected.release_year ? ` (${tmdbSelected.release_year})` : '');
}

async function handleTmdbSearch(query){
  const wrap = document.getElementById('tmdbResults');
  wrap.innerHTML = `<div class="tmdb-empty">Recherche…</div>`;
  try{
    const results = await searchTmdb(query);
    renderTmdbResults(results);
  }catch(e){
    wrap.innerHTML = `<div class="tmdb-empty">${escapeHtml(e.message)}</div>`;
    console.error(e);
  }
}

document.getElementById('titleInput').addEventListener('input', () => {
  clearTimeout(tmdbSearchTimer);
  const query = document.getElementById('titleInput').value.trim();
  if(query.length < 2){
    document.getElementById('tmdbResults').innerHTML = '';
    return;
  }
  tmdbSearchTimer = setTimeout(() => handleTmdbSearch(query), 350);
});
document.getElementById('titleInput').addEventListener('blur', () => {
  // Léger délai pour laisser le mousedown sur un résultat s'exécuter avant
  // que la liste ne disparaisse.
  setTimeout(() => { document.getElementById('tmdbResults').innerHTML = ''; }, 150);
});
document.getElementById('tmdbClearBtn').addEventListener('click', clearTmdbSelection);
