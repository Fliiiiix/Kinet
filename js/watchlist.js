// --- Watchlist ("à voir") ---
// Liste séparée du catalogue noté (table `watchlist`, voir
// supabase/migrations/006). Ajout rapide : titre + fiche TMDB optionnelle +
// note libre, sans passer par la grille de critères. "Noter" transforme un
// item en film noté (ouvre le formulaire principal prérempli) et le retire
// de la watchlist une fois le film enregistré — voir handleSave() dans
// js/app.js, qui référence convertingFromWatchlistId.
//
// Écran à part entière (#/watchlist), pas une modal — voir js/router.js,
// même principe que Groupes (js/groups.js).

let watchlist = [];
let wlTmdbSelected = null; // { tmdb_id, poster_url, overview, release_year, title }
let convertingFromWatchlistId = null;

async function loadWatchlist(){
  const { data, error } = await supabaseClient
    .from('watchlist')
    .select('*')
    .order('added', { ascending: false });
  if(error){
    // Repli hors ligne (js/offline.js) : contrairement à loadFilms()/
    // loadViewings() (appelées au démarrage, avant même que l'utilisateur
    // choisisse une page), celle-ci n'est appelée qu'en ouvrant #/watchlist
    // — donc la seule à avoir une chance de détecter le hors ligne si
    // l'utilisateur y arrive par un lien direct sans passer par l'accueil.
    const cached = loadOfflineCache('watchlist');
    if(cached){
      watchlist = cached.data;
      enterOfflineMode(cached.savedAt);
      return;
    }
    showToast('Erreur de chargement de la watchlist');
    console.error(error);
    watchlist = [];
    return;
  }
  watchlist = data.map(row => ({
    id: row.id,
    title: row.title,
    note: row.note || null,
    tmdbId: row.tmdb_id || null,
    posterUrl: row.poster_url || null,
    overview: row.overview || null,
    releaseYear: row.release_year || null,
    // Date de sortie complète (migrations/025), utilisée par la section
    // Prochaines sorties (js/upcoming.js) pour trier par proximité réelle
    // — null pour les entrées ajoutées avant cette colonne, ou sans fiche
    // TMDB : ignorées par cette section plutôt que de fausser le tri.
    releaseDate: row.release_date || null,
    originalTitle: row.original_title || null,
    added: row.added
  }));
  saveOfflineCache('watchlist', watchlist);
}

