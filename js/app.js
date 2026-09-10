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

// Options de #sortCriterion, générées depuis CRITERIA (js/data.js) plutôt
// que dupliquées à la main dans index.html — évite le décalage si un
// critère est renommé/ajouté un jour.
function buildSortOptions(){
  document.getElementById('sortCriterion').innerHTML = CRITERIA
    .map(c => `<option value="${c.key}">${escapeHtml(c.label)}</option>`)
    .join('');
}

// Options de #genreFilter (v2.1, retour utilisateur), reconstruites à
// chaque mutation du catalogue (chargement, ajout/édition/suppression,
// import) — seulement les genres RÉELLEMENT présents (pas la liste TMDB
// complète, voir GENRE_MAP dans js/data.js) : pas la peine de proposer
// "Western" à quelqu'un qui n'a aucun film de ce genre. Sélection
// existante restaurée si le genre choisi est toujours représenté.
// Valeur spéciale de #genreFilter, PAS un vrai genre (voir GENRE_MAP,
// js/data.js — les ids TMDB sont toujours des entiers positifs, jamais
// cette chaîne) : rattrapage des films vus mais jamais notés (retour
// utilisateur — notamment ceux importés via watched.csv de Letterboxd,
// voir js/importExternal.js, qui n'a justement aucune note à donner).
// "Jamais noté" = getDisplayNote() renvoie null, peu importe la raison
// (import sans note, ou simplement pas encore noté) — un seul critère
// déjà utilisé partout ailleurs dans l'app plutôt qu'un nouveau champ.
const UNRATED_FILTER_VALUE = '__unrated__';

function buildGenreFilterOptions(){
  const sel = document.getElementById('genreFilter');
  const current = sel.value;
  const present = new Set();
  films.forEach(f => (f.genreIds || []).forEach(id => present.add(id)));
  const options = Array.from(present)
    .filter(id => GENRE_MAP[id])
    .sort((a, b) => GENRE_MAP[a].localeCompare(GENRE_MAP[b], 'fr'))
    .map(id => `<option value="${id}">${escapeHtml(GENRE_MAP[id])}</option>`)
    .join('');
  const unratedCount = films.filter(f => getDisplayNote(f) === null).length;
  // N'apparaît que s'il y a effectivement quelque chose à rattraper —
  // sinon une option qui ne mène jamais nulle part n'a rien à faire là.
  const unratedOption = unratedCount > 0
    ? `<option value="${UNRATED_FILTER_VALUE}">⚠ Sans note (${unratedCount})</option>`
    : '';
  sel.innerHTML = `<option value="">Tous les genres</option>${unratedOption}${options}`;
  if(current === UNRATED_FILTER_VALUE && unratedCount > 0) sel.value = current;
  else if(current && present.has(Number(current))) sel.value = current;
  // buildYearFilterOptions() (juste en dessous) doit être reconstruite
  // exactement aux mêmes moments que ce select (toute mutation du
  // catalogue) — appelée ici plutôt que dupliquée aux ~9 sites d'appel de
  // buildGenreFilterOptions() (auth.js, handleSave/handleDelete/import
  // Letterboxd/Trakt/watchlist...), pour ne jamais risquer que les deux
  // dérivent l'une de l'autre.
  buildYearFilterOptions();
}

// Options de #yearFilter (retour utilisateur : "Filtre catalogue par
// année/décennie") — même principe que buildGenreFilterOptions() : seules
// les années RÉELLEMENT présentes au catalogue, groupées par décennie
// (<optgroup>) pour rester lisible même avec 30-40 années différentes
// plutôt qu'une liste plate à faire défiler. Le filtre lui-même reste sur
// une année exacte (pas un bucket "2020s") — une décennie n'est ici qu'un
// regroupement visuel du <select>, pas une valeur de filtre à part.
function buildYearFilterOptions(){
  const sel = document.getElementById('yearFilter');
  const current = sel.value;
  const years = new Set();
  films.forEach(f => { if(f.releaseYear) years.add(f.releaseYear); });
  const decades = new Map(); // début de décennie (ex. 2020) -> [années]
  Array.from(years).sort((a, b) => b - a).forEach(y => {
    const decadeStart = Math.floor(y / 10) * 10;
    if(!decades.has(decadeStart)) decades.set(decadeStart, []);
    decades.get(decadeStart).push(y);
  });
  const optgroups = Array.from(decades.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([decadeStart, ys]) => `
      <optgroup label="${decadeStart}s">
        ${ys.map(y => `<option value="${y}">${y}</option>`).join('')}
      </optgroup>
    `).join('');
  sel.innerHTML = `<option value="">Toutes les années</option>${optgroups}`;
  if(current && years.has(Number(current))) sel.value = current;
}

