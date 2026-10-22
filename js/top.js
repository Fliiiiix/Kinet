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
//
// Piste A du 15/10 (draft Top films, choix de Flix) : podium des trois
// premiers, puis la liste avec ta note ou « + À voir ». Un film entre au
// classement à partir de TOP_MIN_NOTES notes et y est trié par sa vraie
// moyenne : jamais un 5.0 derrière un 4.5. Les films notés par une seule
// personne restent visibles, à part, sous le classement.

const TOP_MIN_NOTES = 2;
const TOP_SOLO_PREVIEW = 12;
// Large : la fonction trie d'abord par moyenne, les films à une seule note
// (souvent à 5.0) passent devant ; il faut aller assez loin pour avoir tout
// le classement à 2 notes et plus.
const TOP_FETCH_LIMIT = 500;

let topScope = 'global'; // 'global' | 'friends'
let topFilms = [];
let topSoloExpanded = false;
let topLoadFailed = false;

async function loadTopFilms(scope){
  const fn = scope === 'friends' ? 'get_friends_top_films' : 'get_global_top_films';
  const { data, error } = await supabaseClient.rpc(fn, { p_limit: TOP_FETCH_LIMIT });
  if(error){
    showToast('Erreur de chargement du top');
    console.error(error);
    topFilms = [];
    topLoadFailed = true;
    return;
  }
  topLoadFailed = false;
  topFilms = (data || []).map(f => ({
    tmdbId: f.tmdb_id,
    title: f.title,
    posterUrl: f.poster_url,
    year: f.release_year,
    avg: Number(f.avg_note),
    count: f.rating_count
  }));
}

// Classement (2 notes et plus, par moyenne puis nombre de notes) et films à
// une seule note, à part.
function splitTopFilms(list){
  const byAvg = (a, b) => b.avg - a.avg || b.count - a.count || String(a.title).localeCompare(String(b.title), 'fr');
  return {
    ranked: list.filter(f => f.count >= TOP_MIN_NOTES).sort(byAvg),
    solo: list.filter(f => f.count < TOP_MIN_NOTES).sort(byAvg)
  };
}

// Moyenne lisible : 5.0, 4.75, 4.5 (deux décimales seulement quand il y en a).
function formatTopAvg(n){
  const two = Number(n).toFixed(2);
  return two.endsWith('0') ? Number(n).toFixed(1) : two;
}

function topNotesLabel(count){
  return `${count} note${count > 1 ? 's' : ''}`;
}

function topSubLine(f){
  return [f.year, topNotesLabel(f.count)].filter(Boolean).join(' · ');
}

// Où tu en es avec ce film : ta note si tu l'as vu, « Dans À voir » s'il y
// est, sinon un bouton « + À voir ».
function topMineHtml(f){
  const mine = films.find(x => x.tmdbId === f.tmdbId);
  if(mine){
    const note = getDisplayNote(mine);
    return note != null
      ? `<span class="top-me">Toi <b class="${noteColorClass(note)}">${Number(note).toFixed(1)}</b></span>`
      : `<span class="top-me">Vu</span>`;
  }
  if(watchlist.some(w => w.tmdbId === f.tmdbId)) return `<span class="top-me">Dans À voir</span>`;
  return `<span class="top-me"><button type="button" class="top-add" data-top-add="${f.tmdbId}">+ À voir</button></span>`;
}

function topPosterHtml(f, cls){
  return f.posterUrl
    ? `<img class="${cls}" src="${escapeHtml(f.posterUrl)}" alt="" loading="lazy" decoding="async">`
    : `<span class="${cls} top-poster-empty">${FILM_PLACEHOLDER_SVG}</span>`;
}

function topPodiumHtml(f, rank){
  return `
    <div class="top-pod${rank === 1 ? ' is-first' : ''}" data-tmdb-id="${f.tmdbId}">
      <div class="top-pod-img">
        ${topPosterHtml(f, 'top-pod-poster')}
        <span class="top-pod-rank">${rank}</span>
        <span class="top-pod-note ${noteColorClass(f.avg)}">${formatTopAvg(f.avg)}</span>
      </div>
      <div class="top-pod-title">${escapeHtml(f.title)}</div>
      <div class="top-pod-sub">${escapeHtml(topSubLine(f))}</div>
    </div>`;
}

function topRowHtml(f, rank){
  return `
    <div class="top-line" data-tmdb-id="${f.tmdbId}">
      <span class="top-line-rank">${rank || ''}</span>
      ${topPosterHtml(f, 'top-line-poster')}
      <div class="top-line-main">
        <div class="top-line-title">${escapeHtml(f.title)}</div>
        <div class="top-line-sub">${escapeHtml(topSubLine(f))}</div>
      </div>
      <span class="top-line-note ${noteColorClass(f.avg)}">${formatTopAvg(f.avg)}</span>
      ${topMineHtml(f)}
    </div>`;
}

