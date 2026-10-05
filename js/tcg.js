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
// Fabrication (doublons -> poussière -> carte précise) et échange entre
// amis ajoutés après coup — schéma/fonctions déjà prêts côté base depuis
// le premier jour (upsert_tcg_card()/open_booster() mis à part, aucune
// des fonctions ci-dessous ne décide jamais rien : disenchant_card()/
// craft_card()/accept_trade() valident et déplacent tout côté serveur,
// ce fichier ne fait qu'afficher et appeler).
//
// Reste à construire : lien succès -> boosters, sélecteur de partenaire
// d'échange élargi aux membres de groupe (accept_trade() les autorise déjà
// côté base, voir migrations/041 — juste pas de picker dédié ici, qui
// demanderait de charger tous les membres de tous les groupes rien que
// pour ce sélecteur).

let tcgCollection = []; // [{ cardId, cardType, name, imageUrl, rarity, quantity }]
let tcgAvailableBoosters = 0;
let tcgDustAmount = 0;
let tcgCardNameCache = {}; // cardId -> { name, rarity } — cartes croisées dans des échanges, pas forcément dans tcgCollection
let tcgPendingTrades = [];
let tcgTradePartnerId = null;
let tcgTradePartnerCollection = [];
let tcgTradeOffered = new Set(); // card ids pris dans MA collection
let tcgTradeRequested = new Set(); // card ids pris dans la collection du partenaire

// Miroir côté client de dust_value()/craft_cost() (migrations/041) —
// UNIQUEMENT pour l'affichage (coût annoncé avant de cliquer) : la vraie
// valeur dépensée/reçue est toujours celle calculée côté serveur par
// disenchant_card()/craft_card(), jamais celle-ci.
const TCG_DUST_VALUE = { commun: 5, rare: 20, epique: 100, legendaire: 400 };
const TCG_CRAFT_COST = { commun: 20, rare: 80, epique: 400, legendaire: 1600 };

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

// --- Rattrapage du catalogue existant ---
// generateTcgCardsForFilm() n'est appelée QUE sur un enregistrement/ajout
// NEUF (handleSave()/handleAddToWatchlist()) — un compte qui a déjà
// plusieurs dizaines de films notés AVANT l'arrivée de cette
// fonctionnalité n'a donc, à ce stade, encore AUCUNE carte générée pour
// eux (observé en vrai : des boosters disponibles dès le premier jour,
// grâce à get_available_boosters() qui compte tous les visionnages passés
// — mais un pool de tirage vide en face). Rattrapage un par un plutôt
// qu'une fonction serveur dédiée qui recevrait toute la liste d'un coup :
// generateTcgCardsForFilm() fait déjà exactement ce qu'il faut par film,
// pas la peine d'une 2e implémentation à maintenir en parallèle. Séquentiel
// (pas Promise.all) : des dizaines de films en parallèle solliciteraient
// TMDB et Supabase d'un coup inutilement fort pour un rattrapage qui n'a
// aucune urgence à la seconde près.
let tcgBackfillRunning = false;

