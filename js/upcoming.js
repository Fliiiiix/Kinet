// --- Bientôt (#/prochainement) ---
// Audit et draft du 15/10, piste A « fil par échéance » validée avec « Au
// cinéma ». Une liste qui se lit de haut en bas :
//   À rattraper : séries où tu as du retard, avec le prochain épisode à voir
//     (le même que « À suivre » sur la fiche) ;
//   Déjà là : épisodes sortis ces deux derniers mois alors que tu étais à jour,
//     films d'À voir sortis depuis deux mois (avec la plateforme quand il y
//     en a une) ;
//   Cette semaine, Plus tard : prochains épisodes (TMDB
//     `next_episode_to_air`) et films d'À voir pas encore sortis ;
//   En attente d'une date : séries en cours sans prochain épisode daté ;
//   Au cinéma : sorties en salle en France (TMDB), avec « + À voir ».
// Le calendrier reste en option (bascule liste / calendrier) à la place de
// « Cette semaine » et « Plus tard ». Les séries terminées vivent sur la
// page Séries (renderTrackedShows(), js/series.js).
//
// Dépend de watchlist.js ET series.js (chargés avant, voir index.html) :
// réutilise leurs tableaux déjà chargés et les recharge si vides (accès
// direct par URL).

let upcomingSoon = [];      // à venir, trié par date : [{ type, key, title, posterUrl, date, dateObj, sub, showId?, tmdbId? }]
let upcomingNow = [];       // déjà là, le plus récent d'abord
let upcomingLate = [];      // à rattraper : séries où tu as du retard, la plus récemment sortie d'abord
let upcomingWaiting = [];   // séries en cours sans date
let upcomingCinema = [];    // au cinéma : résultats TMDB + why
let upcomingCinemaAdded = new Set(); // tmdb ids ajoutés à À voir depuis cette page
let upcomingCinemaCache = null;      // { t, results } : /movie/upcoming, gardé une heure

const UPCOMING_RECENT_DAYS = 60;
const UPCOMING_WEEK_DAYS = 7;
const UPCOMING_CINEMA_DAYS = 45;
const UPCOMING_CINEMA_MAX = 6;
const UPCOMING_CINEMA_TTL_MS = 60 * 60 * 1000;
const UPCOMING_DAY_MS = 24 * 60 * 60 * 1000;

function getUpcomingViewMode(){
  return localStorage.getItem('kinetUpcomingView') === 'calendar' ? 'calendar' : 'list';
}
let upcomingCalMonth = null; // Date au 1er du mois affiché par le calendrier