function renderTopFilms(){
  const board = document.getElementById('topBoard');
  const how = document.getElementById('topHow');
  if(topFilms.length === 0){
    how.hidden = true;
    board.innerHTML = `<div class="empty-state">${
      topLoadFailed ? 'Le classement n’a pas pu se charger. Réessaie dans un instant.'
      : topScope === 'friends'
        ? 'Pas encore de film noté par toi ou tes amis (seuls les films avec fiche TMDB comptent).'
        : 'Pas encore de film noté sur Kinet (seuls les films avec fiche TMDB comptent).'
    }</div>`;
    return;
  }
  how.hidden = false;
  const { ranked, solo } = splitTopFilms(topFilms);
  const soloShown = topSoloExpanded ? solo : solo.slice(0, TOP_SOLO_PREVIEW);
  const soloRest = solo.length - soloShown.length;

  let html = '';
  if(ranked.length === 0){
    html += `<div class="empty-state">Aucun film n’a encore été noté par deux personnes${topScope === 'friends' ? ' parmi toi et tes amis' : ''}. Les films notés une fois sont juste en dessous.</div>`;
  }else{
    html += `<div class="top-podium">${ranked.slice(0, 3).map((f, i) => topPodiumHtml(f, i + 1)).join('')}</div>`;
    html += `<div class="top-lines">${ranked.slice(3).map((f, i) => topRowHtml(f, i + 4)).join('')}</div>`;
  }
  if(solo.length){
    html += `
      <div class="top-solo">
        <h3 class="top-solo-label">Une seule note pour l’instant <span>${solo.length} film${solo.length > 1 ? 's' : ''}, en attente d’une deuxième note</span></h3>
        <div class="top-lines">${soloShown.map(f => topRowHtml(f, '')).join('')}</div>
        ${soloRest > 0 ? `<button type="button" class="top-more" id="topSoloMore">Voir les ${soloRest} autres</button>` : ''}
      </div>`;
  }
  board.innerHTML = html;

  // Fiche film (v2.1, retour utilisateur) — voir js/filmDetail.js. Les
  // flèches de la fiche suivent l'ordre affiché : classement puis une note.
  const navList = ranked.concat(soloShown).map(f => ({ tmdbId: f.tmdbId, title: f.title }));
  board.querySelectorAll('[data-tmdb-id]').forEach(el => {
    makeRowClickable(el, () => goToFilmDetail(parseInt(el.dataset.tmdbId, 10), navList));
  });
  board.querySelectorAll('[data-top-add]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      addTopFilmToWatchlist(parseInt(btn.dataset.topAdd, 10), btn);
    });
    btn.addEventListener('keydown', (e) => e.stopPropagation());
  });
  const more = document.getElementById('topSoloMore');
  if(more) more.addEventListener('click', () => { topSoloExpanded = true; renderTopFilms(); });
}

// « + À voir » : la fiche TMDB complète (date de sortie, résumé) plutôt que
// le seul titre du classement, comme un ajout depuis la recherche.
async function addTopFilmToWatchlist(tmdbId, btn){
  if(btn) btn.disabled = true;
  try{
    const details = await fetchMovieDetails(tmdbId);
    const item = await addTmdbMovieToWatchlist(details);
    if(item) showToast('Ajouté à À voir');
  }catch(e){
    showToast('Erreur, réessaie');
    console.error(e);
  }
  renderTopFilms();
}

// Page top films — appelée par le routeur (#/top).
async function openTop(){
  document.getElementById('topBoard').innerHTML = skeletonRows();
  topSoloExpanded = false;
  if(watchlist.length === 0 && typeof loadWatchlist === 'function'){
    await loadWatchlist().catch(e => console.error(e));
  }
  await loadTopFilms(topScope);
  renderTopFilms();
}

function setTopScope(scope){
  if(topScope === scope) return;
  topScope = scope;
  [['topTabGlobal', 'global'], ['topTabFriends', 'friends']].forEach(([id, s]) => {
    const tab = document.getElementById(id);
    tab.classList.toggle('is-active', s === scope);
    tab.setAttribute('aria-selected', s === scope ? 'true' : 'false');
  });
  openTop();
}

document.getElementById('topBtn').addEventListener('click', goToTop);
// Lien de secours dans la modale profil (v2.1.x, mobile — voir le
// commentaire sur #profileTopFilmsLinkBtn, index.html).
document.getElementById('profileTopFilmsLinkBtn').addEventListener('click', () => {
  closeProfileModal();
  goToTop();
});
document.getElementById('topTabGlobal').addEventListener('click', () => setTopScope('global'));
document.getElementById('topTabFriends').addEventListener('click', () => setTopScope('friends'));
