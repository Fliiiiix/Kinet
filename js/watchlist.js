// --- Watchlist ("à voir") ---
// Liste séparée du catalogue noté (table `watchlist`, voir
// supabase/migrations/006). Ajout rapide : titre + fiche TMDB optionnelle +
// note libre, sans passer par la grille de critères. "Noter" transforme un
// item en film noté (ouvre le formulaire principal prérempli) et le retire
// de la watchlist une fois le film enregistré — voir handleSave() dans
// js/app.js, qui référence convertingFromWatchlistId.
//
// Écran à part entière (#/watchlist), pas une modal — voir js/router.js,
// même principe que Groupes (js/groups.js).

let watchlist = [];
let wlTmdbSelected = null; // { tmdb_id, poster_url, overview, release_year, title }
let convertingFromWatchlistId = null;
// Alerte "un ami a noté un film de ta watchlist" (retour utilisateur) —
// watchlistId -> [{ friendId, note }], voir get_watchlist_friend_ratings()
// (migrations/039), jointure fiable sur tmdb_id (jamais le titre).
let watchlistFriendRatings = {};
// Filtre "dispo sur ma plateforme" (retour utilisateur) — tmdbId -> liste
// de plateformes en ABONNEMENT (flatrate uniquement, voir
// loadWatchlistProviders() plus bas) ; absent tant que non vérifié, []
// explicitement vide si vérifié mais aucune plateforme FR. Jamais stocké en
// base ni mis en cache entre deux ouvertures de la page, même philosophie
// que "Où regarder" sur la fiche film (js/tmdb.js, js/filmDetail.js) : la
// disponibilité change sans prévenir.
let watchlistProviders = {};

async function loadWatchlist(){
  const { data, error } = await supabaseClient
    .from('watchlist')
    .select('*')
    .order('added', { ascending: false });
  if(error){
    // Repli hors ligne (js/offline.js) : contrairement à loadFilms()/
    // loadViewings() (appelées au démarrage, avant même que l'utilisateur
    // choisisse une page), celle-ci n'est appelée qu'en ouvrant #/watchlist
    // — donc la seule à avoir une chance de détecter le hors ligne si
    // l'utilisateur y arrive par un lien direct sans passer par l'accueil.
    const cached = loadOfflineCache('watchlist');
    if(cached){
      watchlist = cached.data;
      enterOfflineMode(cached.savedAt);
      return;
    }
    showToast('Erreur de chargement de la watchlist');
    console.error(error);
    watchlist = [];
    return;
  }
  watchlist = data.map(row => ({
    id: row.id,
    title: row.title,
    note: row.note || null,
    tmdbId: row.tmdb_id || null,
    posterUrl: row.poster_url || null,
    overview: row.overview || null,
    releaseYear: row.release_year || null,
    // Date de sortie complète (migrations/025), utilisée par la section
    // Prochaines sorties (js/upcoming.js) pour trier par proximité réelle
    // — null pour les entrées ajoutées avant cette colonne, ou sans fiche
    // TMDB : ignorées par cette section plutôt que de fausser le tri.
    releaseDate: row.release_date || null,
    originalTitle: row.original_title || null,
    added: row.added
  }));
  saveOfflineCache('watchlist', watchlist);
}

// Alerte "un ami a noté un film de ta watchlist" (retour utilisateur) —
// null si aucun ami n'a noté ce tmdb_id (rien à afficher). Un seul ami :
// son prénom + sa note ; plusieurs : décompte + moyenne, pour ne pas
// allonger la ligne d'une liste de noms qui pourrait devenir longue.
function friendRatingsLabel(watchlistId){
  const ratings = watchlistFriendRatings[watchlistId];
  if(!ratings || ratings.length === 0) return null;
  if(ratings.length === 1){
    return `👋 ${friendDisplayName(ratings[0].friendId)} a mis ${ratings[0].note.toFixed(1)}`;
  }
  const avg = ratings.reduce((a, r) => a + r.note, 0) / ratings.length;
  return `👋 ${ratings.length} amis l'ont noté (moy. ${avg.toFixed(1)})`;
}

