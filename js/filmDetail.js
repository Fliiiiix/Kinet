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
// Navigation flèche gauche/droite vers le film d'à côté (retour
// utilisateur : "vu qu'on a de l'espace... j'aimerais pouvoir naviguer à
// ceux d'à côté") — capturée depuis pendingFilmNavList (js/router.js) à
// l'ouverture de CETTE fiche précise, jamais gardée au-delà : une fiche
// ouverte sans liste d'origine (lien direct, F5) n'a tout simplement pas
// de flèches, plutôt que d'en proposer qui ne mèneraient nulle part.
let filmNavList = null;  // [{ tmdbId, title }] ou null
let filmNavIndex = -1;
let filmDetailLikes = [];      // [{ id, userId }]
let filmDetailComments = [];   // [{ id, userId, body, createdAt }]
// Réactions rapides sur une critique d'ami (retour utilisateur, migration
// 037) — commentId -> [{ id, userId, emoji }]. Palette volontairement
// courte et fixe (pas de sélecteur d'emoji libre) : le point est la
// rapidité, un choix parmi 5 réactions type "story" plutôt qu'un clavier
// emoji complet à ouvrir pour un geste censé être léger.
const COMMENT_REACTION_EMOJIS = ['👍', '❤️', '😂', '👏', '😮'];
let commentReactions = {};
// Répartition des notes d'un film : à partir de 5 notes (audit des six écrans, F6).
const FILM_DISTRIBUTION_MIN_NOTES = 5;

function normalizeMovieDetails(details){
  return {
    tmdb_id: details.id,
    title: details.title,
    original_title: details.original_title && details.original_title !== details.title ? details.original_title : null,
    poster_url: details.poster_path ? TMDB_IMG_BASE + details.poster_path : null,
    backdrop_path: details.backdrop_path || null,
    overview: details.overview || null,
    release_year: details.release_date ? parseInt(details.release_date.slice(0, 4), 10) : null,
    release_date: details.release_date || null,
    genre_ids: (details.genres || []).map(g => g.id),
    runtime: details.runtime || null
  };
}

