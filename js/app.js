// --- Persistance ---
// Les films sont stockés dans Supabase (table `films`, voir supabase/schema.sql),
// scopés par utilisateur via RLS. Chaque film noté du site correspond à une ligne ;
// id/added/created_at sont attribués côté serveur. Le catalogue d'origine (Excel,
// js/data.js SEED) n'est plus auto-chargé ici — voir README pour la migration
// via Importer (JSON) une fois connecté.

let films = [];
let editingId = null;

// Pagination du catalogue — évite le scroll infini au-delà de quelques
// centaines de films. Remise à 1 à chaque changement de recherche/tri
// (voir les listeners en bas de fichier), sinon conservée entre les render()
// (ex. après avoir coché un favori) pour ne pas perdre sa place.
const FILMS_PER_PAGE = 50;
let currentPage = 1;
// Liste "d'à côté" capturée à l'ouverture de la modale (voir openModal()),
// pour le bouton "Voir la fiche" — toute la liste filtrée/triée courante,
// pas seulement la page affichée (même esprit que les flèches prev/next
// de la fiche communautaire, js/filmDetail.js).
let modalFilmNavList = null;

function computeNote(critObj){
  const vals = CRITERIA.map(c => critObj[c.key]).filter(v => typeof v === 'number');
  if(vals.length === 0) return null;
  const avg = vals.reduce((a,b)=>a+b,0) / vals.length;
  return Math.round(avg*10) / 2;
}

function rowToFilm(row){
  return {
    id: row.id,
    title: row.title,
    crit: row.crit,
    fav: row.fav,
    added: row.added,
    manualNote: row.manual_note != null ? parseFloat(row.manual_note) : null,
    isPrivate: row.is_private === true,
    review: row.review || null,
    tmdbId: row.tmdb_id || null,
    posterUrl: row.poster_url || null,
    overview: row.overview || null,
    releaseYear: row.release_year || null,
    originalTitle: row.original_title || null,
    genreIds: row.genre_ids || []
  };
}

// Normalise pour une comparaison insensible aux accents/casse — "amelie"
// doit matcher "Amélie" et "féroces" doit matcher "feroces".
// Plage Unicode des diacritiques combinants (U+0300-U+036F), construite via
// String.fromCharCode plutôt qu'un échappement \uXXXX en dur dans le regex.
const DIACRITICS_RE = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');
function normalizeSearch(str){
  return str.normalize('NFD').replace(DIACRITICS_RE, '').toLowerCase();
}

// Titre FR + titre VO (si connu et différent) : sert de base à la recherche,
// pour retrouver un film aussi bien par son titre français que son titre
// original ("créatures féroces" ↔ "fierce creatures"), sans traduction —
// juste les deux titres que TMDB associe déjà au même film.
function getSearchTerms(film){
  const terms = [normalizeSearch(film.title)];
  if(film.originalTitle) terms.push(normalizeSearch(film.originalTitle));
  return terms;
}

// Note affichée : la note manuelle prime sur la note calculée depuis la grille,
// pour les films exceptionnellement notés avec un référentiel différent.
function getDisplayNote(film){
  return film.manualNote != null ? film.manualNote : computeNote(film.crit);
}

async function loadFilms(){
  // Filtre explicite sur user_id : depuis la policy RLS "Friends can view
  // shared films" (migrations/009), un select non filtré remonterait aussi
  // le catalogue des amis acceptés. Cette liste est LE catalogue perso
  // (modifiable) — la vue en lecture seule d'un ami passe par sa propre
  // requête filtrée, voir openFriendProfile() dans js/friends.js.
  const { data, error } = await supabaseClient
    .from('films')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('added', { ascending: false });
  if(error){
    // Repli hors ligne (js/offline.js) : dernier catalogue chargé avec
    // succès plutôt qu'un catalogue vide qui donnerait l'impression que
    // tout a disparu. Ce chemin fait aussi office de "source de vérité"
    // pour isOfflineMode — voir le listener 'online' dans offline.js, qui
    // retente cette même fonction pour en sortir.
    const cached = loadOfflineCache('films');
    if(cached){
      films = cached.data;
      enterOfflineMode(cached.savedAt);
      return;
    }
    showToast('Erreur de chargement, réessaie');
    console.error(error);
    films = [];
    return;
  }
  films = data.map(rowToFilm);
  saveOfflineCache('films', films);
  exitOfflineMode();
}

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(()=> t.classList.remove('show'), 2200);
}

// --- Filtres du catalogue (audit des six écrans, piste A choisie le 16/10) ---
// Des pastilles au lieu de trois menus déroulants : trier (note, ajout
// récent, titre, par critère), afficher (tous, favoris, sans note, revus),
// genres (plusieurs à la fois) et décennie. Les filtres actifs restent
// visibles sous la recherche, avec une croix (renderActiveFilters()).
const CAT_SORTS = [['note', 'Note'], ['recent', 'Ajout récent'], ['title', 'Titre'], ['crit', 'Par critère']];
const CAT_SHOWS = [['all', 'Tous'], ['fav', 'Favoris'], ['unrated', 'Sans note'], ['rewatch', 'Revus']];
const CRIT_SHORT = { jeu: 'Jeu', esthetique: 'Esthétique', ressenti: 'Ressenti' };
let catFilter = { sort: 'note', crit: 'scenario', show: 'all', genres: [], decade: null };

function critShortLabel(key){
  if(CRIT_SHORT[key]) return CRIT_SHORT[key];
  const c = CRITERIA.find(x => x.key === key);
  return c ? c.label : key;
}
// Décennie d'un film : 2020, 2010… ou 0 pour « Avant 1990 ».
function filmDecade(f){
  if(!f.releaseYear) return null;
  return f.releaseYear < 1990 ? 0 : Math.floor(f.releaseYear / 10) * 10;
}
function decadeLabel(d){ return d === 0 ? 'Avant 1990' : String(d); }
function isRewatched(f){ return typeof rewatchCount === 'function' && rewatchCount(f.id) > 1; }
function catFilterActive(){
  return catFilter.sort !== 'note' || catFilter.show !== 'all' || catFilter.genres.length > 0 || catFilter.decade !== null;
}
function hasCritValue(f, key){ return !!(f.crit && typeof f.crit[key] === 'number'); }

// Pastilles du panneau « Trier et filtrer » : seuls les genres et décennies
// présents dans ton catalogue ; « Favoris », « Sans note » et « Revus »
// seulement s'ils mènent quelque part, avec leur nombre.
function renderFilterChips(){
  const wrap = document.getElementById('filterChips');
  if(!wrap) return;
  const chip = (on, act, label, count) => `<button type="button" class="filter-chip${on ? ' is-on' : ''}" data-filter="${act}" aria-pressed="${on}">${escapeHtml(label)}${count != null ? ` <small>${count}</small>` : ''}</button>`;
  const counts = {
    fav: films.filter(f => f.fav).length,
    unrated: films.filter(f => getDisplayNote(f) === null).length,
    rewatch: films.filter(isRewatched).length,
  };
  const genres = new Set();
  films.forEach(f => (f.genreIds || []).forEach(id => { if(GENRE_MAP[id]) genres.add(id); }));
  const genreList = Array.from(genres).sort((a, b) => GENRE_MAP[a].localeCompare(GENRE_MAP[b], 'fr'));
  // Décennies de la plus récente à la plus ancienne, « Avant 1990 » en dernier.
  const decades = Array.from(new Set(films.map(filmDecade).filter(d => d !== null))).sort((a, b) => b - a);
  const shows = CAT_SHOWS.filter(([k]) => k === 'all' || counts[k] > 0 || catFilter.show === k);
  wrap.innerHTML = `
    <div class="filter-label">Trier</div>
    <div class="filter-row">${CAT_SORTS.map(([k, l]) => chip(catFilter.sort === k, 'sort:' + k, l)).join('')}</div>
    ${catFilter.sort === 'crit' ? `<div class="filter-row">${CRITERIA.map(c => chip(catFilter.crit === c.key, 'crit:' + c.key, critShortLabel(c.key))).join('')}</div>` : ''}
    <div class="filter-label">Afficher</div>
    <div class="filter-row">${shows.map(([k, l]) => chip(catFilter.show === k, 'show:' + k, l, k === 'all' ? null : counts[k])).join('')}</div>
    ${genreList.length ? `<div class="filter-label">Genre</div><div class="filter-row">${genreList.map(id => chip(catFilter.genres.includes(id), 'genre:' + id, GENRE_MAP[id])).join('')}</div>` : ''}
    ${decades.length ? `<div class="filter-label">Décennie</div><div class="filter-row">${decades.map(d => chip(catFilter.decade === d, 'decade:' + d, decadeLabel(d))).join('')}</div>` : ''}`;
}