// Filtre plateforme (retour utilisateur) — select masqué tant qu'il n'a pas
// d'options réelles (voir buildWatchlistProviderFilterOptions()), donc
// toujours "" (aucun filtre) à ce moment-là ; getElementById plutôt qu'une
// valeur passée en paramètre, même choix que genreFilter/yearFilter dans
// render() (js/app.js) pour rester la seule source de vérité. Extrait de
// renderWatchlist() pour être réutilisé par la roulette "Surprends-moi"
// (openSurprise() plus bas) : un tirage doit respecter le même filtre que
// la liste affichée, pas piocher dans toute la watchlist si on vient de la
// réduire à "dispo sur Netflix".
function getFilteredWatchlist(){
  const providerFilter = document.getElementById('wlProviderFilter').value;
  return providerFilter
    ? watchlist.filter(item => (watchlistProviders[item.tmdbId] || []).some(p => String(p.provider_id) === providerFilter))
    : watchlist;
}

function renderWatchlist(){
  const list = document.getElementById('wlList');
  if(watchlist.length === 0){
    list.innerHTML = `<div class="empty-state">Rien pour l'instant. Ajoute un film ci-dessus.</div>`;
    return;
  }
  const filtered = getFilteredWatchlist();
  if(filtered.length === 0){
    list.innerHTML = `<div class="empty-state">Rien de ta watchlist n'est dispo là-dessus pour l'instant.</div>`;
    return;
  }
  list.innerHTML = '';
  filtered.forEach(item => {
    const row = document.createElement('div');
    row.className = 'wl-row';
    const friendLabel = friendRatingsLabel(item.id);
    row.innerHTML = `
      ${item.posterUrl
        ? `<img class="film-poster" src="${item.posterUrl}" alt="" loading="lazy">`
        : `<div class="film-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="wl-main">
        <div class="wl-title">${escapeHtml(item.title)}${item.releaseYear ? ` <span class="wl-year">(${item.releaseYear})</span>` : ''}</div>
        ${item.note ? `<div class="wl-note">${escapeHtml(item.note)}</div>` : ''}
        ${friendLabel ? `<div class="wl-friend-rating">${escapeHtml(friendLabel)}</div>` : ''}
        <div class="wl-quick-form" data-quick-form="${item.id}" style="display:none;">
          <input type="number" class="wl-quick-note-input" min="0" max="5" step="0.5" placeholder="Note /5" data-id="${item.id}" aria-label="Note rapide pour ${escapeHtml(item.title)}">
          <button class="btn" type="button" data-action="quick-confirm" data-id="${item.id}">OK</button>
          <button class="btn secondary" type="button" data-action="quick-cancel" data-id="${item.id}">Annuler</button>
        </div>
      </div>
      <div class="wl-actions">
        <button class="btn secondary" data-action="quick" data-id="${item.id}" title="Note rapide : noter d'un coup, sans la grille complète">⚡ Rapide</button>
        <button class="btn secondary" data-action="rate" data-id="${item.id}">✔ Noter</button>
        <button class="btn danger" data-action="remove" data-id="${item.id}">Retirer</button>
      </div>
    `;
    const quickForm = row.querySelector('[data-quick-form]');
    const quickInput = row.querySelector('.wl-quick-note-input');
    row.querySelector('[data-action="quick"]').addEventListener('click', () => {
      quickForm.style.display = quickForm.style.display === 'none' ? '' : 'none';
      if(quickForm.style.display !== 'none') quickInput.focus();
    });
    row.querySelector('[data-action="quick-cancel"]').addEventListener('click', () => {
      quickForm.style.display = 'none';
      quickInput.value = '';
    });
    const quickConfirmBtn = row.querySelector('[data-action="quick-confirm"]');
    quickConfirmBtn.addEventListener('click', () => handleQuickRate(item, quickInput.value, quickConfirmBtn, quickInput));
    quickInput.addEventListener('keydown', (e) => {
      if(e.key === 'Enter'){ e.preventDefault(); handleQuickRate(item, quickInput.value, quickConfirmBtn, quickInput); }
    });
    row.querySelector('[data-action="rate"]').addEventListener('click', () => startRatingFromWatchlist(item));
    row.querySelector('[data-action="remove"]').addEventListener('click', () => handleRemoveFromWatchlist(item.id));
    // Fiche film (retour utilisateur : "dans à voir je ne peux pas cliquer
    // sur le film pour arriver sur sa fiche de présentation comme dans le
    // top"). Même goToFilmDetail() que le Top films (js/top.js). Ignore
    // les clics dans .wl-actions/.wl-quick-form (boutons, champ de note
    // rapide) : ce sont déjà leurs propres actions, jamais une navigation.
    if(item.tmdbId){
      row.classList.add('wl-row-clickable');
      makeRowClickable(row, (e) => {
        if(e.target.closest('.wl-actions, .wl-quick-form')) return;
        goToFilmDetail(item.tmdbId);
      });
    }
    list.appendChild(row);
  });
}

// Alerte "un ami a noté un film de ta watchlist" (retour utilisateur) —
// voir get_watchlist_friend_ratings() (migrations/039), jointure fiable
// sur tmdb_id.
async function loadWatchlistFriendRatings(){
  const { data, error } = await supabaseClient.rpc('get_watchlist_friend_ratings');
  if(error){ console.error(error); watchlistFriendRatings = {}; return; }
  watchlistFriendRatings = {};
  (data || []).forEach(row => {
    (watchlistFriendRatings[row.watchlist_id] = watchlistFriendRatings[row.watchlist_id] || [])
      .push({ friendId: row.friend_id, note: Number(row.note) });
  });
  const missing = [...new Set((data || []).map(r => r.friend_id))].filter(id => !friendProfiles[id]);
  if(missing.length > 0){
    const { data: profs, error: profErr } = await supabaseClient
      .from('profiles')
      .select('user_id, display_name, avatar_url')
      .in('user_id', missing);
    if(profErr) console.error(profErr);
    else profs.forEach(p => cacheProfile(p.user_id, p.display_name, p.avatar_url));
  }
}

// Filtre "dispo sur ma plateforme" (retour utilisateur : "trouver
// facilement les films de ma watchlist dispo sur Netflix") — une requête
// TMDB par film qui a une fiche (même endpoint que "Où regarder", voir
// fetchWatchProviders(), js/tmdb.js), en parallèle plutôt qu'en série : une
// watchlist de taille normale (quelques dizaines de titres) reste rapide,
// et un seul film qui échoue (réseau, titre sans donnée FR) n'empêche pas
// les autres de s'afficher. Résultat posé sur watchlistProviders avant même
// que tout le lot soit fini n'aurait pas de sens ici (contrairement à
// openWatchlist() plus bas qui, lui, affiche déjà la liste sans attendre) —
// le filtre lui-même n'a aucun intérêt tant qu'il ne connaît qu'une partie
// des films, Promise.all attend donc le lot entier avant de rendre la main.
async function loadWatchlistProviders(){
  watchlistProviders = {};
  const withTmdbId = watchlist.filter(item => item.tmdbId);
  await Promise.all(withTmdbId.map(async (item) => {
    try{
      const providers = await fetchWatchProviders(item.tmdbId, 'movie');
      watchlistProviders[item.tmdbId] = (providers && providers.flatrate) || [];
    }catch(e){
      console.error(e);
      watchlistProviders[item.tmdbId] = [];
    }
  }));
}

// Options de #wlProviderFilter — même principe que buildGenreFilterOptions()
// (js/app.js) : seules les plateformes RÉELLEMENT présentes dans la
// watchlist (jamais une liste Netflix/Canal+/Prime... générique, une
// plateforme qui ne concerne aucun film n'a rien à faire dans ce select).
// Un même provider_id peut revenir sur plusieurs films, dédupliqué ici.
function buildWatchlistProviderFilterOptions(){
  const sel = document.getElementById('wlProviderFilter');
  const current = sel.value;
  const present = new Map(); // provider_id -> provider_name
  Object.values(watchlistProviders).forEach(list => {
    list.forEach(p => present.set(p.provider_id, p.provider_name));
  });
  if(present.size === 0){
    sel.style.display = 'none';
    sel.innerHTML = `<option value="">Toutes les plateformes</option>`;
    return;
  }
  const options = Array.from(present.entries())
    .sort((a, b) => a[1].localeCompare(b[1], 'fr'))
    .map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`)
    .join('');
  sel.innerHTML = `<option value="">Toutes les plateformes</option>${options}`;
  sel.style.display = '';
  if(current && present.has(Number(current))) sel.value = current;
}

// Page watchlist — appelée par le routeur (#/watchlist).
async function openWatchlist(){
  document.getElementById('wlList').innerHTML = skeletonRows();
  await loadWatchlist();
  renderWatchlist();
  // Suggestions + alerte "ami a noté" (retour utilisateur) : ni l'une ni
  // l'autre n'est attendue — la page s'affiche sans attendre ces
  // compléments, qui se posent tout seuls une fois prêts (même principe
  // que refreshActivityBadge()/maybeShowDigest(), js/auth.js).
  loadSuggestions();
  loadWatchlistFriendRatings().then(renderWatchlist);
  loadWatchlistProviders().then(() => {
    buildWatchlistProviderFilterOptions();
    renderWatchlist();
  });
}

async function handleAddToWatchlist(){
  if(blockIfOffline()) return; // js/offline.js — lecture seule hors ligne
  const title = document.getElementById('wlTitleInput').value.trim();
  if(!title){
    showToast('Ajoute un titre avant d\'enregistrer');
    return;
  }
  const note = document.getElementById('wlNoteInput').value.trim() || null;
  const tmdbFields = wlTmdbSelected
    ? { tmdb_id: wlTmdbSelected.tmdb_id, poster_url: wlTmdbSelected.poster_url, overview: wlTmdbSelected.overview, release_year: wlTmdbSelected.release_year, release_date: wlTmdbSelected.release_date, original_title: wlTmdbSelected.original_title }
    : { tmdb_id: null, poster_url: null, overview: null, release_year: null, release_date: null, original_title: null };

  const { data, error } = await supabaseClient
    .from('watchlist')
    .insert({ title, note, added: Date.now(), ...tmdbFields })
    .select()
    .single();
  if(error){
    showToast('Erreur de sauvegarde, réessaie');
    console.error(error);
    return;
  }

  watchlist.unshift({
    id: data.id, title, note,
    tmdbId: tmdbFields.tmdb_id, posterUrl: tmdbFields.poster_url,
    overview: tmdbFields.overview, releaseYear: tmdbFields.release_year,
    releaseDate: tmdbFields.release_date,
    originalTitle: tmdbFields.original_title,
    added: data.added
  });
  renderWatchlist();

  // Cartes (js/tcg.js) : un film en watchlist entre déjà dans le pool
  // personnel d'un tirage (voir open_booster(), migrations/041), même sans
  // être encore noté — jamais attendue, même raison que dans handleSave()
  // (js/app.js).
  if(tmdbFields.tmdb_id) generateTcgCardsForFilm(tmdbFields.tmdb_id);

  document.getElementById('wlTitleInput').value = '';
  document.getElementById('wlNoteInput').value = '';
  clearWlTmdbSelection();
  playPopChime();
  showToast('Ajouté à la watchlist');
}

// Toast d'annulation (v2.8) plutôt qu'un confirm() bloquant — voir
// showUndoToast() (js/ui.js) : l'item disparaît tout de suite de l'écran,
// la suppression réelle en base n'a lieu qu'à l'expiration du délai.
// Pas de blockIfOffline() ici (retour utilisateur, file d'attente hors
// ligne, js/offlineQueue.js) : retirer un item cible un id déjà connu,
// rejouable sans réconciliation — voir le onCommit ci-dessous, qui met en
// file plutôt que d'attempter un appel réseau voué à échouer hors ligne.
function handleRemoveFromWatchlist(id){
  const idx = watchlist.findIndex(w => w.id === id);
  if(idx === -1) return;
  const [removed] = watchlist.splice(idx, 1);
  renderWatchlist();
  showUndoToast(
    `« ${removed.title} » retiré de la watchlist`,
    async () => {
      if(isOfflineMode){
        enqueueOfflineWrite({ table: 'watchlist', op: 'delete', match: { id } });
        return;
      }
      const { error } = await supabaseClient.from('watchlist').delete().eq('id', id);
      if(error){
        console.error(error);
        // L'item a déjà disparu de l'écran et la fenêtre d'annulation est
        // passée — un rechargement de la page le restaurera (jamais
        // supprimé côté base en cas d'erreur réseau) plutôt qu'un échec
        // silencieux qui laisserait croire que la suppression a eu lieu.
        showToast('Erreur de suppression, réessaie');
      }
    },
    () => {
      watchlist.splice(idx, 0, removed);
      renderWatchlist();
    }
  );
}

// --- Note rapide depuis la watchlist (retour utilisateur : convertir un
// item en film noté avec une seule note globale, sans ouvrir la grille
// complète à 7 critères) --- Crée directement le film en note manuelle,
// symétrique de la branche création de handleSave() (js/app.js) mais sans
// passer par le formulaire/la modale : un seul champ, un seul clic.
async function handleQuickRate(item, rawValue, confirmBtn, inputEl){
  if(blockIfOffline()) return; // js/offline.js — lecture seule hors ligne
  // Garde anti double-soumission : le clic "OK" et la touche Entrée
  // appellent tous les deux cette fonction, et rien ne retire la ligne de
  // l'écran avant la fin de l'await ci-dessous (renderWatchlist() n'arrive
  // qu'au tout dernier moment) — sans ce verrou, un double-clic ou un Entrée
  // suivi d'un clic insère le même film deux fois. Comparable au filet déjà
  // en place ailleurs (ex. bendBtn.disabled dans js/happenings.js).
  if(confirmBtn && confirmBtn.disabled) return;
  const value = rawValue.trim();
  if(value === ''){
    showToast('Indique une note avant de valider');
    return;
  }
  const manualNote = Math.max(0, Math.min(5, parseFloat(value)));
  if(Number.isNaN(manualNote)){
    showToast('Note invalide');
    return;
  }
  if(confirmBtn) confirmBtn.disabled = true;
  if(inputEl) inputEl.disabled = true;
  const tmdbFields = item.tmdbId
    ? { tmdb_id: item.tmdbId, poster_url: item.posterUrl, overview: item.overview, release_year: item.releaseYear, original_title: item.originalTitle, genre_ids: [] }
    : { tmdb_id: null, poster_url: null, overview: null, release_year: null, original_title: null, genre_ids: [] };

  const { data, error } = await supabaseClient
    .from('films')
    .insert({ title: item.title, crit: {}, fav: false, added: Date.now(), manual_note: manualNote, review: null, ...tmdbFields })
    .select()
    .single();
  if(error){
    showToast('Erreur de sauvegarde, réessaie');
    console.error(error);
    if(confirmBtn) confirmBtn.disabled = false;
    if(inputEl) inputEl.disabled = false;
    return;
  }
  films.push(rowToFilm(data));
  await addViewing(data.id, data.added);

  const { error: wlError } = await supabaseClient.from('watchlist').delete().eq('id', item.id);
  if(wlError) console.error(wlError); // le film est déjà enregistré, on ne bloque pas là-dessus
  watchlist = watchlist.filter(w => w.id !== item.id);

  renderWatchlist();
  buildGenreFilterOptions();
  render();
  playSuccessChime();
  showToast('Noté !');
}

// Bascule vers le formulaire principal (grille/note manuelle) prérempli avec
// le titre et la fiche TMDB déjà connus. L'item n'est retiré de la watchlist
// qu'une fois le film effectivement enregistré, voir handleSave() (app.js).
// Retour à l'accueil d'abord (comme avant : fermer la modale watchlist
// laissait déjà voir l'accueil en dessous) — le formulaire s'ouvre par-dessus.
function startRatingFromWatchlist(item){
  goHome();
  openModal(null);
  document.getElementById('titleInput').value = item.title;
  if(item.tmdbId){
    tmdbSelected = {
      tmdb_id: item.tmdbId, poster_url: item.posterUrl,
      overview: item.overview, release_year: item.releaseYear, title: item.title,
      original_title: item.originalTitle
    };
    updateTmdbSelectedUI();
  }
  convertingFromWatchlistId = item.id;
}

// --- "Surprends-moi" (retour utilisateur) --- Tire un film au hasard dans
// la watchlist (respecte le filtre plateforme actif — voir
// getFilteredWatchlist(), "piocher dans Netflix" doit rester cohérent avec
// la liste affichée) pour aider à décider quoi regarder ce soir, version
// "avant" plutôt qu'"après" le visionnage. Roulette façon ouverture de
// caisse (retour utilisateur, motion design) — voir .surprise-roulette
// (css/style.css). Le VRAI tirage (currentSurpriseItem) est décidé AVANT
// de construire la bande, jamais l'inverse : la bande n'est qu'une mise en
// scène de ce choix déjà fait, chaque film du lot garde exactement les
// mêmes chances d'être tiré, peu importe où il atterrit visuellement.
let currentSurpriseItem = null;
let surpriseSpinning = false;

// Longueur de la bande et position de la case gagnante dedans — assez de
// recul AVANT (le temps que la décélération se sente vraiment) et assez
// d'images APRÈS (la bande ne s'arrête pas pile au bord du cadre, encore
// un peu de défilement visible une fois le repère atteint).
const ROULETTE_LENGTH = 32;
const ROULETTE_WINNER_INDEX = 24;

function rouletteItemHtml(item){
  return `
    <div class="surprise-roulette-item">
      ${item.posterUrl
        ? `<img src="${item.posterUrl}" alt="" loading="lazy">`
        : `<div class="film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
    </div>
  `;
}

// pool : la liste dans laquelle tirer (déjà filtrée par l'appelant). Les
// cases autour du tirage sont piochées au hasard dans ce même pool — avec
// une petite liste, le même poster revient plusieurs fois dans la bande,
// sans conséquence (ce n'est QUE le décor du tirage, voir le commentaire
// plus haut).
function buildRouletteStripHtml(pool, winner){
  let html = '';
  for(let i = 0; i < ROULETTE_LENGTH; i++){
    html += rouletteItemHtml(i === ROULETTE_WINNER_INDEX ? winner : pool[Math.floor(Math.random() * pool.length)]);
  }
  return html;
}

// Pas de 2e affiche ici (retour utilisateur : "cropée, moche") — .surprise-
// poster forçait .film-poster (pensé pour une ligne compacte, 52×78) à
// 160px de large SANS redéfinir sa hauteur, donc un cover sur un format
// 2:3 largement écrasé. La bande au-dessus (.surprise-roulette) montre
// déjà une vraie affiche, celle du tirage, en entier et sans ce problème —
// pas la peine d'en remontrer une seconde, moins bonne, juste en dessous.
function renderSurpriseContent(item){
  document.getElementById('surpriseContent').innerHTML = `
    <div class="surprise-info">
      <div class="wl-title">${escapeHtml(item.title)}${item.releaseYear ? ` <span class="wl-year">(${item.releaseYear})</span>` : ''}</div>
      ${item.note ? `<div class="wl-note">${escapeHtml(item.note)}</div>` : ''}
    </div>
  `;
}

// Lance un tirage dans pool : construit la bande, l'anime jusqu'au repère
// central, révèle le résultat à l'arrivée. Appelée à l'ouverture ET à
// chaque "Encore un" — un reroll est un tirage comme un autre, pas un cas
// à part.
function spinSurpriseRoulette(pool){
  if(surpriseSpinning) return; // anti double-lancement (boutons désactivés pendant le tirage, filet en plus)
  surpriseSpinning = true;
  currentSurpriseItem = pool[Math.floor(Math.random() * pool.length)];

  const content = document.getElementById('surpriseContent');
  const rerollBtn = document.getElementById('surpriseRerollBtn');
  const rateBtn = document.getElementById('surpriseRateBtn');
  content.style.display = 'none';
  rerollBtn.disabled = true;
  rateBtn.disabled = true;

  const frame = document.getElementById('surpriseRoulette');
  const track = document.getElementById('surpriseRouletteTrack');
  track.innerHTML = buildRouletteStripHtml(pool, currentSurpriseItem);

  // Reset instantané à la position de départ (transition coupée le temps de
  // ce reset) avant de la rejouer — sans ça, un 2e tirage ("Encore un")
  // repartirait de la position d'arrivée du précédent : un balayage parfois
  // très court plutôt que le grand geste voulu à chaque fois.
  track.style.transition = 'none';
  track.style.transform = 'translateX(0)';
  void track.offsetWidth; // force le reflow avant de relire les positions ci-dessous et de relancer la transition

  const winnerEl = track.children[ROULETTE_WINNER_INDEX];
  const itemWidth = winnerEl.getBoundingClientRect().width;
  // Espace entre deux cases consécutives (largeur + gap) — sert de pas pour
  // le tic sonore pendant le défilement (voir la boucle de suivi plus bas) :
  // mesuré sur le vrai rendu, comme le reste de ce calcul, pas recopié du
  // CSS (le seuil mobile change la largeur des cases).
  const itemSpacing = track.children[1].offsetLeft - track.children[0].offsetLeft;
  const viewportWidth = frame.getBoundingClientRect().width;
  // Léger aléa (jamais pile centré sous le repère) : un vrai tirage
  // n'atterrit jamais exactement au même pixel — +/- un quart de la largeur
  // d'une case reste toujours clairement DANS la case gagnante.
  const jitter = (Math.random() - 0.5) * itemWidth * 0.5;
  const targetOffset = winnerEl.offsetLeft + itemWidth / 2 - viewportWidth / 2 + jitter;

  // motionReduced() (js/ui.js) plutôt que prefersReducedMotion()
  // (js/happenings.js, réglage système seul) : la roulette est un élément
  // d'interface normal, pas un easter egg — même helper que le reste des
  // interactions "sérieuses" de js/ui.js (inclinaison des lignes, clin
  // d'œil du logo), qui respecte EN PLUS le réglage propre à Kinet
  // (Paramètres → Réduire les animations).
  const reduced = motionReduced();
  let done = false;
  const finish = () => {
    if(done) return;
    done = true;
    winnerEl.classList.add('winner');
    renderSurpriseContent(currentSurpriseItem);
    content.style.display = '';
    rerollBtn.disabled = false;
    rateBtn.disabled = false;
    surpriseSpinning = false;
    playRouletteWin();
  };

  requestAnimationFrame(() => {
    track.style.transition = reduced ? 'none' : '';
    track.style.transform = `translateX(${-targetOffset}px)`;
    // Filet (même principe que closeOverlay(), js/ui.js) : transitionend ne
    // se déclenche jamais pour une transition coupée (reduced:'none',
    // transition:none), le setTimeout est alors le SEUL signal de fin.
    track.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, (reduced ? 0 : 5000) + 200);

    // Tic sonore façon ouverture de caisse (retour utilisateur) — un tic à
    // chaque case qui franchit le repère, voir playRouletteTick()
    // (js/sound.js). Lu sur la VRAIE position interpolée de la transition
    // en cours (getComputedStyle().transform, mis à jour par le navigateur
    // à chaque frame pendant l'animation) plutôt qu'un minuteur à part :
    // le tempo suit alors tout seul la décélération réelle de la bande
    // (rafale au départ, tics isolés à l'arrivée), sans dupliquer la
    // courbe cubic-bezier ici. Sautée entièrement sous reduced (pas de
    // défilement à accompagner, juste le son d'arrivée).
    if(!reduced){
      let lastTickIndex = null;
      const tick = () => {
        if(done) return;
        const match = getComputedStyle(track).transform.match(/matrix\(([^)]+)\)/);
        const tx = match ? parseFloat(match[1].split(',')[4]) : 0;
        const idx = Math.round(-tx / itemSpacing);
        if(idx !== lastTickIndex){
          lastTickIndex = idx;
          playRouletteTick();
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  });
}

function openSurprise(){
  const pool = getFilteredWatchlist();
  if(watchlist.length === 0){
    showToast('Ta watchlist est vide — ajoute un film d\'abord');
    return;
  }
  if(pool.length === 0){
    showToast('Rien sur cette plateforme pour l\'instant — change le filtre');
    return;
  }
  openOverlay('surpriseOverlay');
  spinSurpriseRoulette(pool);
}

document.getElementById('wlSurpriseBtn').addEventListener('click', openSurprise);
document.getElementById('closeSurprise').addEventListener('click', () => closeOverlay('surpriseOverlay'));
document.getElementById('surpriseOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'surpriseOverlay') closeOverlay('surpriseOverlay');
});
document.getElementById('surpriseRerollBtn').addEventListener('click', () => {
  spinSurpriseRoulette(getFilteredWatchlist());
});
document.getElementById('surpriseRateBtn').addEventListener('click', () => {
  closeOverlay('surpriseOverlay', () => startRatingFromWatchlist(currentSurpriseItem));
});

// --- Recherche TMDB pour le formulaire d'ajout rapide ---
// Le champ "Titre du film" fait aussi office de recherche (debounce pendant
// la frappe), comme dans le formulaire principal — voir js/tmdb.js.

let wlTmdbSearchTimer = null;

function renderWlTmdbResults(results){
  const wrap = document.getElementById('wlTmdbResults');
  if(!results.length){
    wrap.innerHTML = `<div class="tmdb-empty">Aucun résultat.</div>`;
    return;
  }
  wrap.innerHTML = '';
  results.forEach(r => {
    const year = r.release_date ? r.release_date.slice(0, 4) : '?';
    const poster = r.poster_path ? TMDB_IMG_BASE + r.poster_path : null;
    const item = document.createElement('div');
    item.className = 'tmdb-result';
    item.innerHTML = `
      ${poster ? `<img src="${poster}" alt="">` : `<div class="tmdb-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="tmdb-result-info">
        <div class="tmdb-result-title">${escapeHtml(r.title)}</div>
        <div class="tmdb-result-year">${year}</div>
      </div>
    `;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectWlTmdbResult(r); });
    wrap.appendChild(item);
  });
}

