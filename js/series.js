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
// Agrégats globaux (toutes séries confondues), calculés par loadTrackedShows()
// — voir js/achievements.js, succès "Ça méritait un revisionnage (bis)"/
// "Le noteur d'épisodes".
let maxEpisodeTimesWatched = 0; // le plus grand times_watched vu sur UN SEUL épisode, tous shows confondus
let notedEpisodeCount = 0;      // nombre total d'épisodes ayant une note (note IS NOT NULL)
let seriesTmdbSelected = null; // { tmdb_id, poster_url, overview, release_year, title, original_title }

// Série précédente/suivante dans la liste d'où l'on vient (retour
// utilisateur : "vu qu'on a de l'espace... j'aimerais naviguer à ceux
// d'à côté") — même principe que filmNavList/filmNavIndex, js/filmDetail.js.
let showNavList = null;  // [{ id, title }] ou null
let showNavIndex = -1;

let currentShowId = null;       // série affichée sur #seriesDetailPage
let currentShowSeasons = [];    // [{ season_number, name, episode_count, air_date }], depuis fetchTvDetails()
let watchedEpisodeSet = new Set(); // "saison-episode" vus, pour la série actuellement ouverte
// Note + nombre de fois vu par épisode (v2.39, retour utilisateur) —
// facultatifs, jamais l'essentiel (voir tv_shows.manual_note, la note
// globale) : "saison-episode" -> { note, timesWatched }, uniquement pour
// les clés présentes dans watchedEpisodeSet ci-dessus.
let watchedEpisodeExtras = {};
let loadedSeasonEpisodes = {};  // season_number -> episodes[] (TMDB), alias courant de seasonUiCache[currentShowId].episodes
// Saisons dépliées + épisodes déjà téléchargés, PAR SÉRIE (retour
// utilisateur : "je déplie la saison 1, je change de page et je reviens,
// elle n'est plus dépliée") — le routeur rappelle openShowDetail() à CHAQUE
// retour sur #/series/:id, qui reconstruit toute la liste des saisons depuis
// zéro ; ce cache (durée de la session, pas persisté) garde ce qui était
// ouvert pour cette série, et les épisodes déjà en mémoire pour ne pas les
// retélécharger. showId -> { expanded: Set<season_number>, episodes: {...} }.
let seasonUiCache = {};

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
  // sur un jeu de données personnel). note/times_watched (v2.39) inclus
  // dans le même select — au passage, nourrit 2 nouveaux succès (v2.49,
  // retour utilisateur : "je veux de nouveaux succès vu qu'on a des
  // nouvelles features") sans requête dédiée : maxEpisodeTimesWatched/
  // notedEpisodeCount (js/achievements.js) plutôt qu'un chargement séparé
  // par série, qui n'aurait aucun sens pour un simple agrégat global.
  if(trackedShows.length > 0){
    const { data: watched, error: watchedErr } = await supabaseClient
      .from('tv_episodes_watched')
      .select('tv_show_id, note, times_watched, watched_at');
    if(watchedErr){
      console.error(watchedErr);
    }else{
      watchedEpisodeCounts = {};
      lastWatchedAtByShow = {};
      maxEpisodeTimesWatched = 0;
      notedEpisodeCount = 0;
      (watched || []).forEach(row => {
        watchedEpisodeCounts[row.tv_show_id] = (watchedEpisodeCounts[row.tv_show_id] || 0) + 1;
        if(row.watched_at && row.watched_at > (lastWatchedAtByShow[row.tv_show_id] || 0)) lastWatchedAtByShow[row.tv_show_id] = row.watched_at;
        if(row.times_watched > maxEpisodeTimesWatched) maxEpisodeTimesWatched = row.times_watched;
        if(row.note != null) notedEpisodeCount++;
      });
    }
  }
}

// --- Badge "nouvel épisode" (retour utilisateur) --- Signal léger, dérivé
// de données déjà chargées (aucun appel TMDB dédié) : une série encore en
// cours dont le nombre d'épisodes connus dépasse le nombre d'épisodes vus
// a probablement un épisode récent pas encore rattrapé. Instantané comme
// le reste de la liste (number_of_episodes n'est rafraîchi qu'à l'ouverture
// de la fiche détail, voir refreshShowMeta()) — un signal utile même
// approximatif vaut mieux qu'aucun signal ici. Jamais affiché sur une série
// terminée : "plus rien à rattraper de nouveau" par définition.
// Audit des six écrans (S3) : le badge s'affichait dès qu'il restait un
// épisode à voir, même sur une série jamais commencée. Désormais :
// « Nouvel épisode » si un épisode est sorti après ton dernier visionnage,
// « À rattraper » s'il reste des épisodes sortis à voir, rien sinon. Ce qui
// est sorti vient de TMDB (dernier épisode diffusé), gardé 6 heures par
// série (saveShowAiring()), rafraîchi en tâche de fond sur la page Séries.
const SHOW_AIRING_KEY = 'kinetShowAiring';
const SHOW_AIRING_TTL_MS = 6 * 3600 * 1000;
let lastWatchedAtByShow = {}; // tv_show_id -> date du dernier épisode coché (ms)
function loadShowAiringCache(){
  try{ return JSON.parse(localStorage.getItem(SHOW_AIRING_KEY) || '{}') || {}; }catch(e){ return {}; }
}
function showAiring(show){
  const entry = loadShowAiringCache()[show.tmdbId];
  return entry && entry.aired != null ? entry : null;
}
function saveShowAiring(tmdbId, details){
  const cache = loadShowAiringCache();
  const last = details.last_episode_to_air;
  const seasons = (details.seasons || []).filter(x => x.season_number > 0);
  const aired = last
    ? seasons.filter(x => x.season_number < last.season_number).reduce((a, x) => a + (x.episode_count || 0), 0) + last.episode_number
    : null;
  cache[tmdbId] = { t: Date.now(), aired, lastAir: last ? last.air_date || null : null };
  try{ localStorage.setItem(SHOW_AIRING_KEY, JSON.stringify(cache)); }catch(e){}
}
// 'new' | 'catchup' | null
function showEpisodeBadge(show){
  if(isShowEnded(show.status)) return null;
  const info = showAiring(show);
  const watched = watchedEpisodeCounts[show.id] || 0;
  if(!info || watched === 0 || watched >= info.aired) return null;
  const lastSeen = lastWatchedAtByShow[show.id] || 0;
  if(info.lastAir && new Date(info.lastAir + 'T23:59:59').getTime() > lastSeen) return 'new';
  return 'catchup';
}
function hasNewEpisode(show){
  return showEpisodeBadge(show) === 'new';
}
// Rafraîchit en tâche de fond ce qui est sorti pour les séries en cours
// (une requête TMDB par série, au plus toutes les 6 heures), puis redessine.
let showAiringRefreshing = false;
async function refreshShowAiringInBackground(){
  if(showAiringRefreshing || typeof fetchTvDetails !== 'function') return;
  const cache = loadShowAiringCache();
  const stale = trackedShows.filter(show => !isShowEnded(show.status) && show.tmdbId
    && (!cache[show.tmdbId] || Date.now() - cache[show.tmdbId].t > SHOW_AIRING_TTL_MS));
  if(!stale.length) return;
  showAiringRefreshing = true;
  try{
    for(let i = 0; i < stale.length; i += 4){
      await Promise.all(stale.slice(i, i + 4).map(async show => {
        try{ saveShowAiring(show.tmdbId, await fetchTvDetails(show.tmdbId)); }catch(e){ console.error(e); }
      }));
    }
  }finally{
    showAiringRefreshing = false;
  }
  if(document.getElementById('seriesPage') && document.getElementById('seriesPage').style.display !== 'none') renderTrackedShows();
}