// « 1 h 56 » à partir d'une durée TMDB en minutes.
function formatRuntime(minutes){
  if(!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

// Fiche alignée sur la fiche série (audit M4) : bandeau toujours visible
// (photo de plateau > affiche > repli neutre, point ouvert n° 4), titre,
// ligne bleue année · genres · durée, résumé.
function renderFilmDetailHeader(){
  const d = currentFilmData;
  // Même titre que dans ton catalogue (audit T2 : « Arrival » dans la
  // grille, « Premier Contact » sur sa fiche) ; titre TMDB sinon.
  const myFilm = films.find(f => f.tmdbId === currentFilmTmdbId);
  document.getElementById('filmDetailTitle').textContent = myFilm ? myFilm.title : d.title;

  const backdropContainer = document.getElementById('filmDetailBackdrop');
  const backdropImg = document.getElementById('filmDetailBackdropImg');
  if(d.backdrop_path){
    renderDetailBackdrop('filmDetailBackdrop', 'filmDetailBackdropImg', d.backdrop_path);
    backdropContainer.classList.remove('is-placeholder');
  }else{
    backdropContainer.style.display = '';
    backdropImg.removeAttribute('src');
    backdropContainer.classList.add('is-placeholder');
  }
  // L'affiche, posée sur le bandeau (piste A) : celle que tu reconnais dans ta grille.
  const poster = document.getElementById('filmDetailPoster');
  const posterUrl = (myFilm && myFilm.posterUrl) || d.poster_url;
  if(posterUrl){ poster.src = posterUrl; poster.hidden = false; }
  else{ poster.removeAttribute('src'); poster.hidden = true; }

  // Une ligne d'infos sans capitales : année · genres · durée.
  const genres = (d.genre_ids || []).map(id => GENRE_MAP[id]).filter(Boolean).join(', ');
  document.getElementById('filmDetailMeta').textContent = [d.release_year, genres, formatRuntime(d.runtime)].filter(Boolean).join(' · ');

  document.getElementById('filmDetailOverview').textContent = d.overview || 'Aucun résumé disponible.';
  renderFilmDetailRatingRing();
}

// Ta note, à droite du titre (même anneau que la fiche série). Un clic
// ouvre la notation.
function renderFilmDetailRatingRing(){
  const ring = document.getElementById('filmDetailRatingRing');
  if(!ring) return;
  const myFilm = films.find(f => f.tmdbId === currentFilmTmdbId);
  const myNote = myFilm ? getDisplayNote(myFilm) : null;
  ring.textContent = myNote !== null ? myNote.toFixed(1) : '—';
  ring.className = `counter ff-ring ${noteColorClass(myNote)}`;
  const label = myNote !== null ? `Ta note : ${myNote.toFixed(1)}. Modifier ma note` : 'Noter ce film';
  ring.title = label;
  ring.setAttribute('aria-label', label);
}

// Historique des notes (migration 051) : les derniers changements de MA note
// pour ce film. Si la table n'existe pas encore, la section reste vide.
async function renderNoteHistory(myFilm){
  const el = document.getElementById('filmDetailHistory');
  if(!el) return;
  el.textContent = '';
  if(!myFilm || !myFilm.id) return;
  const { data, error } = await supabaseClient
    .from('film_note_history')
    .select('changed_at, crit_avant, crit_apres, manuelle_avant, manuelle_apres')
    .eq('film_id', myFilm.id)
    .order('changed_at', { ascending: false })
    .limit(10);
  if(error || !data || data.length === 0) return;
  el.textContent = noteHistoryLine(data);
}

// Dernier changement de ta note, en clair (audit des six écrans) : « Ta
// note est passée de 4.0 à 4.5 le 12 octobre », au lieu de « grille de critères ».
function noteHistoryLine(rows){
  const noteOf = (crit, manual) => manual != null ? Number(manual) : (crit && Object.keys(crit).length ? computeNote(crit) : null);
  for(const r of rows){
    const before = noteOf(r.crit_avant, r.manuelle_avant);
    const after = noteOf(r.crit_apres, r.manuelle_apres);
    if(after === null || before === after) continue;
    const date = new Date(r.changed_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    return before === null
      ? `Notée ${after.toFixed(1)} le ${date}.`
      : `Ta note est passée de ${before.toFixed(1)} à ${after.toFixed(1)} le ${date}.`;
  }
  return '';
}

async function renderFilmDetailNotes(){
  const wrap = document.getElementById('filmDetailNotes');
  const section = document.getElementById('filmDetailNotesSection');
  renderNoteHistory(films.find(f => f.tmdbId === currentFilmTmdbId));
  // En parallèle : la moyenne et sa répartition par palier. Une erreur sur la
  // répartition (ex. migration 059 pas encore appliquée) n'empêche jamais
  // d'afficher au moins la moyenne.
  const [statsResult, distResult] = await Promise.all([
    supabaseClient.rpc('get_film_stats', { p_tmdb_id: currentFilmTmdbId }),
    supabaseClient.rpc('get_film_note_distribution', { p_tmdb_id: currentFilmTmdbId }),
  ]);
  const stats = Array.isArray(statsResult.data) ? statsResult.data[0] : statsResult.data;
  const avgNote = (!statsResult.error && stats && stats.avg_note !== null) ? Number(stats.avg_note) : null;
  const ratingCount = (!statsResult.error && stats) ? stats.rating_count : 0;
  if(statsResult.error) console.error(statsResult.error);
  if(distResult.error) console.error(distResult.error);

  document.getElementById('filmDetailAvg').textContent = avgNote !== null
    ? `${avgNote.toFixed(1)} · ${ratingCount} note${ratingCount > 1 ? 's' : ''}`
    : 'Personne ne l\'a encore noté';
  // La répartition ne dit quelque chose qu'à partir de 5 notes (audit des
  // six écrans, F6 : 11 barres pour 2 notes). En dessous, la section disparaît.
  const showDist = !distResult.error && ratingCount >= FILM_DISTRIBUTION_MIN_NOTES;
  if(section) section.hidden = !showDist;
  wrap.innerHTML = showDist
    ? renderBarChart((distResult.data || []).map(row => ({ label: Number(row.note).toFixed(1), count: row.note_count })))
    : '';
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
  btn.innerHTML = `${uiIcon('heart', liked)}<span>${liked ? 'Ne plus aimer' : 'Aimer'}</span><small>tes amis le voient</small>`;
}

// Notes des amis sur CE film précis (retour utilisateur, étude comparative
// Letterboxd/Goodreads) — get_film_friend_ratings() (migrations/057),
// jamais tout le monde (contrairement à la moyenne communautaire globale
// affichée plus bas, voir renderFilmDetailNotes()). Jamais bloquant : une
// erreur ici (réseau, fonction pas encore appliquée) laisse simplement le
// strip vide plutôt que de casser le reste de la fiche.
async function renderFilmDetailFriendRatings(tmdbId){
  const wrap = document.getElementById('filmDetailFriendRatings');
  if(!wrap) return;
  try{
    const { data, error } = await supabaseClient.rpc('get_film_friend_ratings', { p_tmdb_id: tmdbId });
    if(error){ console.error(error); wrap.innerHTML = ''; updateFilmFriendsSection(); return; }
    const ratings = (data || []).map(r => ({ friendId: r.friend_id, note: Number(r.note) }));
    if(ratings.length === 0){ wrap.innerHTML = ''; updateFilmFriendsSection(); return; }
    await ensureProfilesCached(ratings.map(r => r.friendId));
    wrap.innerHTML = ratings.map(r => `
      <div class="friend-rating-chip">
        ${friendAvatarHtml(r.friendId, friendDisplayName(r.friendId))}
        <div class="friend-rating-chip-name">${escapeHtml(friendDisplayName(r.friendId))}</div>
        <div class="counter ${noteColorClass(r.note)}">${r.note.toFixed(1)}</div>
      </div>
    `).join('');
  }catch(e){
    console.error(e);
    wrap.innerHTML = '';
  }
  updateFilmFriendsSection();
}

// « Tes amis » ne s'affiche que si un ami a noté ou aimé le film (F6).
function updateFilmFriendsSection(){
  const section = document.getElementById('filmDetailFriendsSection');
  if(!section) return;
  const strip = document.getElementById('filmDetailFriendRatings');
  const summary = document.getElementById('filmDetailLikesSummary');
  section.hidden = !((strip && strip.innerHTML.trim()) || (summary && summary.textContent.trim()));
}

function renderFilmDetailLikesSummary(){
  const others = filmDetailLikes.filter(l => l.userId !== currentUser.id);
  const summaryEl = document.getElementById('filmDetailLikesSummary');
  summaryEl.textContent = others.length === 0
    ? ''
    : `Aimé par ${others.map(l => friendDisplayName(l.userId)).join(', ')}.`;
  updateLikeButtonUI();
  updateFilmFriendsSection();
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

// Une pastille par emoji de la palette, TOUJOURS affichée (pas seulement
// celles déjà utilisées) : montrer d'emblée les 5 choix possibles invite à
// réagir, plutôt qu'un unique bouton "+" qu'il faudrait ouvrir d'abord —
// c'est tout l'intérêt du mot "rapides" dans la demande d'origine. Un
// compteur n'apparaît qu'à partir de 1 réaction pour cet emoji.
function commentReactionsHtml(commentId){
  const reactions = commentReactions[commentId] || [];
  return `
    <div class="comment-reactions" data-comment-id="${commentId}">
      ${COMMENT_REACTION_EMOJIS.map(emoji => {
        const forThis = reactions.filter(r => r.emoji === emoji);
        const mine = forThis.some(r => r.userId === currentUser.id);
        return `<button type="button" class="reaction-btn ${mine ? 'active' : ''}" data-emoji="${emoji}" title="Réagir avec ${emoji}" aria-label="Réagir avec ${emoji}" aria-pressed="${mine}">${emoji}${forThis.length > 0 ? `<span class="reaction-count">${forThis.length}</span>` : ''}</button>`;
      }).join('')}
    </div>
  `;
}

function renderFilmDetailComments(){
  const list = document.getElementById('filmDetailCommentsList');
  if(filmDetailComments.length === 0){
    list.innerHTML = `<div class="tmdb-empty">Pas encore de commentaire. Lance la discussion.</div>`;
    return;
  }
  // Datés, et les réactions sans compteur n'apparaissent qu'au survol ou
  // après « Réagir » (audit des six écrans, F9).
  list.innerHTML = filmDetailComments.map(c => `
    <div class="comment-item">
      ${friendAvatarHtml(c.userId, friendDisplayName(c.userId))}
      <div class="comment-body-wrap">
        <div class="comment-author">${escapeHtml(friendDisplayName(c.userId))}${c.createdAt && typeof friendFeedWhen === 'function' ? `<span class="comment-when">${escapeHtml(friendFeedWhen(c.createdAt))}</span>` : ''}</div>
        <div class="comment-body">${escapeHtml(c.body)}</div>
        ${commentReactionsHtml(c.id)}
        <button type="button" class="comment-react-toggle">Réagir</button>
      </div>
      ${c.userId === currentUser.id ? `<button class="comment-delete" data-id="${c.id}" type="button" title="Supprimer" aria-label="Supprimer ce commentaire">✕</button>` : ''}
    </div>
  `).join('');
  list.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => deleteFilmComment(parseInt(btn.dataset.id, 10)));
  });
  list.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const commentId = parseInt(btn.closest('.comment-reactions').dataset.commentId, 10);
      toggleCommentReaction(commentId, btn.dataset.emoji);
    });
  });
  list.querySelectorAll('.comment-react-toggle').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.comment-item').classList.toggle('show-reactions'));
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
  await loadCommentReactions(filmDetailComments.map(c => c.id));
  renderFilmDetailComments();
}

