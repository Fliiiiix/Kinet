// --- Recherche unique (audit M2, draft option A validée le 15/10) ---
// La recherche du catalogue est la seule recherche de Kinet. Elle filtre
// tes films (render(), js/app.js) ou tes séries (renderTrackedShows(),
// js/series.js) ; ce fichier montre dessous, dès 2 lettres, ce qui
// correspond ailleurs : séries suivies, films, amis, groupes, 5 au plus
// par rubrique. Remplace la fenêtre « Rechercher » (ex-#globalSearchOverlay)
// et la rangée « Rechercher partout » de la page Profil.
//
// Données déjà en mémoire (films chargé dès la connexion, voir js/auth.js) ;
// trackedShows/friendships/groups chargés à la première recherche s'ils ne
// le sont pas encore, puis la rubrique se redessine toute seule.

let searchExtrasDataReady = false;
let searchExtrasDataLoad = null;

function ensureSearchExtrasData(){
  if(searchExtrasDataReady) return Promise.resolve();
  if(!searchExtrasDataLoad){
    searchExtrasDataLoad = Promise.all([
      trackedShows.length === 0 ? loadTrackedShows() : Promise.resolve(),
      friendships.length === 0 ? loadFriendships() : Promise.resolve(),
      groups.length === 0 ? loadGroups() : Promise.resolve()
    ]).then(() => {
      searchExtrasDataReady = true;
    }).catch(err => {
      // Réseau coupé : on réessaiera à la prochaine frappe.
      searchExtrasDataLoad = null;
      console.error(err);
    });
  }
  return searchExtrasDataLoad;
}

const SEARCH_EXTRAS_MAX = 5;

function searchFilms(normalizedQuery){
  return films
    .filter(f => getSearchTerms(f).some(t => t.includes(normalizedQuery)))
    .slice(0, SEARCH_EXTRAS_MAX);
}

function searchShows(normalizedQuery){
  return trackedShows
    .filter(s => normalizeSearch(s.title).includes(normalizedQuery))
    .slice(0, SEARCH_EXTRAS_MAX);
}

function searchFriends(normalizedQuery){
  return friendships
    .filter(f => f.status === 'accepted')
    .map(f => otherUserId(f))
    .filter(userId => normalizeSearch(friendDisplayName(userId)).includes(normalizedQuery))
    .slice(0, SEARCH_EXTRAS_MAX);
}

function searchGroups(normalizedQuery){
  return groups
    .filter(g => normalizeSearch(g.name).includes(normalizedQuery))
    .slice(0, SEARCH_EXTRAS_MAX);
}

function searchExtraNoteHtml(note){
  if(note === null || note === undefined) return '';
  return `<span class="sx-note ${noteColorClass(note)}">${note.toFixed(1)}</span>`;
}

function searchExtraRowHtml(visualHtml, title, sub, noteHtml){
  return `
    <div class="sx-row">
      ${visualHtml}
      <div class="sx-main">
        <div class="sx-title">${escapeHtml(title)}</div>
        ${sub ? `<div class="sx-sub">${escapeHtml(String(sub))}</div>` : ''}
      </div>
      ${noteHtml || ''}
    </div>
  `;
}

function showProgressLabel(show){
  if(!show.numberOfEpisodes) return showStatusLabel(show.status);
  const watched = (typeof watchedEpisodeCounts !== 'undefined' && watchedEpisodeCounts[show.id]) || 0;
  return `${watched}/${show.numberOfEpisodes} épisode${show.numberOfEpisodes > 1 ? 's' : ''} vus`;
}

