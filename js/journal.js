// --- Journal des visionnages (revisionnages) ---
// Une ligne par fois où un film a été vu (table `viewings`, voir
// supabase/migrations/007). `films` reste la fiche notée ; ce module gère
// le journal chronologique et les compteurs "revu Nx".

let viewings = [];

async function loadViewings(){
  const { data, error } = await supabaseClient
    .from('viewings')
    .select('*')
    .order('watched_at', { ascending: false });
  if(error){
    // Repli hors ligne (js/offline.js) : mêmes principes que loadFilms()
    // dans js/app.js — pas de toast ici, celui de loadFilms() (chargée EN
    // PARALLÈLE depuis showApp(), voir js/auth.js) suffit à prévenir
    // l'utilisateur.
    const cached = loadOfflineCache('viewings');
    if(cached){
      viewings = cached.data;
      return;
    }
    showToast('Erreur de chargement du journal');
    console.error(error);
    viewings = [];
    return;
  }
  viewings = data.map(row => ({
    id: row.id,
    filmId: row.film_id,
    watchedAt: row.watched_at,
    note: row.note || null
  }));
  saveOfflineCache('viewings', viewings);
}

// Insère un visionnage — utilisé à la création d'un film (premier
// visionnage automatique, voir app.js/handleSave) et par "+ Revisionnage"
// dans le formulaire (js/journal.js plus bas).
async function addViewing(filmId, watchedAt, note){
  const { data, error } = await supabaseClient
    .from('viewings')
    .insert({ film_id: filmId, watched_at: watchedAt, note: note || null })
    .select()
    .single();
  if(error){
    showToast('Erreur d\'enregistrement du visionnage');
    console.error(error);
    return null;
  }
  const v = { id: data.id, filmId: data.film_id, watchedAt: data.watched_at, note: data.note || null };
  viewings.push(v);
  return v;
}

// Toast d'annulation (v2.8) plutôt qu'un confirm() bloquant — voir
// showUndoToast() (js/ui.js) : le visionnage disparaît tout de suite de
// l'écran, la suppression réelle en base n'a lieu qu'à l'expiration du
// délai. filmId sert uniquement à re-rendre la bonne section au clic sur
// "Annuler" (renderViewingsSection est propre à une fiche film).
function removeViewingWithUndo(id, filmId){
  const idx = viewings.findIndex(v => v.id === id);
  if(idx === -1) return;
  const [removed] = viewings.splice(idx, 1);
  renderViewingsSection(filmId);
  render();
  showUndoToast(
    'Visionnage retiré du journal',
    async () => {
      // File d'attente hors ligne (retour utilisateur, js/offlineQueue.js) :
      // cible un id déjà connu, rejouable sans réconciliation.
      if(isOfflineMode){
        enqueueOfflineWrite({ table: 'viewings', op: 'delete', match: { id } });
        return;
      }
      const { error } = await supabaseClient.from('viewings').delete().eq('id', id);
      if(error){
        console.error(error);
        // Même logique que la watchlist (js/watchlist.js) : jamais
        // supprimé côté base en cas d'erreur, un rechargement le
        // restaurera plutôt qu'un échec silencieux.
        showToast('Erreur de suppression, réessaie');
      }
    },
    () => {
      viewings.splice(idx, 0, removed);
      renderViewingsSection(filmId);
      render();
    }
  );
}

function viewingsForFilm(filmId){
  return viewings.filter(v => v.filmId === filmId).sort((a, b) => a.watchedAt - b.watchedAt);
}

function rewatchCount(filmId){
  return viewingsForFilm(filmId).length;
}

// --- Section "Visionnages" dans le formulaire d'un film existant ---

function renderViewingsSection(filmId){
  const list = document.getElementById('viewingsList');
  const items = viewingsForFilm(filmId);
  if(items.length === 0){
    list.innerHTML = `<div class="tmdb-empty">Aucun visionnage enregistré.</div>`;
    return;
  }
  list.innerHTML = items.map((v, idx) => `
    <div class="viewing-row">
      <span class="viewing-date">${formatViewingDate(v.watchedAt)}</span>
      ${idx === 0 ? '<span class="viewing-first">1er visionnage</span>' : `<span class="rewatch-badge" title="Revisionnage">${uiIcon('repeat')} revu</span>`}
      ${v.note ? `<span class="viewing-note">${escapeHtml(v.note)}</span>` : ''}
      <button class="viewing-remove" data-id="${v.id}" title="Retirer ce visionnage" aria-label="Retirer ce visionnage" type="button">✕</button>
    </div>
  `).join('');
  list.querySelectorAll('.viewing-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      removeViewingWithUndo(parseInt(btn.dataset.id, 10), filmId);
    });
  });
}