// Gardé sous ce nom : appelé après chaque changement du catalogue (ajout,
// import, suppression...). Retire des filtres un genre ou une décennie qui
// n'existent plus, puis redessine les pastilles.
function buildGenreFilterOptions(){
  const genres = new Set();
  films.forEach(f => (f.genreIds || []).forEach(id => genres.add(id)));
  catFilter.genres = catFilter.genres.filter(id => genres.has(id));
  if(catFilter.decade !== null && !films.some(f => filmDecade(f) === catFilter.decade)) catFilter.decade = null;
  renderFilterChips();
}
// Ancien remplissage du menu des critères : ce sont désormais des pastilles.
function buildSortOptions(){ renderFilterChips(); }

function applyCatFilter(act){
  const [k, v] = act.split(':');
  if(k === 'sort') catFilter.sort = v;
  else if(k === 'crit') catFilter.crit = v;
  else if(k === 'show') catFilter.show = (catFilter.show === v && v !== 'all') ? 'all' : v;
  else if(k === 'genre'){
    const id = Number(v);
    catFilter.genres = catFilter.genres.includes(id) ? catFilter.genres.filter(g => g !== id) : catFilter.genres.concat(id);
  }else if(k === 'decade'){
    const d = Number(v);
    catFilter.decade = catFilter.decade === d ? null : d;
  }else if(k === 'clear'){
    catFilter = { sort: 'note', crit: catFilter.crit, show: 'all', genres: [], decade: null };
  }
  currentPage = 1;
  renderFilterChips();
  render();
}

// Filtres actifs sous la recherche, chacun avec sa croix.
function renderActiveFilters(){
  const el = document.getElementById('activeFilters');
  if(!el) return;
  const items = [];
  if(catFilter.sort !== 'note') items.push([catFilter.sort === 'crit' ? `Trié par ${critShortLabel(catFilter.crit)}` : CAT_SORTS.find(s => s[0] === catFilter.sort)[1], 'sort:note']);
  if(catFilter.show !== 'all') items.push([CAT_SHOWS.find(s => s[0] === catFilter.show)[1], 'show:all']);
  catFilter.genres.forEach(id => items.push([GENRE_MAP[id] || '', 'genre:' + id]));
  if(catFilter.decade !== null) items.push([decadeLabel(catFilter.decade), 'decade:' + catFilter.decade]);
  el.hidden = items.length === 0;
  el.innerHTML = items.map(([l, a]) => `<button type="button" class="filter-chip is-on" data-filter="${a}" aria-label="Retirer le filtre ${escapeHtml(l)}">${escapeHtml(l)} <span aria-hidden="true">×</span></button>`).join('')
    + (items.length ? `<button type="button" class="filter-clear" data-filter="clear">Tout effacer</button>` : '');
}

// Sous les filtres : ce que montre le coin des affiches quand on trie par
// critère, ou la rangée « Noter le premier » des films sans note.
function renderCatalogNotice(){
  const el = document.getElementById('catalogNotice');
  if(!el) return;
  let html = '';
  if(catFilter.sort === 'crit'){
    const name = critShortLabel(catFilter.crit).toLowerCase();
    const without = films.filter(f => getDisplayNote(f) !== null && !hasCritValue(f, catFilter.crit)).length;
    html += `<p class="catalog-hint">Trié par ${escapeHtml(name)} : le chiffre dans le coin est ta note de ${escapeHtml(name)}, sur 5.${without ? ` Les ${without} films notés sans critères sont à la fin.` : ''}</p>`;
  }
  if(catFilter.show === 'unrated'){
    const n = films.filter(f => getDisplayNote(f) === null).length;
    if(n > 0) html += `<div class="catalog-strip"><span><b>${n} film${n > 1 ? 's' : ''}</b> vu${n > 1 ? 's' : ''} mais pas encore noté${n > 1 ? 's' : ''}.</span><button type="button" class="catalog-strip-btn" id="rateFirstUnratedBtn">Noter le premier ›</button></div>`;
  }
  el.innerHTML = html;
  el.hidden = !html;
  const btn = document.getElementById('rateFirstUnratedBtn');
  if(btn) btn.addEventListener('click', startUnratedQueue);
}

// « Noter le premier » : ouvre la notation du premier film sans note de la
// liste affichée ; après « Enregistrer », la fenêtre passe au suivant
// (voir handleSave()). Fermer la fenêtre arrête l'enchaînement.
let unratedQueueActive = false;
function nextUnratedFilm(exceptId){
  return getFilteredSortedFilms().find(f => f.id !== exceptId && getDisplayNote(f) === null) || null;
}
function startUnratedQueue(){
  const first = nextUnratedFilm(null);
  if(!first) return;
  openModal(first.id);
  unratedQueueActive = true;
}

// Extrait du click .star-btn (voir render() plus bas) pour rester testable
// isolément (tests/favorite-offline.test.js) — renvoie true si l'état
// local a effectivement changé (succès en ligne, ou mis en file hors
// ligne), false sur une erreur réseau (l'appelant sait alors qu'il n'y a
// rien à re-render/pulser, l'erreur étant déjà signalée ici par toast).
async function toggleFilmFavorite(f){
  const newFav = !f.fav;
  // File d'attente hors ligne (retour utilisateur, js/offlineQueue.js) :
  // toggle favori mis en file plutôt que bloqué — met à jour un id déjà
  // connu, rejouable sans réconciliation au retour du réseau.
  if(isOfflineMode){
    f.fav = newFav;
    enqueueOfflineWrite({ table: 'films', op: 'update', match: { id: f.id, user_id: currentUser.id }, payload: { fav: newFav } });
    return true;
  }
  const { error } = await supabaseClient.from('films').update({ fav: newFav }).eq('id', f.id).eq('user_id', currentUser.id);
  if(error){
    showToast('Erreur de sauvegarde, réessaie');
    console.error(error);
    return false;
  }
  f.fav = newFav;
  return true;
}

