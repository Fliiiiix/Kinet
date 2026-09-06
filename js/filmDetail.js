// --- Fiche film (v2.1, retour utilisateur) ---
// Page dédiée à un film précis (route #/film/:tmdbId, voir js/router.js) :
// résumé, genre, note moyenne communautaire, + noter/aimer/commenter.
// Accessible en cliquant un film n'importe où dans l'app (profil d'un
// ami, Top...), pas seulement depuis son propre catalogue.
//
// Toujours rappelée en direct depuis TMDB (fetchMovieDetails(), js/tmdb.js)
// plutôt que de dépendre d'une donnée déjà en mémoire (posterUrl/overview
// connus ou non selon d'où on vient) — même principe que
// refreshShowMeta() pour les séries (js/series.js).
//
// Like/commentaire : tables dédiées (film_likes/film_comments,
// migrations/030), visibles entre amis (policy RLS "are_friends"), pas
// juste soi — distinct du ★ favori et de review, tous les deux personnels.

let currentFilmTmdbId = null;
let currentFilmData = null;    // forme tmdbSelected : {tmdb_id, title, poster_url, overview, release_year, original_title, genre_ids}
let filmDetailLikes = [];      // [{ id, userId }]
let filmDetailComments = [];   // [{ id, userId, body, createdAt }]

function normalizeMovieDetails(details){
  return {
    tmdb_id: details.id,
    title: details.title,
    original_title: details.original_title && details.original_title !== details.title ? details.original_title : null,
    poster_url: details.poster_path ? TMDB_IMG_BASE + details.poster_path : null,
    overview: details.overview || null,
    release_year: details.release_date ? parseInt(details.release_date.slice(0, 4), 10) : null,
    release_date: details.release_date || null,
    genre_ids: (details.genres || []).map(g => g.id)
  };
}

function renderFilmDetailHeader(){
  const d = currentFilmData;
  document.getElementById('filmDetailTitle').textContent = d.title;
  const posterImg = document.getElementById('filmDetailPoster');
  const posterPlaceholder = document.getElementById('filmDetailPosterPlaceholder');
  if(d.poster_url){
    posterImg.src = d.poster_url;
    posterImg.style.display = '';
    posterPlaceholder.style.display = 'none';
  }else{
    posterImg.style.display = 'none';
    posterPlaceholder.style.display = '';
  }
  const genres = (d.genre_ids || []).map(id => GENRE_MAP[id]).filter(Boolean).join(', ');
  const metaParts = [];
  if(d.release_year) metaParts.push(`<span class="wl-year">(${d.release_year})</span>`);
  if(genres) metaParts.push(escapeHtml(genres));
  document.getElementById('filmDetailMeta').innerHTML = metaParts.join(' · ');
  document.getElementById('filmDetailOverview').textContent = d.overview || 'Aucun résumé disponible.';
}

async function renderFilmDetailNotes(){
  const wrap = document.getElementById('filmDetailNotes');
  wrap.innerHTML = `<div class="tmdb-empty">Chargement…</div>`;
  const { data, error } = await supabaseClient.rpc('get_film_stats', { p_tmdb_id: currentFilmTmdbId });
  const stats = Array.isArray(data) ? data[0] : data;
  const avgNote = (!error && stats && stats.avg_note !== null) ? Number(stats.avg_note) : null;
  const ratingCount = (!error && stats) ? stats.rating_count : 0;
  if(error) console.error(error);

  const myFilm = films.find(f => f.tmdbId === currentFilmTmdbId);
  const myNote = myFilm ? getDisplayNote(myFilm) : null;

  wrap.innerHTML = `
    <div class="film-detail-note-row">
      <div class="counter ${noteColorClass(avgNote)}">${avgNote !== null ? avgNote.toFixed(1) : '—'}</div>
      <div class="wl-note">Note moyenne Kinet ${ratingCount ? `(${ratingCount} note${ratingCount > 1 ? 's' : ''})` : "(personne ne l'a encore noté)"}</div>
    </div>
    ${myNote !== null ? `
    <div class="film-detail-note-row">
      <div class="counter ${noteColorClass(myNote)}">${myNote.toFixed(1)}</div>
      <div class="wl-note">Ta note</div>
    </div>` : ''}
  `;
}

// S'assure que friendProfiles (js/friends.js) connaît bien tous les
// auteurs à afficher (likes + commentaires) — même principe que
// loadDigest() (js/activityState.js) : ne va chercher que les profils
// manquants, jamais tout redemander.
async function ensureProfilesCached(userIds){
  const missing = [...new Set(userIds)].filter(id => id !== currentUser.id && !friendProfiles[id]);
  if(missing.length === 0) return;
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('user_id, display_name, avatar_url')
    .in('user_id', missing);
  if(error){ console.error(error); return; }
  data.forEach(p => cacheProfile(p.user_id, p.display_name, p.avatar_url));
}