// Un seul select groupé (in comment_id) pour tous les commentaires de la
// fiche, plutôt qu'une requête par commentaire — même principe que
// loadTrackedShows() (js/series.js) pour la progression par série.
async function loadCommentReactions(commentIds){
  if(commentIds.length === 0){ commentReactions = {}; return; }
  const { data, error } = await supabaseClient
    .from('comment_reactions')
    .select('id, comment_id, user_id, emoji')
    .in('comment_id', commentIds);
  if(error){ console.error(error); commentReactions = {}; return; }
  commentReactions = {};
  data.forEach(row => {
    (commentReactions[row.comment_id] = commentReactions[row.comment_id] || []).push({ id: row.id, userId: row.user_id, emoji: row.emoji });
  });
}

// Toggle, pas de confirm() (audit confirmations, v2.7) : aussi léger et
// réversible qu'un like ou un vote de groupe, un re-clic suffit à annuler.
async function toggleCommentReaction(commentId, emoji){
  if(blockIfOffline()) return;
  const reactions = commentReactions[commentId] || (commentReactions[commentId] = []);
  const mine = reactions.find(r => r.userId === currentUser.id && r.emoji === emoji);
  if(mine){
    const { error } = await supabaseClient.from('comment_reactions').delete().eq('id', mine.id);
    if(error){ showToast('Erreur, réessaie'); console.error(error); return; }
    commentReactions[commentId] = reactions.filter(r => r.id !== mine.id);
  }else{
    const { data, error } = await supabaseClient
      .from('comment_reactions')
      .insert({ comment_id: commentId, user_id: currentUser.id, emoji })
      .select()
      .single();
    if(error){ showToast('Erreur, réessaie'); console.error(error); return; }
    reactions.push({ id: data.id, userId: currentUser.id, emoji });
  }
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
  delete commentReactions[id]; // supprimées en cascade côté base avec le commentaire (on delete cascade)
  renderFilmDetailComments();
}