function renderWatchlist(){
  const list = document.getElementById('wlList');
  if(watchlist.length === 0){
    list.innerHTML = `<div class="empty-state">Rien pour l'instant. Ajoute un film ci-dessus.</div>`;
    return;
  }
  list.innerHTML = '';
  watchlist.forEach(item => {
    const row = document.createElement('div');
    row.className = 'wl-row';
    row.innerHTML = `
      ${item.posterUrl
        ? `<img class="film-poster" src="${item.posterUrl}" alt="" loading="lazy">`
        : `<div class="film-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="wl-main">
        <div class="wl-title">${escapeHtml(item.title)}${item.releaseYear ? ` <span class="wl-year">(${item.releaseYear})</span>` : ''}</div>
        ${item.note ? `<div class="wl-note">${escapeHtml(item.note)}</div>` : ''}
      </div>
      <div class="wl-actions">
        <button class="btn secondary" data-action="rate" data-id="${item.id}">✔ Noter</button>
        <button class="btn danger" data-action="remove" data-id="${item.id}">Retirer</button>
      </div>
    `;
    row.querySelector('[data-action="rate"]').addEventListener('click', () => startRatingFromWatchlist(item));
    row.querySelector('[data-action="remove"]').addEventListener('click', () => handleRemoveFromWatchlist(item.id));
    list.appendChild(row);
  });
}

// Page watchlist — appelée par le routeur (#/watchlist).
async function openWatchlist(){
  document.getElementById('wlList').innerHTML = `<div class="empty-state">Chargement…</div>`;
  await loadWatchlist();
  renderWatchlist();
  // Suggestions (v2.1, js/suggestions.js) : plusieurs appels TMDB, jamais
  // attendu — la page watchlist s'affiche sans attendre ce complément.
  loadSuggestions();
}

async function handleAddToWatchlist(){
  if(blockIfOffline()) return; // js/offline.js — lecture seule hors ligne
  const title = document.getElementById('wlTitleInput').value.trim();
  if(!title){
    showToast('Ajoute un titre avant d\'enregistrer');
    return;
  }
  const note = document.getElementById('wlNoteInput').value.trim() || null;
  const tmdbFields = wlTmdbSelected
    ? { tmdb_id: wlTmdbSelected.tmdb_id, poster_url: wlTmdbSelected.poster_url, overview: wlTmdbSelected.overview, release_year: wlTmdbSelected.release_year, release_date: wlTmdbSelected.release_date, original_title: wlTmdbSelected.original_title }
    : { tmdb_id: null, poster_url: null, overview: null, release_year: null, release_date: null, original_title: null };

  const { data, error } = await supabaseClient
    .from('watchlist')
    .insert({ title, note, added: Date.now(), ...tmdbFields })
    .select()
    .single();
  if(error){
    showToast('Erreur de sauvegarde, réessaie');
    console.error(error);
    return;
  }

  watchlist.unshift({
    id: data.id, title, note,
    tmdbId: tmdbFields.tmdb_id, posterUrl: tmdbFields.poster_url,
    overview: tmdbFields.overview, releaseYear: tmdbFields.release_year,
    releaseDate: tmdbFields.release_date,
    originalTitle: tmdbFields.original_title,
    added: data.added
  });
  renderWatchlist();

  document.getElementById('wlTitleInput').value = '';
  document.getElementById('wlNoteInput').value = '';
  clearWlTmdbSelection();
  showToast('Ajouté à la watchlist');
}

async function handleRemoveFromWatchlist(id){
  if(blockIfOffline()) return; // js/offline.js — lecture seule hors ligne
  const { error } = await supabaseClient.from('watchlist').delete().eq('id', id);
  if(error){
    showToast('Erreur de suppression, réessaie');
    console.error(error);
    return;
  }
  watchlist = watchlist.filter(w => w.id !== id);
  renderWatchlist();
}

// Bascule vers le formulaire principal (grille/note manuelle) prérempli avec
// le titre et la fiche TMDB déjà connus. L'item n'est retiré de la watchlist
// qu'une fois le film effectivement enregistré, voir handleSave() (app.js).
// Retour à l'accueil d'abord (comme avant : fermer la modale watchlist
// laissait déjà voir l'accueil en dessous) — le formulaire s'ouvre par-dessus.
function startRatingFromWatchlist(item){
  goHome();
  openModal(null);
  document.getElementById('titleInput').value = item.title;
  if(item.tmdbId){
    tmdbSelected = {
      tmdb_id: item.tmdbId, poster_url: item.posterUrl,
      overview: item.overview, release_year: item.releaseYear, title: item.title,
      original_title: item.originalTitle
    };
    updateTmdbSelectedUI();
  }
  convertingFromWatchlistId = item.id;
}

// --- "Surprends-moi" (retour utilisateur) --- Tire un film au hasard dans
// la watchlist pour aider à décider quoi regarder ce soir plutôt que de
// parcourir toute la liste — correspond à l'usage central de l'app (noter
// vite, juste après avoir vu quelque chose), version "avant" plutôt
// qu'"après" du visionnage.
let currentSurpriseItem = null;

function renderSurpriseContent(item){
  document.getElementById('surpriseContent').innerHTML = `
    ${item.posterUrl
      ? `<img class="film-poster surprise-poster" src="${item.posterUrl}" alt="">`
      : ''}
    <div class="surprise-info">
      <div class="wl-title">${escapeHtml(item.title)}${item.releaseYear ? ` <span class="wl-year">(${item.releaseYear})</span>` : ''}</div>
      ${item.note ? `<div class="wl-note">${escapeHtml(item.note)}</div>` : ''}
    </div>
  `;
}

function openSurprise(){
  if(watchlist.length === 0){
    showToast('Ta watchlist est vide — ajoute un film d\'abord');
    return;
  }
  currentSurpriseItem = watchlist[Math.floor(Math.random() * watchlist.length)];
  renderSurpriseContent(currentSurpriseItem);
  openOverlay('surpriseOverlay');
}

document.getElementById('wlSurpriseBtn').addEventListener('click', openSurprise);
document.getElementById('closeSurprise').addEventListener('click', () => closeOverlay('surpriseOverlay'));
document.getElementById('surpriseOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'surpriseOverlay') closeOverlay('surpriseOverlay');
});
document.getElementById('surpriseRerollBtn').addEventListener('click', () => {
  // Évite de retomber sur EXACTEMENT le même film que le tirage précédent
  // tant qu'il y en a d'autres — sinon "Encore un" semblerait ne rien faire
  // la moitié du temps sur une petite watchlist.
  let next = currentSurpriseItem;
  if(watchlist.length > 1){
    do{ next = watchlist[Math.floor(Math.random() * watchlist.length)]; }while(next.id === currentSurpriseItem.id);
  }
  currentSurpriseItem = next;
  renderSurpriseContent(currentSurpriseItem);
});
document.getElementById('surpriseRateBtn').addEventListener('click', () => {
  closeOverlay('surpriseOverlay', () => startRatingFromWatchlist(currentSurpriseItem));
});

// --- Recherche TMDB pour le formulaire d'ajout rapide ---
// Le champ "Titre du film" fait aussi office de recherche (debounce pendant
// la frappe), comme dans le formulaire principal — voir js/tmdb.js.

let wlTmdbSearchTimer = null;

function renderWlTmdbResults(results){
  const wrap = document.getElementById('wlTmdbResults');
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
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectWlTmdbResult(r); });
    wrap.appendChild(item);
  });
}

function selectWlTmdbResult(r){
  wlTmdbSelected = {
    tmdb_id: r.id,
    poster_url: r.poster_path ? TMDB_IMG_BASE + r.poster_path : null,
    overview: r.overview || null,
    release_year: r.release_date ? parseInt(r.release_date.slice(0, 4), 10) : null,
    // Date complète (migrations/025) — voir js/upcoming.js.
    release_date: r.release_date || null,
    title: r.title,
    original_title: r.original_title && r.original_title !== r.title ? r.original_title : null
  };
  document.getElementById('wlTitleInput').value = r.title;
  document.getElementById('wlTmdbResults').innerHTML = '';
  updateWlTmdbSelectedUI();
}

function clearWlTmdbSelection(){
  wlTmdbSelected = null;
  updateWlTmdbSelectedUI();
}

function updateWlTmdbSelectedUI(){
  const box = document.getElementById('wlTmdbSelected');
  const img = document.getElementById('wlTmdbSelectedPoster');
  if(!wlTmdbSelected){
    box.style.display = 'none';
    return;
  }
  box.style.display = '';
  img.src = wlTmdbSelected.poster_url || '';
  img.style.display = wlTmdbSelected.poster_url ? '' : 'none';
  document.getElementById('wlTmdbSelectedTitle').textContent =
    wlTmdbSelected.title + (wlTmdbSelected.release_year ? ` (${wlTmdbSelected.release_year})` : '');
}

async function handleWlTmdbSearch(query){
  const wrap = document.getElementById('wlTmdbResults');
  wrap.innerHTML = `<div class="tmdb-empty">Recherche…</div>`;
  try{
    const results = await searchTmdb(query);
    renderWlTmdbResults(results);
  }catch(e){
    wrap.innerHTML = `<div class="tmdb-empty">${escapeHtml(e.message)}</div>`;
    console.error(e);
  }
}

document.getElementById('watchlistBtn').addEventListener('click', goToWatchlist);
document.getElementById('watchlistPageBack').addEventListener('click', goHome);
document.getElementById('wlAddBtn').addEventListener('click', handleAddToWatchlist);
document.getElementById('wlTitleInput').addEventListener('input', () => {
  clearTimeout(wlTmdbSearchTimer);
  const query = document.getElementById('wlTitleInput').value.trim();
  if(query.length < 2){
    document.getElementById('wlTmdbResults').innerHTML = '';
    return;
  }
  wlTmdbSearchTimer = setTimeout(() => handleWlTmdbSearch(query), 350);
});
document.getElementById('wlTitleInput').addEventListener('blur', () => {
  setTimeout(() => { document.getElementById('wlTmdbResults').innerHTML = ''; }, 150);
});
document.getElementById('wlTmdbClearBtn').addEventListener('click', clearWlTmdbSelection);