// Sens du tri par critère (#sortAdvancedRow) — bouton-bascule plutôt qu'un
// 2e select, voir setSortDir() plus bas.
let sortDir = 'desc';

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

function render(){
  const list = document.getElementById('filmList');
  const countLine = document.getElementById('countLine');
  const search = normalizeSearch(document.getElementById('search').value.trim());
  const sortBy = document.getElementById('sortBy').value;
  const isAdvanced = sortBy === 'advanced';
  const critKey = isAdvanced ? document.getElementById('sortCriterion').value : null;
  const critFilterMin = isAdvanced ? parseFloat(document.getElementById('critFilterMin').value) : 0;
  const genreFilter = document.getElementById('genreFilter').value;
  const yearFilter = document.getElementById('yearFilter').value;

  // Point d'état sur le bouton Filtres (v2.1.x, mobile — voir index.html) :
  // seul indice qu'un tri/genre/année non-défaut est actif une fois la
  // feuille repliée, tri "note-desc" étant la valeur par défaut de #sortBy.
  document.getElementById('filtersToggleBtn').classList.toggle('has-active-filter', sortBy !== 'note-desc' || !!genreFilter || !!yearFilter);
  renderBulkActionsBar();

  // Matche le titre FR ou le titre VO (ex. "créatures féroces" trouve aussi
  // "Fierce Creatures"), accents/casse ignorés — voir getSearchTerms().
  let filtered = films.filter(f => !search || getSearchTerms(f).some(t => t.includes(search)));

  // Filtre genre (v2.1, retour utilisateur) — voir buildGenreFilterOptions()
  // plus haut et GENRE_MAP (js/data.js). "Sans note" (retour utilisateur,
  // rattrapage des films vus non notés) partage le même <select> mais n'est
  // pas un genre — vérifié en premier, avant de traiter genreFilter comme
  // un id TMDB.
  if(genreFilter === UNRATED_FILTER_VALUE){
    filtered = filtered.filter(f => getDisplayNote(f) === null);
  }else if(genreFilter){
    const genreId = Number(genreFilter);
    filtered = filtered.filter(f => (f.genreIds || []).includes(genreId));
  }

  // Filtre année (retour utilisateur : "Filtre catalogue par
  // année/décennie") — voir buildYearFilterOptions() plus haut.
  if(yearFilter){
    const year = Number(yearFilter);
    filtered = filtered.filter(f => f.releaseYear === year);
  }

  // Seuil sur le critère en cours de tri (voir #sortAdvancedRow) — un film
  // noté en note manuelle n'a pas cette valeur (crit vide) et sort donc du
  // lot dès que le seuil dépasse 0, pas juste mal classé.
  if(isAdvanced && critFilterMin > 0){
    filtered = filtered.filter(f => typeof f.crit[critKey] === 'number' && f.crit[critKey] >= critFilterMin);
  }

  filtered.sort((a,b) => {
    if(isAdvanced){
      const av = typeof a.crit[critKey] === 'number' ? a.crit[critKey] : -1;
      const bv = typeof b.crit[critKey] === 'number' ? b.crit[critKey] : -1;
      return sortDir === 'desc' ? bv - av : av - bv;
    }
    if(sortBy === 'note-desc') return (getDisplayNote(b)||0) - (getDisplayNote(a)||0);
    if(sortBy === 'note-asc') return (getDisplayNote(a)||0) - (getDisplayNote(b)||0);
    if(sortBy === 'title-asc') return a.title.localeCompare(b.title, 'fr');
    if(sortBy === 'fav-first') return (b.fav - a.fav) || ((getDisplayNote(b)||0) - (getDisplayNote(a)||0));
    if(sortBy === 'recent') return b.added - a.added;
    return 0;
  });

  const isFiltered = !!search || !!genreFilter || !!yearFilter || (isAdvanced && critFilterMin > 0);
  countLine.textContent = `${filtered.length} film${filtered.length>1?'s':''} ${isFiltered ? '(filtré)' : 'au catalogue'}`;

  if(filtered.length === 0){
    list.innerHTML = `<div class="empty-state">Aucun film. Clique sur « + Ajouter un film » pour commencer ton catalogue.</div>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / FILMS_PER_PAGE));
  currentPage = Math.min(Math.max(1, currentPage), totalPages);
  const pageItems = filtered.slice((currentPage - 1) * FILMS_PER_PAGE, currentPage * FILMS_PER_PAGE);

  list.innerHTML = '';
  pageItems.forEach(f => {
    const note = getDisplayNote(f);
    const isManual = f.manualNote != null;
    const rewatches = typeof rewatchCount === 'function' ? rewatchCount(f.id) : 0;
    const happening = getClickHappeningForFilm(f);
    const row = document.createElement('div');
    row.className = 'film-row';
    row.dataset.id = f.id; // cible du pulse de sauvegarde (voir handleSave()) et du pulse favori ci-dessous
    // Genres visibles direct sur la fiche (v2.1, retour utilisateur, avant
    // même le filtre #genreFilter) — 2 maximum, assez pour situer le film
    // sans allonger la ligne indéfiniment (certains en ont 4-5 sur TMDB).
    const genres = (f.genreIds || []).map(id => GENRE_MAP[id]).filter(Boolean).slice(0, 2).join(', ');
    // Genre en bronze (v2.8, retour utilisateur — "où est la couleur ?") :
    // seul segment de .film-sub à sortir du gris muet, sur la ligne la
    // plus vue de toute l'app (le catalogue).
    // "7 critères notés" supposait à tort qu'un film non manuel avait
    // forcément sa grille remplie — faux pour un import watched.csv
    // (Letterboxd, voir js/importExternal.js), qui crée le film avec
    // crit:{} (aucune note du tout, pas même partielle) : chaque ligne du
    // nouveau filtre "Sans note" (retour utilisateur) affichait pourtant
    // "7 critères notés", trompeur. note === null (ni manuelle, ni grille
    // remplie) couvre les deux raisons possibles d'absence de note.
    const critLabel = note === null ? 'Pas encore noté' : (isManual ? 'Note manuelle · ancien référentiel' : '7 critères notés');
    const sub = critLabel + (f.releaseYear ? ` · ${f.releaseYear}` : '') + (genres ? ` · <span class="film-sub-genre">${genres}</span>` : '');
    row.innerHTML = `
      <div class="holes"><span></span><span></span><span></span></div>
      ${bulkSelectMode ? `<input type="checkbox" class="bulk-select-checkbox" data-id="${f.id}" aria-label="Sélectionner ${escapeHtml(f.title)}" ${selectedFilmIds.has(f.id) ? 'checked' : ''}>` : ''}
      ${f.posterUrl
        ? `<img class="film-poster" src="${f.posterUrl}" alt="" loading="lazy">`
        : `<div class="film-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="film-main">
        <div class="film-title">${escapeHtml(f.title)}${isManual ? '<span class="manual-badge" title="Note manuelle (référentiel différent)">manuel</span>' : ''}${f.review ? '<span class="review-badge" title="Commentaire enregistré">💬</span>' : ''}${rewatches > 1 ? `<span class="rewatch-badge" title="Revu ${rewatches} fois">↻ ×${rewatches}</span>` : ''}${happening ? `<button class="happening-badge" type="button" title="Un petit quelque chose à découvrir..." aria-label="Un petit quelque chose à découvrir...">${happening.icon}</button>` : ''}</div>
        <div class="film-sub">${sub}</div>
      </div>
      <button class="star-btn ${f.fav ? 'active' : ''}" data-id="${f.id}" type="button" title="Favori" aria-label="${f.fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}" aria-pressed="${f.fav}">${f.fav ? '★' : '☆'}</button>
      <div class="counter ${noteColorClass(note)}">${note !== null ? note.toFixed(1) : '—'}</div>
    `;
    makeRowClickable(row, (e) => {
      if(e.target.classList.contains('star-btn')) return;
      if(e.target.classList.contains('bulk-select-checkbox')) return; // déjà géré par son propre listener 'change' ci-dessous
      // Actions groupées (retour utilisateur) : en mode sélection, la ligne
      // entière coche/décoche au lieu d'ouvrir la fiche — cocher UN PAR UN
      // 50 films avec une case minuscule serait pénible, toute la ligne
      // (déjà cliquable) est une cible bien plus grande.
      if(bulkSelectMode){ toggleFilmSelection(f.id); render(); return; }
      openModal(f.id);
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

  renderPagination(totalPages);
}

function renderPagination(totalPages){
  const el = document.getElementById('pagination');
  if(totalPages <= 1){
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <button class="btn secondary" id="pagePrev" ${currentPage === 1 ? 'disabled' : ''}>← Précédent</button>
    <span class="pagination-label">Page ${currentPage} / ${totalPages}</span>
    <button class="btn secondary" id="pageNext" ${currentPage === totalPages ? 'disabled' : ''}>Suivant →</button>
  `;
  document.getElementById('pagePrev').addEventListener('click', () => {
    currentPage--;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.getElementById('pageNext').addEventListener('click', () => {
    currentPage++;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
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

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function buildCriteriaInputs(critObj){
  const wrap = document.getElementById('criteriaWrap');
  wrap.innerHTML = '';
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
        <input type="number" class="crit-val" id="val-${c.key}" data-key="${c.key}" min="0" max="1" step="0.05" value="${val.toFixed(2)}" inputmode="decimal">
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
      document.getElementById('val-' + input.dataset.key).value = parseFloat(input.value).toFixed(2);
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
      let v = parseFloat(input.value);
      if(isNaN(v)) v = parseFloat(slider().value);
      v = Math.min(1, Math.max(0, v));
      if(clampDisplay) input.value = v.toFixed(2);
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
  hero.className = 'counter crit-dial-hero-counter ' + noteColorClass(note);
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
function openModal(id, prefillTmdb){
  if(blockIfOffline()) return; // js/offline.js — lecture seule hors ligne
  editingId = id || null;
  // Repart d'une conversion watchlist propre à chaque ouverture — seule
  // startRatingFromWatchlist() (js/watchlist.js) la positionne ensuite.
  convertingFromWatchlistId = null;
  const film = id ? films.find(f => f.id === id) : null;
  const manualNote = film && film.manualNote != null ? film.manualNote : null;

  document.getElementById('modalTitle').textContent = film ? 'Modifier le film' : 'Nouveau film';
  document.getElementById('titleInput').value = film ? film.title : (prefillTmdb ? prefillTmdb.title : '');
  document.getElementById('deleteBtn').style.display = film ? 'inline-block' : 'none';

  document.getElementById('manualToggle').checked = manualNote !== null;
  const sliderVal = manualNote !== null ? manualNote : 2.5;
  document.getElementById('manualScoreSlider').value = sliderVal;
  document.getElementById('manualScoreVal').textContent = sliderVal.toFixed(2);

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

  openOverlay('overlay');
  document.getElementById('titleInput').focus();
  // Happenings "dwell" (ex. The Whale) : se déclenchent en restant un
  // moment sur la fiche d'un film précis — voir js/happenings.js.
  startDwellWatch(film);
}

function closeModal(){
  closeOverlay('overlay', () => {
    editingId = null;
    convertingFromWatchlistId = null;
    clearDwellWatch();
  });
}

async function handleSave(){
  const title = document.getElementById('titleInput').value.trim();
  if(!title){
    showToast('Ajoute un titre avant d\'enregistrer');
    return;
  }
  const manual = isManualMode();
  // En mode manuel, la grille n'est pas utilisée : crit vide, note = manual_note.
  const crit = manual ? {} : readCriteriaFromForm();
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
      .update({ title, crit, manual_note: manualNote, review, ...tmdbFields })
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
  }else{
    const { data, error } = await supabaseClient
      .from('films')
      .insert({ title, crit, fav: false, added: Date.now(), manual_note: manualNote, review, ...tmdbFields })
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
    await addViewing(data.id, data.added);

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
  showToast('Film enregistré');
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
  document.getElementById('manualScoreVal').textContent = parseFloat(e.target.value).toFixed(2);
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
document.getElementById('overlay').addEventListener('click', (e) => {
  if(e.target.id === 'overlay') closeModal();
});
document.getElementById('search').addEventListener('input', () => { currentPage = 1; render(); });

// Le sélecteur avancé (#sortAdvancedRow : critère, sens, seuil) n'a de sens
// qu'en mode "Par critère…" — masqué et remis à zéro sinon, pour ne pas
// laisser un filtre invisible actif après être revenu à "Note globale".
function updateSortMode(){
  const active = document.getElementById('sortBy').value === 'advanced';
  document.getElementById('sortAdvancedRow').style.display = active ? '' : 'none';
  if(!active){
    sortDir = 'desc';
    document.getElementById('sortDirDesc').classList.add('active');
    document.getElementById('sortDirDesc').setAttribute('aria-pressed', 'true');
    document.getElementById('sortDirAsc').classList.remove('active');
    document.getElementById('sortDirAsc').setAttribute('aria-pressed', 'false');
    document.getElementById('critFilterMin').value = 0;
    document.getElementById('critFilterMinVal').textContent = '0.00';
  }
}
document.getElementById('sortBy').addEventListener('change', () => {
  currentPage = 1;
  updateSortMode();
  render();
});
document.getElementById('sortCriterion').addEventListener('change', () => { currentPage = 1; render(); });
document.getElementById('genreFilter').addEventListener('change', () => { currentPage = 1; render(); });
document.getElementById('yearFilter').addEventListener('change', () => { currentPage = 1; render(); });

// --- Feuille Filtres (v2.1.x, mobile) — voir #toolbarFilters, index.html ---
// #sortBy/#genreFilter eux-mêmes gardent leurs listeners ci-dessus tels
// quels (choisir une option ferme le picker natif mais pas cette feuille).
// Fermeture manuelle seulement : bouton ✕ ou tap hors de la feuille,
// jamais automatique au changement d'un select — "Par critère…" révèle
// #sortAdvancedRow qui vit sous la toolbar, PAS dans cette feuille (prend
// toute la largeur sur sa propre ligne, voir index.html) : se fermer tout
// seul à ce moment-là masquerait le résultat au lieu de le montrer.
function openToolbarFilters(){
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
function setSortDir(dir){
  sortDir = dir;
  document.getElementById('sortDirDesc').classList.toggle('active', dir === 'desc');
  document.getElementById('sortDirDesc').setAttribute('aria-pressed', String(dir === 'desc'));
  document.getElementById('sortDirAsc').classList.toggle('active', dir === 'asc');
  document.getElementById('sortDirAsc').setAttribute('aria-pressed', String(dir === 'asc'));
  currentPage = 1;
  render();
}
document.getElementById('sortDirDesc').addEventListener('click', () => setSortDir('desc'));
document.getElementById('sortDirAsc').addEventListener('click', () => setSortDir('asc'));
document.getElementById('critFilterMin').addEventListener('input', (e) => {
  document.getElementById('critFilterMinVal').textContent = parseFloat(e.target.value).toFixed(2);
  currentPage = 1;
  render();
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
