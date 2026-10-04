// --- Cartes à collectionner (TCG, retour utilisateur) ---
// Films/acteurs/réalisateurs, rareté liée à leur notoriété réelle
// (popularité TMDB), débloqués en boosters de 5 en regardant des films (2
// films vus = 1 booster), doublons convertibles en poussière. Voir
// supabase/migrations/041_add_tcg_cards.sql pour le schéma + toute la
// logique de tirage (déjà là-bas, jamais recalculée côté client : un
// tirage décidé en JS serait trivialement manipulable par n'importe qui
// ouvrant la console). Ce fichier ne fait que : générer les cartes au fil
// de l'eau (upsertTcgCard()/linkTcgCard(), appelées en tâche de fond
// depuis handleSave()/handleAddToWatchlist()), appeler open_booster(), et
// afficher collection + ouverture.
//
// Reste à construire (prochaine session, voir le message qui accompagne
// ce commit) : UI d'échange amis/groupes, fabrication contre poussière,
// lien succès -> boosters. La fondation (schéma, génération, tirage,
// ouverture, collection) est, elle, complète et testée.

let tcgCollection = []; // [{ cardId, cardType, name, imageUrl, rarity, quantity }]
let tcgAvailableBoosters = 0;

// --- Génération des cartes (en tâche de fond, jamais bloquant) ---

// Les 6 premiers rôles crédités (TMDB trie déjà son "cast" par ordre de
// billing) — pas tout le générique, qui irait jusqu'aux doublures et
// figurants sans nom : "plus une dimension est connue, plus la carte est
// rare" perd son sens sur un rôle de 3 répliques.
const TCG_CAST_LIMIT = 6;

async function fetchMovieCredits(tmdbId){
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}/credits?language=fr-FR`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${TMDB_API_KEY}`, 'Accept': 'application/json' }
  });
  if(!res.ok) throw new Error(`Erreur TMDB (${res.status})`);
  return res.json();
}

async function upsertTcgCard(cardType, tmdbId, name, imageUrl, popularity){
  const { data, error } = await supabaseClient.rpc('upsert_tcg_card', {
    p_card_type: cardType, p_tmdb_id: tmdbId, p_name: name, p_image_url: imageUrl, p_popularity: popularity || 0
  });
  if(error) throw error;
  return data;
}

async function linkTcgCard(filmCardId, personCardId){
  const { error } = await supabaseClient.rpc('link_tcg_card', { p_film_card_id: filmCardId, p_person_card_id: personCardId });
  if(error) throw error;
}

// Appelée dès qu'un film avec fiche TMDB rejoint le catalogue noté OU la
// watchlist (handleSave()/js/app.js, handleAddToWatchlist()/
// js/watchlist.js) — TOUJOURS en tâche de fond (jamais attendue par
// l'appelant, voir le commentaire sur chaque site d'appel) : générer des
// cartes est un à-côté, jamais une condition à l'enregistrement réel du
// film. Idempotent côté serveur (upsert_tcg_card()/link_tcg_card()) :
// rappelée pour le même film par 10 comptes différents ne crée rien en
// double, juste 10 allers-retours réseau inutiles après le premier —
// accepté comme compromis simple plutôt qu'un cache client à maintenir
// pour un appel qui reste rare (un film par ajout, pas une boucle).
async function generateTcgCardsForFilm(tmdbId){
  try{
    const details = await fetchMovieDetails(tmdbId);
    const filmImg = details.poster_path ? TMDB_IMG_BASE + details.poster_path : null;
    const filmCard = await upsertTcgCard('film', tmdbId, details.title, filmImg, details.popularity);

    const credits = await fetchMovieCredits(tmdbId);
    const director = (credits.crew || []).find(c => c.job === 'Director');
    const topCast = (credits.cast || []).slice(0, TCG_CAST_LIMIT);
    const people = [
      ...(director ? [{ tmdbId: director.id, name: director.name, profilePath: director.profile_path, popularity: director.popularity, role: 'director' }] : []),
      ...topCast.map(c => ({ tmdbId: c.id, name: c.name, profilePath: c.profile_path, popularity: c.popularity, role: 'actor' }))
    ];

    for(const person of people){
      const img = person.profilePath ? TMDB_IMG_BASE + person.profilePath : null;
      const personCard = await upsertTcgCard(person.role, person.tmdbId, person.name, img, person.popularity);
      await linkTcgCard(filmCard.id, personCard.id);
    }
  }catch(e){
    console.error(e);
  }
}