// Rubriques sous la grille, dans l'ordre affiché. Celle de la page en cours
// est exclue : sur Films, tes films sont déjà dans la grille ; sur Séries,
// tes séries sont déjà dans la liste. Chaque ligne porte son action de clic.
function buildSearchExtras(kind, rawQuery){
  const query = (rawQuery || '').trim();
  if(query.length < 2) return [];
  const q = normalizeSearch(query);
  const sections = [];

  if(kind === 'films'){
    const shows = searchShows(q);
    const showNav = shows.map(s => ({ id: s.id, title: s.title }));
    sections.push({ label: 'Séries', items: shows.map(s => ({
      html: searchExtraRowHtml(
        s.posterUrl ? `<img class="sx-thumb" src="${s.posterUrl}" alt="" loading="lazy">` : `<div class="sx-thumb">${TV_PLACEHOLDER_SVG}</div>`,
        s.title, showProgressLabel(s), searchExtraNoteHtml(s.manualNote)),
      open: () => goToSeriesDetail(s.id, showNav)
    })) });
  }else{
    const matches = searchFilms(q);
    const filmNav = matches.filter(f => f.tmdbId).map(f => ({ tmdbId: f.tmdbId, title: f.title }));
    sections.push({ label: 'Films', items: matches.map(f => ({
      html: searchExtraRowHtml(
        f.posterUrl ? `<img class="sx-thumb" src="${f.posterUrl}" alt="" loading="lazy">` : `<div class="sx-thumb">${FILM_PLACEHOLDER_SVG}</div>`,
        f.title, f.releaseYear, searchExtraNoteHtml(getDisplayNote(f))),
      open: () => { if(f.tmdbId) goToFilmDetail(f.tmdbId, filmNav); else openModal(f.id); }
    })) });
  }

  sections.push({ label: 'Amis', items: searchFriends(q).map(userId => ({
    html: searchExtraRowHtml(
      friendAvatarUrl(userId) ? `<img class="sx-face" src="${friendAvatarUrl(userId)}" alt="" loading="lazy">` : `<div class="sx-face">${uiIcon('user')}</div>`,
      friendDisplayName(userId), '', ''),
    open: () => openFriendProfile(userId)
  })) });

  sections.push({ label: 'Groupes', items: searchGroups(q).map(g => ({
    html: searchExtraRowHtml(`<div class="sx-glyph">${uiIcon('group')}</div>`, g.name, '', ''),
    open: () => goToGroup(g.id)
  })) });

  return sections.filter(s => s.items.length > 0);
}

const SEARCH_EXTRAS_TARGETS = {
  films: { container: 'searchExtras', input: 'search' },
  series: { container: 'seriesSearchExtras', input: 'seriesTitleInput' }
};

function renderSearchExtras(kind, rawQuery){
  const target = SEARCH_EXTRAS_TARGETS[kind];
  const el = target && document.getElementById(target.container);
  if(!el) return;
  const sections = buildSearchExtras(kind, rawQuery);
  el.innerHTML = sections.map(s => `
    <div class="sx-group">
      <div class="sx-label">${s.label}</div>
      ${s.items.map(i => i.html).join('')}
    </div>
  `).join('');
  // Même ordre que le HTML généré ci-dessus : une action par ligne.
  const opens = sections.flatMap(s => s.items.map(i => i.open));
  Array.from(el.querySelectorAll('.sx-row')).forEach((row, i) => makeRowClickable(row, opens[i]));

  if(!searchExtrasDataReady && (rawQuery || '').trim().length >= 2){
    ensureSearchExtrasData().then(() => {
      if(!searchExtrasDataReady) return;
      const input = document.getElementById(target.input);
      if(input && input.value.trim().length >= 2) renderSearchExtras(kind, input.value);
    });
  }
}

// --- Raccourci clavier « / » (retour utilisateur) --- Place le curseur
// dans la recherche, depuis n'importe quelle page : celle des séries sur
// la page Séries, celle du catalogue partout ailleurs (on y revient
// d'abord). Ignoré pendant une saisie (le « / » doit atteindre le champ)
// ou si une fenêtre est ouverte.
function focusMainSearch(){
  const route = parseRoute().name;
  if(route === 'seriesList'){
    document.getElementById('seriesTitleInput').focus();
    return;
  }
  if(route !== 'home'){
    // Le catalogue s'affiche au hashchange (renderRoute(), js/router.js) :
    // le champ n'est visible, donc focalisable, qu'après.
    window.addEventListener('hashchange', () => {
      setTimeout(() => document.getElementById('search').focus(), 0);
    }, { once: true });
    goHome();
    return;
  }
  document.getElementById('search').focus();
}

document.addEventListener('keydown', (e) => {
  if(e.key !== '/') return;
  const tag = (e.target.tagName || '').toLowerCase();
  if(tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
  if(document.querySelector('.overlay.open')) return;
  e.preventDefault();
  focusMainSearch();
});
