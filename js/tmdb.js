// --- Recherche TMDB (affiche, résumé, année) ---
// Docs : https://developer.themoviedb.org/reference/search-movie
// Le champ "Titre du film" fait office de recherche : on interroge TMDB en
// direct pendant la frappe (debounce), pas besoin d'un champ ni d'un bouton
// séparés. Choisir un résultat renseigne aussi le titre. Résultat choisi
// stocké dans tmdbSelected, lu par handleSave() (js/app.js) à l'enregistrement.

let tmdbSelected = null; // { tmdb_id, poster_url, overview, release_year, title, original_title, genre_ids }
let tmdbSearchTimer = null;

// Score de pertinence d'un résultat TMDB déjà normalisé (forme
// {title, original_title, popularity, ...} ci-dessous) par rapport à une
// recherche. Partagé entre l'affichage des résultats juste en dessous ET
// bestTmdbCandidate() (js/importExternal.js, désambiguïsation à l'import)
// plutôt que deux logiques de pertinence différentes pour le même problème.
// Un titre EXACTEMENT identique (FR ou VO) l'emporte toujours sur tout le
// reste ; sinon la popularité TMDB départage, nécessaire car le classement
// "pertinence texte" brut de TMDB peut reléguer un film très populaire loin
// derrière des résultats obscurs qui ne partagent qu'un mot avec la requête
// (retour utilisateur, bug réel constaté : chercher "City of God" ne
// remontait pas "La Cité de Dieu"/"Cidade de Deus" dans les 6 premiers
// résultats affichés, TMDB renvoyant d'abord une poignée de résultats sans
// rapport dont le titre contient littéralement "city of god"/"city... god").
function tmdbRelevanceScore(r, queryNorm){
  const exactMatch = normalizeSearch(r.title || '') === queryNorm || normalizeSearch(r.original_title || '') === queryNorm;
  return (exactMatch ? 1e6 : 0) + (r.popularity || 0);
}

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
  const mapped = (data.results || []).map(r => {
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
      // Popularité TMDB brute, voir tmdbRelevanceScore() ci-dessus.
      popularity: typeof r.popularity === 'number' ? r.popularity : 0
    };
  });
  // Reclassé par pertinence (voir tmdbRelevanceScore()) AVANT de couper à 6.
  // Sur l'ordre brut de TMDB, le vrai film pouvait rester invisible, coupé
  // au-delà des 6 affichés. On garde le classement de TMDB comme
  // ensemble de candidats plausibles (aucun résultat de plus n'est ajouté),
  // seul l'ORDRE change, vers celui déjà utilisé pour l'import.
  const queryNorm = normalizeSearch(query);
  mapped.sort((a, b) => tmdbRelevanceScore(b, queryNorm) - tmdbRelevanceScore(a, queryNorm));
  return mapped.slice(0, 6);
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

// --- Où regarder (films ET séries, retour utilisateur) ---
// Données JustWatch via TMDB, une seule région (FR) : l'app n'a pas de
// sélecteur de pays, ni de raison d'en avoir un pour un usage perso en
// France. https://developer.themoviedb.org/reference/movie-watch-providers
// (même endpoint côté /tv). Jamais stocké, toujours rappelé en direct
// (même principe que fetchMovieDetails()/fetchTvDetails() ci-dessus) : un
// catalogue change de plateforme sans prévenir.
async function fetchWatchProviders(tmdbId, mediaType){
  const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/watch/providers`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${TMDB_API_KEY}`, 'Accept': 'application/json' }
  });
  if(!res.ok) throw new Error(`Erreur TMDB (${res.status})`);
  const data = await res.json();
  return (data.results && data.results.FR) || null;
}

