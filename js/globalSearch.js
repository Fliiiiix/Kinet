// --- Suggestions sous la recherche (draft du 15/10, option A validée) ---
// La recherche du catalogue (et celle des séries) ouvre une liste sous la
// pilule dès 2 lettres : en tête le meilleur résultat, quel que soit son
// type, puis des rubriques dans un ordre fixe (3 lignes chacune) : tes
// films, À voir, séries, amis, groupes, et enfin les films (ou séries) à
// ajouter depuis TMDB, à partir de 3 lettres. Barre vide : les 3 derniers
// résultats ouverts. Remplace les rubriques sous la grille et la case
// « Ajouter « … » » (audit M2) : un seul endroit pour les suggestions.
//
// Données déjà en mémoire (films chargé dès la connexion, voir js/auth.js) ;
// trackedShows/friendships/groups/watchlist chargés à la première recherche
// s'ils ne le sont pas encore, puis la liste se redessine toute seule.

let searchExtrasDataReady = false;
let searchExtrasDataLoad = null;

function ensureSearchExtrasData(){
  if(searchExtrasDataReady) return Promise.resolve();
  if(!searchExtrasDataLoad){
    searchExtrasDataLoad = Promise.all([
      trackedShows.length === 0 ? loadTrackedShows() : Promise.resolve(),
      friendships.length === 0 ? loadFriendships() : Promise.resolve(),
      groups.length === 0 ? loadGroups() : Promise.resolve(),
      watchlist.length === 0 ? loadWatchlist() : Promise.resolve()
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

const SUGGEST_PER_SECTION = 3;
const SUGGEST_TMDB_MIN = 3;
const SUGGEST_TMDB_DELAY_MS = 300;
const SUGGEST_RECENTS_KEY = 'kinetRecentResults';
const SUGGEST_RECENTS_MAX = 3;

// Une page = sa pilule, son panneau, le type qu'elle liste déjà, ses rubriques.
const SUGGEST_PAGES = {
  films: {
    input: 'search', panel: 'searchSuggest', own: 'film',
    sections: [['film', 'Tes films'], ['avoir', 'À voir'], ['serie', 'Séries'], ['ami', 'Amis'], ['groupe', 'Groupes']],
    tmdbLabel: 'À ajouter, depuis TMDB'
  },
  series: {
    input: 'seriesTitleInput', panel: 'seriesSuggest', own: 'serie',
    sections: [['serie', 'Tes séries'], ['film', 'Films'], ['avoir', 'À voir'], ['ami', 'Amis'], ['groupe', 'Groupes']],
    tmdbLabel: 'À suivre, depuis TMDB'
  }
};

// Pertinence : début du nom 3, début d'un mot 2, ailleurs 1, absent 0.
// nq est déjà normalisé (normalizeSearch(), js/app.js).
function suggestScore(name, nq){
  const n = normalizeSearch(String(name || ''));
  if(!nq || !n.includes(nq)) return 0;
  if(n.startsWith(nq)) return 3;
  let at = n.indexOf(nq);
  while(at > 0){
    if(!/[a-z0-9]/.test(n[at - 1])) return 2;
    at = n.indexOf(nq, at + 1);
  }
  return 1;
}

// Titre français ou titre d'origine (« god » trouve Le Parrain par The
// Godfather), l'original passant juste après à pertinence égale.
function suggestItemScore(title, originalTitle, nq){
  return Math.max(suggestScore(title, nq), originalTitle ? suggestScore(originalTitle, nq) - 0.5 : 0);
}

// Lettres tapées en gras, accents et casse ignorés.
function suggestHighlight(text, nq){
  const raw = String(text || '');
  if(!nq) return escapeHtml(raw);
  let flat = '';
  const map = [];
  for(let i = 0; i < raw.length; i++){
    const piece = normalizeSearch(raw[i]);
    for(let k = 0; k < piece.length; k++){ flat += piece[k]; map.push(i); }
  }
  const at = flat.indexOf(nq);
  if(at < 0) return escapeHtml(raw);
  const start = map[at];
  const end = map[at + nq.length - 1] + 1;
  return `${escapeHtml(raw.slice(0, start))}<b>${escapeHtml(raw.slice(start, end))}</b>${escapeHtml(raw.slice(end))}`;
}

// Sous-titre : l'année, précédée du titre d'origine quand c'est lui qui
// correspond (« sil » trouve Affaires non classées par Silent Witness).
function matchedSub(title, originalTitle, year, nq){
  const viaOriginal = originalTitle && suggestScore(originalTitle, nq) > suggestScore(title, nq);
  return [viaOriginal ? originalTitle : '', year ? String(year) : ''].filter(Boolean).join(' · ');
}

function showProgressLabel(show){
  if(!show.numberOfEpisodes) return showStatusLabel(show.status);
  const watched = (typeof watchedEpisodeCounts !== 'undefined' && watchedEpisodeCounts[show.id]) || 0;
  return `${watched}/${show.numberOfEpisodes} épisode${show.numberOfEpisodes > 1 ? 's' : ''} vus`;
}

// Tout ce qui correspond chez toi, avec sa pertinence. Un film à la fois
// noté et dans À voir ne sort qu'une fois, comme film noté.
function collectOwnSuggestions(nq){
  const items = [];
  films.forEach(f => {
    const s = suggestItemScore(f.title, f.originalTitle, nq);
    if(!s) return;
    const viaOriginal = f.originalTitle && suggestScore(f.originalTitle, nq) > suggestScore(f.title, nq);
    const note = getDisplayNote(f);
    items.push({ type: 'film', s, title: f.title, posterUrl: f.posterUrl,
      sub: viaOriginal ? `${f.originalTitle}${f.releaseYear ? ` · ${f.releaseYear}` : ''}` : [f.releaseYear, note === null ? 'Pas encore noté' : ''].filter(Boolean).join(' · '),
      note, ref: { id: f.id, tmdbId: f.tmdbId || null } });
  });
  const ratedTmdb = new Set(films.map(f => f.tmdbId).filter(Boolean));
  watchlist.forEach(w => {
    if(w.tmdbId && ratedTmdb.has(w.tmdbId)) return;
    const s = suggestItemScore(w.title, w.originalTitle, nq);
    if(s) items.push({ type: 'avoir', s, title: w.title, posterUrl: w.posterUrl, sub: matchedSub(w.title, w.originalTitle, w.releaseYear, nq), ref: { tmdbId: w.tmdbId || null } });
  });
  trackedShows.forEach(show => {
    const s = suggestScore(show.title, nq);
    if(s) items.push({ type: 'serie', s, title: show.title, posterUrl: show.posterUrl, sub: showProgressLabel(show), note: show.manualNote, ref: { id: show.id } });
  });
  friendships.filter(f => f.status === 'accepted').forEach(f => {
    const userId = otherUserId(f);
    const name = friendDisplayName(userId);
    const s = suggestScore(name, nq);
    if(s) items.push({ type: 'ami', s, title: name, sub: '', ref: { userId } });
  });
  groups.forEach(g => {
    const s = suggestScore(g.name, nq);
    if(s) items.push({ type: 'groupe', s, title: g.name, sub: '', ref: { id: g.id } });
  });
  return items;
}

// Résultats TMDB gardés pour la liste : jamais un film déjà chez toi (noté
// ou À voir) ni une série déjà suivie ; ceux dont le titre commence par ce
// que tu tapes d'abord, puis l'ordre de searchTmdb() (js/tmdb.js).
function tmdbSuggestions(kind, results, nq){
  const known = new Set(kind === 'films'
    ? films.map(f => f.tmdbId).concat(watchlist.map(w => w.tmdbId)).filter(Boolean)
    : trackedShows.map(s => s.tmdbId).filter(Boolean));
  return (results || [])
    .filter(r => !known.has(r.id))
    .map((r, i) => ({ r, i, s: suggestItemScore(r.title, r.original_title, nq) }))
    .sort((a, b) => ((b.s >= 3) - (a.s >= 3)) || (a.i - b.i))
    .slice(0, SUGGEST_PER_SECTION)
    .map(({ r }) => ({
      type: kind === 'films' ? 'tmdb' : 'tmdbtv',
      title: r.title,
      posterUrl: r.poster_path ? TMDB_IMG_BASE + r.poster_path : null,
      sub: matchedSub(r.title, r.original_title, r.release_year, nq),
      ref: { tmdb: r }
    }));
}

// Rubriques dans l'ordre affiché. tmdbResults : undefined tant que TMDB n'a
// pas répondu (ou sous 3 lettres), [] s'il n'a rien trouvé.
function buildSuggestions(kind, rawQuery, tmdbResults){
  const cfg = SUGGEST_PAGES[kind];
  const nq = normalizeSearch((rawQuery || '').trim());
  if(nq.length < 2) return { sections: [], ownCount: 0 };
  const own = collectOwnSuggestions(nq);
  let best = null;
  own.forEach(it => {
    if(!best || it.s > best.s || (it.s === best.s && it.type === cfg.own && best.type !== cfg.own)) best = it;
  });
  const sections = [];
  if(best) sections.push({ label: 'Meilleur résultat', top: true, items: [best] });
  cfg.sections.forEach(([type, label]) => {
    const items = own.filter(it => it !== best && it.type === type)
      .sort((a, b) => b.s - a.s)
      .slice(0, SUGGEST_PER_SECTION);
    if(items.length) sections.push({ label, items });
  });
  if(tmdbResults && nq.length >= SUGGEST_TMDB_MIN){
    const items = tmdbSuggestions(kind, tmdbResults, nq);
    if(items.length) sections.push({ label: cfg.tmdbLabel, items, tmdb: true });
  }
  return { sections, ownCount: own.filter(it => it.type === cfg.own).length };
}

// --- Derniers résultats ouverts (barre vide) --- Gardés sur cet appareil.
function getRecentResults(){
  try{
    const parsed = JSON.parse(localStorage.getItem(SUGGEST_RECENTS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  }catch(e){
    return [];
  }
}

function rememberRecentResult(item){
  if(!['film', 'avoir', 'serie', 'ami', 'groupe', 'tmdb'].includes(item.type)) return;
  // Un film TMDB ouvert revient comme un film : sa fiche, par son tmdbId.
  const entry = { type: item.type === 'tmdb' ? 'film' : item.type, title: item.title, posterUrl: item.posterUrl || null, sub: item.sub || '',
    ref: item.type === 'tmdb' ? { id: null, tmdbId: item.ref.tmdb.id } : item.ref };
  const same = (a) => a.type === entry.type && JSON.stringify(a.ref) === JSON.stringify(entry.ref);
  const next = [entry, ...getRecentResults().filter(a => !same(a))].slice(0, SUGGEST_RECENTS_MAX);
  try{ localStorage.setItem(SUGGEST_RECENTS_KEY, JSON.stringify(next)); }catch(e){}
}

// --- Ouvrir un résultat ---
function openSuggestion(item){
  rememberRecentResult(item);
  const ref = item.ref || {};
  if(item.type === 'film'){ if(ref.tmdbId) goToFilmDetail(ref.tmdbId); else openModal(ref.id); return; }
  if(item.type === 'avoir'){ if(ref.tmdbId) goToFilmDetail(ref.tmdbId); else goToWatchlist(); return; }
  if(item.type === 'tmdb'){ goToFilmDetail(ref.tmdb.id); return; }
  if(item.type === 'tmdbtv'){ selectSeriesTmdbResult(ref.tmdb); return; }
  if(item.type === 'serie'){ goToSeriesDetail(ref.id); return; }
  if(item.type === 'ami'){ openFriendProfile(ref.userId); return; }
  if(item.type === 'groupe'){ goToGroup(ref.id); }
}

// --- Le panneau ---
const suggestState = { kind: null, open: false, rows: [], active: -1 };
const suggestTmdbCache = new Map(); // 'films:god' -> résultats searchTmdb()
let suggestTmdbTimer = null;

function suggestVisualHtml(item){
  if(item.type === 'ami'){
    const avatar = friendAvatarUrl(item.ref.userId);
    return avatar ? `<img class="sg-face" src="${avatar}" alt="" loading="lazy">` : `<span class="sg-face">${uiIcon('user')}</span>`;
  }
  if(item.type === 'groupe') return `<span class="sg-glyph">${uiIcon('group')}</span>`;
  const placeholder = (item.type === 'serie' || item.type === 'tmdbtv') ? TV_PLACEHOLDER_SVG : FILM_PLACEHOLDER_SVG;
  return item.posterUrl ? `<img class="sg-thumb" src="${item.posterUrl}" alt="" loading="lazy">` : `<span class="sg-thumb">${placeholder}</span>`;
}

function suggestRowHtml(item, nq, index){
  const right = (typeof item.note === 'number')
    ? `<span class="sg-note ${noteColorClass(item.note)}">${item.note.toFixed(1)}</span>`
    : (item.type === 'tmdb' || item.type === 'tmdbtv') ? `<span class="sg-add" aria-hidden="true">+</span>` : '';
  return `
    <div class="sg-row${suggestState.active === index ? ' is-active' : ''}" role="option" id="sg-opt-${index}" data-index="${index}" aria-selected="${suggestState.active === index}">
      ${suggestVisualHtml(item)}
      <span class="sg-main">
        <span class="sg-title">${suggestHighlight(item.title, nq)}</span>
        ${item.sub ? `<span class="sg-sub">${escapeHtml(item.sub)}</span>` : ''}
      </span>
      ${right}
    </div>`;
}

function renderSuggestPanel(kind){
  const cfg = SUGGEST_PAGES[kind];
  const panel = document.getElementById(cfg.panel);
  const input = document.getElementById(cfg.input);
  if(!panel || !input) return;
  const raw = input.value.trim();
  const nq = normalizeSearch(raw);
  const rows = [];
  let html = '';

  if(nq.length === 0){
    const recents = getRecentResults();
    if(recents.length === 0){ closeSuggestPanel(); return; }
    html += `<div class="sg-label">Récents</div>`;
    recents.forEach(item => { html += suggestRowHtml(item, '', rows.length); rows.push({ item }); });
  }else if(nq.length < 2){
    html += `<div class="sg-empty">Continue à taper…</div>`;
  }else{
    const cacheKey = `${kind}:${nq}`;
    const tmdbPending = nq.length >= SUGGEST_TMDB_MIN && !suggestTmdbCache.has(cacheKey);
    const { sections, ownCount } = buildSuggestions(kind, raw, suggestTmdbCache.get(cacheKey));
    sections.forEach(section => {
      html += `<div class="${section.top ? 'sg-top' : ''}"><div class="sg-label">${section.label}</div>`;
      section.items.forEach(item => { html += suggestRowHtml(item, nq, rows.length); rows.push({ item }); });
      html += `</div>`;
    });
    if(tmdbPending) html += `<div class="sg-empty">Recherche sur TMDB…</div>`;
    // Côté films, TMDB n'est pas une autocomplétion (« god » ne donne pas
    // Godzilla) : la recherche complète de la notation reste à un clic.
    if(kind === 'films' && nq.length >= SUGGEST_TMDB_MIN && !tmdbPending){
      html += `<div class="sg-more" role="option" id="sg-opt-${rows.length}" data-index="${rows.length}" aria-selected="${suggestState.active === rows.length}">Plus de films « ${escapeHtml(raw)} » sur TMDB</div>`;
      rows.push({ action: () => openAddFromSearch(raw) });
    }
    if(sections.length === 0 && !tmdbPending && !(kind === 'films' && nq.length >= SUGGEST_TMDB_MIN)){
      html += `<div class="sg-empty">Rien chez toi pour « ${escapeHtml(raw)} ».${nq.length < SUGGEST_TMDB_MIN ? ' Une lettre de plus pour chercher sur TMDB.' : ''}</div>`;
    }
    if(ownCount > 0){
      const what = kind === 'films'
        ? (ownCount > 1 ? `tes ${ownCount} films dans la grille` : 'ton film dans la grille')
        : (ownCount > 1 ? `tes ${ownCount} séries dans la liste` : 'ta série dans la liste');
      html += `<div class="sg-more sg-grid" role="option" id="sg-opt-${rows.length}" data-index="${rows.length}" aria-selected="${suggestState.active === rows.length}">Voir ${what}</div>`;
      rows.push({ action: () => closeSuggestPanel() });
    }
  }
  html += `<div class="sg-hint" aria-hidden="true"><span><kbd>↑</kbd> <kbd>↓</kbd> choisir</span><span><kbd>Entrée</kbd> ouvrir</span><span><kbd>Échap</kbd> fermer</span></div>`;

  suggestState.kind = kind;
  suggestState.open = true;
  suggestState.rows = rows;
  if(suggestState.active >= rows.length) suggestState.active = -1;
  panel.innerHTML = html;
  panel.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  if(suggestState.active >= 0) input.setAttribute('aria-activedescendant', `sg-opt-${suggestState.active}`);
  else input.removeAttribute('aria-activedescendant');
}

function closeSuggestPanel(){
  Object.values(SUGGEST_PAGES).forEach(cfg => {
    const panel = document.getElementById(cfg.panel);
    const input = document.getElementById(cfg.input);
    if(panel){ panel.hidden = true; panel.innerHTML = ''; }
    if(input){ input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
  });
  suggestState.open = false;
  suggestState.rows = [];
  suggestState.active = -1;
}

function chooseSuggestion(index){
  const row = suggestState.rows[index];
  if(!row) return;
  const kind = suggestState.kind;
  closeSuggestPanel();
  if(row.action){ row.action(); return; }
  const input = kind && document.getElementById(SUGGEST_PAGES[kind].input);
  if(input) input.blur();
  openSuggestion(row.item);
}

function scheduleSuggestTmdb(kind, raw){
  clearTimeout(suggestTmdbTimer);
  const nq = normalizeSearch(raw);
  const cacheKey = `${kind}:${nq}`;
  if(nq.length < SUGGEST_TMDB_MIN || suggestTmdbCache.has(cacheKey)) return;
  suggestTmdbTimer = setTimeout(async () => {
    let results = [];
    try{
      results = kind === 'films' ? await searchTmdb(raw) : await searchTmdbTv(raw);
    }catch(e){
      console.error(e);
    }
    suggestTmdbCache.set(cacheKey, results || []);
    const input = document.getElementById(SUGGEST_PAGES[kind].input);
    if(suggestState.open && suggestState.kind === kind && input && normalizeSearch(input.value.trim()) === nq) renderSuggestPanel(kind);
  }, SUGGEST_TMDB_DELAY_MS);
}

function refreshSuggestions(kind){
  const input = document.getElementById(SUGGEST_PAGES[kind].input);
  if(!input) return;
  suggestState.active = -1;
  const raw = input.value.trim();
  renderSuggestPanel(kind);
  scheduleSuggestTmdb(kind, raw);
  if(!searchExtrasDataReady && normalizeSearch(raw).length >= 2){
    ensureSearchExtrasData().then(() => {
      if(searchExtrasDataReady && suggestState.open && suggestState.kind === kind) renderSuggestPanel(kind);
    });
  }
}

function onSuggestKeydown(kind, e){
  if(e.key === 'Escape'){
    if(suggestState.open){ e.preventDefault(); closeSuggestPanel(); }
    return;
  }
  if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
    if(!suggestState.open || suggestState.kind !== kind) refreshSuggestions(kind);
    const n = suggestState.rows.length;
    if(!n) return;
    e.preventDefault();
    suggestState.active = e.key === 'ArrowDown'
      ? (suggestState.active + 1) % n
      : (suggestState.active <= 0 ? n - 1 : suggestState.active - 1);
    renderSuggestPanel(kind);
    const el = document.getElementById(`sg-opt-${suggestState.active}`);
    if(el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    return;
  }
  if(e.key === 'Enter'){
    if(suggestState.open && suggestState.active >= 0){
      e.preventDefault();
      chooseSuggestion(suggestState.active);
    }else if(suggestState.open){
      // Entrée sans rien choisir : la liste se ferme, la grille reste filtrée.
      e.preventDefault();
      closeSuggestPanel();
    }
  }
}

Object.keys(SUGGEST_PAGES).forEach(kind => {
  const cfg = SUGGEST_PAGES[kind];
  const input = document.getElementById(cfg.input);
  const panel = document.getElementById(cfg.panel);
  if(!input || !panel) return;
  input.setAttribute('aria-controls', cfg.panel);
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-autocomplete', 'list');
  input.addEventListener('input', () => refreshSuggestions(kind));
  input.addEventListener('focus', () => refreshSuggestions(kind));
  input.addEventListener('keydown', (e) => onSuggestKeydown(kind, e));
  // Le clic dans la liste ne doit pas retirer le focus de la pilule avant
  // d'avoir choisi ; la liste se ferme quand on clique ailleurs.
  input.addEventListener('blur', () => setTimeout(() => {
    if(suggestState.kind === kind && document.activeElement !== input) closeSuggestPanel();
  }, 150));
  panel.addEventListener('mousedown', (e) => e.preventDefault());
  panel.addEventListener('click', (e) => {
    const row = e.target.closest('[data-index]');
    if(row) chooseSuggestion(parseInt(row.dataset.index, 10));
  });
});

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
