// --- Séries suivies, à l'épisode près ---
// Section séparée du catalogue films (table `tv_shows`, voir
// supabase/migrations/024) — décision confirmée : deux sections
// distinctes, pas de fusion avec `films`. Contrairement à la watchlist,
// une série suivie exige une fiche TMDB (voir handleAddShow()) : sans
// elle, il n'y a aucune liste de saisons/épisodes sur laquelle s'appuyer
// pour le suivi, qui est tout l'intérêt de cette section.
//
// Écran à part entière (#/series), + route imbriquée #/series/:id pour le
// détail (contenu trop riche pour une popup — saisons/épisodes), même
// principe que Groupes (js/groups.js). Voir js/router.js.

let trackedShows = [];
let watchedEpisodeCounts = {}; // tv_show_id -> nombre d'épisodes vus (pour la liste)
let seriesTmdbSelected = null; // { tmdb_id, poster_url, overview, release_year, title, original_title }

let currentShowId = null;       // série affichée sur #seriesDetailPage
let currentShowSeasons = [];    // [{ season_number, name, episode_count, air_date }], depuis fetchTvDetails()
let watchedEpisodeSet = new Set(); // "saison-episode" vus, pour la série actuellement ouverte
// Note + nombre de fois vu par épisode (v2.39, retour utilisateur) —
// facultatifs, jamais l'essentiel (voir tv_shows.manual_note, la note
// globale) : "saison-episode" -> { note, timesWatched }, uniquement pour
// les clés présentes dans watchedEpisodeSet ci-dessus.
let watchedEpisodeExtras = {};
let loadedSeasonEpisodes = {};  // season_number -> episodes[] (TMDB), cache pour la série actuellement ouverte

function rowToShow(row){
  return {
    id: row.id,
    tmdbId: row.tmdb_id,
    title: row.title,
    posterUrl: row.poster_url || null,
    overview: row.overview || null,
    firstAirYear: row.first_air_year || null,
    status: row.status || null,
    numberOfSeasons: row.number_of_seasons || null,
    numberOfEpisodes: row.number_of_episodes || null,
    inProduction: !!row.in_production,
    manualNote: row.manual_note != null ? parseFloat(row.manual_note) : null,
    review: row.review || null,
    added: row.added
  };
}

// "Ended"/"Cancelled" = ne produira plus jamais de nouvelle saison — même
// distinction que la section Prochaines sorties (js/upcoming.js).
function isShowEnded(status){
  return status === 'Ended' || status === 'Cancelled';
}
function showStatusLabel(status){
  const labels = {
    'Returning Series': 'En diffusion',
    'Planned': 'Prévue',
    'In Production': 'En production',
    'Pilot': 'Pilote',
    'Ended': 'Terminée',
    'Cancelled': 'Annulée'
  };
  return labels[status] || status || 'Statut inconnu';
}

async function loadTrackedShows(){
  const { data, error } = await supabaseClient
    .from('tv_shows')
    .select('*')
    .order('added', { ascending: false });
  if(error){
    const cached = loadOfflineCache('tv_shows');
    if(cached){
      trackedShows = cached.data;
      enterOfflineMode(cached.savedAt);
      return;
    }
    showToast('Erreur de chargement des séries');
    console.error(error);
    trackedShows = [];
    return;
  }
  trackedShows = data.map(rowToShow);
  saveOfflineCache('tv_shows', trackedShows);

  // Progression de chaque série (X/Y épisodes vus) : un seul select groupé
  // plutôt qu'une requête par série — table de jointure légère, comptée
  // côté client (pas besoin d'une fonction SQL pour un simple group by
  // sur un jeu de données personnel).
  if(trackedShows.length > 0){
    const { data: watched, error: watchedErr } = await supabaseClient
      .from('tv_episodes_watched')
      .select('tv_show_id');
    if(watchedErr){
      console.error(watchedErr);
    }else{
      watchedEpisodeCounts = {};
      (watched || []).forEach(row => {
        watchedEpisodeCounts[row.tv_show_id] = (watchedEpisodeCounts[row.tv_show_id] || 0) + 1;
      });
    }
  }
}