// Un même service apparaît parfois dans plusieurs catégories à la fois
// (ex. Apple TV en location ET en achat), dédupliqué par provider_id,
// jamais montré deux fois dans la même ligne.
function watchProviderChipsHtml(items){
  const seen = new Set();
  return items
    .filter(p => {
      if(seen.has(p.provider_id)) return false;
      seen.add(p.provider_id);
      return true;
    })
    .map(p => `
      <span class="watch-provider-chip" title="${escapeHtml(p.provider_name)}">
        <img src="${WATCH_PROVIDER_IMG_BASE}${p.logo_path}" alt="${escapeHtml(p.provider_name)}" loading="lazy">
      </span>
    `)
    .join('');
}

// providers : le résultat FR déjà extrait par fetchWatchProviders() (ou
// null, film/série sans donnée pour la France ce jour-là). "Inclus avec"
// (flatrate, un abonnement déjà payé) mis en avant avant "Location/Achat" :
// c'est la question que tout le monde se pose en premier. providers.link
// (une page TMDB, pas un lien direct vers un service précis : l'API n'en
// fournit pas) sert d'échappatoire si aucune des plateformes listées ne
// convient. Attribution JustWatch toujours affichée à côté : imposée par
// TMDB pour l'usage de cet endpoint précis (contrairement au reste de
// l'app, où les données viennent directement de TMDB).
function renderWatchProvidersHtml(providers){
  if(!providers || (!providers.flatrate && !providers.rent && !providers.buy)){
    return `<div class="tmdb-empty">Pas d'info de disponibilité pour la France pour l'instant.</div>`;
  }
  const flatrateHtml = providers.flatrate ? `
    <div class="watch-provider-row">
      <span class="watch-provider-row-label">Inclus avec</span>
      <div class="watch-provider-chips">${watchProviderChipsHtml(providers.flatrate)}</div>
    </div>` : '';
  const buyRent = [...(providers.rent || []), ...(providers.buy || [])];
  const buyRentHtml = buyRent.length ? `
    <div class="watch-provider-row">
      <span class="watch-provider-row-label">Location/Achat</span>
      <div class="watch-provider-chips">${watchProviderChipsHtml(buyRent)}</div>
    </div>` : '';
  return `
    <div class="watch-providers">
      ${flatrateHtml}
      ${buyRentHtml}
      <a href="${providers.link}" target="_blank" rel="noopener" class="watch-provider-justwatch">Voir tout, données JustWatch ↗</a>
    </div>
  `;
}

// --- Photo de plateau en tête de fiche film/série (retour utilisateur),
// voir .detail-backdrop (css/style.css). backdropPath : details.backdrop_path
// brut de TMDB (déjà dans l'objet que fetchMovieDetails()/fetchTvDetails()
// renvoie, simplement jamais lu jusqu'ici) — null pour un titre qui n'en a
// pas, pas systématique. containerId/imgId : les deux fiches (film et
// série) partagent .detail-backdrop mais pas leurs id, un seul helper leur
// suffit en le paramétrant plutôt que dupliquer la même logique deux fois.
function renderDetailBackdrop(containerId, imgId, backdropPath){
  const container = document.getElementById(containerId);
  if(!backdropPath){
    container.style.display = 'none';
    return;
  }
  document.getElementById(imgId).src = TMDB_BACKDROP_IMG_BASE + backdropPath;
  container.style.display = '';
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
// Retour utilisateur : cliquer un film déjà noté ouvre direct cette modale
// (noter/modifier), sans accès à sa présentation (résumé, genre, note
// communautaire), pourtant déjà à un clic depuis la recherche ou le Top
// (goToFilmDetail(), js/router.js). Fonctionne aussi bien pour un film
// déjà dans le catalogue que pour une fiche TMDB tout juste choisie sur un
// nouveau film pas encore enregistré : les deux ont déjà un tmdb_id.
document.getElementById('tmdbViewFicheBtn').addEventListener('click', () => {
  if(!tmdbSelected) return;
  const tmdbId = tmdbSelected.tmdb_id;
  closeModal();
  goToFilmDetail(tmdbId);
});