// --- Boutons d'action : noter / ajouter à la watchlist ---

function updateFilmDetailActionButtons(){
  const myFilm = films.find(f => f.tmdbId === currentFilmTmdbId);
  const rateBtn = document.getElementById('filmDetailRateBtn');
  rateBtn.textContent = myFilm ? 'Modifier ma note' : 'Noter ce film';

  // À voir (F1) : « + À voir » pour un film pas encore noté, « Dans À voir »
  // une fois ajouté (un tap le retire). Un film noté n'y a plus sa place.
  const inWatchlist = watchlist.some(w => w.tmdbId === currentFilmTmdbId);
  const watchlistBtn = document.getElementById('filmDetailWatchlistBtn');
  watchlistBtn.style.display = myFilm ? 'none' : '';
  watchlistBtn.classList.toggle('is-on', inWatchlist);
  watchlistBtn.innerHTML = inWatchlist ? `${uiIcon('check')}<span>Dans À voir</span>` : `${uiIcon('plus')}<span>À voir</span>`;
  watchlistBtn.setAttribute('aria-pressed', String(inWatchlist));
  const removeWl = document.getElementById('filmDetailRemoveWlBtn');
  if(removeWl) removeWl.hidden = !inWatchlist || !!myFilm;

  // Favori : seulement pour un film de ton catalogue.
  const favBtn = document.getElementById('filmDetailFavBtn');
  if(favBtn){
    favBtn.style.display = myFilm ? '' : 'none';
    const isFav = !!(myFilm && myFilm.fav);
    favBtn.innerHTML = `${uiIcon('star', isFav)}<span class="ff-label">Favori</span>`;
    favBtn.setAttribute('aria-pressed', String(isFav));
    favBtn.setAttribute('aria-label', isFav ? 'Retirer des favoris' : 'Ajouter aux favoris');
    favBtn.classList.toggle('active', isFav);
  }
  renderFilmDetailRatingRing();
  renderFilmDetailAvis();
}

