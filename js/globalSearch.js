// --- Recherche globale unifiée (v2.42, retour utilisateur) ---
// Une seule barre, ouvrable depuis n'importe où (icône dans le header —
// voir js/ui.js pour la règle "header seulement, jamais dupliqué"), qui
// cherche à la fois dans le catalogue de films, les séries suivies, les
// amis et les groupes déjà chargés en mémoire — pas de nouvel appel réseau
// dédié, ces quatre tableaux existent déjà (films chargé dès la connexion,
// voir js/auth.js ; trackedShows/friendships/groups chargés à la volée ici
// s'ils ne le sont pas encore, même stratégie que openAchievements()/
// openAdminModal() dans js/achievements.js et js/admin.js).
//
// Résultat cliqué -> ferme cette recherche puis ouvre la fiche concernée,
// jamais une deuxième couche de recherche par catégorie : un raccourci
// vers un écran qui existe déjà (fiche film, détail série, profil ami,
// détail groupe), pas un nouvel écran de résultats à lui seul.

let globalSearchTimer = null;
let globalSearchDataReady = false;

async function ensureGlobalSearchData(){
  if(globalSearchDataReady) return;
  await Promise.all([
    trackedShows.length === 0 ? loadTrackedShows() : Promise.resolve(),
    friendships.length === 0 ? loadFriendships() : Promise.resolve(),
    groups.length === 0 ? loadGroups() : Promise.resolve()
  ]);
  globalSearchDataReady = true;
}

const GLOBAL_SEARCH_MAX_PER_GROUP = 5;

function searchFilms(normalizedQuery){
  return films
    .filter(f => getSearchTerms(f).some(t => t.includes(normalizedQuery)))
    .slice(0, GLOBAL_SEARCH_MAX_PER_GROUP);
}

function searchShows(normalizedQuery){
  return trackedShows
    .filter(s => normalizeSearch(s.title).includes(normalizedQuery))
    .slice(0, GLOBAL_SEARCH_MAX_PER_GROUP);
}

function searchFriends(normalizedQuery){
  return friendships
    .filter(f => f.status === 'accepted')
    .map(f => otherUserId(f))
    .filter(userId => normalizeSearch(friendDisplayName(userId)).includes(normalizedQuery))
    .slice(0, GLOBAL_SEARCH_MAX_PER_GROUP);
}

function searchGroups(normalizedQuery){
  return groups
    .filter(g => normalizeSearch(g.name).includes(normalizedQuery))
    .slice(0, GLOBAL_SEARCH_MAX_PER_GROUP);
}

function globalSearchRowHtml(posterOrIcon, title, sub){
  return `
    <div class="wl-row global-search-row">
      ${posterOrIcon}
      <div class="wl-main">
        <div class="wl-title">${escapeHtml(title)}</div>
        ${sub ? `<div class="wl-note">${escapeHtml(sub)}</div>` : ''}
      </div>
    </div>
  `;
}

function renderGlobalSearchGroup(titleLabel, itemsHtml){
  if(itemsHtml.length === 0) return '';
  return `
    <div class="global-search-group">
      <div class="global-search-group-title">${escapeHtml(titleLabel)}</div>
      ${itemsHtml.join('')}
    </div>
  `;
}

function performGlobalSearch(rawQuery){
  const query = rawQuery.trim();
  const resultsEl = document.getElementById('globalSearchResults');
  if(query.length < 2){
    resultsEl.innerHTML = `<div class="empty-state">Tape au moins 2 caractères…</div>`;
    return;
  }
  const normalizedQuery = normalizeSearch(query);

  const filmMatches = searchFilms(normalizedQuery);
  const showMatches = searchShows(normalizedQuery);
  const friendMatches = searchFriends(normalizedQuery);
  const groupMatches = searchGroups(normalizedQuery);

  if(filmMatches.length + showMatches.length + friendMatches.length + groupMatches.length === 0){
    resultsEl.innerHTML = `<div class="empty-state">Rien ne correspond à "${escapeHtml(query)}".</div>`;
    return;
  }

  resultsEl.innerHTML = [
    renderGlobalSearchGroup('Films', filmMatches.map(f => globalSearchRowHtml(
      f.posterUrl ? `<img class="film-poster" src="${f.posterUrl}" alt="" loading="lazy">` : `<div class="film-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`,
      f.title,
      getDisplayNote(f) != null ? `Ta note : ${getDisplayNote(f)}/5` : 'Pas encore noté'
    ))),
    renderGlobalSearchGroup('Séries suivies', showMatches.map(s => globalSearchRowHtml(
      s.posterUrl ? `<img class="film-poster" src="${s.posterUrl}" alt="" loading="lazy">` : `<div class="film-poster film-poster-placeholder">${TV_PLACEHOLDER_SVG}</div>`,
      s.title,
      showStatusLabel(s.status)
    ))),
    renderGlobalSearchGroup('Amis', friendMatches.map(userId => globalSearchRowHtml(
      friendAvatarUrl(userId) ? `<img class="film-poster" src="${friendAvatarUrl(userId)}" alt="" loading="lazy">` : `<div class="film-poster film-poster-placeholder">👤</div>`,
      friendDisplayName(userId),
      'Ami'
    ))),
    renderGlobalSearchGroup('Groupes', groupMatches.map(g => globalSearchRowHtml(
      `<div class="film-poster film-poster-placeholder">👥</div>`,
      g.name,
      'Groupe'
    )))
  ].join('');

  // Reclique-able après ré-écriture du HTML : ré-attache un handler par
  // ligne dans l'ordre exact où chaque catégorie a été construite
  // ci-dessus (même ordre que le DOM généré) plutôt que d'essayer de
  // retrouver l'item correspondant à un clic après coup.
  const rows = Array.from(resultsEl.querySelectorAll('.global-search-row'));
  const clickTargets = [
    ...filmMatches.map(f => () => {
      closeOverlay('globalSearchOverlay', () => {
        if(f.tmdbId) goToFilmDetail(f.tmdbId);
        else openModal(f.id);
      });
    }),
    ...showMatches.map(s => () => closeOverlay('globalSearchOverlay', () => goToSeriesDetail(s.id))),
    ...friendMatches.map(userId => () => closeOverlay('globalSearchOverlay', () => openFriendProfile(userId))),
    ...groupMatches.map(g => () => closeOverlay('globalSearchOverlay', () => goToGroup(g.id)))
  ];
  rows.forEach((row, i) => makeRowClickable(row, clickTargets[i]));
}

async function openGlobalSearch(){
  document.getElementById('globalSearchInput').value = '';
  document.getElementById('globalSearchResults').innerHTML = `<div class="empty-state">Tape au moins 2 caractères…</div>`;
  openOverlay('globalSearchOverlay');
  document.getElementById('globalSearchInput').focus();
  await ensureGlobalSearchData(); // n'empêche pas de taper pendant le chargement
}

document.getElementById('globalSearchBtn').addEventListener('click', openGlobalSearch);
document.getElementById('closeGlobalSearch').addEventListener('click', () => closeOverlay('globalSearchOverlay'));
document.getElementById('globalSearchOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'globalSearchOverlay') closeOverlay('globalSearchOverlay');
});
document.getElementById('globalSearchInput').addEventListener('input', () => {
  clearTimeout(globalSearchTimer);
  const query = document.getElementById('globalSearchInput').value;
  globalSearchTimer = setTimeout(() => performGlobalSearch(query), 200);
});