function updateLikeButtonUI(){
  const btn = document.getElementById('filmDetailLikeBtn');
  const liked = filmDetailLikes.some(l => l.userId === currentUser.id);
  btn.classList.toggle('active', liked);
  btn.textContent = liked ? '♥ Aimé' : '♡ Aimer';
}

function renderFilmDetailLikesSummary(){
  const others = filmDetailLikes.filter(l => l.userId !== currentUser.id);
  const summaryEl = document.getElementById('filmDetailLikesSummary');
  summaryEl.textContent = others.length === 0
    ? 'Aucun ami ne l\'a encore aimé.'
    : `Aimé par ${others.map(l => friendDisplayName(l.userId)).join(', ')}.`;
  updateLikeButtonUI();
}

async function loadFilmDetailLikes(){
  const { data, error } = await supabaseClient
    .from('film_likes')
    .select('id, user_id')
    .eq('tmdb_id', currentFilmTmdbId);
  if(error){
    console.error(error);
    filmDetailLikes = [];
    return;
  }
  filmDetailLikes = data.map(row => ({ id: row.id, userId: row.user_id }));
  await ensureProfilesCached(filmDetailLikes.map(l => l.userId));
  renderFilmDetailLikesSummary();
}

async function toggleFilmLike(){
  if(blockIfOffline()) return;
  const mine = filmDetailLikes.find(l => l.userId === currentUser.id);
  if(mine){
    const { error } = await supabaseClient.from('film_likes').delete().eq('id', mine.id);
    if(error){ showToast('Erreur, réessaie'); console.error(error); return; }
    filmDetailLikes = filmDetailLikes.filter(l => l.id !== mine.id);
  }else{
    // user_id explicite : contrairement à films/watchlist/tv_shows,
    // film_likes/film_comments (migrations/030) n'ont pas de valeur par
    // défaut auth.uid() sur cette colonne — sans lui l'insert est rejeté
    // par la policy RLS ("new row violates row-level security policy"),
    // constaté en test.
    const { data, error } = await supabaseClient
      .from('film_likes')
      .insert({ tmdb_id: currentFilmTmdbId, user_id: currentUser.id })
      .select()
      .single();
    if(error){ showToast('Erreur, réessaie'); console.error(error); return; }
    filmDetailLikes.push({ id: data.id, userId: currentUser.id });
  }
  renderFilmDetailLikesSummary();
}

function renderFilmDetailComments(){
  const list = document.getElementById('filmDetailCommentsList');
  if(filmDetailComments.length === 0){
    list.innerHTML = `<div class="tmdb-empty">Aucun commentaire pour l'instant.</div>`;
    return;
  }
  list.innerHTML = filmDetailComments.map(c => `
    <div class="comment-item">
      ${friendAvatarHtml(c.userId, friendDisplayName(c.userId))}
      <div class="comment-body-wrap">
        <div class="comment-author">${escapeHtml(friendDisplayName(c.userId))}</div>
        <div class="comment-body">${escapeHtml(c.body)}</div>
      </div>
      ${c.userId === currentUser.id ? `<button class="comment-delete" data-id="${c.id}" type="button" title="Supprimer" aria-label="Supprimer ce commentaire">✕</button>` : ''}
    </div>
  `).join('');
  list.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => deleteFilmComment(parseInt(btn.dataset.id, 10)));
  });
}

async function loadFilmDetailComments(){
  const { data, error } = await supabaseClient
    .from('film_comments')
    .select('*')
    .eq('tmdb_id', currentFilmTmdbId)
    .order('created_at', { ascending: true });
  if(error){
    console.error(error);
    filmDetailComments = [];
    return;
  }
  filmDetailComments = data.map(row => ({ id: row.id, userId: row.user_id, body: row.body, createdAt: row.created_at }));
  await ensureProfilesCached(filmDetailComments.map(c => c.userId));
  renderFilmDetailComments();
}

async function addFilmComment(){
  if(blockIfOffline()) return;
  const input = document.getElementById('filmDetailCommentInput');
  const body = input.value.trim();
  if(!body) return;
  // user_id explicite — même raison que toggleFilmLike() plus haut.
  const { data, error } = await supabaseClient
    .from('film_comments')
    .insert({ tmdb_id: currentFilmTmdbId, body, user_id: currentUser.id })
    .select()
    .single();
  if(error){ showToast('Erreur, réessaie'); console.error(error); return; }
  filmDetailComments.push({ id: data.id, userId: currentUser.id, body, createdAt: data.created_at });
  input.value = '';
  renderFilmDetailComments();
}