// --- Boosters ---

async function refreshAvailableBoosters(){
  const { data, error } = await supabaseClient.rpc('get_available_boosters');
  if(error){ console.error(error); return; }
  tcgAvailableBoosters = data || 0;
  renderBoosterBar();
}

function renderBoosterBar(){
  const countEl = document.getElementById('tcgBoosterCount');
  const btn = document.getElementById('tcgOpenBoosterBtn');
  if(!countEl) return;
  countEl.textContent = tcgAvailableBoosters > 0
    ? `${tcgAvailableBoosters} booster${tcgAvailableBoosters > 1 ? 's' : ''} disponible${tcgAvailableBoosters > 1 ? 's' : ''}`
    : 'Regarde 2 films pour débloquer un booster';
  btn.disabled = tcgAvailableBoosters <= 0;
}

async function handleOpenBooster(){
  const btn = document.getElementById('tcgOpenBoosterBtn');
  if(btn.disabled) return;
  btn.disabled = true;
  const { data, error } = await supabaseClient.rpc('open_booster');
  if(error){
    showToast(error.message === 'no_booster_available' ? 'Aucun booster disponible pour l\'instant' : 'Erreur à l\'ouverture, réessaie');
    console.error(error);
    btn.disabled = false;
    return;
  }
  tcgAvailableBoosters = Math.max(0, tcgAvailableBoosters - 1);
  renderBoosterBar();
  // data : les 5 (ou moins, voir migrations/041) tcg_cards reçues — la
  // quantité/détention réelle est déjà à jour côté serveur (open_booster()
  // l'a fait), loadTcgCollection() plus bas la relira au prochain affichage
  // de la collection ; cette animation ne fait que RÉVÉLER ce qui a déjà
  // été attribué, elle ne décide jamais rien elle-même.
  openBoosterReveal(data || []);
}

function rarityLabel(rarity){
  return { commun: 'Figurant', rare: 'Second rôle', epique: 'Tête d\'affiche', legendaire: 'Légende du 7e art' }[rarity] || rarity;
}

