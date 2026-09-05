// --- Prochainement (#/prochainement) ---
// Agrège ce que l'utilisateur suit déjà — pas une découverte de
// nouveautés non ajoutées : (a) les films de la watchlist (js/watchlist.js)
// ayant une date de sortie future connue (migrations/025), et (b) pour
// chaque série suivie (js/series.js) encore susceptible de sortir un
// épisode, son prochain épisode à venir (TMDB `next_episode_to_air`).
// Les séries dont le statut est "Ended"/"Cancelled" (ne produiront plus
// jamais de saison) sont affichées à part, avec un badge clair, plutôt que
// simplement omises — demande explicite de l'utilisateur.
//
// Dépend de watchlist.js ET series.js (chargés avant, voir index.html) :
// réutilise leurs tableaux déjà chargés plutôt que de dupliquer le
// chargement, et les recharge si vides (accès direct par URL, comme
// openGroupDetail() dans js/groups.js).

let upcomingSoon = [];       // [{ type, key, title, posterUrl, date, dateObj, sub }]
let upcomingEndedShows = []; // séries "Ended"/"Cancelled" suivies

// --- Calendrier visuel (v2.41, retour utilisateur : remplacer la simple
// liste triée par date par un vrai calendrier) --- Bascule propre à cette
// section (pas la préférence grille/liste partagée de js/ui.js, qui ne
// concerne que les affiches du catalogue/watchlist/séries/top).
function getUpcomingViewMode(){
  return localStorage.getItem('kinetUpcomingView') === 'calendar' ? 'calendar' : 'list';
}
let upcomingCalMonth = null; // Date au 1er du mois affiché par le calendrier

async function loadUpcoming(){
  if(watchlist.length === 0) await loadWatchlist();
  if(trackedShows.length === 0) await loadTrackedShows();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const soonItems = [];

  watchlist.forEach(item => {
    if(!item.releaseDate) return; // pas de fiche TMDB, ou ajouté avant migrations/025
    const d = new Date(item.releaseDate + 'T00:00:00');
    if(d < today) return; // déjà sorti : plus "à venir"
    soonItems.push({
      type: 'movie',
      key: `movie-${item.id}`,
      title: item.title,
      posterUrl: item.posterUrl,
      date: item.releaseDate,
      dateObj: d,
      sub: 'Film'
    });
  });

  const endedShows = [];
  // Un appel TMDB par série encore en vie (pas "Ended"/"Cancelled") — évité
  // pour celles déjà connues comme terminées, ni utile ni souhaité.
  await Promise.all(trackedShows.map(async show => {
    if(isShowEnded(show.status)){
      endedShows.push(show);
      return;
    }
    let details;
    try{
      details = await fetchTvDetails(show.tmdbId);
    }catch(e){
      console.error(e);
      return;
    }
    const next = details.next_episode_to_air;
    if(!next || !next.air_date) return;
    const d = new Date(next.air_date + 'T00:00:00');
    if(d < today) return;
    soonItems.push({
      type: 'episode',
      key: `show-${show.id}`,
      showId: show.id,
      title: show.title,
      posterUrl: show.posterUrl,
      date: next.air_date,
      dateObj: d,
      sub: `S${String(next.season_number).padStart(2, '0')}E${String(next.episode_number).padStart(2, '0')}${next.name ? ' · ' + next.name : ''}`
    });
  }));

  soonItems.sort((a, b) => a.dateObj - b.dateObj);
  upcomingSoon = soonItems;
  upcomingEndedShows = endedShows;
}

// formatDateFr() : voir js/series.js (chargé avant, même style d'entête
// que renderChosenBanner() dans js/groups.js).
function upcomingRowHtml(item){
  const dateLabel = formatDateFr(item.date);
  return `
    <div class="wl-row">
      ${item.posterUrl
        ? `<img class="film-poster" src="${item.posterUrl}" alt="" loading="lazy">`
        : `<div class="film-poster film-poster-placeholder">${item.type === 'episode' ? TV_PLACEHOLDER_SVG : FILM_PLACEHOLDER_SVG}</div>`}
      <div class="wl-main">
        <div class="wl-title">${escapeHtml(item.title)}</div>
        <div class="wl-note">${escapeHtml(item.sub)}${dateLabel ? ` · ${dateLabel}` : ''}</div>
      </div>
    </div>
  `;
}

function upcomingEndedRowHtml(show){
  return `
    <div class="wl-row">
      ${show.posterUrl
        ? `<img class="film-poster" src="${show.posterUrl}" alt="" loading="lazy">`
        : `<div class="film-poster film-poster-placeholder">${TV_PLACEHOLDER_SVG}</div>`}
      <div class="wl-main">
        <div class="wl-title">${escapeHtml(show.title)}</div>
        <div class="wl-note"><span class="status-badge ended">${escapeHtml(showStatusLabel(show.status))}</span> (plus aucune nouvelle saison prévue)</div>
      </div>
      <div class="wl-actions">
        <button class="btn secondary" data-id="${show.id}" type="button">Ouvrir</button>
      </div>
    </div>
  `;
}