// --- Dates lisibles ---
function upcomingToday(){
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function upcomingParseDay(iso){
  return new Date(iso + 'T00:00:00');
}
function upcomingDaysBetween(from, to){
  return Math.round((to - from) / UPCOMING_DAY_MS);
}
const upcomingCap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// « Sam. 17 oct. » cette année, « 8 juil. 2027 » au-delà.
function upcomingFutureLabel(d, today){
  const dm = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  if(d.getFullYear() !== today.getFullYear()) return `${dm} ${d.getFullYear()}`;
  return `${upcomingCap(d.toLocaleDateString('fr-FR', { weekday: 'short' }))} ${dm}`;
}
// « 10 oct. » cette année, « 20 mars 2025 » avant.
function upcomingPastLabel(d, today){
  const dm = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return d.getFullYear() === today.getFullYear() ? dm : `${dm} ${d.getFullYear()}`;
}
function upcomingRelFuture(days){
  if(days <= 0) return 'aujourd’hui';
  if(days === 1) return 'demain';
  if(days < 14) return `dans ${days} jours`;
  if(days < 60) return `dans ${Math.round(days / 7)} semaines`;
  return `dans ${Math.round(days / 30)} mois`;
}
function upcomingRelPast(days){
  if(days <= 0) return 'aujourd’hui';
  if(days === 1) return 'hier';
  if(days < 14) return `il y a ${days} jours`;
  return `il y a ${Math.round(days / 7)} semaines`;
}
const upcomingEpisodeLabel = (season, episode) => `Saison ${season}, épisode ${episode}`;

// Épisodes cochés, par série : showId -> Set("saison-épisode"). null si la
// lecture échoue (hors ligne) : « Déjà là » se passe alors des séries.
async function loadWatchedEpisodeKeys(){
  const { data, error } = await supabaseClient
    .from('tv_episodes_watched')
    .select('tv_show_id, season_number, episode_number');
  if(error){ console.error(error); return null; }
  const byShow = new Map();
  (data || []).forEach(r => {
    if(!byShow.has(r.tv_show_id)) byShow.set(r.tv_show_id, new Set());
    byShow.get(r.tv_show_id).add(`${r.season_number}-${r.episode_number}`);
  });
  return byShow;
}

// Retard sur une série : le premier épisode sorti pas coché (le même que
// « À suivre » sur la fiche, nextEpisodeToWatch(), js/series.js) et le
// nombre d'épisodes sortis pas cochés. Sorti = pas après last_episode_to_air.
// null si tout ce qui est sorti est vu, ou si les épisodes cochés sont
// inconnus (hors ligne).
function showBacklog(details, watched){
  const last = details.last_episode_to_air;
  if(!last || !watched) return null;
  const seasons = (details.seasons || []).filter(s => s.season_number > 0)
    .sort((a, b) => a.season_number - b.season_number);
  let next = null;
  let count = 0;
  seasons.forEach(s => {
    for(let ep = 1; ep <= (s.episode_count || 0); ep++){
      const aired = s.season_number < last.season_number || (s.season_number === last.season_number && ep <= last.episode_number);
      if(!aired || watched.has(`${s.season_number}-${ep}`)) continue;
      if(!next) next = { s: s.season_number, e: ep };
      count++;
    }
  });
  return next ? { next, count } : null;
}

// Classe une série en cours à partir de sa fiche TMDB : à rattraper (du
// retard), déjà là (sorti récemment alors que tu étais à jour), à venir
// (prochain épisode daté), en attente. Audit général du 16/10, I7 piste A :
// Silo annonçait « Saison 3 en entier » quand la fiche disait « À suivre :
// saison 2, épisode 1 ».
function classifyShow(show, details, watched, today){
  const out = { late: null, now: null, soon: null, waiting: null };
  const last = details.last_episode_to_air;
  const next = details.next_episode_to_air;
  const base = { showId: show.id, title: show.title, posterUrl: show.posterUrl };
  const backlog = showBacklog(details, watched);
  if(backlog && last.air_date){
    const d = upcomingParseDay(last.air_date);
    const ago = upcomingDaysBetween(d, today);
    const season = (details.seasons || []).find(s => s.season_number === last.season_number);
    const seasonDone = !!(season && season.episode_count && last.episode_number >= season.episode_count);
    // À jour avant la dernière sortie : seul le dernier épisode manque, ou
    // toute la dernière saison, sortie d'un coup et pas commencée.
    const onlyLast = backlog.count === 1 && backlog.next.s === last.season_number && backlog.next.e === last.episode_number;
    const seasonUnseen = seasonDone && backlog.next.s === last.season_number && backlog.next.e === 1 && backlog.count === season.episode_count;
    if((onlyLast || seasonUnseen) && ago >= 0 && ago <= UPCOMING_RECENT_DAYS){
      out.now = Object.assign({ type: 'episode', key: `now-show-${show.id}`, dateObj: d,
        sub: seasonUnseen ? `Saison ${last.season_number} en entier, ${season.episode_count} épisode${season.episode_count > 1 ? 's' : ''}` : upcomingEpisodeLabel(last.season_number, last.episode_number),
        when: `${seasonUnseen ? 'Depuis le' : 'Sorti le'} ${upcomingPastLabel(d, today)}`,
        rel: seasonUnseen ? 'saison terminée' : upcomingRelPast(ago) }, base);
    }else{
      const started = watched.size > 0;
      out.late = Object.assign({ type: 'episode', key: `late-show-${show.id}`, lastDate: d.getTime(),
        sub: `${upcomingEpisodeLabel(backlog.next.s, backlog.next.e)} · ${started
          ? `${backlog.count} épisode${backlog.count > 1 ? 's' : ''} de retard`
          : 'pas encore commencée'}` }, base);
    }
  }
  if(next && next.air_date){
    const d = upcomingParseDay(next.air_date);
    if(d >= today){
      out.soon = Object.assign({ type: 'episode', key: `show-${show.id}`, date: next.air_date, dateObj: d,
        sub: upcomingEpisodeLabel(next.season_number, next.episode_number) }, base);
      return out;
    }
  }
  if(!out.now && !out.late){
    let sub = 'Pas encore de date';
    let lastDate = 0;
    if(last && last.air_date){
      const d = upcomingParseDay(last.air_date);
      lastDate = d.getTime();
      const season = (details.seasons || []).find(s => s.season_number === last.season_number);
      const seasonDone = !!(season && season.episode_count && last.episode_number >= season.episode_count);
      sub = seasonDone
        ? `Saison ${last.season_number} finie le ${upcomingPastLabel(d, today)}`
        : `${upcomingEpisodeLabel(last.season_number, last.episode_number)} le ${upcomingPastLabel(d, today)}`;
    }
    out.waiting = Object.assign({ type: 'waiting', key: `wait-${show.id}`, sub, lastDate }, base);
  }
  return out;
}

async function loadUpcoming(){
  if(watchlist.length === 0) await loadWatchlist();
  if(trackedShows.length === 0) await loadTrackedShows();
  const today = upcomingToday();
  const late = [];
  const now = [];
  const soon = [];
  const waiting = [];

  watchlist.forEach(item => {
    if(!item.releaseDate) return;
    const d = upcomingParseDay(item.releaseDate);
    const diff = upcomingDaysBetween(today, d);
    const base = { title: item.title, posterUrl: item.posterUrl, tmdbId: item.tmdbId || null, dateObj: d };
    if(diff >= 0){
      soon.push(Object.assign({ type: 'movie', key: `movie-${item.id}`, date: item.releaseDate, sub: 'Film à voir' }, base));
    }else if(-diff <= UPCOMING_RECENT_DAYS){
      now.push(Object.assign({ type: 'movie', key: `now-movie-${item.id}`, sub: 'Film à voir',
        when: `Sorti le ${upcomingPastLabel(d, today)}`, rel: upcomingRelPast(-diff) }, base));
    }
  });

  const watchedByShow = await loadWatchedEpisodeKeys();
  // Un appel TMDB par série encore en vie ; jamais pour une série terminée.
  await Promise.all(trackedShows.filter(show => !isShowEnded(show.status)).map(async show => {
    let details;
    try{
      details = await fetchTvDetails(show.tmdbId);
    }catch(e){
      console.error(e);
      return;
    }
    const watched = watchedByShow ? (watchedByShow.get(show.id) || new Set()) : null;
    const c = classifyShow(show, details, watched, today);
    if(c.late) late.push(c.late);
    if(c.now) now.push(c.now);
    if(c.soon) soon.push(c.soon);
    if(c.waiting) waiting.push(c.waiting);
  }));

  // Film déjà là : la plateforme où le voir (abonnement), quand TMDB la connaît.
  await Promise.all(now.filter(it => it.type === 'movie' && it.tmdbId).map(async it => {
    try{
      const providers = await fetchWatchProviders(it.tmdbId, 'movie');
      const service = groupStreamingServices(providers && providers.flatrate)[0];
      if(service){
        it.service = service;
        it.rel = `sur ${service.name}`;
      }
    }catch(e){
      console.error(e);
    }
  }));

  soon.sort((a, b) => a.dateObj - b.dateObj);
  late.sort((a, b) => b.lastDate - a.lastDate);
  now.sort((a, b) => b.dateObj - a.dateObj);
  waiting.sort((a, b) => b.lastDate - a.lastDate);
  upcomingSoon = soon;
  upcomingLate = late;
  upcomingNow = now;
  upcomingWaiting = waiting;
}

// --- Au cinéma --- Sorties en salle en France dans les 45 jours, sans les
// films déjà chez toi. En tête, ceux qui partagent leur premier mot avec un
// film que tu as noté 4 ou plus (« Godzilla Minus Zero » après « Godzilla
// Minus One ») : la raison est écrite sous le titre.
const UPCOMING_STOP_WORDS = new Set(['les', 'des', 'the', 'une', 'pour', 'dans', 'avec', 'sous', 'that', 'this', 'from', 'what', 'when']);
function upcomingFirstWord(title){
  return normalizeSearch(String(title || '')).split(/[^a-z0-9]+/).find(w => w.length >= 4 && !UPCOMING_STOP_WORDS.has(w)) || null;
}

function cinemaReason(movie){
  const word = upcomingFirstWord(movie.title) || upcomingFirstWord(movie.original_title);
  if(!word) return null;
  let best = null;
  films.forEach(f => {
    const note = getDisplayNote(f);
    if(note === null || note < 4) return;
    if(upcomingFirstWord(f.title) !== word && upcomingFirstWord(f.originalTitle) !== word) return;
    if(!best || note > best.note) best = { note, title: f.title };
  });
  return best ? `Tu as mis ${best.note.toFixed(1)} à ${best.title}` : null;
}

function pickCinemaMovies(results, today){
  const known = new Set(films.map(f => f.tmdbId).concat(watchlist.map(w => w.tmdbId)).filter(Boolean));
  const limit = today.getTime() + UPCOMING_CINEMA_DAYS * UPCOMING_DAY_MS;
  const seen = new Set();
  return (results || [])
    .filter(m => m.release_date && !seen.has(m.id) && seen.add(m.id))
    .filter(m => {
      const d = upcomingParseDay(m.release_date);
      return d >= today && d.getTime() <= limit && (!known.has(m.id) || upcomingCinemaAdded.has(m.id));
    })
    .map(m => Object.assign({}, m, { why: cinemaReason(m) }))
    .sort((a, b) => (!!b.why - !!a.why) || ((b.popularity || 0) - (a.popularity || 0)))
    .slice(0, UPCOMING_CINEMA_MAX);
}

async function loadUpcomingCinema(){
  if(!upcomingCinemaCache || Date.now() - upcomingCinemaCache.t > UPCOMING_CINEMA_TTL_MS){
    const pages = await Promise.all([1, 2].map(async page => {
      const res = await fetch(`https://api.themoviedb.org/3/movie/upcoming?language=fr-FR&region=FR&page=${page}`, {
        headers: { 'Authorization': `Bearer ${TMDB_API_KEY}`, 'Accept': 'application/json' }
      });
      if(!res.ok) throw new Error(`Erreur TMDB (${res.status})`);
      return (await res.json()).results || [];
    }));
    upcomingCinemaCache = { t: Date.now(), results: pages.flat() };
  }
  upcomingCinema = pickCinemaMovies(upcomingCinemaCache.results, upcomingToday());
}

async function addCinemaToWatchlist(tmdbId, btn){
  const movie = upcomingCinema.find(m => m.id === tmdbId);
  if(!movie || upcomingCinemaAdded.has(tmdbId)) return;
  btn.disabled = true;
  const item = await addTmdbMovieToWatchlist(movie);
  btn.disabled = false;
  if(!item) return;
  upcomingCinemaAdded.add(tmdbId);
  // Il arrive aussi dans « Cette semaine » ou « Plus tard ».
  const d = upcomingParseDay(movie.release_date);
  upcomingSoon.push({ type: 'movie', key: `movie-${item.id}`, title: item.title, posterUrl: item.posterUrl, tmdbId,
    date: movie.release_date, dateObj: d, sub: 'Film à voir' });
  upcomingSoon.sort((a, b) => a.dateObj - b.dateObj);
  showToast('Ajouté à À voir');
  renderUpcoming();
}

// --- Rendu du fil ---
function upcomingThumbHtml(item){
  if(item.posterUrl) return `<img class="up-thumb" src="${escapeHtml(item.posterUrl)}" alt="" loading="lazy">`;
  const placeholder = item.type === 'movie' || item.type === 'cinema' ? FILM_PLACEHOLDER_SVG : TV_PLACEHOLDER_SVG;
  return `<span class="up-thumb">${placeholder}</span>`;
}

function upcomingRowHtml(item, index, opts = {}){
  const logo = item.service && item.service.logoPath
    ? ` <img class="up-logo" src="https://image.tmdb.org/t/p/w92${item.service.logoPath}" alt="" title="${escapeHtml(item.service.name)}">` : '';
  return `
    <div class="up-row${opts.compact ? ' is-compact' : ''}" data-up-index="${index}">
      ${upcomingThumbHtml(item)}
      <div class="up-main">
        <div class="up-title">${escapeHtml(item.title)}</div>
        <div class="up-sub">${escapeHtml(item.sub)}${logo}</div>
      </div>
      ${item.when ? `<div class="up-when${opts.now ? ' is-now' : ''}"><b>${escapeHtml(item.when)}</b>${item.rel ? `<span>${escapeHtml(item.rel)}</span>` : ''}</div>` : ''}
      ${opts.add ? opts.add : ''}
    </div>`;
}

function upcomingSectionHtml(label, hint, rowsHtml, extraClass){
  if(!rowsHtml) return '';
  return `<section class="up-section${extraClass ? ' ' + extraClass : ''}">
    <h3 class="up-label">${label}${hint ? ` <span>${hint}</span>` : ''}</h3>
    ${rowsHtml}
  </section>`;
}

function upcomingSummaryText(weekItems){
  const parts = [];
  if(upcomingNow.length) parts.push(`<b>${upcomingNow.length} ${upcomingNow.length > 1 ? 'choses' : 'chose'} à voir</b> dès maintenant`);
  if(upcomingLate.length) parts.push(`${upcomingLate.length} série${upcomingLate.length > 1 ? 's' : ''} à rattraper`);
  if(weekItems.length){
    const allEpisodes = weekItems.every(i => i.type === 'episode');
    const allMovies = weekItems.every(i => i.type === 'movie');
    const noun = allEpisodes ? 'épisode' : allMovies ? 'film' : 'sortie';
    parts.push(`${weekItems.length} ${noun}${weekItems.length > 1 ? 's' : ''} cette semaine`);
  }
  if(!parts.length) return upcomingSoon.length ? 'Rien cette semaine. La suite plus bas.' : 'Rien de prévu pour l’instant chez toi.';
  return `${parts.join(', ')}.`;
}

let upcomingRowActions = [];

function renderUpcoming(){
  const today = upcomingToday();
  const weekEnd = today.getTime() + UPCOMING_WEEK_DAYS * UPCOMING_DAY_MS;
  const week = upcomingSoon.filter(i => i.dateObj.getTime() < weekEnd);
  const later = upcomingSoon.filter(i => i.dateObj.getTime() >= weekEnd);
  const actions = [];
  const showNav = (items) => items.filter(i => i.showId).map(i => ({ id: i.showId, title: i.title }));
  const rows = (items, opts) => items.map(item => {
    const index = actions.length;
    const nav = showNav(items);
    actions.push(() => {
      if(item.showId) goToSeriesDetail(item.showId, nav);
      else if(item.tmdbId) goToFilmDetail(item.tmdbId);
      else goToWatchlist();
    });
    return upcomingRowHtml(item, index, opts);
  }).join('');
  const future = (items) => items.map(i => Object.assign({}, i, {
    when: upcomingFutureLabel(i.dateObj, today), rel: upcomingRelFuture(upcomingDaysBetween(today, i.dateObj))
  }));

  document.getElementById('upcomingSummary').innerHTML = upcomingSummaryText(week);
  let html = upcomingSectionHtml('À rattraper', '', rows(upcomingLate));
  html += upcomingSectionHtml('Déjà là', '', rows(upcomingNow, { now: true }));
  if(getUpcomingViewMode() === 'calendar'){
    html += `<section class="up-section"><h3 class="up-label">À venir</h3><div class="upcoming-calendar" id="upcomingCalendar"></div></section>`;
  }else{
    html += upcomingSectionHtml('Cette semaine', '', rows(future(week)));
    html += upcomingSectionHtml('Plus tard', '', rows(future(later)));
  }
  html += upcomingSectionHtml('En attente d’une date', 'séries renouvelées ou en pause', rows(upcomingWaiting, { compact: true }), 'is-compact');
  html += upcomingSectionHtml('Au cinéma', 'les prochaines sorties en salle', upcomingCinema.map(movie => {
    const index = actions.length;
    actions.push(() => goToFilmDetail(movie.id));
    const added = upcomingCinemaAdded.has(movie.id);
    const d = upcomingParseDay(movie.release_date);
    return upcomingRowHtml({
      type: 'cinema', title: movie.title,
      posterUrl: movie.poster_path ? TMDB_IMG_BASE + movie.poster_path : null,
      sub: movie.why || 'Sortie en salle',
      when: upcomingFutureLabel(d, today)
    }, index, { add: `<button type="button" class="up-add${added ? ' is-added' : ''}" data-cinema-add="${movie.id}"${added ? ' disabled' : ''}>${added ? 'Dans À voir' : '+ À voir'}</button>` });
  }).join(''));
  const empty = !upcomingLate.length && !upcomingNow.length && !upcomingSoon.length && !upcomingWaiting.length && !upcomingCinema.length;
  const feed = document.getElementById('upcomingFeed');
  feed.innerHTML = empty
    ? `<div class="empty-state">Rien de prévu pour l’instant. Ajoute des films à À voir ou suis des séries encore en diffusion.</div>`
    : html;
  upcomingRowActions = actions;
  feed.querySelectorAll('.up-row[data-up-index]').forEach(row => {
    makeRowClickable(row, (e) => {
      if(e && e.target && e.target.closest && e.target.closest('[data-cinema-add]')) return;
      const action = upcomingRowActions[parseInt(row.dataset.upIndex, 10)];
      if(action) action();
    });
  });
  feed.querySelectorAll('[data-cinema-add]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      addCinemaToWatchlist(parseInt(btn.dataset.cinemaAdd, 10), btn);
    });
  });
  // La fiche du film s'ouvre aussi depuis le calendrier (plus seulement les épisodes).
  if(getUpcomingViewMode() === 'calendar') renderUpcomingCalendar();
}