function selectWlTmdbResult(r){
  wlTmdbSelected = {
    tmdb_id: r.id,
    poster_url: r.poster_path ? TMDB_IMG_BASE + r.poster_path : null,
    overview: r.overview || null,
    release_year: r.release_date ? parseInt(r.release_date.slice(0, 4), 10) : null,
    // Date complète (migrations/025) — voir js/upcoming.js.
    release_date: r.release_date || null,
    title: r.title,
    original_title: r.original_title && r.original_title !== r.title ? r.original_title : null
  };
  document.getElementById('wlTitleInput').value = r.title;
  document.getElementById('wlTmdbResults').innerHTML = '';
  updateWlTmdbSelectedUI();
}

function clearWlTmdbSelection(){
  wlTmdbSelected = null;
  updateWlTmdbSelectedUI();
}

function updateWlTmdbSelectedUI(){
  const box = document.getElementById('wlTmdbSelected');
  const img = document.getElementById('wlTmdbSelectedPoster');
  if(!wlTmdbSelected){
    box.style.display = 'none';
    return;
  }
  box.style.display = '';
  img.src = wlTmdbSelected.poster_url || '';
  img.style.display = wlTmdbSelected.poster_url ? '' : 'none';
  document.getElementById('wlTmdbSelectedTitle').textContent =
    wlTmdbSelected.title + (wlTmdbSelected.release_year ? ` (${wlTmdbSelected.release_year})` : '');
}

