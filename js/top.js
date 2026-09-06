// --- Top films : deux classements agrégés côté serveur ---
// "Tout le monde" = tous les comptes de l'app. "Mes amis" = moi + mes amis
// acceptés directs (pas les amis de mes amis — personnel à chaque
// utilisateur, voir supabase/migrations/015). Calcul entièrement fait par
// deux fonctions SECURITY DEFINER (get_global_top_films / get_friends_top_
// films) : ce module ne fait qu'appeler l'une ou l'autre et afficher le
// résultat, jamais de lecture directe de `films` d'un autre utilisateur.
//
// Page à part entière (#/top), comme Amis/Watchlist/Groupes — voir
// js/router.js.

let topScope = 'global'; // 'global' | 'friends'
let topFilms = [];

async function loadTopFilms(scope){
  const fn = scope === 'friends' ? 'get_friends_top_films' : 'get_global_top_films';
  const { data, error } = await supabaseClient.rpc(fn, { p_limit: 30 });
  if(error){
    showToast('Erreur de chargement du top');
    console.error(error);
    topFilms = [];
    return;
  }
  topFilms = data || [];
}

function renderTopFilms(){
  const list = document.getElementById('topList');
  if(topFilms.length === 0){
    list.innerHTML = `<div class="tmdb-empty">${
      topScope === 'friends'
        ? "Pas encore assez de films notés en commun avec tes amis (seuls les films avec fiche TMDB comptent)."
        : "Pas encore de film noté sur l'app (seuls les films avec fiche TMDB comptent)."
    }</div>`;
    return;
  }
  list.innerHTML = topFilms.map((f, i) => `
    <div class="wl-row top-row" data-tmdb-id="${f.tmdb_id}">
      <div class="top-rank">${i + 1}</div>
      ${f.poster_url
        ? `<img class="film-poster" src="${f.poster_url}" alt="" loading="lazy">`
        : `<div class="film-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="wl-main">
        <div class="wl-title">${escapeHtml(f.title)}${f.release_year ? ` <span class="wl-year">(${f.release_year})</span>` : ''}</div>
        <div class="wl-note">${f.rating_count} note${f.rating_count > 1 ? 's' : ''}</div>
      </div>
      <div class="counter ${noteColorClass(Number(f.avg_note))}">${Number(f.avg_note).toFixed(1)}</div>
    </div>
  `).join('');
  // Fiche film (v2.1, retour utilisateur) — voir js/filmDetail.js.
  list.querySelectorAll('[data-tmdb-id]').forEach(row => {
    makeRowClickable(row, () => goToFilmDetail(parseInt(row.dataset.tmdbId, 10)));
  });
}

// Page top films — appelée par le routeur (#/top).
async function openTop(){
  document.getElementById('topList').innerHTML = skeletonRows();
  await loadTopFilms(topScope);
  renderTopFilms();
}

function setTopScope(scope){
  if(topScope === scope) return;
  topScope = scope;
  document.getElementById('topTabGlobal').classList.toggle('active', scope === 'global');
  document.getElementById('topTabFriends').classList.toggle('active', scope === 'friends');
  openTop();
}

document.getElementById('topBtn').addEventListener('click', goToTop);
// Lien de secours dans la modale profil (v2.1.x, mobile — voir le
// commentaire sur #profileTopFilmsLinkBtn, index.html).
document.getElementById('profileTopFilmsLinkBtn').addEventListener('click', () => {
  closeProfileModal();
  goToTop();
});
document.getElementById('topPageBack').addEventListener('click', goHome);
document.getElementById('topTabGlobal').addEventListener('click', () => setTopScope('global'));
document.getElementById('topTabFriends').addEventListener('click', () => setTopScope('friends'));