// --- Vue calendrier (option) --- Grille CSS pure, semaines du lundi au
// dimanche. Chaque case montre une mini-affiche par sortie ce jour-là,
// cliquable : la série, ou la fiche du film.
const UPCOMING_WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function upcomingCalItemHtml(item){
  const label = `${item.title}, ${item.sub}${item.date ? `, ${formatDateFr(item.date)}` : ''}`;
  const target = item.type === 'episode' ? ` data-cal-show="${item.showId}"` : item.tmdbId ? ` data-cal-film="${item.tmdbId}"` : '';
  const clickable = target ? ' is-clickable' : '';
  return item.posterUrl
    ? `<img class="upcoming-cal-poster${clickable}" src="${escapeHtml(item.posterUrl)}" alt="" title="${escapeHtml(label)}" loading="lazy"${target}>`
    : `<div class="upcoming-cal-poster upcoming-cal-poster-placeholder${clickable}" title="${escapeHtml(label)}"${target}>${item.type === 'episode' ? TV_PLACEHOLDER_SVG : FILM_PLACEHOLDER_SVG}</div>`;
}

function renderUpcomingCalendar(){
  const wrap = document.getElementById('upcomingCalendar');
  if(!wrap) return;
  if(!upcomingCalMonth){
    const today = new Date();
    upcomingCalMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  }
  const year = upcomingCalMonth.getFullYear();
  const month = upcomingCalMonth.getMonth();
  const today = upcomingToday();
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

  // Regroupe les sorties du mois par jour ("YYYY-MM-DD" -> items[]).
  const byDay = {};
  upcomingSoon.forEach(item => {
    if(item.dateObj.getFullYear() === year && item.dateObj.getMonth() === month){
      (byDay[item.date] = byDay[item.date] || []).push(item);
    }
  });

  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7; // lundi = 0
  const cells = [];
  for(let i = 0; i < leadingBlanks; i++){
    cells.push({ date: new Date(year, month, 1 - (leadingBlanks - i)), outside: true });
  }
  for(let day = 1; day <= daysInMonth; day++){
    cells.push({ date: new Date(year, month, day), outside: false });
  }
  while(cells.length % 7 !== 0){
    const last = cells[cells.length - 1].date;
    cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), outside: true });
  }

  const monthLabel = firstOfMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  wrap.innerHTML = `
    <div class="upcoming-cal-nav">
      <button class="upcoming-cal-arrow" type="button" data-cal-nav="prev" aria-label="Mois précédent" ${isCurrentMonth ? 'disabled' : ''}>‹</button>
      <div class="upcoming-cal-label">${escapeHtml(monthLabel)}</div>
      <button class="upcoming-cal-arrow" type="button" data-cal-nav="next" aria-label="Mois suivant">›</button>
    </div>
    <div class="upcoming-cal-grid">
      ${UPCOMING_WEEKDAY_LABELS.map(d => `<div class="upcoming-cal-weekday">${d}</div>`).join('')}
      ${cells.map(cell => {
        const key = `${cell.date.getFullYear()}-${String(cell.date.getMonth() + 1).padStart(2, '0')}-${String(cell.date.getDate()).padStart(2, '0')}`;
        const items = byDay[key] || [];
        const isToday = !cell.outside && cell.date.getTime() === today.getTime();
        return `
          <div class="upcoming-cal-day${cell.outside ? ' is-outside' : ''}${isToday ? ' is-today' : ''}">
            <div class="upcoming-cal-daynum">${cell.date.getDate()}</div>
            <div class="upcoming-cal-items">${items.map(upcomingCalItemHtml).join('')}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
  wrap.querySelectorAll('[data-cal-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      const delta = btn.dataset.calNav === 'next' ? 1 : -1;
      upcomingCalMonth = new Date(year, month + delta, 1);
      renderUpcomingCalendar();
    });
  });
  // Séries du mois affiché, dans l'ordre du calendrier, sans doublon : la
  // navigation « série d'à côté » de la fiche.
  const monthShowIds = new Set();
  const navList = [];
  Object.values(byDay).flat().forEach(item => {
    if(item.type === 'episode' && !monthShowIds.has(item.showId)){
      monthShowIds.add(item.showId);
      navList.push({ id: item.showId, title: item.title });
    }
  });
  wrap.querySelectorAll('[data-cal-show]').forEach(el => {
    makeRowClickable(el, () => goToSeriesDetail(parseInt(el.dataset.calShow, 10), navList));
  });
  wrap.querySelectorAll('[data-cal-film]').forEach(el => {
    makeRowClickable(el, () => goToFilmDetail(parseInt(el.dataset.calFilm, 10)));
  });
}