async function deleteFilmComment(id){
  if(blockIfOffline()) return;
  if(!confirm('Supprimer ce commentaire ?')) return;
  const { error } = await supabaseClient.from('film_comments').delete().eq('id', id);
  if(error){ showToast('Erreur, réessaie'); console.error(error); return; }
  filmDetailComments = filmDetailComments.filter(c => c.id !== id);
  renderFilmDetailComments();
}

// --- Boutons d'action : noter / ajouter à la watchlist ---

function updateFilmDetailActionButtons(){
  const myFilm = films.find(f => f.tmdbId === currentFilmTmdbId);
  const rateBtn = document.getElementById('filmDetailRateBtn');
  rateBtn.textContent = myFilm ? 'Modifier ma note' : 'Noter ce film';

  const inWatchlist = watchlist.some(w => w.tmdbId === currentFilmTmdbId);
  const watchlistBtn = document.getElementById('filmDetailWatchlistBtn');
  // Un film déjà noté n'a plus sa place dans "à voir" — masqué plutôt que
  // désactivé, pas d'action possible qui aurait un sens ici.
  watchlistBtn.style.display = (myFilm || inWatchlist) ? 'none' : '';
}

function handleFilmDetailRate(){
  const myFilm = films.find(f => f.tmdbId === currentFilmTmdbId);
  if(myFilm){
    openModal(myFilm.id);
  }else{
    openModal(null, currentFilmData);
  }
}

async function handleFilmDetailAddWatchlist(){
  if(blockIfOffline()) return;
  const d = currentFilmData;
  const payload = {
    title: d.title,
    note: null,
    added: Date.now(),
    tmdb_id: d.tmdb_id,
    poster_url: d.poster_url,
    overview: d.overview,
    release_year: d.release_year,
    release_date: d.release_date || null,
    original_title: d.original_title
  };
  const { data, error } = await supabaseClient.from('watchlist').insert(payload).select().single();
  if(error){ showToast('Erreur, réessaie'); console.error(error); return; }
  watchlist.unshift({
    id: data.id, title: payload.title, note: null,
    tmdbId: payload.tmdb_id, posterUrl: payload.poster_url, overview: payload.overview,
    releaseYear: payload.release_year, releaseDate: payload.release_date,
    originalTitle: payload.original_title, added: data.added
  });
  updateFilmDetailActionButtons();
  showToast('Ajouté à la watchlist');
}

// Appelée par le routeur (#/film/:tmdbId).
async function openFilmDetail(tmdbId){
  currentFilmTmdbId = tmdbId;
  document.getElementById('filmDetailTitle').textContent = 'Chargement…';
  document.getElementById('filmDetailOverview').textContent = '';
  document.getElementById('filmDetailMeta').innerHTML = '';
  document.getElementById('filmDetailNotes').innerHTML = '';
  document.getElementById('filmDetailLikesSummary').textContent = '';
  document.getElementById('filmDetailCommentsList').innerHTML = `<div class="tmdb-empty">Chargement…</div>`;
  document.getElementById('filmDetailCommentInput').value = '';

  let details;
  try{
    details = await fetchMovieDetails(tmdbId);
  }catch(e){
    showToast('Film introuvable sur TMDB');
    console.error(e);
    goHome();
    return;
  }
  currentFilmData = normalizeMovieDetails(details);
  renderFilmDetailHeader();
  updateFilmDetailActionButtons();

  await Promise.all([
    renderFilmDetailNotes(),
    loadFilmDetailLikes(),
    loadFilmDetailComments()
  ]);
}

document.getElementById('filmDetailBack').addEventListener('click', goHome);
document.getElementById('filmDetailRateBtn').addEventListener('click', handleFilmDetailRate);
{
  const filmDetailWatchlistBtn = document.getElementById('filmDetailWatchlistBtn');
  filmDetailWatchlistBtn.addEventListener('click', withSubmitGuard(filmDetailWatchlistBtn, handleFilmDetailAddWatchlist));
}
document.getElementById('filmDetailLikeBtn').addEventListener('click', toggleFilmLike);
{
  const filmDetailCommentBtn = document.getElementById('filmDetailCommentBtn');
  filmDetailCommentBtn.addEventListener('click', withSubmitGuard(filmDetailCommentBtn, addFilmComment));
}