// « Ton avis » (piste A) : ta note, tes 7 critères, ton commentaire, tes
// visionnages. Remplace « Voir le détail de ta critique » et sa fenêtre.
function renderFilmDetailAvis(){
  const el = document.getElementById('filmDetailAvis');
  if(!el) return;
  const myFilm = films.find(f => f.tmdbId === currentFilmTmdbId);
  if(!myFilm || getDisplayNote(myFilm) === null){
    el.innerHTML = `
      <div class="stats-section-title">Ton avis</div>
      <p class="tmdb-empty">${myFilm ? 'Tu as vu ce film mais tu ne l\'as pas encore noté.' : 'Tu n\'as pas encore noté ce film.'}</p>
      <button type="button" class="ff-btn-main" data-avis-rate>Noter ce film</button>`;
    el.querySelector('[data-avis-rate]').addEventListener('click', handleFilmDetailRate);
    return;
  }
  const note = getDisplayNote(myFilm);
  const hasCrit = !!(myFilm.crit && CRITERIA.some(c => typeof myFilm.crit[c.key] === 'number'));
  // Note directe égale à la grille (les 52 films de l'audit N1) : c'est la grille.
  const direct = myFilm.manualNote != null && !(hasCrit && myFilm.manualNote === computeNote(myFilm.crit));
  const how = direct ? (hasCrit ? 'note directe, ta grille est gardée' : 'note directe') : 'calculée sur tes 7 critères';
  const seen = typeof viewingsForFilm === 'function' ? viewingsForFilm(myFilm.id) : [];
  const last = seen.length ? seen[seen.length - 1] : null;
  const lastDate = last ? new Date(last.watchedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const seenText = !seen.length ? '' : seen.length === 1 ? `Vu une fois, le ${lastDate}` : `Vu ${seen.length} fois, la dernière le ${lastDate}`;
  el.innerHTML = `
    <div class="ff-sec-head"><span class="stats-section-title">Ton avis</span><button type="button" class="ff-link" data-avis-rate>Modifier</button></div>
    <div class="ff-avis-grid${hasCrit ? '' : ' no-crit'}">
      <div class="ff-avis-note"><span class="counter ${noteColorClass(note)}">${note.toFixed(1)}</span><div><b>Ta note</b><small>${how}</small></div></div>
      ${hasCrit ? `<div class="ff-crits">${CRITERIA.map(c => {
        const v = typeof myFilm.crit[c.key] === 'number' ? myFilm.crit[c.key] : 0;
        return `<div class="ff-crit"><span>${escapeHtml(critShortLabel(c.key))}</span><i><b style="width:${Math.round(v * 100)}%"></b></i><span class="num">${critToDisplay(v)}</span></div>`;
      }).join('')}</div>` : ''}
    </div>
    ${myFilm.review ? `<p class="ff-quote">${escapeHtml(myFilm.review)}</p>` : ''}
    <div class="ff-seen">${seenText ? `<span>${escapeHtml(seenText)}</span>` : ''}<button type="button" class="ff-link" data-avis-rewatch>+ Je l'ai revu</button></div>`;
  el.querySelectorAll('[data-avis-rate]').forEach(b => b.addEventListener('click', handleFilmDetailRate));
  el.querySelector('[data-avis-rewatch]').addEventListener('click', async (e) => {
    if(blockIfOffline()) return;
    e.currentTarget.disabled = true;
    const v = await addViewing(myFilm.id, Date.now());
    if(v){
      showToast('Visionnage ajouté, daté d\'aujourd\'hui');
      renderFilmDetailAvis();
      if(typeof render === 'function') render();
    }
  });
}

async function handleFilmDetailToggleFav(){
  const myFilm = films.find(f => f.tmdbId === currentFilmTmdbId);
  if(!myFilm) return;
  const changed = await toggleFilmFavorite(myFilm);
  if(!changed) return;
  updateFilmDetailActionButtons();
  if(typeof render === 'function') render();
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
  // Déjà dans À voir : le même bouton l'en retire, avec « Annuler » (F1).
  const existing = watchlist.find(w => w.tmdbId === currentFilmTmdbId);
  if(existing){
    handleRemoveFromWatchlist(existing.id);
    updateFilmDetailActionButtons();
    return;
  }
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
  showToast('Ajouté à À voir');
}

// Où regarder (retour utilisateur), voir renderWatchProvidersHtml()
// (js/tmdb.js). Séparée de renderFilmDetailNotes() (qui ne dépend que de
// `films`, aucun réseau) pour rester dans le même Promise.all() que le
// reste des appels TMDB/Supabase ci-dessous, en parallèle plutôt qu'en
// série. Jamais bloquant : une erreur ici (réseau, film sans donnée FR)
// n'empêche jamais le reste de la fiche de s'afficher.
async function renderFilmDetailWatchProviders(){
  const wrap = document.getElementById('filmDetailWatchProviders');
  try{
    const providers = await fetchWatchProviders(currentFilmTmdbId, 'movie');
    wrap.innerHTML = filmProvidersHtml(providers);
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

// Où regarder (piste A, F7) : tes abonnements d'abord, les autres plateformes
// en abonnement ensuite, la location et l'achat repliés en une ligne.
function filmProvidersHtml(providers){
  const flat = typeof groupStreamingServices === 'function' ? groupStreamingServices((providers && providers.flatrate) || []) : [];
  const rentBuy = [...((providers && providers.rent) || []), ...((providers && providers.buy) || [])];
  const rentNames = Array.from(new Set(rentBuy.map(p => (typeof streamingServiceName === 'function' ? streamingServiceName(p.provider_name) : p.provider_name))));
  if(!flat.length && !rentNames.length){
    return `<div class="tmdb-empty">Pas d'info de disponibilité pour la France pour l'instant.</div>`;
  }
  const mine = typeof getMyStreamingServices === 'function' ? getMyStreamingServices() : new Set();
  const mineNames = flat.filter(s => mine.has(s.key));
  const others = flat.filter(s => !mine.has(s.key));
  const logo = (s) => s.logoPath ? `<img src="${WATCHLIST_LOGO_BASE}${s.logoPath}" alt="" loading="lazy">` : '';
  const rows = [];
  mineNames.forEach(s => rows.push(`<div class="ff-prov">${logo(s)}<span><b>${escapeHtml(s.name)}</b> · dans tes abonnements</span></div>`));
  if(others.length){
    const note = mine.size && !mineNames.length ? ` · pas dans tes abonnements` : '';
    rows.push(`<div class="ff-prov">${others.map(logo).join('')}<span>${others.map(s => `<b>${escapeHtml(s.name)}</b>`).join(', ')}${note}</span></div>`);
  }
  if(!flat.length) rows.push(`<div class="ff-prov"><span>Pas en abonnement en France.</span></div>`);
  if(rentNames.length){
    rows.push(`<button type="button" class="ff-rent-toggle" aria-expanded="false">${rentNames.length} plateforme${rentNames.length > 1 ? 's' : ''} en location ou achat ›</button>
      <p class="ff-rent-list" hidden>${rentNames.map(escapeHtml).join(', ')}.</p>`);
  }
  if(providers && providers.link) rows.push(`<a href="${providers.link}" target="_blank" rel="noopener" class="watch-provider-justwatch">Données JustWatch</a>`);
  return `<div class="ff-provs">${rows.join('')}</div>`;
}

// Appelée par le routeur (#/film/:tmdbId).
// Casting (retour utilisateur : "pour les films ce serait bien de pouvoir
// voir le cast aussi") — réutilise fetchMovieCredits() (js/tcg.js, déjà
// appelée pour générer les cartes à collectionner) plutôt qu'un 2e appel
// réseau équivalent. Bande horizontale défilable, pas une liste : une
// quinzaine de personnes à montrer sans allonger la page.
async function renderFilmDetailCast(tmdbId){
  const wrap = document.getElementById('filmDetailCast');
  try{
    const credits = await fetchMovieCredits(tmdbId);
    // Ligne « Réalisation » de la fiche, tirée des mêmes crédits que le casting.
    const directors = (credits.crew || []).filter(c => c.job === 'Director').map(c => c.name);
    const directorRow = document.getElementById('filmDetailDirectorRow');
    if(directorRow && tmdbId === currentFilmTmdbId){
      directorRow.style.display = directors.length ? '' : 'none';
      document.getElementById('filmDetailDirector').textContent = directors.join(', ');
    }
    const cast = (credits.cast || []).slice(0, 15);
    if(cast.length === 0){
      wrap.innerHTML = `<div class="tmdb-empty">Casting non référencé pour ce film.</div>`;
      return;
    }
    wrap.innerHTML = cast.map(p => `
      <div class="cast-card">
        ${p.profile_path
          ? `<img class="cast-photo" src="${TMDB_PROFILE_IMG_BASE}${p.profile_path}" alt="" loading="lazy" decoding="async">`
          : `<div class="cast-photo cast-photo-placeholder">${PERSON_PLACEHOLDER_SVG}</div>`}
        <div class="cast-name">${escapeHtml(p.name)}</div>
        ${p.character ? `<div class="cast-character">${escapeHtml(p.character)}</div>` : ''}
      </div>
    `).join('');
  }catch(e){
    wrap.innerHTML = `<div class="tmdb-empty">Casting indisponible pour l'instant.</div>`;
    console.error(e);
  }
}

// Films similaires (retour utilisateur, étude comparative
// Letterboxd/Goodreads — "Readers also enjoyed") — fetchSimilarMovies()
// (js/tmdb.js). Section entière masquée s'il n'y a rien à montrer (TMDB ne
// recommande pas systématiquement, surtout un film ancien/confidentiel),
// jamais un bandeau vide. Chaque carte navigue vers la fiche du film
// recommandé en lui transmettant la liste affichée comme navList (mêmes
// flèches prev/next que partout ailleurs, voir goFilmNav()) : on peut
// enchaîner les recommandations flèche après flèche.
async function renderFilmDetailSimilar(tmdbId){
  const section = document.getElementById('filmDetailSimilarSection');
  const wrap = document.getElementById('filmDetailSimilar');
  try{
    const results = await fetchSimilarMovies(tmdbId);
    if(results.length === 0){ section.style.display = 'none'; return; }
    section.style.display = '';
    const navList = results.map(r => ({ tmdbId: r.id, title: r.title }));
    wrap.innerHTML = results.map(r => `
      <div class="similar-card" data-tmdb-id="${r.id}">
        ${r.poster_path
          ? `<img src="${TMDB_IMG_BASE}${r.poster_path}" alt="" loading="lazy" decoding="async">`
          : `<div class="film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
        <div class="similar-card-title">${escapeHtml(r.title)}</div>
        ${r.release_year ? `<div class="similar-card-year">${r.release_year}</div>` : ''}
      </div>
    `).join('');
    wrap.querySelectorAll('.similar-card[data-tmdb-id]').forEach(card => {
      card.addEventListener('click', () => goToFilmDetail(parseInt(card.dataset.tmdbId, 10), navList));
    });
  }catch(e){
    console.error(e);
    section.style.display = 'none';
  }
}

// Bande-annonce (retour utilisateur) — même principe que
// updateSeriesTrailerBtn(), js/series.js : masqué tant que fetchVideos()
// (js/tmdb.js) ne renvoie pas vraiment une vidéo YouTube pour ce film.
async function updateFilmDetailTrailerBtn(tmdbId){
  const btn = document.getElementById('filmDetailTrailerBtn');
  if(!btn) return;
  btn.style.display = 'none';
  btn.innerHTML = `${uiIcon('play')}<span class="ff-label">Bande-annonce</span>`;
  btn.setAttribute('aria-label', 'Bande-annonce');
  try{
    const video = pickTrailerVideo(await fetchVideos(tmdbId, 'movie'));
    if(!video) return;
    btn.href = `https://www.youtube.com/watch?v=${video.key}`;
    btn.style.display = '';
  }catch(e){
    console.error(e);
  }
}

// Capture la liste "d'à côté" depuis router.js (si on vient d'une liste
// qui en a posé une) et met à jour les deux flèches en conséquence —
// séparée d'openFilmDetail() pour rester appelable seule par les tests.
function setFilmNavFromPending(tmdbId){
  filmNavList = (typeof pendingFilmNavList !== 'undefined' && pendingFilmNavList) || null;
  if(typeof pendingFilmNavList !== 'undefined') pendingFilmNavList = null;
  filmNavIndex = filmNavList ? filmNavList.findIndex(f => f.tmdbId === tmdbId) : -1;
  renderFilmNavArrows();
}

function renderFilmNavArrows(){
  const prevBtn = document.getElementById('filmDetailPrevBtn');
  const nextBtn = document.getElementById('filmDetailNextBtn');
  if(!prevBtn || !nextBtn) return;
  const hasPrev = filmNavIndex > 0;
  const hasNext = filmNavIndex >= 0 && filmNavIndex < filmNavList.length - 1;
  prevBtn.style.display = hasPrev ? '' : 'none';
  nextBtn.style.display = hasNext ? '' : 'none';
  prevBtn.title = hasPrev ? `Film précédent : ${filmNavList[filmNavIndex - 1].title}` : '';
  prevBtn.setAttribute('aria-label', prevBtn.title || 'Film précédent');
  nextBtn.title = hasNext ? `Film suivant : ${filmNavList[filmNavIndex + 1].title}` : '';
  nextBtn.setAttribute('aria-label', nextBtn.title || 'Film suivant');
}

function goFilmNav(delta){
  if(!filmNavList) return;
  const cible = filmNavList[filmNavIndex + delta];
  if(!cible) return;
  // Repasse la MÊME liste : on reste dedans tant qu'on avance flèche après
  // flèche, jusqu'à en sortir (ouvrir un film depuis ailleurs la remplace).
  goToFilmDetail(cible.tmdbId, filmNavList);
}

async function openFilmDetail(tmdbId){
  currentFilmTmdbId = tmdbId;
  setFilmNavFromPending(tmdbId);
  document.getElementById('filmDetailTitle').textContent = 'Chargement…';
  // Bandeau neutre pendant le chargement plutôt que masqué : la page ne
  // saute pas quand l'image arrive.
  const backdrop = document.getElementById('filmDetailBackdrop');
  backdrop.style.display = '';
  backdrop.classList.add('is-placeholder');
  document.getElementById('filmDetailBackdropImg').removeAttribute('src');
  document.getElementById('filmDetailOverview').textContent = '';
  document.getElementById('filmDetailMeta').textContent = '';
  document.getElementById('filmDetailDirectorRow').style.display = 'none';
  document.getElementById('filmDetailAvg').textContent = '—';
  document.getElementById('filmDetailNotes').innerHTML = '';
  document.getElementById('filmDetailNotesSection').hidden = true;
  document.getElementById('filmDetailFriendsSection').hidden = true;
  document.getElementById('filmDetailAvis').innerHTML = '';
  document.getElementById('filmDetailHistory').textContent = '';
  document.getElementById('filmDetailPoster').hidden = true;
  closeFilmDetailMenu();
  document.getElementById('filmDetailWatchProviders').innerHTML = `<div class="tmdb-empty">Chargement…</div>`;
  document.getElementById('filmDetailCast').innerHTML = `<div class="tmdb-empty">Chargement…</div>`;
  document.getElementById('filmDetailSimilarSection').style.display = 'none';
  document.getElementById('filmDetailFriendRatings').innerHTML = '';
  document.getElementById('filmDetailLikesSummary').textContent = '';
  document.getElementById('filmDetailCommentsList').innerHTML = `${skeletonRows(3)}`;
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
    renderFilmDetailWatchProviders(),
    renderFilmDetailCast(tmdbId),
    renderFilmDetailSimilar(tmdbId),
    renderFilmDetailFriendRatings(tmdbId),
    loadFilmDetailLikes(),
    loadFilmDetailComments(),
    updateFilmDetailTrailerBtn(tmdbId)
  ]);
}

document.getElementById('filmDetailBack').addEventListener('click', () => returnFromDetail(goHome));
document.getElementById('filmDetailPrevBtn').addEventListener('click', () => goFilmNav(-1));
document.getElementById('filmDetailNextBtn').addEventListener('click', () => goFilmNav(1));
document.addEventListener('keydown', (e) => {
  if(e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if(!isDetailKeyNavAllowed('filmDetailPage', e)) return;
  goFilmNav(e.key === 'ArrowLeft' ? -1 : 1);
});
document.getElementById('filmDetailRateBtn').addEventListener('click', handleFilmDetailRate);
document.getElementById('filmDetailRatingRing').addEventListener('click', handleFilmDetailRate);
{
  const filmDetailFavBtn = document.getElementById('filmDetailFavBtn');
  filmDetailFavBtn.addEventListener('click', withSubmitGuard(filmDetailFavBtn, handleFilmDetailToggleFav));
}
{
  const filmDetailWatchlistBtn = document.getElementById('filmDetailWatchlistBtn');
  filmDetailWatchlistBtn.addEventListener('click', withSubmitGuard(filmDetailWatchlistBtn, handleFilmDetailAddWatchlist));
}
// Menu « ⋯ » de la fiche (piste A) : Aimer, Retirer d'À voir.
function closeFilmDetailMenu(){
  const menu = document.getElementById('filmDetailMenu');
  if(menu) menu.hidden = true;
  const btn = document.getElementById('filmDetailMoreBtn');
  if(btn) btn.setAttribute('aria-expanded', 'false');
}
{
  const moreBtn = document.getElementById('filmDetailMoreBtn');
  moreBtn.innerHTML = uiIcon('dots');
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('filmDetailMenu');
    menu.hidden = !menu.hidden;
    moreBtn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', (e) => {
    if(!e.target.closest || !e.target.closest('.ff-more')) closeFilmDetailMenu();
  });
  document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeFilmDetailMenu(); });
}
document.getElementById('filmDetailLikeBtn').addEventListener('click', () => { closeFilmDetailMenu(); toggleFilmLike(); });
document.getElementById('filmDetailRemoveWlBtn').addEventListener('click', () => { closeFilmDetailMenu(); handleFilmDetailAddWatchlist(); });
{
  const filmDetailCommentBtn = document.getElementById('filmDetailCommentBtn');
  filmDetailCommentBtn.addEventListener('click', withSubmitGuard(filmDetailCommentBtn, addFilmComment));
}
