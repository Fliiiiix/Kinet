// --- Cartes : l'album sans hasard (draft Profil du 15/10, piste A) ---
// Plus de boosters, de poussière, de fabrication ni d'échanges : l'album se
// calcule depuis ton catalogue, sur un seul écran.
// - Chaque film de ton catalogue donne sa carte, son rang suit ta note
//   (Figurant tant qu'il n'est pas noté : un film vu, importé sans note).
// - Un réalisateur ou un acteur arrive avec ton premier film avec lui, puis
//   monte de rang avec les suivants (2, 4, 7 films).
// - « Bientôt dans ta collection » : les cartes près de monter, reliées à ce
//   qui est dans ton À voir.
// Les liens film → réalisateur/acteurs viennent des tables tcg_cards et
// tcg_card_links (migrations 041 et suivantes, lisibles par tout compte
// connecté), remplies par generateTcgCardsForFilm() (js/tcg.js). Les
// anciennes tables (collection, poussière, échanges) restent en base,
// intactes, simplement plus utilisées.

const ALBUM_RANKS = ['', 'Figurant', 'Second rôle', 'Tête d’affiche', 'Légende'];
const ALBUM_PERSON_STEPS = [1, 2, 4, 7]; // films vus pour Figurant, Second rôle, Tête d'affiche, Légende
const ALBUM_PAGE = 60;
const ALBUM_CHUNK = 150;

let albumData = null;
let albumTab = 'films';
let albumShown = ALBUM_PAGE;
let albumUpdating = false;

// Rang d'une carte film : ta note. 5 Légende, 4.5 Tête d'affiche, 4 Second
// rôle, en dessous (ou pas encore noté) Figurant.
function albumFilmRank(note){
  if(note == null) return 1;
  if(note >= 5) return 4;
  if(note >= 4.5) return 3;
  if(note >= 4) return 2;
  return 1;
}
// Rang d'une carte réalisateur ou acteur : le nombre de ses films que tu as vus.
function albumPersonRank(count){
  let rank = 0;
  ALBUM_PERSON_STEPS.forEach((step, i) => { if(count >= step) rank = i + 1; });
  return rank;
}
// Prochain palier : { rank, need, progress } ou null au rang maximal. La
// barre montre les films vus sur ceux qu'il faut (1 sur 2, 2 sur 4...).
function albumNextStep(count){
  const rank = albumPersonRank(count);
  if(rank >= ALBUM_PERSON_STEPS.length) return null;
  const next = ALBUM_PERSON_STEPS[rank];
  return { rank: rank + 1, need: next - count, progress: count / next };
}

async function albumSelectIn(table, columns, column, values, extra){
  const out = [];
  for(let i = 0; i < values.length; i += ALBUM_CHUNK){
    let q = supabaseClient.from(table).select(columns).in(column, values.slice(i, i + ALBUM_CHUNK));
    if(extra) q = extra(q);
    const { data, error } = await q;
    if(error) throw error;
    out.push(...(data || []));
  }
  return out;
}

// Construit l'album à partir des films notés, d'À voir et des liens de cartes.
// Pur côté calcul (buildAlbum) pour les tests ; loadAlbum() fait les requêtes.
function buildAlbum(ratedFilms, watchlistItems, filmCards, links, persons){
  const filmCardByTmdb = new Map(filmCards.map(c => [c.tmdb_id, c.id]));
  const tmdbByFilmCard = new Map(filmCards.map(c => [c.id, c.tmdb_id]));
  const personById = new Map(persons.map(p => [p.id, p]));
  const ratedByTmdb = new Map(ratedFilms.map(f => [f.tmdbId, f]));
  const wlByTmdb = new Map(watchlistItems.filter(w => w.tmdbId && !ratedByTmdb.has(w.tmdbId)).map(w => [w.tmdbId, w]));

  const filmsCards = ratedFilms
    .map(f => ({ kind: 'film', film: f, note: f.note, rank: albumFilmRank(f.note) }))
    .sort((a, b) => (b.note != null ? b.note : -1) - (a.note != null ? a.note : -1) || a.film.title.localeCompare(b.film.title, 'fr'));

  const people = new Map(); // person card id -> { person, seen: [titles], wl: [titles] }
  links.forEach(l => {
    const person = personById.get(l.person_card_id);
    const tmdb = tmdbByFilmCard.get(l.film_card_id);
    if(!person || tmdb == null) return;
    const entry = people.get(person.id) || { person, seen: [], wl: [] };
    const rated = ratedByTmdb.get(tmdb);
    const wl = wlByTmdb.get(tmdb);
    if(rated && !entry.seen.includes(rated.title)) entry.seen.push(rated.title);
    if(wl && !entry.wl.includes(wl.title)) entry.wl.push(wl.title);
    people.set(person.id, entry);
  });
  const owned = Array.from(people.values()).filter(e => e.seen.length > 0)
    .map(e => ({ kind: e.person.card_type, person: e.person, count: e.seen.length, seen: e.seen, wl: e.wl, rank: albumPersonRank(e.seen.length) }))
    .sort((a, b) => b.count - a.count || a.person.name.localeCompare(b.person.name, 'fr'));

  // D'abord ce qu'un film de ton À voir ferait monter tout de suite, puis ce
  // qu'À voir rapproche, puis le plus proche du palier suivant.
  const nextScore = (x) => (x.card.wl.length && x.step.need === 1 ? 0 : x.card.wl.length ? 1 : 2);
  const next = owned
    .map(c => ({ card: c, step: albumNextStep(c.count) }))
    .filter(x => x.step)
    .sort((a, b) => nextScore(a) - nextScore(b) || a.step.need - b.step.need || b.card.count - a.card.count)
    .slice(0, 3);

  return {
    films: filmsCards,
    directors: owned.filter(c => c.kind === 'director'),
    actors: owned.filter(c => c.kind === 'actor'),
    next,
    missing: ratedFilms.filter(f => !filmCardByTmdb.has(f.tmdbId)).map(f => f.tmdbId)
  };
}