// Filtre + trie `films` selon la recherche et les filtres du catalogue
// (catFilter) — extrait de render() pour être réutilisable par openModal()
// (navList des flèches vers la fiche) et par l'enchaînement « Noter le
// premier », sans dépendre de la pagination de l'écran.
function getFilteredSortedFilms(){
  const search = normalizeSearch(document.getElementById('search').value.trim());
  // Matche le titre FR ou le titre VO (ex. "créatures féroces" trouve aussi
  // "Fierce Creatures"), accents/casse ignorés — voir getSearchTerms().
  let filtered = films.filter(f => !search || getSearchTerms(f).some(t => t.includes(search)));

  if(catFilter.show === 'fav') filtered = filtered.filter(f => f.fav);
  else if(catFilter.show === 'unrated') filtered = filtered.filter(f => getDisplayNote(f) === null);
  else if(catFilter.show === 'rewatch') filtered = filtered.filter(isRewatched);
  if(catFilter.genres.length) filtered = filtered.filter(f => catFilter.genres.some(g => (f.genreIds || []).includes(g)));
  if(catFilter.decade !== null) filtered = filtered.filter(f => filmDecade(f) === catFilter.decade);

  const noteOf = (f) => { const n = getDisplayNote(f); return n === null ? -1 : n; };
  filtered.sort((a, b) => {
    if(catFilter.sort === 'crit'){
      // Les films notés sur ce critère d'abord, du meilleur au moins bon,
      // puis ceux notés sans critères (par note), puis les films sans note.
      const key = catFilter.crit;
      const rank = (f) => hasCritValue(f, key) ? 2 : (getDisplayNote(f) !== null ? 1 : 0);
      const ra = rank(a), rb = rank(b);
      if(ra !== rb) return rb - ra;
      if(ra === 2) return b.crit[key] - a.crit[key];
      return noteOf(b) - noteOf(a);
    }
    if(catFilter.sort === 'title') return a.title.localeCompare(b.title, 'fr');
    if(catFilter.sort === 'recent') return b.added - a.added;
    return noteOf(b) - noteOf(a);
  });

  return filtered;
}

function render(){
  // Objectif annuel (retour utilisateur) — voir renderAnnualGoalWidget(),
  // js/recap.js. Rafraîchi à chaque render() (appelé après toute mutation
  // pertinente : sauvegarde d'un film, visionnage ajouté...) plutôt que
  // traqué site par site : render() est déjà le point de passage commun.
  if(typeof renderAnnualGoalWidget === 'function') renderAnnualGoalWidget();
  const list = document.getElementById('filmList');
  const countLine = document.getElementById('countLine');
  // Vue Journal (draft Profil du 15/10) : tes visionnages par mois, à la
  // place de la grille ou de la liste. Voir renderFilmsJournal(), js/journal.js.
  const journalOn = typeof isFilmsJournal === 'function' && isFilmsJournal();
  if(typeof renderFilmsViewTabs === 'function') renderFilmsViewTabs();
  const journalEl = document.getElementById('filmJournal');
  if(journalEl) journalEl.style.display = journalOn ? '' : 'none';
  list.style.display = journalOn ? 'none' : '';
  if(journalOn){
    renderBulkActionsBar();
    renderFilmsJournal();
    renderLoadMore(false);
    return;
  }
  const search = document.getElementById('search').value.trim();

  // Point sur le bouton filtre : un tri ou un filtre autre que celui par défaut est actif.
  document.getElementById('filtersToggleBtn').classList.toggle('has-active-filter', catFilterActive());
  renderBulkActionsBar();
  renderActiveFilters();
  renderCatalogNotice();

  const filtered = getFilteredSortedFilms();

  const isFiltered = !!search || catFilter.show !== 'all' || catFilter.genres.length > 0 || catFilter.decade !== null;
  // Compteur à droite de la recherche : « 334 films », ou « 12 sur 334 »
  // quand un filtre ou une recherche réduit la liste.
  countLine.textContent = isFiltered
    ? `${filtered.length} sur ${films.length}`
    : `${filtered.length} film${filtered.length>1?'s':''}`;
  const applyBtn = document.getElementById('applyFiltersBtn');
  if(applyBtn) applyBtn.textContent = isFiltered ? `Voir ${filtered.length} film${filtered.length > 1 ? 's' : ''}` : 'Voir les films';

  if(filtered.length === 0){
    list.innerHTML = `<div class="empty-state">${films.length === 0
      ? 'Aucun film pour l\'instant. Tape un titre dans la recherche pour ajouter ton premier film.'
      : search ? `Aucun de tes films ne correspond à « ${escapeHtml(search)} ». Choisis-le dans la liste sous la recherche pour l'ajouter.`
      : 'Aucun film ne correspond à ces filtres.'}</div>`;
    renderLoadMore(false);
    return;
  }

  // Défilement continu (audit M9, ex-pagination « Suivant ») : currentPage
  // compte désormais les paquets de FILMS_PER_PAGE déjà affichés, et on
  // montre tout jusque-là. Le paquet suivant arrive en approchant du bas
  // (renderLoadMore()).
  const totalPages = Math.max(1, Math.ceil(filtered.length / FILMS_PER_PAGE));
  currentPage = Math.min(Math.max(1, currentPage), totalPages);
  const pageItems = filtered.slice(0, currentPage * FILMS_PER_PAGE);

  list.innerHTML = '';
  // Fiche film plutôt que la modale de notation au clic (retour
  // utilisateur : "quand je clique sur un que j'ai déjà vu je veux arriver
  // sur la fiche des films pas sur ma fiche de notation") — même
  // goToFilmDetail() que Top/Watchlist/Amis (js/top.js, js/watchlist.js).
  const navList = pageItems.filter(f => f.tmdbId).map(f => ({ tmdbId: f.tmdbId, title: f.title }));
  // Trié par critère : la note de ce critère dans le coin, et un séparateur
  // avant les films notés sans critères (audit des six écrans, piste A).
  const critKey = catFilter.sort === 'crit' ? catFilter.crit : null;
  let dividerDone = !critKey || !pageItems.some(f => hasCritValue(f, critKey));
  pageItems.forEach(f => {
    if(!dividerDone && !hasCritValue(f, critKey)){
      dividerDone = true;
      const sep = document.createElement('div');
      sep.className = 'film-divider';
      sep.textContent = 'Notés sans critères, puis sans note';
      list.appendChild(sep);
    }
    const note = getDisplayNote(f);
    const critShown = critKey && hasCritValue(f, critKey) ? f.crit[critKey] : null;
    const cornerValue = critKey ? (critShown !== null ? critShown * CRIT_DISPLAY_SCALE : null) : note;
    const cornerText = critKey ? (critShown !== null ? critToDisplay(critShown) : '—') : (note !== null ? note.toFixed(1) : '—');
    const rewatches = typeof rewatchCount === 'function' ? rewatchCount(f.id) : 0;
    const happening = getClickHappeningForFilm(f);
    const row = document.createElement('div');
    row.className = 'film-row';
    row.dataset.id = f.id; // cible du pulse de sauvegarde (voir handleSave()) et du pulse favori ci-dessous
    const genres = (f.genreIds || []).map(id => GENRE_MAP[id]).filter(Boolean).slice(0, 2).join(', ');
    // Sous l'affiche : l'année (et « sans note »). En liste : l'année, les
    // genres et les revisionnages (audit des six écrans, C6 et C7).
    const subGrid = [f.releaseYear, note === null ? 'sans note' : ''].filter(Boolean).join(' · ');
    const subList = [f.releaseYear, genres, rewatches > 1 ? `revu ${rewatches} fois` : ''].filter(Boolean).join(' · ');
    row.innerHTML = `
      ${bulkSelectMode ? `<input type="checkbox" class="bulk-select-checkbox" data-id="${f.id}" aria-label="Sélectionner ${escapeHtml(f.title)}" ${selectedFilmIds.has(f.id) ? 'checked' : ''}>` : ''}
      <div class="film-poster-box">
        ${f.posterUrl
          ? `<img class="film-poster" src="${escapeHtml(f.posterUrl)}" alt="" loading="lazy">`
          : `<div class="film-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
        ${happening ? `<button class="happening-badge" type="button" title="Un petit quelque chose à découvrir..." aria-label="Un petit quelque chose à découvrir...">${happening.icon}</button>` : ''}
      </div>
      <div class="film-main">
        <div class="film-title">${escapeHtml(f.title)}</div>
        <div class="film-sub film-sub-grid">${escapeHtml(subGrid)}</div>
        <div class="film-sub film-sub-list">${escapeHtml(subList)}</div>
      </div>
      <button class="star-btn ${f.fav ? 'active' : ''}" data-id="${f.id}" type="button" title="Favori" aria-label="${f.fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}" aria-pressed="${f.fav}">${uiIcon('star', f.fav)}</button>
      ${note === null ? `<button class="row-rate-link" type="button">Noter</button>` : ''}
      <div class="counter ${noteColorClass(cornerValue)}">${cornerText}</div>
    `;
    makeRowClickable(row, (e) => {
      if(e.target.closest && e.target.closest('.star-btn, .row-rate-link, .happening-badge')) return;
      if(e.target.classList.contains('bulk-select-checkbox')) return; // déjà géré par son propre listener 'change' ci-dessous
      // Actions groupées (retour utilisateur) : en mode sélection, la ligne
      // entière coche/décoche au lieu d'ouvrir la fiche.
      if(bulkSelectMode){ toggleFilmSelection(f.id); render(); return; }
      // Entrée manuelle sans tmdbId (ancien référentiel, pas de fiche TMDB
      // possible) : seul cas qui ouvre encore la notation directement.
      if(f.tmdbId) goToFilmDetail(f.tmdbId, navList);
      else openModal(f.id);
    });
    if(bulkSelectMode){
      row.querySelector('.bulk-select-checkbox').addEventListener('change', () => {
        toggleFilmSelection(f.id);
        render();
      });
    }
    if(happening){
      row.querySelector('.happening-badge').addEventListener('click', (e) => {
        e.stopPropagation();
        happening.run(f);
      });
    }
    const rateLink = row.querySelector('.row-rate-link');
    if(rateLink){
      rateLink.addEventListener('click', (e) => {
        e.stopPropagation();
        openModal(f.id);
      });
    }
    row.querySelector('.star-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const changed = await toggleFilmFavorite(f);
      if(!changed) return; // erreur réseau déjà signalée par toggleFilmFavorite() elle-même
      render();
      // render() reconstruit tout le DOM de la liste (voir plus haut) — le
      // bouton cliqué n'existe déjà plus, on pulse celui qui vient d'être
      // recréé pour le même film plutôt que l'ancienne référence.
      pulseElement(document.querySelector(`.star-btn[data-id="${f.id}"]`));
    });
    list.appendChild(row);
  });

  renderLoadMore(currentPage < totalPages);
}