function renderTrackedShows(){
  const list = document.getElementById('seriesList');
  if(trackedShows.length === 0){
    list.innerHTML = `<div class="empty-state">Rien pour l'instant. Cherche une série ci-dessus pour commencer à suivre ses épisodes.</div>`;
    return;
  }
  // v2.3, retour utilisateur : la tuile grille (poster + titre + progression
  // + pastille de statut + note + 2 boutons Ouvrir/Retirer) empilait 5
  // traitements visuels différents pour une seule série — "pas assez
  // symétrique ou cohérent". Alignée sur le gabarit de la tuile film
  // (poster, titre, UNE sous-ligne discrète, note) : toute la ligne ouvre
  // désormais la série au clic (comme .film-row, js/app.js), Retirer
  // rejoint "Retirer cette série" déjà présent sur la fiche détail plutôt
  // que de vivre en double ici — le même principe que la suppression d'un
  // film, qui vit dans sa fiche/modale, jamais sur la carte du catalogue.
  list.innerHTML = trackedShows.map(show => {
    const watchedCount = watchedEpisodeCounts[show.id] || 0;
    const progress = show.numberOfEpisodes
      ? `${watchedCount}/${show.numberOfEpisodes} épisode${show.numberOfEpisodes > 1 ? 's' : ''} vus`
      : `${watchedCount} épisode${watchedCount > 1 ? 's' : ''} vus`;
    return `
      <div class="wl-row" data-id="${show.id}">
        ${show.posterUrl
          ? `<img class="film-poster" src="${show.posterUrl}" alt="" loading="lazy">`
          : `<div class="film-poster film-poster-placeholder">${TV_PLACEHOLDER_SVG}</div>`}
        <div class="wl-main">
          <div class="wl-title">${escapeHtml(show.title)}${show.firstAirYear ? ` <span class="wl-year">(${show.firstAirYear})</span>` : ''}</div>
          <div class="wl-note">${progress}${show.status ? ` · ${escapeHtml(showStatusLabel(show.status))}` : ''}</div>
        </div>
        <!-- Note visible direct sur la liste (v2.1, retour utilisateur :
             fallait ouvrir la série pour la voir) — même badge .counter que
             le catalogue films, même repli '—' tant qu'aucune note
             manuelle n'a été donnée (voir handleSaveSeriesNote()). -->
        <div class="counter ${noteColorClass(show.manualNote)}">${show.manualNote !== null ? show.manualNote.toFixed(1) : '—'}</div>
      </div>
    `;
  }).join('');
  list.querySelectorAll('.wl-row[data-id]').forEach(row => {
    makeRowClickable(row, () => goToSeriesDetail(parseInt(row.dataset.id, 10)));
  });
}

// Page liste des séries — appelée par le routeur (#/series).
async function openSeries(){
  document.getElementById('seriesList').innerHTML = `<div class="empty-state">Chargement…</div>`;
  await loadTrackedShows();
  renderTrackedShows();
}

async function deleteShowRow(id){
  const { error } = await supabaseClient.from('tv_shows').delete().eq('id', id);
  if(error){
    showToast('Erreur de suppression, réessaie');
    console.error(error);
    return false;
  }
  trackedShows = trackedShows.filter(s => s.id !== id);
  delete watchedEpisodeCounts[id];
  return true;
}

async function handleRemoveShow(id, fromDetail){
  if(blockIfOffline()) return;
  if(!confirm('Retirer cette série suivie ? Les épisodes cochés seront perdus.')) return;
  const ok = await deleteShowRow(id);
  if(!ok) return;
  showToast('Série retirée');
  if(fromDetail) goToSeries();
  else renderTrackedShows();
}

// --- Ajout : recherche TMDB (séries), voir js/tmdb.js ---

let seriesTmdbSearchTimer = null;