// Les films du catalogue (avec fiche TMDB), une fois chacun, avec ta note
// si tu en as donné une.
function albumRatedFilms(){
  const byTmdb = new Map();
  films.forEach(f => {
    if(!f.tmdbId) return;
    const note = getDisplayNote(f);
    const prev = byTmdb.get(f.tmdbId);
    if(!prev || (note != null && (prev.note == null || note > prev.note))) byTmdb.set(f.tmdbId, { tmdbId: f.tmdbId, title: f.title, posterUrl: f.posterUrl, note, id: f.id });
  });
  return Array.from(byTmdb.values());
}

async function loadAlbum(){
  if(watchlist.length === 0 && typeof loadWatchlist === 'function') await loadWatchlist().catch(e => console.error(e));
  const rated = albumRatedFilms();
  const tmdbIds = Array.from(new Set(rated.map(f => f.tmdbId).concat(watchlist.filter(w => w.tmdbId).map(w => w.tmdbId))));
  const filmCards = tmdbIds.length ? await albumSelectIn('tcg_cards', 'id, tmdb_id', 'tmdb_id', tmdbIds, q => q.eq('card_type', 'film')) : [];
  const links = filmCards.length ? await albumSelectIn('tcg_card_links', 'film_card_id, person_card_id', 'film_card_id', filmCards.map(c => c.id)) : [];
  const personIds = Array.from(new Set(links.map(l => l.person_card_id)));
  const persons = personIds.length ? await albumSelectIn('tcg_cards', 'id, card_type, tmdb_id, name, image_url', 'id', personIds) : [];
  albumData = buildAlbum(rated, watchlist, filmCards, links, persons);
  return albumData;
}

function albumTotal(a){
  return a.films.length + a.directors.length + a.actors.length;
}

function albumSummaryText(a){
  const parts = [];
  const n = (count, one, many) => parts.push(`${count} ${count > 1 ? many : one}`);
  n(a.films.length, 'film', 'films');
  n(a.directors.length, 'réalisateur', 'réalisateurs');
  n(a.actors.length, 'acteur', 'acteurs');
  return parts.join(' · ');
}

function albumNextSub(x){
  const need = x.step.need;
  const wl = x.card.wl[0];
  if(wl && need === 1) return `${wl} est dans ton À voir`;
  if(wl) return `Encore ${need} de ses films, dont ${wl} dans ton À voir`;
  return need === 1 ? 'Encore 1 de ses films' : `Encore ${need} de ses films`;
}

function albumCardHtml(c, index){
  const img = c.kind === 'film' ? c.film.posterUrl : c.person.image_url;
  const name = c.kind === 'film' ? c.film.title : c.person.name;
  const extra = c.kind === 'film'
    ? (c.note != null ? `ta note ${Number(c.note).toFixed(1)}` : 'pas encore noté')
    : `${c.count} film${c.count > 1 ? 's' : ''}`;
  return `
    <button type="button" class="al-card al-r${c.rank}" data-album-index="${index}">
      <span class="al-face">${img ? `<img src="${escapeHtml(img)}" alt="" loading="lazy" decoding="async">` : (c.kind === 'film' ? FILM_PLACEHOLDER_SVG : uiIcon('user'))}</span>
      <span class="al-name">${escapeHtml(name)}</span>
      <span class="al-rank"><b>${ALBUM_RANKS[c.rank]}</b> · ${escapeHtml(extra)}</span>
    </button>`;
}

function albumListForTab(a){
  return albumTab === 'directors' ? a.directors : albumTab === 'actors' ? a.actors : a.films;
}