// --- Vue calendrier ---
// Grille CSS pure (pas de librairie, cohérent avec le reste du site) —
// mois affiché par upcomingCalMonth, semaines démarrant le lundi (usage
// FR). Chaque case affiche une mini-affiche par item ce jour-là (cliquable
// pour ouvrir la série concernée, un épisode n'a pas d'autre écran de
// détail qu'elle) ; un film watchlist n'a pas d'écran propre, sa mini-
// affiche n'est donc pas cliquable — seule l'info-bulle (title=) détaille.
const UPCOMING_WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function upcomingCalItemHtml(item){
  const label = `${item.title} — ${item.sub}${item.date ? ` · ${formatDateFr(item.date)}` : ''}`;
  const clickable = item.type === 'episode';
  const poster = item.posterUrl
    ? `<img class="upcoming-cal-poster${clickable ? ' is-clickable' : ''}" src="${item.posterUrl}" alt="" title="${escapeHtml(label)}" loading="lazy"${clickable ? ` data-cal-show="${item.showId}"` : ''}>`
    : `<div class="upcoming-cal-poster upcoming-cal-poster-placeholder${clickable ? ' is-clickable' : ''}" title="${escapeHtml(label)}"${clickable ? ` data-cal-show="${item.showId}"` : ''}>${item.type === 'episode' ? TV_PLACEHOLDER_SVG : FILM_PLACEHOLDER_SVG}</div>`;
  return poster;
}

function renderUpcomingCalendar(){
  const wrap = document.getElementById('upcomingCalendar');
  if(!upcomingCalMonth){
    const today = new Date();
    upcomingCalMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  }
  const year = upcomingCalMonth.getFullYear();
  const month = upcomingCalMonth.getMonth();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

  // Regroupe les items du mois par jour ("YYYY-MM-DD" -> items[]).
  const byDay = {};
  upcomingSoon.forEach(item => {
    if(item.dateObj.getFullYear() === year && item.dateObj.getMonth() === month){
      const key = item.date;
      (byDay[key] = byDay[key] || []).push(item);
    }
  });

  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7; // lundi = 0

  const cells = [];
  for(let i = 0; i < leadingBlanks; i++){
    const d = new Date(year, month, 1 - (leadingBlanks - i));
    cells.push({ date: d, outside: true });
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
      <button class="btn secondary" type="button" data-cal-nav="prev" ${isCurrentMonth ? 'disabled' : ''}>← Mois préc.</button>
      <div class="upcoming-cal-label">${escapeHtml(monthLabel)}</div>
      <button class="btn secondary" type="button" data-cal-nav="next">Mois suiv. →</button>
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
  wrap.querySelectorAll('[data-cal-show]').forEach(el => {
    el.addEventListener('click', () => goToSeriesDetail(parseInt(el.dataset.calShow, 10)));
  });
}

function renderUpcomingSoonSection(){
  const mode = getUpcomingViewMode();
  const listEl = document.getElementById('upcomingSoonList');
  const calEl = document.getElementById('upcomingCalendar');
  if(mode === 'calendar'){
    listEl.style.display = 'none';
    calEl.style.display = '';
    renderUpcomingCalendar();
  }else{
    listEl.style.display = '';
    calEl.style.display = 'none';
    listEl.innerHTML = upcomingSoon.length === 0
      ? `<div class="empty-state">Rien de prévu pour l'instant. Ajoute des films à ta watchlist ou suis des séries encore en diffusion.</div>`
      : upcomingSoon.map(upcomingRowHtml).join('');
  }
}

function renderUpcoming(){
  renderUpcomingSoonSection();

  const endedEl = document.getElementById('upcomingEndedList');
  endedEl.innerHTML = upcomingEndedShows.length === 0
    ? `<div class="empty-state">Aucune série terminée parmi celles que tu suis.</div>`
    : upcomingEndedShows.map(upcomingEndedRowHtml).join('');
  endedEl.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => goToSeriesDetail(parseInt(btn.dataset.id, 10)));
  });
}

// Page Prochainement — appelée par le routeur (#/prochainement).
async function openUpcoming(){
  document.getElementById('upcomingSoonList').innerHTML = `<div class="empty-state">Chargement…</div>`;
  document.getElementById('upcomingEndedList').innerHTML = `<div class="empty-state">Chargement…</div>`;
  // Reparti du mois en cours à chaque ouverture de la page plutôt que de
  // garder une navigation précédente : sinon revenir sur Prochainement
  // après avoir feuilleté plusieurs mois rouvrirait sur un mois qui n'a
  // plus rien à voir avec "maintenant".
  const today = new Date();
  upcomingCalMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  await loadUpcoming();
  renderUpcoming();
  observeReveal(document.getElementById('upcomingPage'));
}

document.getElementById('upcomingBtn').addEventListener('click', goToUpcoming);
document.getElementById('upcomingPageBack').addEventListener('click', goHome);
function syncUpcomingViewButtons(){
  const mode = getUpcomingViewMode();
  document.querySelectorAll('[data-upcoming-view-btn]').forEach(b => {
    const active = b.dataset.upcomingViewBtn === mode;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-pressed', String(active));
  });
}
syncUpcomingViewButtons(); // reflète la préférence mémorisée dès le chargement (page cachée mais boutons déjà dans le DOM)

document.querySelectorAll('[data-upcoming-view-btn]').forEach(btn => {
  btn.addEventListener('click', () => {
    localStorage.setItem('kinetUpcomingView', btn.dataset.upcomingViewBtn);
    syncUpcomingViewButtons();
    renderUpcomingSoonSection();
  });
});