// Page Bientôt, appelée par le routeur (#/prochainement).
async function openUpcoming(){
  document.getElementById('upcomingSummary').textContent = '';
  document.getElementById('upcomingFeed').innerHTML = skeletonRows(4);
  // Repart du mois en cours à chaque ouverture (calendrier).
  const today = new Date();
  upcomingCalMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  // « Au cinéma » en parallèle : jamais bloquant pour le reste du fil.
  const cinema = loadUpcomingCinema().catch(e => { console.error(e); upcomingCinema = []; });
  await loadUpcoming();
  await cinema;
  renderUpcoming();
  observeReveal(document.getElementById('upcomingPage'));
}

document.getElementById('upcomingBtn').addEventListener('click', goToUpcoming);
function syncUpcomingViewButtons(){
  const mode = getUpcomingViewMode();
  document.querySelectorAll('[data-upcoming-view-btn]').forEach(b => {
    const active = b.dataset.upcomingViewBtn === mode;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-pressed', String(active));
  });
}
syncUpcomingViewButtons(); // reflète la préférence mémorisée dès le chargement

document.querySelectorAll('[data-upcoming-view-btn]').forEach(btn => {
  btn.addEventListener('click', () => {
    localStorage.setItem('kinetUpcomingView', btn.dataset.upcomingViewBtn);
    syncUpcomingViewButtons();
    renderUpcoming();
  });
});