// Changer la date d'un visionnage (notation en pas à pas, « Changer la date »).
async function updateViewingDate(id, watchedAt){
  if(blockIfOffline()) return false;
  const { error } = await supabaseClient.from('viewings').update({ watched_at: watchedAt }).eq('id', id);
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return false;
  }
  const v = viewings.find(x => x.id === id);
  if(v) v.watchedAt = watchedAt;
  return true;
}

function formatViewingDate(ts){
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

async function handleAddViewing(){
  if(!editingId) return;
  const dateVal = document.getElementById('viewingDateInput').value;
  // Pas de visionnage dans le futur — le max sur le champ (voir openModal()
  // dans app.js) empêche déjà ça au clavier/calendrier, ceci est juste le
  // filet de sécurité côté logique.
  if(dateVal && dateVal > new Date().toISOString().slice(0, 10)){
    showToast('Impossible d\'enregistrer un visionnage dans le futur');
    return;
  }
  const watchedAt = dateVal ? new Date(dateVal + 'T12:00:00').getTime() : Date.now();
  const note = document.getElementById('viewingNoteInput').value.trim() || null;
  const v = await addViewing(editingId, watchedAt, note);
  if(!v) return;
  document.getElementById('viewingDateInput').value = '';
  document.getElementById('viewingNoteInput').value = '';
  renderViewingsSection(editingId);
  render();
  showToast('Revisionnage ajouté');
}

{
  const addViewingBtn = document.getElementById('addViewingBtn');
  addViewingBtn.addEventListener('click', withSubmitGuard(addViewingBtn, handleAddViewing));
}

// --- Journal chronologique (toutes les vues, tous films confondus) ---

function journalMonthLabel(d){
  const noms = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  return `${noms[d.getMonth()]} ${d.getFullYear()}`;
}

function computeJournalEntries(){
  return viewings
    .map(v => {
      const film = films.find(f => f.id === v.filmId);
      if(!film) return null;
      const isRewatch = viewingsForFilm(v.filmId)[0].id !== v.id;
      return { ...v, film, isRewatch };
    })
    .filter(Boolean)
    .sort((a, b) => b.watchedAt - a.watchedAt);
}

function renderJournalRow(e){
  const d = new Date(e.watchedAt);
  return `
    <div class="journal-row">
      ${e.film.posterUrl
        ? `<img class="film-poster" src="${e.film.posterUrl}" alt="" loading="lazy">`
        : `<div class="film-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="journal-main">
        <div class="journal-title">${escapeHtml(e.film.title)}${e.isRewatch ? `<span class="rewatch-badge" title="Revisionnage">${uiIcon('repeat')}</span>` : ''}</div>
        ${e.note ? `<div class="journal-note">${escapeHtml(e.note)}</div>` : ''}
      </div>
      <div class="journal-date">${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</div>
    </div>
  `;
}

function renderJournal(){
  const content = document.getElementById('journalContent');
  const entries = computeJournalEntries();
  if(entries.length === 0){
    content.innerHTML = `<div class="empty-state">Aucun visionnage enregistré pour l'instant.</div>`;
    return;
  }
  let html = '';
  let lastMonth = null;
  entries.forEach(e => {
    const d = new Date(e.watchedAt);
    const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
    if(monthKey !== lastMonth){
      html += `<div class="journal-month">${journalMonthLabel(d)}</div>`;
      lastMonth = monthKey;
    }
    html += renderJournalRow(e);
  });
  content.innerHTML = html;
}

function openJournal(){
  // Accessible depuis la modale profil ("Mon activité") — la refermer
  // d'abord évite deux modales de tailles différentes superposées.
  closeProfileModal();
  renderJournal();
  openOverlay('journalOverlay');
}

// Rouvre la modale profil (pas juste closeOverlay simple) : Journal n'est
// accessible QUE depuis "Mon activité" dans le profil (voir #journalBtn,
// index.html) — en ressortir doit ramener là où on était, pas sortir
// entièrement du profil.
function closeJournal(){
  closeOverlay('journalOverlay', () => returnToProfile());
}

document.getElementById('journalBtn').addEventListener('click', openJournal);
document.getElementById('closeJournal').addEventListener('click', closeJournal);
document.getElementById('journalOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'journalOverlay') closeJournal();
});