async function backfillTcgCards(onProgress){
  if(tcgBackfillRunning) return;
  tcgBackfillRunning = true;
  try{
    const ids = new Set();
    films.forEach(f => { if(f.tmdbId) ids.add(f.tmdbId); });
    watchlist.forEach(w => { if(w.tmdbId) ids.add(w.tmdbId); });
    const list = Array.from(ids);
    for(let i = 0; i < list.length; i++){
      await generateTcgCardsForFilm(list[i]);
      if(onProgress) onProgress(i + 1, list.length);
    }
    try{ localStorage.setItem('kinetTcgBackfillDone', '1'); }catch(e){}
  }finally{
    tcgBackfillRunning = false;
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
    // Ouvert depuis l'overlay (« Ouvrir un autre booster ») : sans ça,
    // l'overlay resterait bloqué, sans bouton pour le fermer.
    if(document.getElementById('tcgBoosterOverlay').classList.contains('open')){
      document.getElementById('tcgBoosterNextBtn').style.display = 'none';
      document.getElementById('tcgBoosterDoneBtn').style.display = '';
    }
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
  const nextBtn = document.getElementById('tcgBoosterNextBtn');
  doneBtn.style.display = 'none';
  nextBtn.style.display = 'none';
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
  // Déjà ouvert (enchaînement « Ouvrir un autre booster ») : on ne le rouvre
  // pas, sinon le retour du focus mémoriserait un bouton caché.
  if(!document.getElementById('tcgBoosterOverlay').classList.contains('open')) openOverlay('tcgBoosterOverlay');

  const reduced = motionReduced();
  cards.forEach((c, i) => {
    const delay = reduced ? 0 : 500 + i * 650;
    setTimeout(() => {
      const el = document.getElementById(`tcgBoosterCard${i}`);
      if(el){
        el.classList.add('revealed');
        playCardFlip();
        playRarityReveal(c.rarity);
      }
      if(i === cards.length - 1){
        setTimeout(() => {
          doneBtn.style.display = '';
          // Un autre booster seulement s'il en reste (tcgAvailableBoosters
          // est déjà décrémenté par handleOpenBooster()).
          nextBtn.style.display = tcgAvailableBoosters > 0 ? '' : 'none';
          if(tcgAvailableBoosters > 0) nextBtn.focus();
        }, reduced ? 0 : 700);
      }
    }, delay);
  });
}

document.getElementById('tcgOpenBoosterBtn').addEventListener('click', handleOpenBooster);
document.getElementById('tcgBoosterNextBtn').addEventListener('click', () => {
  // Cache tout de suite le bouton : évite un double clic pendant l'appel réseau.
  document.getElementById('tcgBoosterNextBtn').style.display = 'none';
  document.getElementById('tcgBoosterDoneBtn').style.display = 'none';
  handleOpenBooster();
});
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

function getTcgBackfillDone(){
  try{ return localStorage.getItem('kinetTcgBackfillDone') === '1'; }
  catch(e){ return false; }
}

function updateTcgScanStatus(done, total){
  const el = document.getElementById('tcgScanStatus');
  if(!el) return;
  if(!tcgBackfillRunning){ el.textContent = ''; return; }
  el.textContent = total ? `Scan de ton catalogue… ${done}/${total}` : 'Scan de ton catalogue…';
}

// Rattrapage auto UNE SEULE FOIS par appareil (voir backfillTcgCards()) —
// en tâche de fond, jamais attendue : le reste de la modale (collection,
// boosters déjà générés) s'affiche sans dépendre de la fin du scan, qui
// peut prendre plusieurs minutes sur un gros catalogue. Bouton "Scanner
// mon catalogue" toujours visible en plus (voir index.html) : reprend la
// main si le rattrapage auto a été interrompu (onglet fermé en plein
// milieu) ou pour forcer un nouveau passage après un gros import.
async function handleScanCatalog(){
  if(tcgBackfillRunning) return;
  await backfillTcgCards((done, total) => {
    updateTcgScanStatus(done, total);
    // Révèle les cartes au fil du scan plutôt qu'à la toute fin — un
    // catalogue de 200 films mettrait sinon plusieurs minutes à montrer
    // le moindre résultat alors que les premières cartes existent déjà.
    if(done % 5 === 0 || done === total) loadTcgCollection().then(renderTcgCollection);
  });
  updateTcgScanStatus(false, 0);
  loadTcgCollection().then(renderTcgCollection);
}

// --- Onglets Collection / Fabriquer / Échanger --- même composant que les
// onglets Admin/Avatar (.avatar-source-tabs), voir setAdminTab()
// (js/admin.js) pour le même principe appliqué ailleurs.
function setTcgTab(tab){
  document.querySelectorAll('#tcgTabs .avatar-source-tab').forEach(btn => {
    const active = btn.dataset.tcgTab === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.getElementById('tcgPanelCollection').style.display = tab === 'collection' ? '' : 'none';
  document.getElementById('tcgPanelCraft').style.display = tab === 'craft' ? '' : 'none';
  document.getElementById('tcgPanelTrade').style.display = tab === 'trade' ? '' : 'none';
  if(tab === 'craft') loadCraftTab();
  else if(tab === 'trade') loadTradeTab();
}

// --- Fabriquer : doublons -> poussière -> carte précise ---

async function refreshDustBalance(){
  const { data, error } = await supabaseClient.from('tcg_dust').select('amount').eq('user_id', currentUser.id).maybeSingle();
  tcgDustAmount = (!error && data) ? data.amount : 0;
  const el = document.getElementById('tcgDustCount');
  if(el) el.textContent = `✨ ${tcgDustAmount} poussière`;
}

async function loadCraftTab(){
  document.getElementById('tcgDuplicatesList').innerHTML = skeletonRows();
  await Promise.all([refreshDustBalance(), loadTcgCollection()]);
  renderDuplicatesList();
}

// Doublons = quantity > 1 (voir disenchant_card(), migrations/041 : le
// dernier exemplaire reste toujours intouchable, jamais désenchantable) —
// un seul exemplaire EN TROP à la fois par clic, pas de sélecteur de
// quantité : reclique autant de fois que de doublons à écouler, mental
// model plus simple qu'un champ numérique pour un geste déjà rapide.
function renderDuplicatesList(){
  const wrap = document.getElementById('tcgDuplicatesList');
  const dups = tcgCollection.filter(c => c.quantity > 1);
  if(dups.length === 0){
    wrap.innerHTML = `<div class="tmdb-empty">Pas de doublon pour l'instant.</div>`;
    return;
  }
  wrap.innerHTML = dups.map(c => `
    <div class="wl-row">
      ${c.imageUrl
        ? `<img class="film-poster" src="${c.imageUrl}" alt="" loading="lazy">`
        : `<div class="film-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="wl-main">
        <div class="wl-title">${escapeHtml(c.name)}</div>
        <div class="wl-note"><span class="tcg-rarity-tag rarity-${c.rarity}">${rarityLabel(c.rarity)}</span> · ×${c.quantity} (${c.quantity - 1} en trop) · +${TCG_DUST_VALUE[c.rarity]} poussière</div>
      </div>
      <div class="wl-actions">
        <button class="btn secondary" type="button" data-disenchant="${c.cardId}">✨ Désenchanter 1</button>
      </div>
    </div>
  `).join('');
  wrap.querySelectorAll('[data-disenchant]').forEach(btn => {
    btn.addEventListener('click', () => handleDisenchant(Number(btn.dataset.disenchant), btn));
  });
}

async function handleDisenchant(cardId, btn){
  btn.disabled = true;
  const { data, error } = await supabaseClient.rpc('disenchant_card', { p_card_id: cardId, p_quantity: 1 });
  if(error){
    showToast(error.message === 'not_enough_duplicates' ? 'Plus de doublon à désenchanter' : 'Erreur, réessaie');
    console.error(error);
    btn.disabled = false;
    return;
  }
  tcgDustAmount = data;
  document.getElementById('tcgDustCount').textContent = `✨ ${tcgDustAmount} poussière`;
  await loadTcgCollection();
  renderDuplicatesList();
  playDustChime();
  showToast('Désenchantée — poussière ajoutée');
}

let tcgCraftSearchTimer = null;
document.getElementById('tcgCraftSearch').addEventListener('input', () => {
  clearTimeout(tcgCraftSearchTimer);
  const q = document.getElementById('tcgCraftSearch').value.trim();
  if(q.length < 2){ document.getElementById('tcgCraftResults').innerHTML = ''; return; }
  tcgCraftSearchTimer = setTimeout(() => runCraftSearch(q), 300);
});

// Cherche dans TOUT le catalogue partagé (tcg_cards), pas juste ta
// collection — fabriquer sert justement à obtenir une carte qu'on n'a pas
// (ou pas assez), chercher uniquement dans ce qu'on possède déjà n'aurait
// aucun sens.
async function runCraftSearch(query){
  const wrap = document.getElementById('tcgCraftResults');
  wrap.innerHTML = `<div class="tmdb-empty">Recherche…</div>`;
  const { data, error } = await supabaseClient
    .from('tcg_cards')
    .select('id, card_type, name, image_url, rarity')
    .ilike('name', `%${query}%`)
    .limit(20);
  if(error){
    wrap.innerHTML = `<div class="tmdb-empty">Erreur de recherche.</div>`;
    console.error(error);
    return;
  }
  if(!data || data.length === 0){
    wrap.innerHTML = `<div class="tmdb-empty">Aucune carte connue avec ce nom — elle n'a peut-être encore été générée par personne (voir "Scanner mon catalogue").</div>`;
    return;
  }
  wrap.innerHTML = data.map(c => {
    const cost = TCG_CRAFT_COST[c.rarity];
    const affordable = tcgDustAmount >= cost;
    return `
      <div class="wl-row">
        ${c.image_url
          ? `<img class="film-poster" src="${c.image_url}" alt="" loading="lazy">`
          : `<div class="film-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
        <div class="wl-main">
          <div class="wl-title">${escapeHtml(c.name)}</div>
          <div class="wl-note"><span class="tcg-rarity-tag rarity-${c.rarity}">${rarityLabel(c.rarity)}</span> · coût : ${cost} poussière</div>
        </div>
        <div class="wl-actions">
          <button class="btn secondary" type="button" data-craft="${c.id}" ${affordable ? '' : 'disabled title="Pas assez de poussière"'}>Fabriquer</button>
        </div>
      </div>
    `;
  }).join('');
  wrap.querySelectorAll('[data-craft]').forEach(btn => {
    btn.addEventListener('click', () => handleCraft(Number(btn.dataset.craft), btn));
  });
}

async function handleCraft(cardId, btn){
  btn.disabled = true;
  const { data, error } = await supabaseClient.rpc('craft_card', { p_card_id: cardId });
  if(error){
    showToast(error.message === 'not_enough_dust' ? 'Pas assez de poussière' : 'Erreur, réessaie');
    console.error(error);
    btn.disabled = false;
    return;
  }
  tcgDustAmount = data;
  document.getElementById('tcgDustCount').textContent = `✨ ${tcgDustAmount} poussière`;
  playSuccessChime();
  showToast('Carte fabriquée !');
  // Les coûts affichés dans les résultats déjà à l'écran dépendent du
  // solde (affordable, voir runCraftSearch()) — relance la même recherche
  // pour qu'un autre résultat devenu inabordable se grise immédiatement.
  const q = document.getElementById('tcgCraftSearch').value.trim();
  if(q.length >= 2) runCraftSearch(q);
}

// --- Échanger (amis) ---

async function loadTradeTab(){
  populateTradePartnerSelect();
  document.getElementById('tcgTradesList').innerHTML = skeletonRows();
  await loadPendingTrades();
  renderPendingTrades();
}

function populateTradePartnerSelect(){
  const sel = document.getElementById('tcgTradePartnerSelect');
  const current = sel.value;
  const accepted = friendships.filter(f => f.status === 'accepted');
  const options = accepted
    .map(f => ({ id: otherUserId(f), name: friendDisplayName(otherUserId(f)) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    .map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`)
    .join('');
  sel.innerHTML = `<option value="">Choisis un ami</option>${options}`;
  if(current && accepted.some(f => otherUserId(f) === current)) sel.value = current;
}

async function loadPendingTrades(){
  const { data, error } = await supabaseClient
    .from('tcg_trades')
    .select('*')
    .or(`from_user.eq.${currentUser.id},to_user.eq.${currentUser.id}`)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if(error){ console.error(error); tcgPendingTrades = []; return; }
  tcgPendingTrades = data || [];

  const missingProfiles = [...new Set(tcgPendingTrades.map(t => t.from_user === currentUser.id ? t.to_user : t.from_user))]
    .filter(id => !friendProfiles[id]);
  if(missingProfiles.length > 0){
    const { data: profs, error: profErr } = await supabaseClient
      .from('profiles').select('user_id, display_name, avatar_url').in('user_id', missingProfiles);
    if(profErr) console.error(profErr);
    else (profs || []).forEach(p => cacheProfile(p.user_id, p.display_name, p.avatar_url));
  }

  // Noms/raretés des cartes citées dans ces échanges — un seul aller-
  // retour groupé plutôt qu'un par ligne offered/requested.
  const cardIds = new Set();
  tcgPendingTrades.forEach(t => {
    (t.offered || []).forEach(i => cardIds.add(i.card_id));
    (t.requested || []).forEach(i => cardIds.add(i.card_id));
  });
  if(cardIds.size > 0){
    const { data: cards, error: cardErr } = await supabaseClient
      .from('tcg_cards').select('id, name, rarity').in('id', Array.from(cardIds));
    if(cardErr) console.error(cardErr);
    else (cards || []).forEach(c => { tcgCardNameCache[c.id] = c; });
  }
}

function tcgCardNamesFromItems(items){
  return (items || []).map(i => (tcgCardNameCache[i.card_id] || {}).name || '?').join(', ');
}

function renderPendingTrades(){
  const section = document.getElementById('tcgTradesSection');
  const wrap = document.getElementById('tcgTradesList');
  if(tcgPendingTrades.length === 0){ section.style.display = 'none'; return; }
  section.style.display = '';
  wrap.innerHTML = tcgPendingTrades.map(t => {
    const incoming = t.to_user === currentUser.id;
    const partnerId = incoming ? t.from_user : t.to_user;
    // "offered"/"requested" sont toujours du point de vue de from_user —
    // pour qui REÇOIT la proposition (incoming), ce qu'il DONNERAIT s'il
    // accepte est donc "requested", pas "offered".
    const give = tcgCardNamesFromItems(incoming ? t.requested : t.offered);
    const receive = tcgCardNamesFromItems(incoming ? t.offered : t.requested);
    return `
      <div class="wl-row">
        <span class="friend-avatar-placeholder friend-avatar">🔄</span>
        <div class="wl-main">
          <div class="wl-title">${incoming ? 'Proposé par' : 'Proposé à'} ${escapeHtml(friendDisplayName(partnerId))}</div>
          <div class="wl-note">Tu donnes : ${escapeHtml(give) || '—'}<br>Tu reçois : ${escapeHtml(receive) || '—'}</div>
        </div>
        <div class="wl-actions">
          ${incoming
            ? `<button class="btn" type="button" data-accept-trade="${t.id}">Accepter</button><button class="btn danger" type="button" data-resolve-trade="${t.id}" data-resolve-status="declined">Refuser</button>`
            : `<button class="btn danger" type="button" data-resolve-trade="${t.id}" data-resolve-status="cancelled">Annuler</button>`}
        </div>
      </div>
    `;
  }).join('');
  wrap.querySelectorAll('[data-accept-trade]').forEach(btn => {
    btn.addEventListener('click', () => handleAcceptTrade(Number(btn.dataset.acceptTrade), btn));
  });
  wrap.querySelectorAll('[data-resolve-trade]').forEach(btn => {
    btn.addEventListener('click', () => handleResolveTrade(Number(btn.dataset.resolveTrade), btn.dataset.resolveStatus, btn));
  });
}

async function handleAcceptTrade(tradeId, btn){
  btn.disabled = true;
  const { error } = await supabaseClient.rpc('accept_trade', { p_trade_id: tradeId });
  if(error){
    showToast('Cet échange n\'est plus disponible (cartes déjà reparties ailleurs ?)');
    console.error(error);
    btn.disabled = false;
    return;
  }
  playSuccessChime();
  showToast('Échange conclu !');
  await loadPendingTrades();
  renderPendingTrades();
  await loadTcgCollection();
  renderTcgCollection();
}

async function handleResolveTrade(tradeId, status, btn){
  btn.disabled = true;
  const { error } = await supabaseClient
    .from('tcg_trades')
    .update({ status, responded_at: new Date().toISOString() })
    .eq('id', tradeId);
  if(error){ showToast('Erreur, réessaie'); console.error(error); btn.disabled = false; return; }
  await loadPendingTrades();
  renderPendingTrades();
}

document.getElementById('tcgTradePartnerSelect').addEventListener('change', async (e) => {
  tcgTradePartnerId = e.target.value || null;
  tcgTradeOffered = new Set();
  tcgTradeRequested = new Set();
  const builder = document.getElementById('tcgTradeBuilder');
  if(!tcgTradePartnerId){ builder.style.display = 'none'; return; }
  builder.style.display = '';
  document.getElementById('tcgTradeMyCards').innerHTML = skeletonRows();
  document.getElementById('tcgTradeTheirCards').innerHTML = skeletonRows();
  await Promise.all([loadTcgCollection(), loadPartnerCollection(tcgTradePartnerId)]);
  renderTradeBuilder();
});

async function loadPartnerCollection(partnerId){
  const { data, error } = await supabaseClient
    .from('tcg_user_cards')
    .select('quantity, card:tcg_cards(id, card_type, name, image_url, rarity)')
    .eq('user_id', partnerId)
    .order('quantity', { ascending: false });
  if(error){ console.error(error); tcgTradePartnerCollection = []; return; }
  tcgTradePartnerCollection = (data || [])
    .filter(row => row.card && row.quantity > 0)
    .map(row => ({
      cardId: row.card.id, cardType: row.card.card_type, name: row.card.name,
      imageUrl: row.card.image_url, rarity: row.card.rarity, quantity: row.quantity
    }));
}

function tcgTradeCardHtml(c, selected){
  return `
    <div class="tcg-card rarity-${c.rarity}${selected ? ' selected' : ''}" data-trade-card="${c.cardId}" title="${escapeHtml(c.name)}">
      ${c.imageUrl
        ? `<img src="${c.imageUrl}" alt="" loading="lazy">`
        : `<div class="film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="tcg-card-name">${escapeHtml(c.name)}</div>
      ${c.quantity > 1 ? `<div class="tcg-card-qty">×${c.quantity}</div>` : ''}
    </div>
  `;
}

// Sélection par clic (toggle), jamais de quantité par carte pour cette 1ère
// version — offrir/demander 1 exemplaire d'une carte à la fois reste
// largement suffisant pour un échange entre amis, évite un sélecteur
// numérique par carte en plus du reste.
function renderTradeBuilder(){
  const mine = document.getElementById('tcgTradeMyCards');
  const theirs = document.getElementById('tcgTradeTheirCards');
  mine.innerHTML = tcgCollection.length
    ? tcgCollection.map(c => tcgTradeCardHtml(c, tcgTradeOffered.has(c.cardId))).join('')
    : `<div class="tmdb-empty">Rien à proposer pour l'instant.</div>`;
  theirs.innerHTML = tcgTradePartnerCollection.length
    ? tcgTradePartnerCollection.map(c => tcgTradeCardHtml(c, tcgTradeRequested.has(c.cardId))).join('')
    : `<div class="tmdb-empty">Rien dans sa collection pour l'instant.</div>`;
  mine.querySelectorAll('[data-trade-card]').forEach(el => {
    el.addEventListener('click', () => {
      const id = Number(el.dataset.tradeCard);
      if(tcgTradeOffered.has(id)) tcgTradeOffered.delete(id); else tcgTradeOffered.add(id);
      renderTradeBuilder();
    });
  });
  theirs.querySelectorAll('[data-trade-card]').forEach(el => {
    el.addEventListener('click', () => {
      const id = Number(el.dataset.tradeCard);
      if(tcgTradeRequested.has(id)) tcgTradeRequested.delete(id); else tcgTradeRequested.add(id);
      renderTradeBuilder();
    });
  });
  const summary = document.getElementById('tcgTradeSummary');
  const submitBtn = document.getElementById('tcgTradeSubmitBtn');
  const ok = tcgTradeOffered.size > 0 && tcgTradeRequested.size > 0;
  summary.textContent = ok
    ? `Tu proposes ${tcgTradeOffered.size} carte${tcgTradeOffered.size > 1 ? 's' : ''} contre ${tcgTradeRequested.size} carte${tcgTradeRequested.size > 1 ? 's' : ''}.`
    : 'Choisis au moins une carte de chaque côté.';
  submitBtn.disabled = !ok;
}

document.getElementById('tcgTradeSubmitBtn').addEventListener('click', async () => {
  const btn = document.getElementById('tcgTradeSubmitBtn');
  btn.disabled = true;
  const offered = Array.from(tcgTradeOffered).map(id => ({ card_id: id, quantity: 1 }));
  const requested = Array.from(tcgTradeRequested).map(id => ({ card_id: id, quantity: 1 }));
  const { error } = await supabaseClient.from('tcg_trades').insert({
    from_user: currentUser.id, to_user: tcgTradePartnerId, offered, requested
  });
  if(error){
    showToast('Erreur lors de la proposition, réessaie');
    console.error(error);
    btn.disabled = false;
    return;
  }
  showToast('Échange proposé !');
  tcgTradeOffered = new Set();
  tcgTradeRequested = new Set();
  document.getElementById('tcgTradePartnerSelect').value = '';
  document.getElementById('tcgTradeBuilder').style.display = 'none';
  await loadPendingTrades();
  renderPendingTrades();
  btn.disabled = false;
});

document.querySelectorAll('#tcgTabs .avatar-source-tab').forEach(btn => {
  btn.addEventListener('click', () => setTcgTab(btn.dataset.tcgTab));
});

async function openTcgModal(){
  closeProfileModal();
  setTcgTab('collection');
  openOverlay('tcgOverlay');
  document.getElementById('tcgCollectionGrid').innerHTML = skeletonRows();
  await Promise.all([refreshAvailableBoosters(), loadTcgCollection()]);
  renderTcgCollection();
  if(!getTcgBackfillDone()) handleScanCatalog();
}

function closeTcgModal(){
  closeOverlay('tcgOverlay', () => openProfileModal());
}

document.getElementById('tcgOddsToggle').addEventListener('click', () => {
  document.getElementById('tcgOddsHelp').classList.toggle('open');
});
document.getElementById('tcgScanBtn').addEventListener('click', handleScanCatalog);
document.getElementById('tcgBtn').addEventListener('click', openTcgModal);
document.getElementById('closeTcg').addEventListener('click', closeTcgModal);
document.getElementById('tcgOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'tcgOverlay') closeTcgModal();
});
document.getElementById('tcgTypeFilter').addEventListener('change', renderTcgCollection);
document.getElementById('tcgRarityFilter').addEventListener('change', renderTcgCollection);