async function handleWlTmdbSearch(query){
  const wrap = document.getElementById('wlTmdbResults');
  wrap.innerHTML = `<div class="tmdb-empty">Recherche…</div>`;
  try{
    const results = await searchTmdb(query);
    renderWlTmdbResults(results);
  }catch(e){
    wrap.innerHTML = `<div class="tmdb-empty">${escapeHtml(e.message)}</div>`;
    console.error(e);
  }
}

document.getElementById('watchlistBtn').addEventListener('click', goToWatchlist);
document.getElementById('watchlistPageBack').addEventListener('click', goHome);
{
  const wlAddBtn = document.getElementById('wlAddBtn');
  wlAddBtn.addEventListener('click', withSubmitGuard(wlAddBtn, handleAddToWatchlist));
}
document.getElementById('wlTitleInput').addEventListener('input', () => {
  clearTimeout(wlTmdbSearchTimer);
  const query = document.getElementById('wlTitleInput').value.trim();
  if(query.length < 2){
    document.getElementById('wlTmdbResults').innerHTML = '';
    return;
  }
  wlTmdbSearchTimer = setTimeout(() => handleWlTmdbSearch(query), 350);
});
document.getElementById('wlTitleInput').addEventListener('blur', () => {
  setTimeout(() => { document.getElementById('wlTmdbResults').innerHTML = ''; }, 150);
});
document.getElementById('wlTmdbClearBtn').addEventListener('click', clearWlTmdbSelection);
document.getElementById('wlProviderFilter').addEventListener('change', renderWatchlist);