// Descend dans « Séries terminées » seulement une série qui ne sortira plus
// rien ET que tu as vue en entier (retour de Flix, 15/10) : une série
// terminée pas encore rattrapée reste dans la liste, avec sa progression.
// Nombre d'épisodes inconnu : elle reste en haut, faute de pouvoir le dire.
function isShowDone(show){
  if(!isShowEnded(show.status) || !show.numberOfEpisodes) return false;
  return (watchedEpisodeCounts[show.id] || 0) >= show.numberOfEpisodes;
}

// Une ligne simple par série terminée et vue, cliquable en entière, dans la
// section repliée « Séries terminées » sous la liste (venue de la page Bientôt).
function renderEndedShows(ended){
  const box = document.getElementById('seriesEndedDisclosure');
  const list = document.getElementById('seriesEndedList');
  if(!box || !list) return;
  box.hidden = ended.length === 0;
  const count = document.getElementById('seriesEndedCount');
  if(count) count.textContent = ended.length ? `(${ended.length})` : '';
  list.innerHTML = ended.map(show => {
    const watchedCount = watchedEpisodeCounts[show.id] || 0;
    const progress = show.numberOfEpisodes ? `${watchedCount}/${show.numberOfEpisodes} épisodes vus · ` : '';
    return `
      <div class="wl-row ended-row" data-id="${show.id}">
        ${show.posterUrl
          ? `<img class="film-poster" src="${escapeHtml(show.posterUrl)}" alt="" loading="lazy">`
          : `<div class="film-poster film-poster-placeholder">${TV_PLACEHOLDER_SVG}</div>`}
        <div class="wl-main">
          <div class="wl-title">${escapeHtml(show.title)}</div>
          <div class="wl-note">${progress}${escapeHtml(showStatusLabel(show.status))}</div>
        </div>
      </div>`;
  }).join('');
  const navList = ended.map(s => ({ id: s.id, title: s.title }));
  list.querySelectorAll('.ended-row[data-id]').forEach(row => {
    makeRowClickable(row, () => goToSeriesDetail(parseInt(row.dataset.id, 10), navList));
  });
}

