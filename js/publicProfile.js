// --- Profil public (#/u/:userId) ---
// Seule page de l'app accessible SANS connexion — un lien à partager, voir
// js/router.js et js/auth.js → initAuth(). Toute la lecture passe par la
// fonction SECURITY DEFINER get_public_profile() (supabase/migrations/016)
// qui ne renvoie que pseudo/avatar + un résumé du catalogue (jamais
// l'email ni le commentaire libre), et rien du tout si le propriétaire n'a
// pas coché "Profil public" dans sa propre modale profil (js/profile.js).

// Mur de posters (retour utilisateur) : plus impressionnant à partager
// qu'une liste de lignes pour une page pensée pour être montrée à
// quelqu'un — même esprit que .top-films-showcase juste au-dessus (4 films
// mis en avant), généralisé à tout le catalogue. Toujours la note et le
// titre en légende (jamais seulement au survol) : cette page est autant
// consultée au tactile qu'à la souris.
function publicProfilePosterHtml(f){
  return `
    <div class="poster-wall-item">
      ${f.poster_url
        ? `<img src="${f.poster_url}" alt="" loading="lazy">`
        : `<div class="film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="poster-wall-note ${noteColorClass(f.note)}">${f.note !== null && f.note !== undefined ? Number(f.note).toFixed(1) : '—'}</div>
      ${f.fav ? `<div class="poster-wall-fav" title="Favori">★</div>` : ''}
      <div class="poster-wall-caption">${escapeHtml(f.title)}${f.release_year ? ` <span class="wl-year">(${f.release_year})</span>` : ''}</div>
    </div>
  `;
}

async function renderPublicProfilePage(userId){
  const content = document.getElementById('publicProfileContent');
  content.innerHTML = `<div class="tmdb-empty">Chargement…</div>`;

  const { data, error } = await supabaseClient.rpc('get_public_profile', { p_user_id: userId });
  // La fonction renvoie 0 ou 1 ligne (voir migrations/016) — rpc() sur une
  // fonction "table" renvoie un tableau, pas un objet direct.
  const row = Array.isArray(data) ? data[0] : data;
  // 0 ligne = profil inexistant OU resté privé, get_public_profile() ne fait
  // pas la différence — donc pas nous non plus ici.
  if(error || !row){
    content.innerHTML = `<div class="empty-state">Ce profil n'existe pas ou n'est pas public.</div>`;
    if(error) console.error(error);
    return;
  }

  const films = row.films || [];
  const topFilms = row.top_films || [];
  const notes = films.map(f => f.note).filter(n => typeof n === 'number');
  const avgNote = notes.length ? notes.reduce((a, b) => a + b, 0) / notes.length : null;
  const favCount = films.filter(f => f.fav).length;
  const name = row.display_name || 'Cinéphile';

  const listHtml = films.length === 0
    ? `<div class="empty-state">Aucun film noté pour l'instant.</div>`
    : `<div class="poster-wall">${films.map(publicProfilePosterHtml).join('')}</div>`;

  // Cliquable vers la fiche film seulement si connecté (v2.3) — la fiche
  // film (js/filmDetail.js) n'est pas de la poignée de pages accessibles
  // sans session (voir le commentaire en tête de fichier), inutile de
  // proposer un clic qui renverrait un visiteur anonyme droit sur l'écran
  // de connexion.
  const topFilmsHtml = topFilms.length === 0 ? '' : `
    <div class="stats-section">
      <div class="stats-section-title">Top films</div>
      <div class="top-films-showcase">
        ${topFilms.map(f => `
          <div class="top-films-showcase-item"${currentUser && f.tmdb_id ? ` data-tmdb-id="${f.tmdb_id}"` : ''}>
            ${f.poster_url
              ? `<img src="${f.poster_url}" alt="">`
              : `<div class="film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
            <div class="top-films-showcase-title">${escapeHtml(f.title)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  content.innerHTML = `
    <div class="public-profile-header">
      ${row.avatar_url
        ? `<img src="${row.avatar_url}" alt="">`
        : `<div class="avatar-fallback">👤</div>`}
      <h3>${escapeHtml(name)}</h3>
    </div>
    <div class="stat-tiles">
      <div class="stat-tile accent-violet"><div class="stat-value">${films.length}</div><div class="stat-label">Films notés</div></div>
      <div class="stat-tile accent-gradient"><div class="stat-value">${avgNote !== null ? avgNote.toFixed(2) : '—'}</div><div class="stat-label">Note moyenne</div></div>
      <div class="stat-tile accent-bronze"><div class="stat-value">${favCount}</div><div class="stat-label">Favoris</div></div>
    </div>
    ${topFilmsHtml}
    <div class="stats-section">
      <div class="stats-section-title">Catalogue (${films.length})</div>
      ${listHtml}
    </div>
  `;

  content.querySelectorAll('.top-films-showcase-item[data-tmdb-id]').forEach(item => {
    makeRowClickable(item, () => goToFilmDetail(parseInt(item.dataset.tmdbId, 10)));
  });
}

// Retour : vers l'accueil si connecté, vers l'écran de connexion sinon —
// goHome() seul ne suffirait pas dans ce dernier cas (renderRoute() ignore
// la route "home" tant que currentUser est vide, voir js/router.js).
document.getElementById('publicProfileBack').addEventListener('click', () => {
  if(currentUser) goHome();
  else showAuthScreen();
});