// --- Journal dans le catalogue (draft Profil du 15/10, piste A) ---
// Troisième vue de tes films, à côté de Grille et Liste : tes visionnages
// par mois, avec ta note et chaque revisionnage sur sa ligne (« revu »). La
// recherche du catalogue y marche aussi. La rangée Journal du Profil est
// retirée ; la fenêtre ci-dessus reste pour ses ids.
const FILMS_JOURNAL_KEY = 'kinetFilmsJournal';

function isFilmsJournal(){
  try{ return localStorage.getItem(FILMS_JOURNAL_KEY) === '1'; }catch(e){ return false; }
}
function setFilmsJournal(on){
  try{ localStorage.setItem(FILMS_JOURNAL_KEY, on ? '1' : '0'); }catch(e){}
}

function renderFilmsViewTabs(){
  const current = isFilmsJournal() ? 'journal' : getViewMode();
  document.querySelectorAll('[data-films-view]').forEach(btn => {
    const on = btn.dataset.filmsView === current;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', String(on));
  });
}

function filmsJournalShortDate(ts){
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function filmsJournalRowHtml(e){
  const note = getDisplayNote(e.film);
  return `
    <div class="fj-row" data-film-id="${e.film.id}">
      ${e.film.posterUrl
        ? `<img class="fj-poster" src="${e.film.posterUrl}" alt="" loading="lazy" decoding="async">`
        : `<span class="fj-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</span>`}
      <div class="fj-main">
        <div class="fj-title">${escapeHtml(e.film.title)}${e.isRewatch ? '<span class="fj-again">revu</span>' : ''}</div>
        ${e.note ? `<div class="fj-sub">${escapeHtml(e.note)}</div>` : ''}
      </div>
      <span class="fj-note ${noteColorClass(note)}">${note != null ? Number(note).toFixed(1) : ''}</span>
      <span class="fj-date">${filmsJournalShortDate(e.watchedAt)}</span>
    </div>`;
}

// Appelée par render() (js/app.js) quand la vue Journal est choisie.
function renderFilmsJournal(){
  const el = document.getElementById('filmJournal');
  const countLine = document.getElementById('countLine');
  const rawQuery = document.getElementById('search').value.trim();
  const query = normalizeSearch(rawQuery);
  const all = computeJournalEntries();
  const entries = query
    ? all.filter(e => normalizeSearch(`${e.film.title} ${e.film.originalTitle || ''}`).includes(query))
    : all;
  countLine.textContent = query
    ? `${entries.length} sur ${all.length}`
    : `${all.length} visionnage${all.length > 1 ? 's' : ''}`;
  if(entries.length === 0){
    el.innerHTML = `<div class="empty-state">${all.length === 0
      ? 'Aucun visionnage pour l’instant : chaque film que tu notes arrive ici, à sa date.'
      : `Aucun visionnage ne correspond à « ${escapeHtml(rawQuery)} ».`}</div>`;
    return;
  }
  let html = '';
  let lastMonth = null;
  let monthCount = 0;
  let monthHtml = '';
  const flush = () => {
    if(lastMonth === null) return;
    html += `<div class="fj-month">${lastMonth.label} <span>· ${monthCount} film${monthCount > 1 ? 's' : ''}</span></div>${monthHtml}`;
  };
  entries.forEach(e => {
    const d = new Date(e.watchedAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if(!lastMonth || lastMonth.key !== key){
      flush();
      lastMonth = { key, label: journalMonthLabel(d) };
      monthCount = 0;
      monthHtml = '';
    }
    monthCount++;
    monthHtml += filmsJournalRowHtml(e);
  });
  flush();
  el.innerHTML = html;

  const navList = entries.filter(e => e.film.tmdbId).map(e => ({ tmdbId: e.film.tmdbId, title: e.film.title }));
  el.querySelectorAll('.fj-row[data-film-id]').forEach(row => {
    const film = films.find(f => String(f.id) === row.dataset.filmId);
    if(!film) return;
    makeRowClickable(row, () => {
      if(film.tmdbId) goToFilmDetail(film.tmdbId, navList);
      else openModal(film.id);
    });
  });
}

document.querySelectorAll('[data-films-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.filmsView;
    if(view === 'journal'){
      setFilmsJournal(true);
    }else{
      setFilmsJournal(false);
      setViewMode(view);
    }
    render();
  });
});