function renderTrackedShows(){
  const list = document.getElementById('seriesList');
  // Compteur à droite de la ligne recherche (draft option B), comme le
  // « 412 films » du catalogue.
  // « Rechercher ou suivre » : le champ filtre aussi les séries déjà
  // suivies, comme la recherche du catalogue films.
  const input = document.getElementById('seriesTitleInput');
  const norm = (txt) => (typeof normalizeSearch === 'function') ? normalizeSearch(txt) : String(txt).toLowerCase();
  const q = input ? norm(input.value.trim()) : '';
  const shown = q ? trackedShows.filter(show => norm(show.title).includes(q)) : trackedShows;
  const countEl = document.getElementById('seriesCountLine');
  if(countEl) countEl.textContent = !trackedShows.length ? ''
    : q ? `${shown.length} sur ${trackedShows.length}`
    : `${trackedShows.length} série${trackedShows.length > 1 ? 's' : ''}`;
  // Séries terminées et vues repliées sous les autres (audit Bientôt du
  // 15/10, B5 : elles vivaient sur la page Bientôt). Voir isShowDone().
  const active = shown.filter(show => !isShowDone(show));
  renderEndedShows(shown.filter(isShowDone));
  if(trackedShows.length === 0){
    list.innerHTML = `<div class="empty-state">Rien pour l'instant. Cherche une série ci-dessus pour commencer à suivre ses épisodes.</div>`;
    return;
  }
  if(shown.length === 0){
    list.innerHTML = `<div class="empty-state">Aucune de tes séries ne correspond. Choisis-la dans les résultats pour la suivre.</div>`;
    return;
  }
  if(active.length === 0){
    list.innerHTML = `<div class="empty-state">Aucune série en cours ici. Tes séries terminées sont juste en dessous.</div>`;
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
  list.innerHTML = active.map(show => {
    const watchedCount = watchedEpisodeCounts[show.id] || 0;
    // Sur les épisodes déjà sortis quand on le sait (S1), sinon le total TMDB.
    const info = isShowEnded(show.status) ? null : showAiring(show);
    const total = info ? info.aired : show.numberOfEpisodes;
    const progress = total
      ? `${watchedCount}/${total} épisode${total > 1 ? 's' : ''} vus`
      : `${watchedCount} épisode${watchedCount > 1 ? 's' : ''} vus`;
    const badge = showEpisodeBadge(show);
    const newEp = badge === 'new';
    return `
      <div class="wl-row" data-id="${show.id}">
        <!-- Pastille sur l'affiche (.new-episode-dot) : cachée par défaut,
             révélée seulement en mode grille (css/style.css) — en mode
             liste le badge texte du titre juste en dessous suffit déjà,
             pas la peine de doubler le signal. -->
        ${newEp ? `<span class="new-episode-dot" title="Nouvel épisode" aria-hidden="true"></span>` : ''}
        ${show.posterUrl
          ? `<img class="film-poster" src="${escapeHtml(show.posterUrl)}" alt="" loading="lazy">`
          : `<div class="film-poster film-poster-placeholder">${TV_PLACEHOLDER_SVG}</div>`}
        <div class="wl-main">
          <div class="wl-title">${escapeHtml(show.title)}${show.firstAirYear ? ` <span class="wl-year">(${show.firstAirYear})</span>` : ''}${badge ? ` <span class="new-episode-badge${badge === 'catchup' ? ' is-catchup' : ''}">${badge === 'new' ? 'Nouvel épisode' : 'À rattraper'}</span>` : ''}</div>
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
  const navList = active.map(s => ({ id: s.id, title: s.title }));
  list.querySelectorAll('.wl-row[data-id]').forEach(row => {
    makeRowClickable(row, () => goToSeriesDetail(parseInt(row.dataset.id, 10), navList));
  });
}

// Page liste des séries — appelée par le routeur (#/series).
async function openSeries(){
  document.getElementById('seriesList').innerHTML = skeletonRows();
  await loadTrackedShows();
  renderTrackedShows();
  refreshShowAiringInBackground();
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

// --- Ajout : recherche TMDB (séries), voir js/tmdb.js --- Les séries à
// suivre sont proposées dans la liste sous la recherche (« À suivre »,
// js/globalSearch.js), qui appelle selectSeriesTmdbResult() au choix.

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
  updateSeriesTmdbSelectedUI();
}

function clearSeriesTmdbSelection(){
  seriesTmdbSelected = null;
  updateSeriesTmdbSelectedUI();
}

function updateSeriesTmdbSelectedUI(){
  const box = document.getElementById('seriesTmdbSelected');
  const img = document.getElementById('seriesTmdbSelectedPoster');
  // « + Suivre » n'a de sens qu'avec une série choisie (draft option B :
  // une seule ligne recherche + affichage, pas de bouton qui traîne).
  const addBtn = document.getElementById('seriesAddBtn');
  if(addBtn) addBtn.style.display = seriesTmdbSelected ? '' : 'none';
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
{
  const seriesAddBtn = document.getElementById('seriesAddBtn');
  seriesAddBtn.addEventListener('click', withSubmitGuard(seriesAddBtn, handleAddShow));
}
document.getElementById('seriesTitleInput').addEventListener('input', renderTrackedShows);
document.getElementById('seriesTmdbClearBtn').addEventListener('click', clearSeriesTmdbSelection);

// --- Détail d'une série : note/commentaire + accordéon de saisons ---

function formatDateLongFr(dateStr){ return formatDateFr(dateStr); }
function formatDateFr(dateStr){
  if(!dateStr) return null;
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

// v3.2, retour utilisateur — refonte à la lettre de la draft Scope (voir
// le commentaire en tête de #seriesDetailPage, index.html) : grand
// panneau toujours visible (photo de plateau > affiche > repli neutre,
// jamais masqué comme avant), titre, légende date/genre/saisons + note
// à droite, fiche Création/Épisodes/Statut, résumé.
function renderShowDetailHeader(show){
  document.getElementById('seriesDetailTitle').textContent = show.title;

  const backdropContainer = document.getElementById('seriesDetailBackdrop');
  const backdropImg = document.getElementById('seriesDetailBackdropImg');
  if(show.backdropPath){
    renderDetailBackdrop('seriesDetailBackdrop', 'seriesDetailBackdropImg', show.backdropPath);
    backdropContainer.classList.remove('is-placeholder');
  }else{
    backdropContainer.style.display = '';
    backdropImg.removeAttribute('src');
    backdropContainer.classList.add('is-placeholder');
  }
  // L'affiche posée sur le bandeau, comme sur la fiche film (piste D).
  const poster = document.getElementById('seriesDetailPoster');
  if(poster){
    if(show.posterUrl){ poster.src = show.posterUrl; poster.hidden = false; }
    else{ poster.removeAttribute('src'); poster.hidden = true; }
  }

  const metaParts = [];
  if(show.firstAirYear) metaParts.push(show.firstAirYear);
  if(show.genreNames) metaParts.push(show.genreNames);
  if(show.numberOfSeasons) metaParts.push(`${show.numberOfSeasons} saison${show.numberOfSeasons > 1 ? 's' : ''}`);
  document.getElementById('seriesDetailMeta').textContent = metaParts.join(' · ');

  renderRatingRing(show);
  // Ligne masquée plutôt qu'un "—" muet : TMDB ne renseigne created_by que
  // pour une partie des séries.
  const creatorsRow = document.getElementById('seriesDetailCreatorsRow');
  if(creatorsRow) creatorsRow.style.display = show.creators ? '' : 'none';
  document.getElementById('seriesDetailCreators').textContent = show.creators || '';
  renderEpisodesFicheValue(show);
  // Statut, et la prochaine date connue : « En diffusion · saison 4 le 8 juillet 2027 ».
  const next = show.nextEpisodeToAir;
  const nextText = next && next.d
    ? (next.e === 1 ? ` · saison ${next.s} le ${formatDateLongFr(next.d)}` : ` · prochain épisode le ${formatDateLongFr(next.d)}`)
    : '';
  document.getElementById('seriesDetailStatus').textContent = show.status ? showStatusLabel(show.status) + nextText : '—';

  document.getElementById('seriesDetailOverview').textContent = show.overview || '';

  // Ta note, dans le petit panneau ouvert par l'anneau (S7).
  const hasNote = show.manualNote != null;
  const slider = document.getElementById('seriesNoteSlider');
  slider.value = hasNote ? show.manualNote : 2.5;
  slider.classList.toggle('is-unset', !hasNote);
  document.getElementById('seriesNoteVal').textContent = hasNote ? show.manualNote.toFixed(1) : 'Non notée';
  const popTitle = document.getElementById('seriesNotePopTitle');
  if(popTitle) popTitle.textContent = `Ta note pour ${show.title}`;
}

// Même cadran que partout ailleurs (.counter, noteColorClass()) — voir le
// commentaire sur #seriesDetailRatingRing, index.html.
function renderRatingRing(show){
  const el = document.getElementById('seriesDetailRatingRing');
  if(!el) return;
  if(show.manualNote != null){
    el.textContent = show.manualNote.toFixed(1);
    el.className = `counter ${noteColorClass(show.manualNote)}`;
  }else{
    el.textContent = '—';
    el.className = 'counter';
  }
}

// Ligne "Épisodes" de .fiche — épisodes vus / total, recalculée à chaque
// changement de progression (updateSeasonProgressUI() plus bas) sans
// attendre un rechargement complet de la page.
function renderEpisodesFicheValue(show){
  const el = document.getElementById('seriesDetailEpisodes');
  if(!el || !show) return;
  // Seuls les épisodes sortis comptent (audit des six écrans, S1).
  const aired = airedEpisodeCount();
  if(aired !== null && aired > 0){
    el.textContent = `${watchedEpisodeSet.size} vu${watchedEpisodeSet.size > 1 ? 's' : ''} sur ${aired} sorti${aired > 1 ? 's' : ''}`;
    return;
  }
  const total = show.numberOfEpisodes || currentShowSeasons.reduce((a, s) => a + (s.episode_count || 0), 0);
  el.textContent = total > 0 ? `${watchedEpisodeSet.size} / ${total} vus` : '—';
}

// --- Épisodes sortis (audit des six écrans, S1) ---
// TMDB compte aussi les épisodes annoncés : Silo affichait « 11 / 31 vus »
// avec une saison 4 prévue en 2027. Un épisode est sorti si sa date est
// passée (épisodes de la saison déjà chargés), sinon s'il n'est pas après le
// dernier épisode diffusé (last_episode_to_air, gardé par refreshShowMeta()).
function seriesTodayIso(){ return new Date().toISOString().slice(0, 10); }
function currentShowObj(){ return trackedShows.find(s => s.id === currentShowId) || null; }
function isEpisodeAired(seasonNumber, episodeNumber){
  const eps = loadedSeasonEpisodes[seasonNumber];
  if(eps){
    const ep = eps.find(e => e.episode_number === episodeNumber);
    if(ep) return !!(ep.air_date && ep.air_date <= seriesTodayIso());
  }
  const show = currentShowObj();
  const last = show && show.lastEpisodeToAir;
  if(last) return seasonNumber < last.s || (seasonNumber === last.s && episodeNumber <= last.e);
  const season = currentShowSeasons.find(x => x.season_number === seasonNumber);
  return !!(season && season.air_date && season.air_date <= seriesTodayIso());
}
function airedEpisodesInSeason(season){
  let n = 0;
  for(let ep = 1; ep <= (season.episode_count || 0); ep++) if(isEpisodeAired(season.season_number, ep)) n++;
  return n;
}
// Nombre d'épisodes sortis, ou null tant qu'on n'a aucune date pour le savoir.
function airedEpisodeCount(){
  const show = currentShowObj();
  const known = (show && show.lastEpisodeToAir) || currentShowSeasons.some(s => s.air_date) || Object.keys(loadedSeasonEpisodes).length > 0;
  if(!known) return null;
  return currentShowSeasons.reduce((a, s) => a + airedEpisodesInSeason(s), 0);
}
function watchedInSeason(seasonNumber){
  return Array.from(watchedEpisodeSet).filter(k => k.startsWith(`${seasonNumber}-`)).length;
}
// Prochain épisode à voir : le premier pas encore coché, dans l'ordre. null
// si tout ce qui est sorti est vu (le suivant n'est pas encore diffusé).
function nextEpisodeToWatch(){
  const seasons = [...currentShowSeasons].sort((a, b) => a.season_number - b.season_number);
  for(const s of seasons){
    for(let ep = 1; ep <= (s.episode_count || 0); ep++){
      if(watchedEpisodeSet.has(`${s.season_number}-${ep}`)) continue;
      return isEpisodeAired(s.season_number, ep) ? { s: s.season_number, e: ep } : null;
    }
  }
  return null;
}
function episodeInfo(seasonNumber, episodeNumber){
  const ep = (loadedSeasonEpisodes[seasonNumber] || []).find(e => e.episode_number === episodeNumber);
  return ep ? { name: ep.name || `Épisode ${episodeNumber}`, air: ep.air_date || null } : { name: `Épisode ${episodeNumber}`, air: null };
}
async function ensureSeasonEpisodes(seasonNumber){
  if(loadedSeasonEpisodes[seasonNumber]) return loadedSeasonEpisodes[seasonNumber];
  const show = currentShowObj();
  if(!show) return [];
  try{
    const data = await fetchTvSeason(show.tmdbId, seasonNumber);
    loadedSeasonEpisodes[seasonNumber] = data.episodes || [];
  }catch(e){
    console.error(e);
    return [];
  }
  return loadedSeasonEpisodes[seasonNumber];
}

// « À suivre » (S4) : l'épisode suivant avec son titre, sa date et « Vu ».
function renderSeriesNextBlock(){
  const el = document.getElementById('seriesNextBlock');
  if(!el) return;
  const next = nextEpisodeToWatch();
  const show = currentShowObj();
  if(next){
    const info = episodeInfo(next.s, next.e);
    el.innerHTML = `
      <div class="sx-nx"><small>À suivre · saison ${next.s}, épisode ${next.e}</small><b>${escapeHtml(info.name)}</b>${info.air ? `<span>Sorti le ${formatDateFr(info.air)}</span>` : ''}</div>
      <button type="button" class="ff-btn-main" id="seriesNextVuBtn">${uiIcon('check')} Vu</button>`;
    el.hidden = false;
    document.getElementById('seriesNextVuBtn').addEventListener('click', withSubmitGuard(document.getElementById('seriesNextVuBtn'), markNextEpisodeWatched));
    // Le titre de l'épisode vient de sa saison : chargée une fois, à la demande.
    if(!loadedSeasonEpisodes[next.s]) ensureSeasonEpisodes(next.s).then(() => renderSeriesNextBlock());
    return;
  }
  const upcoming = show && show.nextEpisodeToAir;
  if(watchedEpisodeSet.size === 0 && !upcoming){ el.innerHTML = ''; el.hidden = true; return; }
  el.innerHTML = `<div class="sx-nx"><small>À jour</small><b>Tu as vu tous les épisodes sortis</b>${upcoming && upcoming.d ? `<span>Prochain : saison ${upcoming.s}, épisode ${upcoming.e}, le ${formatDateLongFr(upcoming.d)}</span>` : ''}</div>`;
  el.hidden = false;
}
function renderSeriesProgress(){
  const el = document.getElementById('seriesProgress');
  if(!el) return;
  const aired = airedEpisodeCount();
  if(!aired){ el.innerHTML = ''; return; }
  const total = currentShowSeasons.reduce((a, s) => a + (s.episode_count || 0), 0);
  const announced = Math.max(0, total - aired);
  const show = currentShowObj();
  const next = show && show.nextEpisodeToAir;
  const pct = Math.min(100, Math.round(watchedEpisodeSet.size / aired * 100));
  el.innerHTML = `<i><b style="width:${pct}%"></b></i><span class="num">${watchedEpisodeSet.size} sur ${aired} épisode${aired > 1 ? 's' : ''} sorti${aired > 1 ? 's' : ''}${announced ? ` · ${announced} annoncé${announced > 1 ? 's' : ''}${next && next.d ? `, dès le ${formatDateLongFr(next.d)}` : ''}` : ''}</span>`;
}
// Tout ce qui dépend des épisodes vus : fiche, à suivre, progression, saisons.
function renderSeriesBlocks(){
  const show = currentShowObj();
  if(show) renderEpisodesFicheValue(show);
  renderSeriesNextBlock();
  renderSeriesProgress();
  renderSeasonsList();
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
  // Photo de plateau (.detail-backdrop) : jamais stockée en base (même
  // logique que "Où regarder", toujours re-demandée), juste posée sur
  // l'objet show en mémoire — indépendante du succès de la mise à jour
  // Supabase juste en dessous, contrairement à status/numberOfSeasons.
  show.backdropPath = details.backdrop_path || null;
  // Création + genres (v3.2, draft Scope — ligne "Création" de .fiche et
  // légende date/genre/saisons) : même logique que backdropPath
  // juste au-dessus, TMDB les renvoie déjà dans cette même requête, pas
  // de colonne dédiée ni d'appel réseau en plus.
  show.creators = (details.created_by || []).map(c => c.name).filter(Boolean).join(', ') || null;
  show.genreNames = (details.genres || []).map(g => g.name).filter(Boolean).slice(0, 2).join(', ') || null;
  // Dernier épisode diffusé et prochain annoncé (audit des six écrans, S1) :
  // ce qui est sorti se déduit du premier, sans charger chaque saison.
  const last = details.last_episode_to_air, nxt = details.next_episode_to_air;
  show.lastEpisodeToAir = last ? { s: last.season_number, e: last.episode_number, d: last.air_date || null } : null;
  show.nextEpisodeToAir = nxt ? { s: nxt.season_number, e: nxt.episode_number, d: nxt.air_date || null } : null;
  if(typeof saveShowAiring === 'function') saveShowAiring(show.tmdbId, details);
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
  let { data, error } = await supabaseClient
    .from('tv_episodes_watched')
    .select('season_number, episode_number, note, times_watched')
    .eq('tv_show_id', showId);
  if(error){
    // Repli : la migration 036 (colonnes note/times_watched) n'a peut-être
    // pas encore été exécutée sur cette base -- ne jamais casser le statut
    // vu/pas-vu pour ça (le cœur de la fonctionnalité, présent bien avant
    // ces deux colonnes optionnelles). Sans ce repli, une base pas encore
    // migrée affiche TOUS les épisodes comme non-vus, y compris ceux déjà
    // cochés.
    const fallback = await supabaseClient
      .from('tv_episodes_watched')
      .select('season_number, episode_number')
      .eq('tv_show_id', showId);
    if(fallback.error){
      console.error(fallback.error);
      watchedEpisodeSet = new Set();
      watchedEpisodeExtras = {};
      return;
    }
    data = fallback.data;
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

// --- Note de saison calculée (retour utilisateur) --- Jamais stockée :
// recalculée à la volée depuis watchedEpisodeExtras (note par épisode,
// v2.39), même principe que la note d'un film dérivée de ses critères
// plutôt que dupliquée en base. Uniquement les épisodes VUS ET notés de
// cette saison — null tant qu'aucun n'a de note, pour ne jamais afficher
// un "0.0" qui laisserait croire à une vraie moyenne sur une saison pas
// encore notée. Reste un complément discret dans l'en-tête de saison,
// jamais aussi visible que la note globale de la série (voir le rappel
// "l'essentiel est la note globale" dans le reste de l'app).
function seasonAverageNote(seasonNumber){
  const notes = Array.from(watchedEpisodeSet)
    .filter(k => k.startsWith(`${seasonNumber}-`))
    .map(k => watchedEpisodeExtras[k] && watchedEpisodeExtras[k].note)
    .filter(n => n != null);
  if(notes.length === 0) return null;
  return notes.reduce((a, b) => a + b, 0) / notes.length;
}

function seasonProgressLabel(seasonNumber, episodeCount){
  const watched = watchedInSeason(seasonNumber);
  const avg = seasonAverageNote(seasonNumber);
  return `${watched}/${episodeCount} vus${avg != null ? ` · ${avg.toFixed(1)}` : ''}`;
}

// Nom de saison en français (audit T1) : TMDB renvoie « Season 1 » quand
// aucune traduction n'existe. Un vrai nom (« Le Livre de Boba Fett »...) est
// gardé tel quel.
function seasonLabel(s){
  const name = (s.name || '').trim();
  if(s.season_number === 0 && (!name || /^(specials|épisodes spéciaux)$/i.test(name))) return 'Épisodes spéciaux';
  if(!name || /^(season|saison|temporada|staffel)\s*\d+$/i.test(name)) return `Saison ${s.season_number}`;
  return name;
}

// Saisons en carrés (« Grille ») ou en rangées avec les titres (« Liste »),
// au choix, gardé sur cet appareil (piste D).
const SERIES_SEASON_VIEW_KEY = 'kinetSeriesSeasonView';
let seriesSelectedEp = null;   // "saison-épisode" choisi dans la grille
let seriesSeasonMenu = null;   // saison dont le menu ⋯ est ouvert
let seriesUndo = null;         // { seasonNumber, rows } après « Tout décocher »
function seriesSeasonView(){
  try{ return localStorage.getItem(SERIES_SEASON_VIEW_KEY) === 'list' ? 'list' : 'grid'; }catch(e){ return 'grid'; }
}
function setSeriesSeasonView(view){
  try{ localStorage.setItem(SERIES_SEASON_VIEW_KEY, view); }catch(e){}
  seriesSelectedEp = null;
  renderSeasonsList();
}

function seasonMenuHtml(s){
  if(seriesSeasonMenu !== s.season_number) return '';
  const aired = airedEpisodesInSeason(s);
  return `<div class="ff-menu sx-season-menu" role="menu">
    ${aired ? `<button type="button" role="menuitem" data-season-all="${s.season_number}">Marquer ${aired > 1 ? `les ${aired} épisodes sortis` : 'l’épisode sorti'} comme vu${aired > 1 ? 's' : ''}</button>` : `<button type="button" role="menuitem" disabled>Rien n’est encore sorti</button>`}
    <button type="button" role="menuitem" data-season-none="${s.season_number}">Tout décocher</button>
  </div>`;
}
function episodeExtrasHtml(key){
  const extra = watchedEpisodeExtras[key] || { note: null, timesWatched: 1 };
  const note = extra.note;
  return `<div class="sx-extra">
    <span class="sx-step">Ta note <button type="button" data-ep-note="${key}" data-dir="-" aria-label="Baisser la note">−</button><b class="num ${note == null ? '' : noteColorClass(note)}">${note == null ? '—' : Number(note).toFixed(1)}</b><button type="button" data-ep-note="${key}" data-dir="+" aria-label="Monter la note">+</button></span>
    <span class="sx-step">Vu <button type="button" data-ep-times="${key}" data-dir="-" aria-label="Retirer un visionnage">−</button><b class="num">${extra.timesWatched || 1} fois</b><button type="button" data-ep-times="${key}" data-dir="+" aria-label="Ajouter un visionnage">+</button></span>
  </div>`;
}
function seasonGridHtml(s){
  const n = s.season_number;
  const squares = [];
  for(let ep = 1; ep <= (s.episode_count || 0); ep++){
    const key = `${n}-${ep}`;
    const aired = isEpisodeAired(n, ep);
    const on = watchedEpisodeSet.has(key);
    squares.push(`<button type="button" class="sx-sq-btn${on ? ' on' : ''}${aired ? '' : ' future'}${seriesSelectedEp === key ? ' sel' : ''}" data-sq="${key}" aria-pressed="${on}" aria-label="Épisode ${ep}${aired ? '' : ', pas encore sorti'}">${ep}</button>`);
  }
  let sel = '';
  if(seriesSelectedEp && seriesSelectedEp.startsWith(`${n}-`)){
    const ep = parseInt(seriesSelectedEp.split('-')[1], 10);
    const info = episodeInfo(n, ep);
    const on = watchedEpisodeSet.has(seriesSelectedEp);
    const aired = isEpisodeAired(n, ep);
    sel = `<div class="sx-sel"><b>${ep} · ${escapeHtml(info.name)}</b>${info.air ? `<span>${aired ? '' : 'sort le '}${formatDateFr(info.air)}</span>` : ''}<span>${on ? 'Vu' : aired ? 'Pas vu' : 'Pas encore sorti'}</span>${on ? episodeExtrasHtml(seriesSelectedEp) : ''}</div>`;
  }
  return `<div class="sx-sq">${squares.join('')}</div>${sel}`;
}
function renderSeasonsList(){
  const wrap = document.getElementById('seriesSeasonsList');
  if(!wrap) return;
  const view = seriesSeasonView();
  document.querySelectorAll('[data-sx-view]').forEach(b => {
    const on = b.dataset.sxView === view;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', String(on));
  });
  const legend = document.getElementById('seriesLegend');
  if(legend) legend.hidden = view !== 'grid' || currentShowSeasons.length === 0;
  renderSeriesUndo();
  if(currentShowSeasons.length === 0){
    wrap.innerHTML = `<div class="tmdb-empty">Aucune saison référencée sur TMDB pour cette série.</div>`;
    return;
  }
  const expanded = (seasonUiCache[currentShowId] && seasonUiCache[currentShowId].expanded) || new Set();
  wrap.innerHTML = currentShowSeasons.map(s => {
    const n = s.season_number;
    const aired = airedEpisodesInSeason(s);
    const watched = watchedInSeason(n);
    const avg = seasonAverageNote(n);
    const progress = aired ? `${watched} / ${aired}` : (s.air_date ? `à venir · ${formatDateFr(s.air_date)}` : 'à venir');
    const open = view === 'list' && expanded.has(n);
    return `
    <div class="season-block sx-season${open ? ' open' : ''}" data-season="${n}">
      <div class="sx-season-head">
        <button class="season-header" type="button" ${view === 'list' ? `data-season-toggle="${n}" aria-expanded="${open}"` : 'tabindex="-1"'}>
          <span class="season-name">${escapeHtml(seasonLabel(s))}</span>
          ${aired ? `<span class="sx-bar"><b style="width:${Math.round(watched / aired * 100)}%"></b></span>` : ''}
          <span class="season-progress num" id="seasonProgress-${n}">${progress}</span>
          <span class="sx-avg num ${avg == null ? '' : noteColorClass(avg)}" id="seasonAvg-${n}">${avg == null ? '' : avg.toFixed(1)}</span>
        </button>
        <div class="sx-season-more">
          <button type="button" class="ff-btn-icon" data-season-menu="${n}" aria-label="Plus d'actions pour ${escapeHtml(seasonLabel(s))}" aria-haspopup="true">${uiIcon('dots')}</button>
          ${seasonMenuHtml(s)}
        </div>
        ${view === 'list' ? `<button type="button" class="sx-caret-btn" data-season-toggle="${n}" aria-expanded="${open}" aria-label="${open ? 'Replier' : 'Déplier'} ${escapeHtml(seasonLabel(s))}"><span class="season-caret" aria-hidden="true"></span></button>` : ''}
      </div>
      ${view === 'grid' ? seasonGridHtml(s) : `<div class="season-episodes" id="seasonEpisodes-${n}"></div>`}
    </div>`;
  }).join('');
  if(view === 'list') expanded.forEach(n => { if(loadedSeasonEpisodes[n]) renderSeasonEpisodes(n); });
}

// Bandeau « Saison 2 décochée. Annuler » après « Tout décocher » (S2).
function renderSeriesUndo(){
  const el = document.getElementById('seriesUndo');
  if(!el) return;
  if(!seriesUndo){ el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `<span><b>Saison ${seriesUndo.seasonNumber}</b> décochée.</span><button type="button" class="catalog-strip-btn" id="seriesUndoBtn">Annuler</button>`;
  document.getElementById('seriesUndoBtn').addEventListener('click', undoUnmarkSeason);
}

// Déplie une saison : chargée une seule fois par série (voir
// seasonUiCache/loadedSeasonEpisodes plus haut) — ne rappelle pas TMDB si
// cette saison a déjà été dépliée, y compris après un aller-retour sur une
// autre page. Mémorise aussi qu'elle est dépliée pour la redéplier toute
// seule au prochain retour sur cette série (openShowDetail()).
async function openSeason(seasonNumber){
  const block = document.querySelector(`.season-block[data-season="${seasonNumber}"]`);
  if(!block || block.classList.contains('open')) return;
  block.classList.add('open');
  if(seasonUiCache[currentShowId]) seasonUiCache[currentShowId].expanded.add(seasonNumber);
  if(!loadedSeasonEpisodes[seasonNumber]){
    const episodesEl = document.getElementById(`seasonEpisodes-${seasonNumber}`);
    if(episodesEl) episodesEl.innerHTML = `<div class="tmdb-empty">Chargement…</div>`;
    const show = trackedShows.find(s => s.id === currentShowId);
    try{
      const seasonData = await fetchTvSeason(show.tmdbId, seasonNumber);
      loadedSeasonEpisodes[seasonNumber] = seasonData.episodes || [];
    }catch(e){
      if(episodesEl) episodesEl.innerHTML = `<div class="tmdb-empty">${escapeHtml(e.message)}</div>`;
      console.error(e);
      return;
    }
  }
  renderSeasonEpisodes(seasonNumber);
}

function closeSeason(seasonNumber){
  const block = document.querySelector(`.season-block[data-season="${seasonNumber}"]`);
  if(block) block.classList.remove('open');
  if(seasonUiCache[currentShowId]) seasonUiCache[currentShowId].expanded.delete(seasonNumber);
}

async function toggleSeason(seasonNumber){
  const block = document.querySelector(`.season-block[data-season="${seasonNumber}"]`);
  if(!block) return;
  if(block.classList.contains('open')) closeSeason(seasonNumber);
  else await openSeason(seasonNumber);
}

function renderSeasonEpisodes(seasonNumber){
  const episodesEl = document.getElementById(`seasonEpisodes-${seasonNumber}`);
  // En grille, pas de liste d'épisodes : on redessine les carrés.
  if(!episodesEl){ if(seriesSeasonView() === 'grid') renderSeasonsList(); return; }
  const episodes = loadedSeasonEpisodes[seasonNumber] || [];
  if(episodes.length === 0){
    episodesEl.innerHTML = `<div class="tmdb-empty">Aucun épisode référencé pour cette saison.</div>`;
    return;
  }
  // Un épisode à venir est grisé, avec sa date, sans case (S1). La note et
  // les revisionnages n'apparaissent qu'en touchant le titre d'un épisode vu (S6).
  episodesEl.innerHTML = episodes.map(ep => {
    const key = `${seasonNumber}-${ep.episode_number}`;
    const checked = watchedEpisodeSet.has(key);
    const aired = isEpisodeAired(seasonNumber, ep.episode_number);
    const air = formatDateFr(ep.air_date);
    return `
      <div class="episode-row sx-ep${aired ? '' : ' future'}">
        <span class="episode-num num">${ep.episode_number}</span>
        <span class="episode-title" ${checked ? `data-ep-sel="${key}" role="button" tabindex="0"` : ''}>${escapeHtml(ep.name || `Épisode ${ep.episode_number}`)}</span>
        <span class="episode-air">${air ? `${aired ? '' : 'sort le '}${air}` : ''}</span>
        ${aired ? `<input type="checkbox" class="sx-check" data-season="${seasonNumber}" data-episode="${ep.episode_number}" aria-label="Vu" ${checked ? 'checked' : ''}>` : '<span></span>'}
        ${checked && seriesSelectedEp === key ? episodeExtrasHtml(key) : ''}
      </div>`;
  }).join('');
  episodesEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      if(cb.checked) pulseCheckbox(cb);
      toggleEpisodeWatched(seasonNumber, parseInt(cb.dataset.episode, 10), cb.checked, cb);
    });
  });
}

function updateSeasonProgressUI(seasonNumber, episodeCount){
  const el = document.getElementById(`seasonProgress-${seasonNumber}`);
  const season = currentShowSeasons.find(s => s.season_number === seasonNumber);
  const aired = season ? airedEpisodesInSeason(season) : episodeCount;
  if(el) el.textContent = `${watchedInSeason(seasonNumber)} / ${aired || episodeCount}`;
  const avgEl = document.getElementById(`seasonAvg-${seasonNumber}`);
  const avg = seasonAverageNote(seasonNumber);
  if(avgEl) avgEl.textContent = avg == null ? '' : avg.toFixed(1);
  renderEpisodesFicheValue(trackedShows.find(s => s.id === currentShowId));
  renderSeriesNextBlock();
  renderSeriesProgress();
}

// checkboxEl : la case cliquée — sur échec réseau, le navigateur a déjà
// basculé son état visuel avant que ce gestionnaire ne s'exécute (c'est
// une checkbox native), donc sans ce paramètre une écriture ratée laisse
// la case cochée à l'écran alors que rien n'a été enregistré (bug
// constaté à la vérification). On la remet dans son état réel ici.
async function toggleEpisodeWatched(seasonNumber, episodeNumber, watched, checkboxEl){
  const key = `${seasonNumber}-${episodeNumber}`;
  // File d'attente hors ligne (retour utilisateur, js/offlineQueue.js) :
  // épisode vu/pas vu s'appuie sur une clé naturelle (tv_show_id, saison,
  // épisode), jamais un id généré par le serveur — rejouable sans
  // réconciliation au retour du réseau, contrairement à une création.
  if(isOfflineMode){
    if(watched){
      enqueueOfflineWrite({
        table: 'tv_episodes_watched', op: 'upsert',
        payload: { tv_show_id: currentShowId, season_number: seasonNumber, episode_number: episodeNumber, watched_at: Date.now() },
        upsertOptions: { onConflict: 'user_id,tv_show_id,season_number,episode_number', ignoreDuplicates: true }
      });
      watchedEpisodeSet.add(key);
      watchedEpisodeExtras[key] = { note: null, timesWatched: 1 };
    }else{
      enqueueOfflineWrite({ table: 'tv_episodes_watched', op: 'delete', match: { tv_show_id: currentShowId, season_number: seasonNumber, episode_number: episodeNumber } });
      watchedEpisodeSet.delete(key);
      delete watchedEpisodeExtras[key];
    }
    const seasonOffline = currentShowSeasons.find(s => s.season_number === seasonNumber);
    if(seasonOffline) updateSeasonProgressUI(seasonNumber, seasonOffline.episode_count);
    watchedEpisodeCounts[currentShowId] = watchedEpisodeSet.size;
    renderSeasonEpisodes(seasonNumber);
    return;
  }
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
  // Note de saison calculée (retour utilisateur) : recalculée depuis les
  // notes d'épisode, voir seasonAverageNote() — sans cet appel, l'en-tête
  // de saison n'afficherait la nouvelle moyenne qu'au prochain repli/dépli
  // de l'accordéon.
  const season = currentShowSeasons.find(s => s.season_number === seasonNumber);
  if(season) updateSeasonProgressUI(seasonNumber, season.episode_count);
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
    // Seulement les épisodes déjà sortis (S1).
    if(!isEpisodeAired(seasonNumber, ep)) continue;
    rows.push({ tv_show_id: currentShowId, season_number: seasonNumber, episode_number: ep, watched_at: Date.now() });
  }
  if(rows.length === 0){ showToast('Rien n’est encore sorti dans cette saison'); return; }
  const { error } = await supabaseClient
    .from('tv_episodes_watched')
    .upsert(rows, { onConflict: 'user_id,tv_show_id,season_number,episode_number', ignoreDuplicates: true });
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  rows.forEach(r => {
    const key = `${seasonNumber}-${r.episode_number}`;
    watchedEpisodeSet.add(key);
    ensureEpisodeExtras(key);
  });
  watchedEpisodeCounts[currentShowId] = watchedEpisodeSet.size;
  renderSeriesBlocks();
  showToast(`Saison ${seasonNumber} : épisodes sortis marqués vus`);
}

// « Tout décocher » une saison (S2) : plus d'effacement silencieux. Les
// lignes retirées (avec leur note et leurs revisionnages) sont gardées le
// temps de proposer « Annuler », qui les remet telles quelles.
async function unmarkSeasonWatched(seasonNumber){
  if(blockIfOffline()) return;
  const { data: removedRows, error: readErr } = await supabaseClient
    .from('tv_episodes_watched')
    .select('season_number, episode_number, watched_at, note, times_watched')
    .eq('tv_show_id', currentShowId).eq('season_number', seasonNumber);
  if(readErr) console.error(readErr);
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
  watchedEpisodeCounts[currentShowId] = watchedEpisodeSet.size;
  seriesUndo = (removedRows && removedRows.length) ? { seasonNumber, showId: currentShowId, rows: removedRows } : null;
  renderSeriesBlocks();
}
async function undoUnmarkSeason(){
  const undo = seriesUndo;
  seriesUndo = null;
  if(!undo || undo.showId !== currentShowId){ renderSeriesUndo(); return; }
  const rows = undo.rows.map(r => ({ tv_show_id: undo.showId, season_number: r.season_number, episode_number: r.episode_number, watched_at: r.watched_at, note: r.note, times_watched: r.times_watched || 1 }));
  const { error } = await supabaseClient
    .from('tv_episodes_watched')
    .upsert(rows, { onConflict: 'user_id,tv_show_id,season_number,episode_number' });
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  rows.forEach(r => {
    const key = `${r.season_number}-${r.episode_number}`;
    watchedEpisodeSet.add(key);
    watchedEpisodeExtras[key] = { note: r.note != null ? parseFloat(r.note) : null, timesWatched: r.times_watched || 1 };
  });
  watchedEpisodeCounts[currentShowId] = watchedEpisodeSet.size;
  renderSeriesBlocks();
  showToast(`Saison ${undo.seasonNumber} recochée`);
}

// --- Marquer TOUTE la série d'un coup (v2.1, retour utilisateur) ---
// currentShowSeasons (métadonnées TMDB, chargées par refreshShowMeta() à
// l'ouverture de la page) donne le nombre d'épisodes de CHAQUE saison sans
// avoir à déplier son accordéon — un seul upsert groupé couvrant toutes
// les saisons plutôt que N appels réseau (un par saison).
async function markAllSeasonsWatched(){
  if(blockIfOffline()) return;
  if(currentShowSeasons.length === 0) return;
  if(!confirm('Marquer comme vus tous les épisodes déjà sortis ?')) return;
  const rows = [];
  currentShowSeasons.forEach(s => {
    for(let ep = 1; ep <= s.episode_count; ep++){
      if(!isEpisodeAired(s.season_number, ep)) continue;
      rows.push({ tv_show_id: currentShowId, season_number: s.season_number, episode_number: ep, watched_at: Date.now() });
    }
  });
  if(rows.length === 0) return;
  const { error } = await supabaseClient
    .from('tv_episodes_watched')
    .upsert(rows, { onConflict: 'user_id,tv_show_id,season_number,episode_number', ignoreDuplicates: true });
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  rows.forEach(r => {
    const key = `${r.season_number}-${r.episode_number}`;
    watchedEpisodeSet.add(key);
    ensureEpisodeExtras(key);
  });
  watchedEpisodeCounts[currentShowId] = watchedEpisodeSet.size;
  renderSeriesBlocks();
  showToast('Épisodes sortis marqués vus');
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

// --- "Marquer l'épisode suivant" (draft Scope, bouton #seriesNextEpisodeBtn)
// --- Cherche le premier épisode non vu, saison par saison dans l'ordre,
// et le marque vu d'un seul clic — pas besoin de déplier la bonne saison
// et viser la bonne case à la main. S'appuie sur toggleEpisodeWatched()
// (déjà hors-ligne-compatible, voir plus haut) plutôt que de dupliquer
// l'écriture ici.
async function markNextEpisodeWatched(){
  // Seulement un épisode déjà sorti (S1) : le suivant pas encore diffusé
  // n'est jamais coché.
  const next = nextEpisodeToWatch();
  if(!next){ showToast('Tu as vu tous les épisodes sortis'); return; }
  await toggleEpisodeWatched(next.s, next.e, true);
  const info = episodeInfo(next.s, next.e);
  showToast(`Saison ${next.s}, épisode ${next.e} « ${info.name} » marqué vu`);
}

// Champ "Commentaire" retiré de cette fiche (v3.2, retour utilisateur,
// déclutter) — ne touche plus que la note, plus sa colonne `review` en
// base (show.review reste chargé par rowToShow() mais n'est plus affiché
// ni réécrit ici).
async function handleSaveSeriesNote(){
  if(blockIfOffline()) return;
  const note = parseFloat(document.getElementById('seriesNoteSlider').value);
  const { error } = await supabaseClient
    .from('tv_shows')
    .update({ manual_note: note })
    .eq('id', currentShowId);
  if(error){
    showToast('Erreur de sauvegarde, réessaie');
    console.error(error);
    return;
  }
  const show = trackedShows.find(s => s.id === currentShowId);
  if(show){ show.manualNote = note; renderRatingRing(show); }
  showToast('Note enregistrée');
}

// Où regarder (retour utilisateur), voir renderWatchProvidersHtml()
// (js/tmdb.js). Jamais bloquant : une erreur ici (réseau, série sans
// donnée FR) n'empêche jamais le reste de la fiche de s'afficher.
async function renderShowDetailWatchProviders(tmdbId){
  const wrap = document.getElementById('seriesDetailWatchProviders');
  try{
    const providers = await fetchWatchProviders(tmdbId, 'tv');
    // Même présentation que la fiche film : tes abonnements d'abord.
    wrap.innerHTML = typeof filmProvidersHtml === 'function' ? filmProvidersHtml(providers) : renderWatchProvidersHtml(providers);
    const more = wrap.querySelector('.ff-rent-toggle');
    if(more){
      more.addEventListener('click', () => {
        const list = wrap.querySelector('.ff-rent-list');
        list.hidden = !list.hidden;
        more.setAttribute('aria-expanded', String(!list.hidden));
      });
    }
  }catch(e){
    console.error(e);
    wrap.innerHTML = `<div class="tmdb-empty">Disponibilité indisponible pour l'instant.</div>`;
  }
}

// Bande-annonce (draft Scope, bouton #seriesTrailerBtn ; même principe côté
// film, voir updateFilmDetailTrailerBtn(), js/filmDetail.js) — masqué par
// défaut (jamais de bouton mort, voir tous les autres liens optionnels de
// cette fiche) : n'apparaît que si fetchVideos() renvoie vraiment une
// bande-annonce YouTube pour cette série.
async function updateSeriesTrailerBtn(tmdbId){
  const btn = document.getElementById('seriesTrailerBtn');
  if(!btn) return;
  btn.style.display = 'none';
  btn.innerHTML = `${uiIcon('play')}<span>Bande-annonce</span>`;
  try{
    const video = pickTrailerVideo(await fetchVideos(tmdbId, 'tv'));
    if(!video) return;
    btn.href = `https://www.youtube.com/watch?v=${video.key}`;
    btn.style.display = '';
  }catch(e){
    console.error(e);
  }
}

// setShowNavFromPending()/renderShowNavArrows()/goShowNav() : même principe
// que setFilmNavFromPending() etc., js/filmDetail.js — voir pendingShowNavList,
// js/router.js.
function setShowNavFromPending(showId){
  showNavList = (typeof pendingShowNavList !== 'undefined' && pendingShowNavList) || null;
  if(typeof pendingShowNavList !== 'undefined') pendingShowNavList = null;
  showNavIndex = showNavList ? showNavList.findIndex(s => s.id === showId) : -1;
  renderShowNavArrows();
}

function renderShowNavArrows(){
  const prevBtn = document.getElementById('seriesDetailPrevBtn');
  const nextBtn = document.getElementById('seriesDetailNextBtn');
  if(!prevBtn || !nextBtn) return;
  const hasPrev = showNavIndex > 0;
  const hasNext = showNavIndex >= 0 && showNavIndex < showNavList.length - 1;
  prevBtn.style.display = hasPrev ? '' : 'none';
  nextBtn.style.display = hasNext ? '' : 'none';
  prevBtn.title = hasPrev ? `Série précédente : ${showNavList[showNavIndex - 1].title}` : '';
  prevBtn.setAttribute('aria-label', prevBtn.title || 'Série précédente');
  nextBtn.title = hasNext ? `Série suivante : ${showNavList[showNavIndex + 1].title}` : '';
  nextBtn.setAttribute('aria-label', nextBtn.title || 'Série suivante');
}

function goShowNav(delta){
  if(!showNavList) return;
  const cible = showNavList[showNavIndex + delta];
  if(!cible) return;
  goToSeriesDetail(cible.id, showNavList);
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
  setShowNavFromPending(showId);
  currentShowSeasons = [];
  // Cache par série (voir seasonUiCache plus haut) : garde les saisons
  // dépliées et déjà téléchargées d'une visite à l'autre de CETTE série,
  // pour la durée de la session — jamais partagé entre deux séries
  // différentes, jamais persisté au-delà d'un rechargement complet.
  if(!seasonUiCache[showId]) seasonUiCache[showId] = { expanded: new Set(), episodes: {} };
  loadedSeasonEpisodes = seasonUiCache[showId].episodes;
  watchedEpisodeSet = new Set();
  watchedEpisodeExtras = {};

  renderShowDetailHeader(show);
  document.getElementById('seriesSeasonsList').innerHTML = `${skeletonRows(3)}`;
  document.getElementById('seriesNextBlock').innerHTML = '';
  document.getElementById('seriesProgress').innerHTML = '';
  closeSeriesNotePop();
  document.getElementById('seriesDetailWatchProviders').innerHTML = `<div class="tmdb-empty">Chargement…</div>`;

  await Promise.all([
    refreshShowMeta(show),
    loadWatchedEpisodes(showId),
    renderShowDetailWatchProviders(show.tmdbId),
    updateSeriesTrailerBtn(show.tmdbId)
  ]);
  renderShowDetailHeader(show); // statut éventuellement mis à jour par refreshShowMeta() (gère déjà la pastille de note et le total d'épisodes)
  seriesSelectedEp = null;
  seriesSeasonMenu = null;
  if(seriesUndo && seriesUndo.showId !== showId) seriesUndo = null;
  renderSeriesBlocks();
  // Vue Liste : redéplie les saisons qui l'étaient avant de quitter la page
  // (retour utilisateur), épisodes gardés en cache pour la session.
  if(seriesSeasonView() === 'list'){
    for(const seasonNumber of seasonUiCache[showId].expanded) await ensureSeasonEpisodes(seasonNumber);
    renderSeasonsList();
  }
}

document.getElementById('seriesDetailBack').addEventListener('click', () => returnFromDetail(goToSeries));
document.getElementById('seriesDetailPrevBtn').addEventListener('click', () => goShowNav(-1));
document.getElementById('seriesDetailNextBtn').addEventListener('click', () => goShowNav(1));
document.addEventListener('keydown', (e) => {
  if(e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if(!isDetailKeyNavAllowed('seriesDetailPage', e)) return;
  goShowNav(e.key === 'ArrowLeft' ? -1 : 1);
});
// Bouton "Enregistrer" retiré (retour utilisateur, déclutter) : sauvegarde
// automatique au relâchement du curseur ('change', une fois en fin de
// glissement, jamais à chaque tick de 'input' — sinon une écriture réseau
// par pixel glissé).
document.getElementById('seriesNoteSlider').addEventListener('input', (e) => {
  e.target.classList.remove('is-unset');
  document.getElementById('seriesNoteVal').textContent = parseFloat(e.target.value).toFixed(1);
});
document.getElementById('seriesNoteSlider').addEventListener('change', handleSaveSeriesNote);
document.getElementById('seriesRemoveBtn').addEventListener('click', () => handleRemoveShow(currentShowId, true));
// Saisons (piste D) : un seul écouteur pour la grille, la liste et les menus ⋯.
document.getElementById('seriesSeasonsList').addEventListener('click', async (e) => {
  const t = e.target;
  const menuBtn = t.closest('[data-season-menu]');
  if(menuBtn){
    e.stopPropagation();
    const n = parseInt(menuBtn.dataset.seasonMenu, 10);
    seriesSeasonMenu = seriesSeasonMenu === n ? null : n;
    renderSeasonsList();
    return;
  }
  const all = t.closest('[data-season-all]');
  if(all){
    seriesSeasonMenu = null;
    const n = parseInt(all.dataset.seasonAll, 10);
    const season = currentShowSeasons.find(x => x.season_number === n);
    await markSeasonWatched(n, season ? season.episode_count : 0);
    return;
  }
  const none = t.closest('[data-season-none]');
  if(none){
    seriesSeasonMenu = null;
    await unmarkSeasonWatched(parseInt(none.dataset.seasonNone, 10));
    return;
  }
  const sq = t.closest('[data-sq]');
  if(sq){
    const [n, ep] = sq.dataset.sq.split('-').map(Number);
    seriesSelectedEp = sq.dataset.sq;
    if(!isEpisodeAired(n, ep)){
      renderSeasonsList();
      await ensureSeasonEpisodes(n);
      renderSeasonsList();
      return;
    }
    await toggleEpisodeWatched(n, ep, !watchedEpisodeSet.has(sq.dataset.sq));
    if(!loadedSeasonEpisodes[n]){ await ensureSeasonEpisodes(n); renderSeasonsList(); }
    return;
  }
  const sel = t.closest('[data-ep-sel]');
  if(sel){
    seriesSelectedEp = seriesSelectedEp === sel.dataset.epSel ? null : sel.dataset.epSel;
    renderSeasonEpisodes(parseInt(sel.dataset.epSel.split('-')[0], 10));
    return;
  }
  const noteBtn = t.closest('[data-ep-note]');
  if(noteBtn){
    const key = noteBtn.dataset.epNote;
    const [n, ep] = key.split('-').map(Number);
    const cur = watchedEpisodeExtras[key] && watchedEpisodeExtras[key].note;
    const up = noteBtn.dataset.dir === '+';
    const next = cur == null ? (up ? 3 : 2.5) : Math.min(5, Math.max(0.5, cur + (up ? 0.5 : -0.5)));
    await updateEpisodeNote(n, ep, String(next));
    renderSeasonEpisodes(n);
    return;
  }
  const timesBtn = t.closest('[data-ep-times]');
  if(timesBtn){
    const [n, ep] = timesBtn.dataset.epTimes.split('-').map(Number);
    await changeEpisodeTimesWatched(n, ep, timesBtn.dataset.dir === '+' ? 1 : -1);
    return;
  }
  // Le nom de la saison et la flèche à droite déplient tous les deux.
  const toggle = t.closest('[data-season-toggle]');
  if(toggle){
    const n = parseInt(toggle.dataset.seasonToggle, 10);
    const block = toggle.closest('.season-block');
    await toggleSeason(n);
    if(block){
      const open = block.classList.contains('open');
      const season = currentShowSeasons.find(x => x.season_number === n);
      block.querySelectorAll('[data-season-toggle]').forEach(b => b.setAttribute('aria-expanded', String(open)));
      const caret = block.querySelector('.sx-caret-btn');
      if(caret && season) caret.setAttribute('aria-label', `${open ? 'Replier' : 'Déplier'} ${seasonLabel(season)}`);
    }
  }
});
document.addEventListener('click', (e) => {
  if(seriesSeasonMenu !== null && (!e.target.closest || !e.target.closest('.sx-season-more'))){
    seriesSeasonMenu = null;
    if(document.getElementById('seriesDetailPage').style.display !== 'none') renderSeasonsList();
  }
});
document.querySelectorAll('[data-sx-view]').forEach(btn => {
  btn.addEventListener('click', async () => {
    setSeriesSeasonView(btn.dataset.sxView);
    if(btn.dataset.sxView === 'list' && seasonUiCache[currentShowId]){
      for(const n of seasonUiCache[currentShowId].expanded) await ensureSeasonEpisodes(n);
      renderSeasonsList();
    }
  });
});
// Ta note : l'anneau ouvre le curseur sur place (S7).
function closeSeriesNotePop(){
  const pop = document.getElementById('seriesNotePop');
  if(pop) pop.hidden = true;
  const ring = document.getElementById('seriesDetailRatingRing');
  if(ring) ring.setAttribute('aria-expanded', 'false');
}
document.getElementById('seriesDetailRatingRing').addEventListener('click', (e) => {
  e.stopPropagation();
  const pop = document.getElementById('seriesNotePop');
  pop.hidden = !pop.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!pop.hidden));
});
document.addEventListener('click', (e) => {
  if(!e.target.closest || !e.target.closest('.sx-ring-wrap')) closeSeriesNotePop();
});
document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeSeriesNotePop(); });
document.getElementById('seriesMarkAllBtn').addEventListener('click', markAllSeasonsWatched);
document.getElementById('seriesUnmarkAllBtn').addEventListener('click', unmarkAllSeasonsWatched);
document.getElementById('seriesNextEpisodeBtn').addEventListener('click', markNextEpisodeWatched);