function renderSeriesTmdbResults(results){
  const wrap = document.getElementById('seriesTmdbResults');
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
      ${poster ? `<img src="${poster}" alt="">` : `<div class="tmdb-poster-placeholder">${TV_PLACEHOLDER_SVG}</div>`}
      <div class="tmdb-result-info">
        <div class="tmdb-result-title">${escapeHtml(r.title)}</div>
        <div class="tmdb-result-year">${year}</div>
      </div>
    `;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectSeriesTmdbResult(r); });
    wrap.appendChild(item);
  });
}

function selectSeriesTmdbResult(r){
  seriesTmdbSelected = {
    tmdb_id: r.id,
    poster_url: r.poster_path ? TMDB_IMG_BASE + r.poster_path : null,
    overview: r.overview || null,
    release_year: r.release_year || null,
    title: r.title,
    original_title: r.original_title || null
  };
  document.getElementById('seriesTitleInput').value = r.title;
  document.getElementById('seriesTmdbResults').innerHTML = '';
  updateSeriesTmdbSelectedUI();
}

function clearSeriesTmdbSelection(){
  seriesTmdbSelected = null;
  updateSeriesTmdbSelectedUI();
}

function updateSeriesTmdbSelectedUI(){
  const box = document.getElementById('seriesTmdbSelected');
  const img = document.getElementById('seriesTmdbSelectedPoster');
  if(!seriesTmdbSelected){
    box.style.display = 'none';
    return;
  }
  box.style.display = '';
  img.src = seriesTmdbSelected.poster_url || '';
  img.style.display = seriesTmdbSelected.poster_url ? '' : 'none';
  document.getElementById('seriesTmdbSelectedTitle').textContent =
    seriesTmdbSelected.title + (seriesTmdbSelected.release_year ? ` (${seriesTmdbSelected.release_year})` : '');
}

async function handleSeriesTmdbSearch(query){
  const wrap = document.getElementById('seriesTmdbResults');
  wrap.innerHTML = `<div class="tmdb-empty">Recherche…</div>`;
  try{
    const results = await searchTmdbTv(query);
    renderSeriesTmdbResults(results);
  }catch(e){
    wrap.innerHTML = `<div class="tmdb-empty">${escapeHtml(e.message)}</div>`;
    console.error(e);
  }
}

// Contrairement à la watchlist (titre libre accepté), une série suivie
// exige une fiche TMDB choisie : c'est elle qui donne le nombre de
// saisons/épisodes sur lequel repose tout le suivi ci-dessous — sans ça,
// rien à cocher.
async function handleAddShow(){
  if(blockIfOffline()) return;
  if(!seriesTmdbSelected){
    showToast('Choisis une série dans les résultats de recherche pour pouvoir suivre ses épisodes');
    return;
  }
  if(trackedShows.some(s => s.tmdbId === seriesTmdbSelected.tmdb_id)){
    showToast('Cette série est déjà suivie');
    return;
  }

  let details;
  try{
    details = await fetchTvDetails(seriesTmdbSelected.tmdb_id);
  }catch(e){
    showToast('Erreur TMDB, réessaie');
    console.error(e);
    return;
  }

  const payload = {
    tmdb_id: seriesTmdbSelected.tmdb_id,
    title: seriesTmdbSelected.title,
    poster_url: seriesTmdbSelected.poster_url,
    overview: seriesTmdbSelected.overview,
    first_air_year: seriesTmdbSelected.release_year,
    status: details.status || null,
    number_of_seasons: details.number_of_seasons || null,
    number_of_episodes: details.number_of_episodes || null,
    in_production: !!details.in_production,
    added: Date.now()
  };
  const { data, error } = await supabaseClient
    .from('tv_shows')
    .insert(payload)
    .select()
    .single();
  if(error){
    showToast(error.code === '23505' ? 'Cette série est déjà suivie' : 'Erreur de sauvegarde, réessaie');
    console.error(error);
    return;
  }

  trackedShows.unshift(rowToShow(data));
  watchedEpisodeCounts[data.id] = 0;
  renderTrackedShows();

  document.getElementById('seriesTitleInput').value = '';
  clearSeriesTmdbSelection();
  showToast('Série suivie');
}

// Plus de #seriesBtn dans l'entête depuis v2.0.6 — l'accès à Séries se
// fait via #primaryTabSeries (js/router.js), qui a son propre listener.
// #seriesPageBack retiré en v2.1 (voir le commentaire dans index.html) —
// plus de listener à poser dessus.
document.getElementById('seriesAddBtn').addEventListener('click', handleAddShow);
document.getElementById('seriesTitleInput').addEventListener('input', () => {
  clearTimeout(seriesTmdbSearchTimer);
  const query = document.getElementById('seriesTitleInput').value.trim();
  if(query.length < 2){
    document.getElementById('seriesTmdbResults').innerHTML = '';
    return;
  }
  seriesTmdbSearchTimer = setTimeout(() => handleSeriesTmdbSearch(query), 350);
});
document.getElementById('seriesTitleInput').addEventListener('blur', () => {
  setTimeout(() => { document.getElementById('seriesTmdbResults').innerHTML = ''; }, 150);
});
document.getElementById('seriesTmdbClearBtn').addEventListener('click', clearSeriesTmdbSelection);

// --- Détail d'une série : note/commentaire + accordéon de saisons ---

function formatDateFr(dateStr){
  if(!dateStr) return null;
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function renderShowDetailHeader(show){
  document.getElementById('seriesDetailTitle').textContent = show.title;
  const posterImg = document.getElementById('seriesDetailPoster');
  const posterPlaceholder = document.getElementById('seriesDetailPosterPlaceholder');
  if(show.posterUrl){
    posterImg.src = show.posterUrl;
    posterImg.style.display = '';
    posterPlaceholder.style.display = 'none';
  }else{
    posterImg.style.display = 'none';
    posterPlaceholder.style.display = '';
  }

  const metaEl = document.getElementById('seriesDetailMeta');
  const parts = [];
  if(show.firstAirYear) parts.push(`<span class="wl-year">${show.firstAirYear}</span>`);
  if(show.numberOfSeasons) parts.push(`<span class="wl-year">${show.numberOfSeasons} saison${show.numberOfSeasons > 1 ? 's' : ''}</span>`);
  if(show.status) parts.push(`<span class="status-badge ${isShowEnded(show.status) ? 'ended' : 'ongoing'}">${escapeHtml(showStatusLabel(show.status))}</span>`);
  metaEl.innerHTML = parts.join('');

  document.getElementById('seriesDetailOverview').textContent = show.overview || '';

  const sliderVal = show.manualNote != null ? show.manualNote : 2.5;
  document.getElementById('seriesNoteSlider').value = sliderVal;
  document.getElementById('seriesNoteVal').textContent = sliderVal.toFixed(2);
  document.getElementById('seriesReviewInput').value = show.review || '';
}

async function refreshShowMeta(show){
  // Instantané pris à l'ajout, rafraîchi ici — une série encore en
  // diffusion peut avoir gagné une saison/changé de statut depuis.
  let details;
  try{
    details = await fetchTvDetails(show.tmdbId);
  }catch(e){
    console.error(e);
    return show; // pas bloquant : on affiche l'instantané existant
  }
  const updates = {
    status: details.status || null,
    number_of_seasons: details.number_of_seasons || null,
    number_of_episodes: details.number_of_episodes || null,
    in_production: !!details.in_production
  };
  const { error } = await supabaseClient.from('tv_shows').update(updates).eq('id', show.id);
  if(error) console.error(error);
  else Object.assign(show, {
    status: updates.status,
    numberOfSeasons: updates.number_of_seasons,
    numberOfEpisodes: updates.number_of_episodes,
    inProduction: updates.in_production
  });
  currentShowSeasons = (details.seasons || []).filter(s => s.season_number > 0);
  return show;
}

async function loadWatchedEpisodes(showId){
  const { data, error } = await supabaseClient
    .from('tv_episodes_watched')
    .select('season_number, episode_number, note, times_watched')
    .eq('tv_show_id', showId);
  if(error){
    console.error(error);
    watchedEpisodeSet = new Set();
    watchedEpisodeExtras = {};
    return;
  }
  watchedEpisodeSet = new Set((data || []).map(r => `${r.season_number}-${r.episode_number}`));
  watchedEpisodeExtras = {};
  (data || []).forEach(r => {
    watchedEpisodeExtras[`${r.season_number}-${r.episode_number}`] = {
      note: r.note != null ? parseFloat(r.note) : null,
      timesWatched: r.times_watched || 1
    };
  });
}

function seasonProgressLabel(seasonNumber, episodeCount){
  const watched = Array.from(watchedEpisodeSet).filter(k => k.startsWith(`${seasonNumber}-`)).length;
  return `${watched}/${episodeCount} vus`;
}

function renderSeasonsList(){
  const wrap = document.getElementById('seriesSeasonsList');
  if(currentShowSeasons.length === 0){
    wrap.innerHTML = `<div class="tmdb-empty">Aucune saison référencée sur TMDB pour cette série.</div>`;
    return;
  }
  wrap.innerHTML = currentShowSeasons.map(s => `
    <div class="season-block" data-season="${s.season_number}">
      <button class="season-header" type="button" data-season-toggle="${s.season_number}">
        <span class="season-name">${escapeHtml(s.name || `Saison ${s.season_number}`)}</span>
        <span class="season-progress" id="seasonProgress-${s.season_number}">${seasonProgressLabel(s.season_number, s.episode_count)}</span>
        <span class="season-caret">▾</span>
      </button>
      <div class="season-episodes" id="seasonEpisodes-${s.season_number}"></div>
    </div>
  `).join('');
  wrap.querySelectorAll('[data-season-toggle]').forEach(btn => {
    btn.addEventListener('click', () => toggleSeason(parseInt(btn.dataset.seasonToggle, 10)));
  });
}

async function toggleSeason(seasonNumber){
  const block = document.querySelector(`.season-block[data-season="${seasonNumber}"]`);
  if(!block) return;
  const isOpening = !block.classList.contains('open');
  block.classList.toggle('open', isOpening);
  if(!isOpening) return;
  // Chargé une seule fois par ouverture de page détail — ne rappelle pas
  // TMDB si cette saison a déjà été dépliée une première fois.
  if(!loadedSeasonEpisodes[seasonNumber]){
    const episodesEl = document.getElementById(`seasonEpisodes-${seasonNumber}`);
    episodesEl.innerHTML = `<div class="tmdb-empty">Chargement…</div>`;
    const show = trackedShows.find(s => s.id === currentShowId);
    try{
      const seasonData = await fetchTvSeason(show.tmdbId, seasonNumber);
      loadedSeasonEpisodes[seasonNumber] = seasonData.episodes || [];
    }catch(e){
      episodesEl.innerHTML = `<div class="tmdb-empty">${escapeHtml(e.message)}</div>`;
      console.error(e);
      return;
    }
  }
  renderSeasonEpisodes(seasonNumber);
}

function renderSeasonEpisodes(seasonNumber){
  const episodesEl = document.getElementById(`seasonEpisodes-${seasonNumber}`);
  const episodes = loadedSeasonEpisodes[seasonNumber] || [];
  if(episodes.length === 0){
    episodesEl.innerHTML = `<div class="tmdb-empty">Aucun épisode référencé pour cette saison.</div>`;
    return;
  }
  episodesEl.innerHTML = `
    <div class="season-episodes-actions">
      <button class="btn secondary" type="button" data-mark-season="${seasonNumber}">Tout marquer vu</button>
      <button class="btn secondary" type="button" data-unmark-season="${seasonNumber}">Tout marquer non vu</button>
    </div>
    ${episodes.map(ep => {
      const key = `${seasonNumber}-${ep.episode_number}`;
      const checked = watchedEpisodeSet.has(key);
      const extra = watchedEpisodeExtras[key];
      const air = formatDateFr(ep.air_date);
      return `
        <div class="episode-row">
          <label class="episode-row-main">
            <input type="checkbox" data-season="${seasonNumber}" data-episode="${ep.episode_number}" ${checked ? 'checked' : ''}>
            <span class="episode-num">E${String(ep.episode_number).padStart(2, '0')}</span>
            <span class="episode-title">${escapeHtml(ep.name || `Épisode ${ep.episode_number}`)}</span>
            ${air ? `<span class="episode-air">${air}</span>` : ''}
          </label>
          ${checked ? `
          <div class="episode-extra">
            <input type="number" class="episode-note-input" min="0" max="5" step="0.5" placeholder="note"
              data-season="${seasonNumber}" data-episode="${ep.episode_number}"
              value="${extra && extra.note != null ? extra.note : ''}">
            <div class="episode-watch-count">
              <button type="button" class="episode-count-btn" data-count="dec" data-season="${seasonNumber}" data-episode="${ep.episode_number}" aria-label="Retirer un visionnage">−</button>
              <span class="episode-count-val">×${extra ? extra.timesWatched : 1}</span>
              <button type="button" class="episode-count-btn" data-count="inc" data-season="${seasonNumber}" data-episode="${ep.episode_number}" aria-label="Ajouter un visionnage">+</button>
            </div>
          </div>` : ''}
        </div>
      `;
    }).join('')}
  `;
  episodesEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => toggleEpisodeWatched(seasonNumber, parseInt(cb.dataset.episode, 10), cb.checked, cb));
  });
  episodesEl.querySelectorAll('.episode-note-input').forEach(inp => {
    inp.addEventListener('change', () => updateEpisodeNote(seasonNumber, parseInt(inp.dataset.episode, 10), inp.value));
  });
  episodesEl.querySelectorAll('.episode-count-btn').forEach(btn => {
    btn.addEventListener('click', () => changeEpisodeTimesWatched(seasonNumber, parseInt(btn.dataset.episode, 10), btn.dataset.count === 'inc' ? 1 : -1));
  });
  const markBtn = episodesEl.querySelector(`[data-mark-season="${seasonNumber}"]`);
  const unmarkBtn = episodesEl.querySelector(`[data-unmark-season="${seasonNumber}"]`);
  if(markBtn) markBtn.addEventListener('click', () => markSeasonWatched(seasonNumber, episodes.length));
  if(unmarkBtn) unmarkBtn.addEventListener('click', () => unmarkSeasonWatched(seasonNumber));
}

function updateSeasonProgressUI(seasonNumber, episodeCount){
  const el = document.getElementById(`seasonProgress-${seasonNumber}`);
  if(el) el.textContent = seasonProgressLabel(seasonNumber, episodeCount);
}

// checkboxEl : la case cliquée — sur échec réseau, le navigateur a déjà
// basculé son état visuel avant que ce gestionnaire ne s'exécute (c'est
// une checkbox native), donc sans ce paramètre une écriture ratée laisse
// la case cochée à l'écran alors que rien n'a été enregistré (bug
// constaté à la vérification). On la remet dans son état réel ici.
async function toggleEpisodeWatched(seasonNumber, episodeNumber, watched, checkboxEl){
  if(blockIfOffline()){ if(checkboxEl) checkboxEl.checked = !watched; return; }
  const key = `${seasonNumber}-${episodeNumber}`;
  if(watched){
    const { error } = await supabaseClient
      .from('tv_episodes_watched')
      .insert({ tv_show_id: currentShowId, season_number: seasonNumber, episode_number: episodeNumber, watched_at: Date.now() });
    if(error && error.code !== '23505'){ // 23505 = déjà coché ailleurs (double-clic) — pas une vraie erreur
      showToast('Erreur, réessaie');
      console.error(error);
      if(checkboxEl) checkboxEl.checked = false;
      return;
    }
    watchedEpisodeSet.add(key);
    watchedEpisodeExtras[key] = { note: null, timesWatched: 1 };
  }else{
    const { error } = await supabaseClient
      .from('tv_episodes_watched')
      .delete()
      .eq('tv_show_id', currentShowId).eq('season_number', seasonNumber).eq('episode_number', episodeNumber);
    if(error){
      showToast('Erreur, réessaie');
      console.error(error);
      if(checkboxEl) checkboxEl.checked = true;
      return;
    }
    watchedEpisodeSet.delete(key);
    delete watchedEpisodeExtras[key];
  }
  const season = currentShowSeasons.find(s => s.season_number === seasonNumber);
  if(season) updateSeasonProgressUI(seasonNumber, season.episode_count);
  watchedEpisodeCounts[currentShowId] = watchedEpisodeSet.size;
  // Fait apparaître/disparaître les contrôles note/nombre de fois vu
  // (.episode-extra, uniquement sur un épisode coché) — un simple
  // classList.toggle() ne suffirait pas, cette section entière n'existe
  // pas encore dans le DOM tant que l'épisode n'a jamais été coché.
  renderSeasonEpisodes(seasonNumber);
}

// --- Note par épisode (v2.39, retour utilisateur, optionnelle) ---
async function updateEpisodeNote(seasonNumber, episodeNumber, rawValue){
  if(blockIfOffline()) return;
  const key = `${seasonNumber}-${episodeNumber}`;
  const value = rawValue.trim();
  const note = value === '' ? null : Math.max(0, Math.min(5, parseFloat(value)));
  const { error } = await supabaseClient
    .from('tv_episodes_watched')
    .update({ note })
    .eq('tv_show_id', currentShowId).eq('season_number', seasonNumber).eq('episode_number', episodeNumber);
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  if(watchedEpisodeExtras[key]) watchedEpisodeExtras[key].note = note;
}

// --- Nombre de fois vu par épisode (v2.39, retour utilisateur) — compteur
// direct sur la ligne existante, jamais en dessous de 1 (repasser à 0
// revient à décocher l'épisode, voir le bouton "−" sur le premier
// visionnage : sans effet plutôt que de finir à 0 en gardant la case
// cochée, ce qui serait incohérent).
async function changeEpisodeTimesWatched(seasonNumber, episodeNumber, delta){
  if(blockIfOffline()) return;
  const key = `${seasonNumber}-${episodeNumber}`;
  const current = (watchedEpisodeExtras[key] && watchedEpisodeExtras[key].timesWatched) || 1;
  const next = Math.max(1, current + delta);
  if(next === current) return;
  const { error } = await supabaseClient
    .from('tv_episodes_watched')
    .update({ times_watched: next })
    .eq('tv_show_id', currentShowId).eq('season_number', seasonNumber).eq('episode_number', episodeNumber);
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  if(!watchedEpisodeExtras[key]) watchedEpisodeExtras[key] = { note: null, timesWatched: 1 };
  watchedEpisodeExtras[key].timesWatched = next;
  renderSeasonEpisodes(seasonNumber);
}

// Initialise les extras (note/nombre de fois vu) d'un épisode fraîchement
// coché SANS écraser ceux d'un épisode déjà coché — utilisé par les
// marquages en masse ci-dessous (ignoreDuplicates: true côté SQL, un
// épisode déjà vu garde sa note/son compteur existants).
function ensureEpisodeExtras(key){
  if(!watchedEpisodeExtras[key]) watchedEpisodeExtras[key] = { note: null, timesWatched: 1 };
}

// "on conflict do nothing" via upsert({ignoreDuplicates:true}) : rejoue
// sans risque même si certains épisodes de la saison sont déjà cochés,
// pas besoin de vérifier au préalable ce qui l'est déjà.
async function markSeasonWatched(seasonNumber, episodeCount){
  if(blockIfOffline()) return;
  const rows = [];
  for(let ep = 1; ep <= episodeCount; ep++){
    rows.push({ tv_show_id: currentShowId, season_number: seasonNumber, episode_number: ep, watched_at: Date.now() });
  }
  const { error } = await supabaseClient
    .from('tv_episodes_watched')
    .upsert(rows, { onConflict: 'user_id,tv_show_id,season_number,episode_number', ignoreDuplicates: true });
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  for(let ep = 1; ep <= episodeCount; ep++){
    const key = `${seasonNumber}-${ep}`;
    watchedEpisodeSet.add(key);
    ensureEpisodeExtras(key);
  }
  updateSeasonProgressUI(seasonNumber, episodeCount);
  watchedEpisodeCounts[currentShowId] = watchedEpisodeSet.size;
  renderSeasonEpisodes(seasonNumber);
  showToast('Saison marquée vue');
}

async function unmarkSeasonWatched(seasonNumber){
  if(blockIfOffline()) return;
  const { error } = await supabaseClient
    .from('tv_episodes_watched')
    .delete()
    .eq('tv_show_id', currentShowId).eq('season_number', seasonNumber);
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  Array.from(watchedEpisodeSet).forEach(key => {
    if(key.startsWith(`${seasonNumber}-`)){
      watchedEpisodeSet.delete(key);
      delete watchedEpisodeExtras[key];
    }
  });
  const season = currentShowSeasons.find(s => s.season_number === seasonNumber);
  if(season) updateSeasonProgressUI(seasonNumber, season.episode_count);
  watchedEpisodeCounts[currentShowId] = watchedEpisodeSet.size;
  renderSeasonEpisodes(seasonNumber);
  showToast('Saison marquée non vue');
}

// --- Marquer TOUTE la série d'un coup (v2.1, retour utilisateur) ---
// currentShowSeasons (métadonnées TMDB, chargées par refreshShowMeta() à
// l'ouverture de la page) donne le nombre d'épisodes de CHAQUE saison sans
// avoir à déplier son accordéon — un seul upsert groupé couvrant toutes
// les saisons plutôt que N appels réseau (un par saison).
async function markAllSeasonsWatched(){
  if(blockIfOffline()) return;
  if(currentShowSeasons.length === 0) return;
  if(!confirm('Marquer tous les épisodes de toutes les saisons comme vus ?')) return;
  const rows = [];
  currentShowSeasons.forEach(s => {
    for(let ep = 1; ep <= s.episode_count; ep++){
      rows.push({ tv_show_id: currentShowId, season_number: s.season_number, episode_number: ep, watched_at: Date.now() });
    }
  });
  const { error } = await supabaseClient
    .from('tv_episodes_watched')
    .upsert(rows, { onConflict: 'user_id,tv_show_id,season_number,episode_number', ignoreDuplicates: true });
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  currentShowSeasons.forEach(s => {
    for(let ep = 1; ep <= s.episode_count; ep++){
      const key = `${s.season_number}-${ep}`;
      watchedEpisodeSet.add(key);
      ensureEpisodeExtras(key);
    }
    updateSeasonProgressUI(s.season_number, s.episode_count);
    // Rafraîchit aussi les cases à cocher des saisons déjà dépliées.
    if(loadedSeasonEpisodes[s.season_number]) renderSeasonEpisodes(s.season_number);
  });
  watchedEpisodeCounts[currentShowId] = watchedEpisodeSet.size;
  showToast('Série entière marquée vue');
}

async function unmarkAllSeasonsWatched(){
  if(blockIfOffline()) return;
  if(!confirm('Retirer tous les épisodes vus de cette série ?')) return;
  const { error } = await supabaseClient
    .from('tv_episodes_watched')
    .delete()
    .eq('tv_show_id', currentShowId);
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  watchedEpisodeSet.clear();
  watchedEpisodeExtras = {};
  currentShowSeasons.forEach(s => {
    updateSeasonProgressUI(s.season_number, s.episode_count);
    if(loadedSeasonEpisodes[s.season_number]) renderSeasonEpisodes(s.season_number);
  });
  watchedEpisodeCounts[currentShowId] = 0;
  showToast('Épisodes vus retirés');
}

async function handleSaveSeriesNote(){
  if(blockIfOffline()) return;
  const note = parseFloat(document.getElementById('seriesNoteSlider').value);
  const review = document.getElementById('seriesReviewInput').value.trim() || null;
  const { error } = await supabaseClient
    .from('tv_shows')
    .update({ manual_note: note, review })
    .eq('id', currentShowId);
  if(error){
    showToast('Erreur de sauvegarde, réessaie');
    console.error(error);
    return;
  }
  const show = trackedShows.find(s => s.id === currentShowId);
  if(show){ show.manualNote = note; show.review = review; }
  showToast('Note enregistrée');
}

// Page détail d'une série — appelée par le routeur (#/series/:id). Robuste
// à un lien direct (F5) : recharge la liste des séries si besoin, comme
// openGroupDetail() (js/groups.js).
async function openShowDetail(showId){
  if(trackedShows.length === 0 || !trackedShows.find(s => s.id === showId)) await loadTrackedShows();
  const show = trackedShows.find(s => s.id === showId);
  if(!show){
    showToast('Série introuvable');
    goToSeries();
    return;
  }
  currentShowId = showId;
  currentShowSeasons = [];
  loadedSeasonEpisodes = {};
  watchedEpisodeSet = new Set();
  watchedEpisodeExtras = {};

  renderShowDetailHeader(show);
  document.getElementById('seriesSeasonsList').innerHTML = `<div class="tmdb-empty">Chargement…</div>`;

  await Promise.all([
    refreshShowMeta(show),
    loadWatchedEpisodes(showId)
  ]);
  renderShowDetailHeader(show); // statut éventuellement mis à jour par refreshShowMeta()
  renderSeasonsList();
}

document.getElementById('seriesDetailBack').addEventListener('click', goToSeries);
document.getElementById('seriesSaveNoteBtn').addEventListener('click', handleSaveSeriesNote);
document.getElementById('seriesNoteSlider').addEventListener('input', (e) => {
  document.getElementById('seriesNoteVal').textContent = parseFloat(e.target.value).toFixed(2);
});
document.getElementById('seriesRemoveBtn').addEventListener('click', () => handleRemoveShow(currentShowId, true));
document.getElementById('seriesMarkAllBtn').addEventListener('click', markAllSeasonsWatched);
document.getElementById('seriesUnmarkAllBtn').addEventListener('click', unmarkAllSeasonsWatched);
