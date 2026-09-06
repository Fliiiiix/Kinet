// --- Suggestions (v2.1, retour utilisateur) ---
// Section discrète sous la grille du catalogue (#suggestionsSection,
// index.html) : quelques recommandations TMDB calculées à partir des
// films favoris déjà notés (ou, à défaut, les mieux notés) — jamais un
// film déjà noté ou déjà dans la watchlist. Pas de table dédiée, calculé
// à la demande à chaque connexion, mêmes principes que Prochainement
// (js/upcoming.js) : un appel TMDB par film "graine", résultats croisés
// et dédupliqués côté client, plafonné pour rester léger.

let suggestedFilms = []; // résultats TMDB bruts (pas des films Kinet) affichés en ce moment

// Favoris d'abord (signal le plus fort : "j'ai aimé CE film précisément")
// — à défaut (aucun favori), les mieux notés (note affichée >= 4). Un film
// sans fiche TMDB ne peut pas servir de graine (pas d'id à interroger).
function pickSuggestionSeeds(){
  const favs = films.filter(f => f.fav && f.tmdbId);
  if(favs.length > 0) return favs.slice(0, 5);
  return films
    .filter(f => f.tmdbId && getDisplayNote(f) !== null && getDisplayNote(f) >= 4)
    .sort((a, b) => getDisplayNote(b) - getDisplayNote(a))
    .slice(0, 5);
}

function suggestionRowHtml(r){
  const year = r.release_date ? r.release_date.slice(0, 4) : null;
  const poster = r.poster_path ? TMDB_IMG_BASE + r.poster_path : null;
  return `
    <div class="wl-row">
      ${poster
        ? `<img class="film-poster" src="${poster}" alt="" loading="lazy">`
        : `<div class="film-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="wl-main">
        <div class="wl-title">${escapeHtml(r.title)}${year ? ` <span class="wl-year">(${year})</span>` : ''}</div>
        <div class="wl-note">Parce que tu aimes des films similaires</div>
      </div>
      <div class="wl-actions">
        <button class="btn secondary" data-action="add-watchlist" data-id="${r.id}" type="button">+ À voir</button>
      </div>
    </div>
  `;
}

function renderSuggestionsList(){
  const list = document.getElementById('suggestionsList');
  list.innerHTML = suggestedFilms.map(suggestionRowHtml).join('');
  list.querySelectorAll('[data-action="add-watchlist"]').forEach(btn => {
    btn.addEventListener('click', withSubmitGuard(btn, () => addSuggestionToWatchlist(Number(btn.dataset.id))));
  });
}

async function loadSuggestions(){
  const section = document.getElementById('suggestionsSection');
  const seeds = pickSuggestionSeeds();
  if(seeds.length === 0){ section.style.display = 'none'; return; }

  // watchlist n'est chargée qu'en ouvrant #/watchlist (voir js/watchlist.js) —
  // pas garantie disponible ici, même principe que loadUpcoming() (js/upcoming.js).
  if(watchlist.length === 0) await loadWatchlist();

  const known = new Set([
    ...films.filter(f => f.tmdbId).map(f => f.tmdbId),
    ...watchlist.filter(w => w.tmdbId).map(w => w.tmdbId)
  ]);

  const perSeedResults = await Promise.all(seeds.map(async seed => {
    try{
      const url = `https://api.themoviedb.org/3/movie/${seed.tmdbId}/recommendations?language=fr-FR`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${TMDB_API_KEY}`, Accept: 'application/json' } });
      if(!res.ok) return [];
      const data = await res.json();
      return data.results || [];
    }catch(e){
      console.error(e);
      return [];
    }
  }));

  // Un même film recommandé par plusieurs graines = signal plus fort,
  // remonte en premier — vote_average TMDB en départage.
  const scoreById = {};
  const infoById = {};
  perSeedResults.flat().forEach(r => {
    if(known.has(r.id)) return; // déjà noté ou déjà dans la watchlist
    scoreById[r.id] = (scoreById[r.id] || 0) + 1;
    if(!infoById[r.id]) infoById[r.id] = r;
  });

  suggestedFilms = Object.keys(scoreById)
    .map(id => ({ id: Number(id), score: scoreById[id] }))
    .sort((a, b) => b.score - a.score || (infoById[b.id].vote_average || 0) - (infoById[a.id].vote_average || 0))
    .slice(0, 10)
    .map(x => infoById[x.id]);

  if(suggestedFilms.length === 0){ section.style.display = 'none'; return; }
  section.style.display = '';
  renderSuggestionsList();
}

async function addSuggestionToWatchlist(tmdbId){
  if(blockIfOffline()) return; // js/offline.js — lecture seule hors ligne
  const r = suggestedFilms.find(x => x.id === tmdbId);
  if(!r) return;
  const payload = {
    title: r.title,
    note: null,
    added: Date.now(),
    tmdb_id: r.id,
    poster_url: r.poster_path ? TMDB_IMG_BASE + r.poster_path : null,
    overview: r.overview || null,
    release_year: r.release_date ? parseInt(r.release_date.slice(0, 4), 10) : null,
    release_date: r.release_date || null,
    original_title: r.original_title && r.original_title !== r.title ? r.original_title : null
  };
  const { data, error } = await supabaseClient.from('watchlist').insert(payload).select().single();
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  watchlist.unshift({
    id: data.id, title: payload.title, note: null,
    tmdbId: payload.tmdb_id, posterUrl: payload.poster_url, overview: payload.overview,
    releaseYear: payload.release_year, releaseDate: payload.release_date,
    originalTitle: payload.original_title, added: data.added
  });
  suggestedFilms = suggestedFilms.filter(x => x.id !== tmdbId);
  if(suggestedFilms.length === 0) document.getElementById('suggestionsSection').style.display = 'none';
  else renderSuggestionsList();
  showToast('Ajouté à la watchlist');
}