function renderAlbum(){
  const el = document.getElementById('tcgAlbum');
  const a = albumData;
  if(!a){ el.innerHTML = skeletonRows(3); return; }
  document.querySelectorAll('#tcgOverlay [data-album-tab]').forEach(btn => {
    const on = btn.dataset.albumTab === albumTab;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', String(on));
  });
  const list = albumListForTab(a);
  const shown = list.slice(0, albumShown);
  const total = albumTotal(a);
  el.innerHTML = `
    <div class="al-sum"><b>${total} carte${total > 1 ? 's' : ''}</b><span>${albumSummaryText(a)}</span></div>
    <p class="al-status" id="albumStatus" aria-live="polite"></p>
    ${a.next.length ? `
      <div class="pp-label">Bientôt dans ta collection</div>
      <div class="al-next">
        ${a.next.map(x => `
          <div class="al-next-row">
            ${x.card.person.image_url ? `<img src="${escapeHtml(x.card.person.image_url)}" alt="" loading="lazy">` : `<span class="al-next-empty">${uiIcon('user')}</span>`}
            <div class="al-next-main">
              <div class="al-next-title">${escapeHtml(x.card.person.name)} · ${ALBUM_RANKS[x.step.rank]}</div>
              <div class="al-next-sub">${escapeHtml(albumNextSub(x))}</div>
              <div class="al-prog"><i style="width:${Math.round(x.step.progress * 100)}%"></i></div>
            </div>
          </div>`).join('')}
      </div>` : ''}
    ${list.length
      ? `<div class="al-grid">${shown.map((c, i) => albumCardHtml(c, i)).join('')}</div>
         ${list.length > shown.length ? `<button type="button" class="al-more" id="albumMore">Voir les ${list.length - shown.length} autres</button>` : ''}`
      : `<div class="empty-state">${albumTab === 'films'
          ? 'Note un film pour avoir ta première carte.'
          : 'Ces cartes arrivent avec tes films notés (et leur fiche TMDB).'}</div>`}
  `;
  const more = document.getElementById('albumMore');
  if(more) more.addEventListener('click', () => { albumShown += ALBUM_PAGE; renderAlbum(); });
  renderAlbumStatus();
}

function renderAlbumStatus(text){
  const el = document.getElementById('albumStatus');
  if(el) el.textContent = text || '';
}

// Fiche d'une carte réalisateur ou acteur : ses films que tu as vus. Une
// carte film ouvre la fiche du film.
function openAlbumCard(index){
  const c = albumListForTab(albumData)[index];
  if(!c) return;
  if(c.kind === 'film'){
    closeOverlay('tcgOverlay');
    goToFilmDetail(c.film.tmdbId);
    return;
  }
  const body = document.getElementById('tcgCardDetailBody');
  body.innerHTML = `
    <div class="al-detail al-r${c.rank}">
      <span class="al-face">${c.person.image_url ? `<img src="${escapeHtml(c.person.image_url)}" alt="">` : uiIcon('user')}</span>
      <div class="al-detail-name">${escapeHtml(c.person.name)}</div>
      <div class="al-rank"><b>${ALBUM_RANKS[c.rank]}</b> · ${c.kind === 'director' ? 'Réalisateur' : 'Acteur'}</div>
      <p class="al-detail-films">Ses films que tu as vus : ${c.seen.map(escapeHtml).join(', ')}.</p>
    </div>`;
  document.getElementById('tcgCardCopyLink').hidden = true;
  openOverlay('tcgCardOverlay');
}

// Cartes manquantes : un film noté dont les liens n'ont jamais été générés
// (noté avant les cartes, fiche TMDB ajoutée après...). Rattrapées en tâche
// de fond, un film à la fois, puis l'album se recalcule.
async function updateAlbumMissing(){
  if(albumUpdating || !albumData || albumData.missing.length === 0) return;
  albumUpdating = true;
  const missing = albumData.missing.slice(0, 40);
  try{
    for(let i = 0; i < missing.length; i++){
      renderAlbumStatus(`Mise à jour de l’album : ${i + 1} film sur ${missing.length}…`);
      await generateTcgCardsForFilm(missing[i]);
    }
    await loadAlbum();
    if(document.getElementById('tcgOverlay').classList.contains('open')) renderAlbum();
  }catch(e){
    console.error(e);
  }finally{
    albumUpdating = false;
    renderAlbumStatus('');
  }
}

async function openTcgAlbum(){
  closeProfileModal();
  albumShown = ALBUM_PAGE;
  openOverlay('tcgOverlay');
  renderAlbum();
  try{
    await loadAlbum();
  }catch(e){
    console.error(e);
    document.getElementById('tcgAlbum').innerHTML = '<div class="empty-state">L’album n’a pas pu se charger. Réessaie dans un instant.</div>';
    return;
  }
  renderAlbum();
  updateAlbumMissing();
}

// Nombre de cartes, pour la rangée Cartes de la page Profil.
async function refreshAlbumCount(){
  const el = document.getElementById('ppTcgVal');
  if(!el) return;
  try{
    const a = albumData || await loadAlbum();
    el.textContent = `${albumTotal(a)} cartes`;
  }catch(e){
    el.textContent = '';
  }
}

document.querySelectorAll('#tcgOverlay [data-album-tab]').forEach(btn => {
  btn.addEventListener('click', () => { albumTab = btn.dataset.albumTab; albumShown = ALBUM_PAGE; renderAlbum(); });
});
document.getElementById('tcgAlbum').addEventListener('click', (e) => {
  const card = e.target.closest('[data-album-index]');
  if(card) openAlbumCard(Number(card.dataset.albumIndex));
});