// Notation avec le titre déjà cherché sur TMDB : « Plus de films sur TMDB »
// en bas de la liste de suggestions (js/globalSearch.js).
function openAddFromSearch(query){
  openModal(null);
  const titleInput = document.getElementById('titleInput');
  titleInput.value = query;
  titleInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Paquet suivant du catalogue : chargé tout seul quand le bas de la liste
// approche (IntersectionObserver), avec un vrai bouton en secours (clavier,
// navigateur sans IntersectionObserver).
let loadMoreObserver = null;
function loadNextFilmChunk(){
  currentPage++;
  render();
}
function renderLoadMore(hasMore){
  const el = document.getElementById('pagination');
  if(loadMoreObserver){ loadMoreObserver.disconnect(); loadMoreObserver = null; }
  if(!hasMore){
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `<button class="load-more-btn" id="loadMoreBtn" type="button">Afficher plus</button>`;
  const btn = document.getElementById('loadMoreBtn');
  btn.addEventListener('click', loadNextFilmChunk);
  if(typeof IntersectionObserver === 'function'){
    loadMoreObserver = new IntersectionObserver((entries) => {
      if(entries.some(e => e.isIntersecting)){
        loadMoreObserver.disconnect();
        loadMoreObserver = null;
        loadNextFilmChunk();
      }
    }, { rootMargin: '600px 0px' });
    loadMoreObserver.observe(btn);
  }
}

// --- Actions groupées sur le catalogue (retour utilisateur) --- Mode
// bascule (#bulkSelectBtn, toolbar) : chaque ligne du catalogue affiche une
// case à cocher au lieu d'ouvrir la fiche au clic (voir render() plus
// haut) ; #bulkActionsBar apparaît dès qu'au moins un film est coché.
// selectedFilmIds ne survit PAS à une sortie du mode sélection
// (toggleBulkSelectMode la vide) — repartir d'une sélection vide à chaque
// activation évite la confusion "pourquoi ces films-là sont déjà cochés".
let bulkSelectMode = false;
let selectedFilmIds = new Set();

function toggleBulkSelectMode(){
  bulkSelectMode = !bulkSelectMode;
  selectedFilmIds.clear();
  const btn = document.getElementById('bulkSelectBtn');
  btn.classList.toggle('active', bulkSelectMode);
  btn.setAttribute('aria-pressed', String(bulkSelectMode));
  render();
}

function toggleFilmSelection(id){
  if(selectedFilmIds.has(id)) selectedFilmIds.delete(id);
  else selectedFilmIds.add(id);
}

function renderBulkActionsBar(){
  const bar = document.getElementById('bulkActionsBar');
  if(!bulkSelectMode || selectedFilmIds.size === 0){
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const n = selectedFilmIds.size;
  document.getElementById('bulkActionsCount').textContent = `${n} film${n > 1 ? 's' : ''} sélectionné${n > 1 ? 's' : ''}`;
}

async function handleBulkFavorite(fav){
  if(blockIfOffline()) return; // js/offline.js — lecture seule hors ligne
  if(selectedFilmIds.size === 0) return;
  const ids = Array.from(selectedFilmIds);
  const { error } = await supabaseClient.from('films').update({ fav }).in('id', ids).eq('user_id', currentUser.id);
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  films.forEach(f => { if(selectedFilmIds.has(f.id)) f.fav = fav; });
  showToast(fav ? 'Ajoutés aux favoris' : 'Retirés des favoris');
  render();
}

// Bulk delete : un confirm() bloquant (comme handleDelete(), voir l'audit
// confirmations v2.7) plutôt que le toast d'annulation (v2.8) — supprimer
// potentiellement des dizaines de films d'un coup est un geste bien plus
// lourd que les cas visés par le toast (un seul item de watchlist/journal),
// une fenêtre de quelques secondes pour annuler serait un filet trop faible.
async function handleBulkDelete(){
  if(blockIfOffline()) return;
  if(selectedFilmIds.size === 0) return;
  const n = selectedFilmIds.size;
  if(!confirm(`Supprimer définitivement ${n} film${n > 1 ? 's' : ''} et leur historique de visionnages ?`)) return;
  const ids = Array.from(selectedFilmIds);
  const { error } = await supabaseClient.from('films').delete().in('id', ids).eq('user_id', currentUser.id);
  if(error){
    showToast('Erreur de suppression, réessaie');
    console.error(error);
    return;
  }
  films = films.filter(f => !selectedFilmIds.has(f.id));
  viewings = viewings.filter(v => !selectedFilmIds.has(v.filmId)); // supprimés en cascade côté base
  selectedFilmIds.clear();
  buildGenreFilterOptions(); // les genres supprimés peuvent ne plus être représentés au catalogue
  render();
  playDeleteTone();
  showToast('Films supprimés');
}

// Déclenche le téléchargement d'un export JSON (même format que
// exportFilms() ci-dessous, dont le corps est maintenant un simple appel à
// ce helper partagé) — filenameSuffix distingue un export complet d'un
// export de sélection sans dupliquer la mécanique blob/lien/révocation.
function downloadFilmsJson(filmsToExport, filenameSuffix){
  const data = {
    app: 'critique-films',
    version: 3,
    exportedAt: new Date().toISOString(),
    films: filmsToExport
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `critique-films${filenameSuffix}-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function handleBulkExport(){
  if(selectedFilmIds.size === 0) return;
  downloadFilmsJson(films.filter(f => selectedFilmIds.has(f.id)), '-selection');
  showToast('Sélection exportée');
}

document.getElementById('bulkSelectBtn').addEventListener('click', toggleBulkSelectMode);
document.getElementById('bulkFavBtn').addEventListener('click', () => handleBulkFavorite(true));
document.getElementById('bulkUnfavBtn').addEventListener('click', () => handleBulkFavorite(false));
document.getElementById('bulkDeleteBtn').addEventListener('click', handleBulkDelete);
document.getElementById('bulkExportBtn').addEventListener('click', handleBulkExport);

// Audit général (16/10) : échappe aussi « " » et « ' ». L'ancienne version
// (textContent puis innerHTML) les laissait passer : un pseudo comme
// `x" onload="…` sortait d'un attribut (alt, aria-label) et ajoutait le sien.
// Sert pour le texte ET les attributs, adresses d'images comprises.
function escapeHtml(str){
  if(str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Audit M11 : chaque critère s'affiche sur la même échelle que la note
// (sur 5, point décimal comme partout), alors qu'il est stocké de 0 à 1.
// Seul l'affichage change : les curseurs et la base gardent 0 à 1.
const CRIT_DISPLAY_SCALE = 5;
function critToDisplay(v){
  return String(Math.round(v * CRIT_DISPLAY_SCALE * 100) / 100);
}
// Tant qu'un nouveau film n'a reçu aucun réglage, sa note calculée (2.5 par
// défaut) reste neutre plutôt que colorée comme une vraie note (audit M11).
let critPristine = false;
// Un curseur de critère a-t-il bougé depuis l'ouverture de la fenêtre ?
// Sert à critForSave() (audit N1, 16/10).
let critTouched = false;

// Critères à enregistrer (audit N1, 16/10) : 52 films avaient une grille ET une
// note manuelle égale ; ouverts en « note manuelle », ils perdaient leur grille
// au premier « Enregistrer » (crit: {}). En note manuelle, on garde la grille
// déjà enregistrée, sauf si un curseur a été bougé dans cette fenêtre.
function critForSave(manual, film, touched, formCrit){
  if(!manual || touched) return formCrit;
  return (film && film.crit && typeof film.crit === 'object') ? film.crit : {};
}

function buildCriteriaInputs(critObj){
  const wrap = document.getElementById('criteriaWrap');
  wrap.innerHTML = '';
  critPristine = !critObj;
  critTouched = false;
  CRITERIA.forEach((c, idx) => {
    const val = (critObj && typeof critObj[c.key] === 'number') ? critObj[c.key] : 0.5;
    const block = document.createElement('div');
    block.className = 'criterion';
    block.innerHTML = `
      <div class="crit-head">
        <div class="crit-label"><span class="num">0${idx+1}</span>${c.label}</div>
        <!-- Éditable (v2.1, retour utilisateur : le curseur seul manque de
             précision) — voir js/ui.js pour le réglage à la molette,
             complémentaire, et la note en tête de fichier sur .crit-val
             (css/style.css) pour la spécificité CSS. -->
        <input type="number" class="crit-val" id="val-${c.key}" data-key="${c.key}" min="0" max="${CRIT_DISPLAY_SCALE}" step="0.25" lang="en" value="${critToDisplay(val)}" inputmode="decimal" aria-label="${escapeHtml(c.label)}, sur 5">
      </div>
      <div class="crit-def">${escapeHtml(c.def)}</div>
      <div class="crit-slider-row">
        <input type="range" min="0" max="1" step="0.05" value="${val}" id="slider-${c.key}" data-key="${c.key}">
      </div>
      <button class="crit-help-toggle" data-key="${c.key}">Repères de notation & questions</button>
      <div class="crit-help" id="help-${c.key}"><div class="crit-anchors">${escapeHtml(c.anchors)}</div><div class="crit-questions">${escapeHtml(c.help)}</div></div>
    `;
    wrap.appendChild(block);
  });

  wrap.querySelectorAll('input[type="range"]').forEach(input => {
    input.addEventListener('input', () => {
      critPristine = false;
      critTouched = true;
      document.getElementById('val-' + input.dataset.key).value = critToDisplay(parseFloat(input.value));
      updateLiveScore();
    });
  });
  // Synchro depuis le chiffre tapé à la main (v2.1, retour utilisateur) :
  // 'input' (à chaque frappe) répercute en direct sur le curseur SANS
  // recadrer ce qui est tapé (sinon "0.6" en cours de frappe se ferait
  // écraser avant même la fin) ; 'change' (au blur/Entrée) arrondit et
  // recadre l'affichage une fois la saisie terminée.
  wrap.querySelectorAll('.crit-val').forEach(input => {
    const slider = () => document.getElementById('slider-' + input.dataset.key);
    const sync = (clampDisplay) => {
      critPristine = false;
      critTouched = true;
      let v = parseFloat(input.value) / CRIT_DISPLAY_SCALE;
      if(isNaN(v)) v = parseFloat(slider().value);
      v = Math.min(1, Math.max(0, v));
      if(clampDisplay) input.value = critToDisplay(v);
      slider().value = v;
      updateLiveScore();
    };
    input.addEventListener('input', () => sync(false));
    input.addEventListener('change', () => sync(true));
  });
  wrap.querySelectorAll('.crit-help-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('help-' + btn.dataset.key).classList.toggle('open');
    });
  });
  updateLiveScore();
}

function readCriteriaFromForm(){
  const obj = {};
  CRITERIA.forEach(c => {
    obj[c.key] = parseFloat(document.getElementById('slider-' + c.key).value);
  });
  return obj;
}

function isManualMode(){
  return document.getElementById('manualToggle').checked;
}

function updateManualVisibility(){
  const manual = isManualMode();
  document.getElementById('criteriaWrap').style.display = manual ? 'none' : '';
  document.getElementById('manualScoreRow').style.display = manual ? '' : 'none';
  updateLiveScore();
}

function updateLiveScore(){
  let note;
  if(isManualMode()){
    note = parseFloat(document.getElementById('manualScoreSlider').value);
  }else{
    note = computeNote(readCriteriaFromForm());
  }
  const label = isManualMode() ? 'Note manuelle' : 'Note calculée';
  const display = (note !== null && !isNaN(note)) ? note.toFixed(1) : '—';
  document.getElementById('liveScoreLabel').textContent = label;
  document.getElementById('liveScore').textContent = display;
  // Cadran en vedette (retour utilisateur, voir le commentaire sur
  // .crit-dial-hero dans index.html) — même noteColorClass() (js/ui.js)
  // que .counter partout ailleurs, jamais une couleur à part pour lui.
  const hero = document.getElementById('critDialHero');
  hero.textContent = display;
  hero.className = 'counter crit-dial-hero-counter ' + (critPristine && !isManualMode() ? '' : noteColorClass(note));
  document.getElementById('critDialHeroLabel').textContent = label;
  document.getElementById('critDialHeroHint').textContent = isManualMode()
    ? 'Glisse le curseur ci-dessous, elle bouge en direct.'
    : 'Ajuste les critères ci-dessous, elle bouge en direct.';
}

// prefillTmdb (v2.1) : lancer une nouvelle fiche déjà pré-remplie depuis un
// film pas encore noté — "Noter ce film" sur la fiche film (voir
// js/filmDetail.js), même forme que tmdbSelected (tmdb_id/poster_url/
// overview/release_year/title/genre_ids). Ignoré si id est fourni (édition
// d'un film déjà enregistré, qui a forcément sa propre fiche TMDB à
// reprendre — voir plus bas).
// Visibilité (migration 054) : le champ n'est envoyé que s'il sert. Un film
// non privé ne l'envoie jamais, donc l'enregistrement reste valable tant que la
// migration n'est pas appliquée. Repasser un film privé en public l'envoie
// explicitement (false).
function champPrive(){
  const coche = document.getElementById('filmPrivate').checked;
  const etaitPrive = editingId ? !!(films.find(f => f.id === editingId) || {}).isPrivate : false;
  if(coche || etaitPrive) return { is_private: coche };
  return {};
}

function openModal(id, prefillTmdb){
  if(blockIfOffline()) return; // js/offline.js — lecture seule hors ligne
  editingId = id || null;
  // Repart d'une conversion watchlist propre à chaque ouverture — seule
  // startRatingFromWatchlist() (js/watchlist.js) la positionne ensuite.
  convertingFromWatchlistId = null;
  const film = id ? films.find(f => f.id === id) : null;
  const manualNote = film && film.manualNote != null ? film.manualNote : null;

  document.getElementById('titleInput').value = film ? film.title : (prefillTmdb ? prefillTmdb.title : '');
  document.getElementById('deleteBtn').style.display = film ? 'inline-block' : 'none';
  const openFilmDetailBtn = document.getElementById('modalOpenFilmDetailBtn');
  openFilmDetailBtn.style.display = (film && film.tmdbId) ? '' : 'none';
  modalFilmNavList = (film && film.tmdbId)
    ? getFilteredSortedFilms().filter(f => f.tmdbId).map(f => ({ tmdbId: f.tmdbId, title: f.title }))
    : null;

  document.getElementById('manualToggle').checked = manualNote !== null;
  document.getElementById('filmPrivate').checked = !!(film && film.isPrivate);
  const sliderVal = manualNote !== null ? manualNote : 2.5;
  document.getElementById('manualScoreSlider').value = sliderVal;
  document.getElementById('manualScoreVal').textContent = sliderVal.toFixed(1);

  document.getElementById('reviewInput').value = film && film.review ? film.review : '';

  // Reprend l'affiche/résumé TMDB déjà enregistrés (s'il y en a) comme point de
  // départ — une nouvelle recherche les remplace, "Retirer" les efface.
  tmdbSelected = (film && film.tmdbId) ? {
    tmdb_id: film.tmdbId,
    poster_url: film.posterUrl,
    overview: film.overview,
    release_year: film.releaseYear,
    title: film.title,
    // Reconduit tel quel (voir handleSave()) : sans lui, ré-enregistrer un
    // film déjà noté sans retoucher sa fiche TMDB effacerait son genre.
    genre_ids: film.genreIds || []
  } : (prefillTmdb || null);
  document.getElementById('tmdbResults').innerHTML = '';
  updateTmdbSelectedUI();

  buildCriteriaInputs(film ? film.crit : null);
  updateManualVisibility();

  // Visionnages : n'a de sens que pour un film déjà enregistré (le premier
  // visionnage d'un nouveau film est créé automatiquement à la sauvegarde).
  document.getElementById('viewingsSection').style.display = film ? '' : 'none';
  if(film){
    const todayStr = new Date().toISOString().slice(0, 10);
    const viewingDateInput = document.getElementById('viewingDateInput');
    viewingDateInput.value = todayStr;
    viewingDateInput.max = todayStr; // pas de visionnage dans le futur
    document.getElementById('viewingNoteInput').value = '';
    renderViewingsSection(film.id);
  }

  // Notation en pas à pas (audit des six écrans, piste B) : choisit l'écran
  // de départ (choix du film, premier critère, résumé ou note directe).
  if(typeof ntOpen === 'function') ntOpen(film);
  openOverlay('overlay');
  // Sur écran tactile, pas de clavier d'office (retour de Flix, 15/10) : on
  // vient souvent régler les curseurs, pas taper le titre.
  if(!window.matchMedia('(pointer: coarse)').matches && typeof ntScreen !== 'undefined' && ntScreen === 'pick') document.getElementById('titleInput').focus();
  // Happenings "dwell" (ex. The Whale) : se déclenchent en restant un
  // moment sur la fiche d'un film précis — voir js/happenings.js.
  startDwellWatch(film);
}

function closeModal(){
  unratedQueueActive = false;
  if(typeof ntCloseMenu === 'function') ntCloseMenu();
  closeOverlay('overlay', () => {
    editingId = null;
    convertingFromWatchlistId = null;
    clearDwellWatch();
  });
}

async function handleSave(){
  if(typeof ntCanSave === 'function' && !ntCanSave()) return;
  const continueQueue = unratedQueueActive;
  const title = document.getElementById('titleInput').value.trim();
  if(!title){
    showToast('Ajoute un titre avant d\'enregistrer');
    return;
  }
  const manual = isManualMode();
  // En note manuelle, la grille déjà enregistrée reste (audit N1), voir critForSave().
  const editedFilm = editingId ? films.find(f => f.id === editingId) : null;
  const crit = critForSave(manual, editedFilm, critTouched, manual && !critTouched ? null : readCriteriaFromForm());
  const manualNote = manual ? parseFloat(document.getElementById('manualScoreSlider').value) : null;
  const review = document.getElementById('reviewInput').value.trim() || null;
  const tmdbFields = tmdbSelected
    ? { tmdb_id: tmdbSelected.tmdb_id, poster_url: tmdbSelected.poster_url, overview: tmdbSelected.overview, release_year: tmdbSelected.release_year, original_title: tmdbSelected.original_title, genre_ids: tmdbSelected.genre_ids || [] }
    : { tmdb_id: null, poster_url: null, overview: null, release_year: null, original_title: null, genre_ids: [] };

  // Capturé avant closeModal() : son extraCleanup (js/ui.js) remet
  // editingId à null, mais seulement une fois l'animation de fermeture
  // terminée — pas question de dépendre de ce timing ici. Réassigné plus
  // bas côté création (id généré par Supabase, connu qu'après l'insert).
  let pulseId = editingId;

  if(editingId){
    const { error } = await supabaseClient.from('films')
      .update({ title, crit, manual_note: manualNote, review, ...tmdbFields, ...champPrive() })
      .eq('id', editingId)
      .eq('user_id', currentUser.id);
    if(error){
      showToast('Erreur de sauvegarde, réessaie');
      console.error(error);
      return;
    }
    const film = films.find(f => f.id === editingId);
    film.title = title;
    film.crit = crit;
    film.manualNote = manualNote;
    film.review = review;
    film.tmdbId = tmdbFields.tmdb_id;
    film.posterUrl = tmdbFields.poster_url;
    film.overview = tmdbFields.overview;
    film.releaseYear = tmdbFields.release_year;
    film.originalTitle = tmdbFields.original_title;
    film.genreIds = tmdbFields.genre_ids;
    // Cartes (js/tcg.js) : une fiche TMDB tout juste rattachée à un film
    // modifié en vaut une ajoutée à la création — même appel, jamais
    // attendu, voir le commentaire dans la branche création plus bas.
    if(tmdbFields.tmdb_id) generateTcgCardsForFilm(tmdbFields.tmdb_id);
  }else{
    const { data, error } = await supabaseClient
      .from('films')
      .insert({ title, crit, fav: false, added: Date.now(), manual_note: manualNote, review, ...tmdbFields, ...champPrive() })
      .select()
      .single();
    if(error){
      showToast('Erreur de sauvegarde, réessaie');
      console.error(error);
      return;
    }
    films.push(rowToFilm(data));
    pulseId = data.id;

    // Premier visionnage automatique, daté de l'ajout — voir js/journal.js.
    await addViewing(data.id, typeof ntFirstViewTimestamp === 'function' ? ntFirstViewTimestamp(data.added) : data.added);

    // Cartes à collectionner (retour utilisateur, js/tcg.js) : jamais
    // attendue (pas de await) — générer les cartes de ce film est un à-
    // côté, ne doit jamais retarder la fermeture du formulaire ni
    // dépendre de son succès réseau.
    if(tmdbFields.tmdb_id) generateTcgCardsForFilm(tmdbFields.tmdb_id);

    // Film créé depuis "✔ Noter" dans la watchlist (js/watchlist.js) :
    // on retire l'item d'origine maintenant que le film est bien enregistré.
    // En tâche de fond, sans bloquer la fermeture du formulaire.
    if(convertingFromWatchlistId){
      const wlId = convertingFromWatchlistId;
      supabaseClient.from('watchlist').delete().eq('id', wlId).then(({ error: wlError }) => {
        if(wlError) console.error(wlError);
        else watchlist = watchlist.filter(w => w.id !== wlId);
      });
    }
  }
  closeModal();
  buildGenreFilterOptions(); // le film enregistré peut introduire un genre inédit au catalogue
  render();
  // Pulse silencieux sur la note qui vient d'être enregistrée, en plus du
  // toast déjà là — peut ne rien trouver (film sur une autre page de la
  // pagination), pulseElement() ignore alors simplement l'appel.
  pulseElement(document.querySelector(`.film-row[data-id="${pulseId}"] .counter`));
  // Fiche film (v2.1) : si on vient de noter CE film-là depuis sa propre
  // fiche ("Noter ce film"), ses boutons/sa note affichée restent sinon
  // périmés en dessous jusqu'à la revisiter — voir js/filmDetail.js.
  if(typeof currentFilmTmdbId !== 'undefined' && currentFilmTmdbId === tmdbFields.tmdb_id
     && document.getElementById('filmDetailPage').style.display !== 'none'){
    updateFilmDetailActionButtons();
    renderFilmDetailNotes();
  }
  // Son selon la note : la hauteur suit la valeur, voir playRatingTone().
  const filmEnregistre = films.find(f => f.id === pulseId);
  playRatingTone(filmEnregistre ? getDisplayNote(filmEnregistre) : 0);
  // 5/5 tout juste (arrondi d'affichage compris) : petite célébration.
  if(filmEnregistre && getDisplayNote(filmEnregistre) >= 4.995) celebrateConfetti();
  showToast('Film enregistré');
  // « Noter le premier » (filtre Sans note) : on enchaîne sur le suivant.
  if(continueQueue){
    const nextFilm = nextUnratedFilm(pulseId);
    if(nextFilm){
      setTimeout(() => { openModal(nextFilm.id); unratedQueueActive = true; }, 380);
      showToast(`Film enregistré. Au suivant : ${nextFilm.title}`);
    }
  }
}

async function handleDelete(){
  if(!editingId) return;
  // Audit confirmations : c'était la seule action destructrice de tout le
  // site sans aucune confirmation, alors qu'elle supprime un film noté ET
  // tout son historique de visionnages en un clic sur un bouton "danger".
  if(!confirm('Supprimer définitivement ce film et tout son historique de visionnages ?')) return;
  const { error } = await supabaseClient.from('films').delete().eq('id', editingId).eq('user_id', currentUser.id);
  if(error){
    showToast('Erreur de suppression, réessaie');
    console.error(error);
    return;
  }
  films = films.filter(f => f.id !== editingId);
  viewings = viewings.filter(v => v.filmId !== editingId); // supprimés en cascade côté base
  closeModal();
  buildGenreFilterOptions(); // le genre supprimé peut ne plus être représenté au catalogue
  render();
  playDeleteTone();
  showToast('Film supprimé');
}

// --- Export / Import JSON ---

function exportFilms(){
  // Corps factorisé dans downloadFilmsJson() (plus haut) — partagé avec
  // l'export d'une sélection (actions groupées, retour utilisateur).
  downloadFilmsJson(films, '');
  showToast('Export téléchargé');
}

function isValidImportedFilm(f){
  return f && typeof f === 'object' && typeof f.title === 'string' && f.title.trim() && typeof f.crit === 'object' && f.crit !== null;
}

function importFilms(file){
  const reader = new FileReader();
  reader.onload = async () => {
    let data;
    try{
      data = JSON.parse(reader.result);
    }catch(e){
      showToast('Fichier JSON invalide');
      return;
    }

    const importedFilms = Array.isArray(data) ? data : data.films;
    if(!Array.isArray(importedFilms) || !importedFilms.every(isValidImportedFilm)){
      showToast('Format inattendu, import annulé');
      return;
    }

    // Sauvegarde proposée (jamais automatique) : avant un import qui peut
    // remplacer le catalogue, on propose de télécharger l'état actuel d'abord.
    if(films.length > 0 && confirm(`Télécharger d'abord une sauvegarde de ton catalogue actuel (${films.length} film(s)) ?`)){
      exportFilms();
    }

    const replace = confirm(
      `${importedFilms.length} film(s) trouvé(s) dans le fichier.\n\n` +
      `OK → remplace le catalogue actuel\n` +
      `Annuler → ajoute ces films aux films existants`
    );

    showToast('Import en cours…');

    if(replace){
      const { error: delError } = await supabaseClient.from('films').delete().eq('user_id', currentUser.id);
      if(delError){
        showToast('Erreur pendant le remplacement, réessaie');
        console.error(delError);
        return;
      }
      films = [];
      viewings = []; // supprimés en cascade côté base avec leurs films (FK on delete cascade)
    }

    const rows = importedFilms.map(f => ({
      title: f.title.trim(),
      crit: f.crit,
      fav: !!f.fav,
      added: typeof f.added === 'number' ? f.added : Date.now(),
      manual_note: typeof f.manualNote === 'number' ? f.manualNote : null,
      review: f.review || null,
      tmdb_id: f.tmdbId || null,
      poster_url: f.posterUrl || null,
      overview: f.overview || null,
      release_year: f.releaseYear || null,
      original_title: f.originalTitle || null,
      genre_ids: f.genreIds || []
    }));

    const { data: inserted, error: insError } = await supabaseClient.from('films').insert(rows).select();
    if(insError){
      showToast('Erreur pendant l\'import, réessaie');
      console.error(insError);
      return;
    }

    inserted.forEach(row => films.push(rowToFilm(row)));
    // Premier visionnage automatique pour chaque film importé, daté de son "added".
    await Promise.all(inserted.map(row => addViewing(row.id, row.added)));
    buildGenreFilterOptions();
    render();
    showToast(replace ? 'Catalogue remplacé' : 'Films ajoutés');
  };
  reader.onerror = () => showToast('Impossible de lire le fichier');
  reader.readAsText(file);
}

// --- Export vers Letterboxd (CSV) ---
// Letterboxd n'ouvre pas son API en écriture à un projet perso comme
// celui-ci (accès sur demande à api@letterboxd.com, réservé en pratique à
// des partenaires approuvés) — pas de vraie synchro automatique possible.
// En revanche, leur import CSV est un vrai flux officiel et documenté
// (letterboxd.com/about/importing-data) : ce fichier, une fois généré,
// s'importe à la main sur leur site en ~1 minute. Colonnes retenues,
// celles dont le comportement à l'import est confirmé : Title, Year,
// tmdbID (le même identifiant que celui déjà stocké via la recherche
// TMDB — évite toute ambiguïté de titre), WatchedDate (YYYY-MM-DD),
// Rating (0.5 à 5.0 par pas de 0.5, exactement l'échelle déjà utilisée
// ici), Review. Tags n'est PAS inclus : documenté comme ignoré côté
// import (contrairement à l'export, qui lui l'inclut).
//
// Un film → une seule ligne (pas une par revisionnage) : l'app ne stocke
// qu'une note par film, pas une par visionnage (voir js/journal.js) — Un
// import Letterboxd pourrait donc au mieux copier la même note sur chaque
// entrée de journal, un résultat plus trompeur qu'utile. WatchedDate
// prend la date du visionnage le PLUS RÉCENT (le plus proche de l'avis
// actuel, si le film a été revu) ; à défaut de tout visionnage enregistré
// (import JSON ancien, film ajouté avant le suivi des visionnages), repli
// sur `added`, la date d'ajout au catalogue.
function csvEscape(value){
  const s = String(value ?? '');
  // Toujours entre guillemets : plus simple et plus sûr que de ne les
  // ajouter qu'en présence d'une virgule/d'un guillemet/d'un retour à la
  // ligne — un titre ou un commentaire peut contenir n'importe lequel des
  // trois, doubler les guillemets internes suffit dans tous les cas.
  return `"${s.replace(/"/g, '""')}"`;
}

function latestWatchedDateFor(filmId, fallbackAddedMs){
  const filmViewings = viewings.filter(v => v.filmId === filmId);
  const ms = filmViewings.length > 0
    ? Math.max(...filmViewings.map(v => v.watchedAt))
    : fallbackAddedMs;
  return new Date(ms).toISOString().slice(0, 10);
}

function exportFilmsToLetterboxd(){
  if(films.length === 0){
    showToast('Aucun film à exporter');
    return;
  }
  const header = ['Title', 'Year', 'tmdbID', 'WatchedDate', 'Rating', 'Review'];
  const rows = films.map(f => [
    f.title,
    f.releaseYear || '',
    f.tmdbId || '',
    latestWatchedDateFor(f.id, f.added),
    getDisplayNote(f) ?? '',
    f.review || ''
  ].map(csvEscape).join(','));
  const csv = [header.join(','), ...rows].join('\r\n');

  // Limite Letterboxd de 1 Mo par fichier (voir leur page d'aide à
  // l'import) — un catalogue perso reste très en dessous en pratique,
  // pas de découpage en plusieurs fichiers nécessaire ici.
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `critique-films-letterboxd-${dateStr}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('CSV téléchargé, à importer sur letterboxd.com/import');
}

document.getElementById('exportLetterboxdBtn').addEventListener('click', exportFilmsToLetterboxd);

document.getElementById('manualToggle').addEventListener('change', updateManualVisibility);
document.getElementById('manualScoreSlider').addEventListener('input', (e) => {
  document.getElementById('manualScoreVal').textContent = parseFloat(e.target.value).toFixed(1);
  updateLiveScore();
});
document.getElementById('openAddBtn').addEventListener('click', () => openModal(null));
document.getElementById('fabAddBtn').addEventListener('click', () => openModal(null));
document.getElementById('closeModal').addEventListener('click', closeModal);
document.getElementById('cancelBtn').addEventListener('click', closeModal);
{
  const saveBtn = document.getElementById('saveBtn');
  saveBtn.addEventListener('click', withSubmitGuard(saveBtn, handleSave));
}
document.getElementById('deleteBtn').addEventListener('click', handleDelete);
document.getElementById('modalOpenFilmDetailBtn').addEventListener('click', () => {
  if(!editingId) return;
  const film = films.find(f => f.id === editingId);
  if(!film || !film.tmdbId) return;
  const navList = modalFilmNavList;
  closeModal();
  goToFilmDetail(film.tmdbId, navList);
});
document.getElementById('overlay').addEventListener('click', (e) => {
  if(e.target.id === 'overlay') closeModal();
});
document.getElementById('search').addEventListener('input', () => { currentPage = 1; render(); });

// Pastilles du panneau et filtres actifs (audit des six écrans, piste A) :
// un seul écouteur par conteneur. stopPropagation() parce que la pastille
// cliquée est redessinée tout de suite : sans ça, l'écouteur « clic hors du
// panneau » plus bas la croirait dehors et refermerait le panneau.
['filterChips', 'activeFilters'].forEach(id => {
  document.getElementById(id).addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if(!chip) return;
    e.stopPropagation();
    applyCatFilter(chip.dataset.filter);
  });
});
document.getElementById('clearFiltersBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  applyCatFilter('clear');
});
document.getElementById('applyFiltersBtn').addEventListener('click', () => closeToolbarFilters());

// --- Panneau « Trier et filtrer » — voir #toolbarFilters, index.html ---
// Fermeture manuelle seulement : ✕, tap hors du panneau, Échap ou « Voir
// les films » au téléphone. Une pastille ne le ferme pas : on enchaîne
// souvent plusieurs filtres.
function openToolbarFilters(){
  renderFilterChips();
  document.getElementById('toolbarFilters').classList.add('open');
  document.getElementById('filtersToggleBtn').setAttribute('aria-expanded', 'true');
}
function closeToolbarFilters(){
  document.getElementById('toolbarFilters').classList.remove('open');
  document.getElementById('filtersToggleBtn').setAttribute('aria-expanded', 'false');
}
document.getElementById('filtersToggleBtn').addEventListener('click', (e) => {
  e.stopPropagation(); // sans ça, le listener document ci-dessous le refermerait dans la foulée
  openToolbarFilters();
});
document.getElementById('closeToolbarFilters').addEventListener('click', closeToolbarFilters);
document.getElementById('toolbarFilters').addEventListener('click', (e) => {
  // Voile plein écran sous le seuil mobile (voir css/style.css) : taper
  // dessus (jamais sur la feuille elle-même) referme, même geste que
  // .overlay/.dropdown-menu ailleurs dans l'app.
  if(e.target.id === 'toolbarFilters') closeToolbarFilters();
});
// Repasse (retour utilisateur, "3 boutons de tri") : sur desktop/tablette,
// #toolbarFilters est un panneau ancré (pas un voile plein écran, voir
// css/style.css) — rien n'y capte plus un clic hors de la feuille pour la
// refermer à cette largeur. Même mécanique que toggleMoreMenu() juste plus
// bas (clic hors du menu OU Échap) plutôt qu'une nouvelle. Sans effet sous
// le seuil mobile : cette largeur ferme déjà via le voile ci-dessus, avant
// même que ce listener document ne s'exécute.
document.addEventListener('click', (e) => {
  if(!document.getElementById('toolbarFilters').contains(e.target)) closeToolbarFilters();
});
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape') closeToolbarFilters();
});
document.getElementById('exportBtn').addEventListener('click', exportFilms);
document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if(file) importFilms(file);
  e.target.value = ''; // permet de réimporter le même fichier
});

// --- Menu "⋯" (Exporter / Importer) ---
function toggleMoreMenu(open){
  const wrap = document.getElementById('moreMenuWrap');
  const btn = document.getElementById('moreMenuBtn');
  const isOpen = open !== undefined ? open : !wrap.classList.contains('open');
  wrap.classList.toggle('open', isOpen);
  btn.setAttribute('aria-expanded', String(isOpen));
}
document.getElementById('moreMenuBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMoreMenu();
});
document.getElementById('moreMenu').addEventListener('click', () => toggleMoreMenu(false));
document.addEventListener('click', (e) => {
  if(!document.getElementById('moreMenuWrap').contains(e.target)) toggleMoreMenu(false);
});
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape') toggleMoreMenu(false);
});

// L'initialisation (chargement des films + premier rendu) est déclenchée par
// js/auth.js une fois la session utilisateur confirmée — voir showApp().