function tcgCardFaceHtml(card){
  return `
    ${card.image_url
      ? `<img src="${card.image_url}" alt="" loading="lazy">`
      : `<div class="film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
    <div class="tcg-card-name">${escapeHtml(card.name)}</div>
  `;
}

// Révélation du booster — 5 cartes dos tourné, retournées une par une en
// cascade (délai croissant, pas toutes en même temps : le suspense EST le
// point, voir la demande "ça doit être hyper peaufiné, beaucoup
// d'animation"). Une carte Légendaire/Épique reçoit en plus un halo
// marqué à sa révélation (voir .tcg-booster-card.rarity-* dans
// css/style.css) — la seule vraie surprise d'un booster mérite plus qu'un
// simple retournement identique à une carte Commune.
function openBoosterReveal(cards){
  const pack = document.getElementById('tcgBoosterPack');
  const doneBtn = document.getElementById('tcgBoosterDoneBtn');
  doneBtn.style.display = 'none';
  pack.innerHTML = cards.map((c, i) => `
    <div class="tcg-booster-card" id="tcgBoosterCard${i}" data-rarity="${c.rarity}">
      <div class="tcg-booster-card-face tcg-booster-card-back">
        <div class="brand-mark" aria-hidden="true"><div class="brand-mark-violet"></div><div class="brand-mark-gold"></div></div>
      </div>
      <div class="tcg-booster-card-face tcg-booster-card-front rarity-${c.rarity}">
        ${tcgCardFaceHtml(c)}
      </div>
    </div>
  `).join('');
  openOverlay('tcgBoosterOverlay');

  const reduced = motionReduced();
  cards.forEach((c, i) => {
    const delay = reduced ? 0 : 500 + i * 650;
    setTimeout(() => {
      const el = document.getElementById(`tcgBoosterCard${i}`);
      if(el) el.classList.add('revealed');
      if(i === cards.length - 1){
        setTimeout(() => { doneBtn.style.display = ''; }, reduced ? 0 : 700);
      }
    }, delay);
  });
}

document.getElementById('tcgOpenBoosterBtn').addEventListener('click', handleOpenBooster);
document.getElementById('tcgBoosterDoneBtn').addEventListener('click', () => {
  closeOverlay('tcgBoosterOverlay');
  loadTcgCollection().then(renderTcgCollection);
});
document.getElementById('tcgBoosterOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'tcgBoosterOverlay' && document.getElementById('tcgBoosterDoneBtn').style.display !== 'none'){
    closeOverlay('tcgBoosterOverlay');
    loadTcgCollection().then(renderTcgCollection);
  }
});

// --- Collection ---

const RARITY_ORDER = ['commun', 'rare', 'epique', 'legendaire'];

async function loadTcgCollection(){
  const { data, error } = await supabaseClient
    .from('tcg_user_cards')
    .select('quantity, card:tcg_cards(id, card_type, name, image_url, rarity, popularity)')
    .eq('user_id', currentUser.id)
    .order('quantity', { ascending: false });
  if(error){ console.error(error); tcgCollection = []; return; }
  tcgCollection = (data || [])
    .filter(row => row.card && row.quantity > 0)
    .map(row => ({
      cardId: row.card.id, cardType: row.card.card_type, name: row.card.name,
      imageUrl: row.card.image_url, rarity: row.card.rarity, quantity: row.quantity
    }))
    // Les plus rares d'abord — c'est la partie de la collection dont on
    // est le plus fier, elle doit sauter aux yeux en premier, pas être
    // noyée après des dizaines de Communs.
    .sort((a, b) => RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity));
}

function renderTcgCollection(){
  const grid = document.getElementById('tcgCollectionGrid');
  const typeFilter = document.getElementById('tcgTypeFilter').value;
  const rarityFilter = document.getElementById('tcgRarityFilter').value;
  const filtered = tcgCollection.filter(c =>
    (!typeFilter || c.cardType === typeFilter) && (!rarityFilter || c.rarity === rarityFilter)
  );
  if(tcgCollection.length === 0){
    grid.innerHTML = `<div class="empty-state">Pas encore de carte — ouvre ton premier booster pour commencer.</div>`;
    return;
  }
  if(filtered.length === 0){
    grid.innerHTML = `<div class="empty-state">Rien avec ces filtres pour l'instant.</div>`;
    return;
  }
  grid.innerHTML = filtered.map(c => `
    <div class="tcg-card rarity-${c.rarity}" title="${escapeHtml(c.name)} — ${rarityLabel(c.rarity)}">
      ${c.imageUrl
        ? `<img src="${c.imageUrl}" alt="" loading="lazy">`
        : `<div class="film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="tcg-card-name">${escapeHtml(c.name)}</div>
      ${c.quantity > 1 ? `<div class="tcg-card-qty">×${c.quantity}</div>` : ''}
    </div>
  `).join('');
}

async function openTcgModal(){
  closeProfileModal();
  openOverlay('tcgOverlay');
  document.getElementById('tcgCollectionGrid').innerHTML = skeletonRows();
  await Promise.all([refreshAvailableBoosters(), loadTcgCollection()]);
  renderTcgCollection();
}

function closeTcgModal(){
  closeOverlay('tcgOverlay', () => openProfileModal());
}

document.getElementById('tcgBtn').addEventListener('click', openTcgModal);
document.getElementById('closeTcg').addEventListener('click', closeTcgModal);
document.getElementById('tcgOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'tcgOverlay') closeTcgModal();
});
document.getElementById('tcgTypeFilter').addEventListener('change', renderTcgCollection);
document.getElementById('tcgRarityFilter').addEventListener('change', renderTcgCollection);
