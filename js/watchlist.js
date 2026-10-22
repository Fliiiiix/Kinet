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
// Vrai une fois le lot entier vérifié (loadWatchlistProviders()) : le tirage
// « Surprends-moi » sur une plateforme attend ce moment plutôt que de
// piocher dans une liste à moitié connue.
let watchlistProvidersReady = false;

// Ajoute un film TMDB brut (résultat de /search, /upcoming, /similar...) à
// À voir et le place en tête de `watchlist`. Renvoie l'élément ajouté, ou
// null (hors ligne, erreur déjà signalée). Partagée par les suggestions
// (js/suggestions.js) et « Au cinéma » (js/upcoming.js).
async function addTmdbMovieToWatchlist(r){
  if(blockIfOffline()) return null; // js/offline.js : lecture seule hors ligne
  const payload = {
    title: r.title,
    note: null,
    added: Date.now(),
    tmdb_id: r.id,
    poster_url: r.poster_path ? TMDB_IMG_BASE + r.poster_path : null,
    overview: r.overview || null,
    release_year: r.release_date ? parseInt(r.release_date.slice(0, 4), 10) : null,
    release_date: r.release_date || null,
    original_title: r.original_title && r.original_title !== r.title ? r.original_title : null
  };
  const { data, error } = await supabaseClient.from('watchlist').insert(payload).select().single();
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return null;
  }
  const item = {
    id: data.id, title: payload.title, note: null,
    tmdbId: payload.tmdb_id, posterUrl: payload.poster_url, overview: payload.overview,
    releaseYear: payload.release_year, releaseDate: payload.release_date,
    originalTitle: payload.original_title, added: data.added
  };
  watchlist.unshift(item);
  return item;
}

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
    showToast('Erreur de chargement d\'À voir');
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
    return `${friendDisplayName(ratings[0].friendId)} a mis ${ratings[0].note.toFixed(1)}`;
  }
  const avg = ratings.reduce((a, r) => a + r.note, 0) / ratings.length;
  return `${ratings.length} amis l'ont noté (moy. ${avg.toFixed(1)})`;
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
  if(!providerFilter) return watchlist;
  const mine = getMyStreamingServices();
  return watchlist.filter(item => watchlistServices(item).some(s =>
    providerFilter === MY_SERVICES_FILTER ? mine.has(s.key) : s.key === providerFilter));
}

// --- Plateformes sur les affiches (draft du 15/10, option A validée) ---
// Une plateforme, un nom : TMDB liste aussi les variantes « with Ads »,
// « Premium » et les chaînes Amazon (« HBO Max Amazon Channel »), qui
// comptent ici pour le service lui-même (31 noms deviennent 22 sur un vrai
// À voir). Seul l'abonnement (flatrate) compte, comme le filtre.
const STREAMING_SERVICE_ALIASES = {
  'amazon prime video': 'Prime Video',
  'disney plus': 'Disney+',
  'paramount plus': 'Paramount+',
  'cine+ ocs': 'Ciné+ OCS'
};
const WATCHLIST_LOGO_BASE = 'https://image.tmdb.org/t/p/w92';
const WATCHLIST_MAX_LOGOS = 2;
const MY_SERVICES_FILTER = '__mine';
const MY_SERVICES_KEY = 'kinetMyStreamingServices';

function streamingServiceBaseName(providerName){
  return String(providerName || '').trim()
    .replace(/\s+Amazon Channel$/i, '')
    .replace(/\s+(Standard\s+)?with Ads$/i, '')
    .replace(/\s+Premium$/i, '')
    .trim();
}

function streamingServiceName(providerName){
  const base = streamingServiceBaseName(providerName);
  return STREAMING_SERVICE_ALIASES[base.toLowerCase()] || base;
}

// Plateformes d'un film, une par service, dans l'ordre de TMDB
// (display_priority). Le logo est celui du service lui-même quand TMDB le
// donne, pas celui d'une variante (pub, chaîne Amazon).
function groupStreamingServices(flatrate){
  const byKey = new Map();
  (flatrate || []).forEach(p => {
    const name = streamingServiceName(p.provider_name);
    const key = name.toLowerCase();
    const isVariant = streamingServiceBaseName(p.provider_name) !== String(p.provider_name || '').trim();
    const priority = typeof p.display_priority === 'number' ? p.display_priority : 999;
    const prev = byKey.get(key);
    if(!prev){
      byKey.set(key, { key, name, logoPath: p.logo_path || null, priority, isVariant });
      return;
    }
    prev.priority = Math.min(prev.priority, priority);
    if(prev.isVariant && !isVariant && p.logo_path){
      prev.logoPath = p.logo_path;
      prev.isVariant = false;
    }
  });
  return Array.from(byKey.values()).sort((a, b) => a.priority - b.priority);
}

function watchlistServices(item){
  return groupStreamingServices(watchlistProviders[item.tmdbId]);
}

// « Mes abonnements » : les plateformes cochées une fois par l'utilisateur.
// Gardées sur cet appareil (même principe que grille ou liste, getViewMode(),
// js/ui.js). Vide = toutes les plateformes restent sur les affiches.
function getMyStreamingServices(){
  try{
    const parsed = JSON.parse(localStorage.getItem(MY_SERVICES_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed : []);
  }catch(e){
    return new Set();
  }
}

function toggleMyStreamingService(key){
  const mine = getMyStreamingServices();
  if(mine.has(key)) mine.delete(key); else mine.add(key);
  try{ localStorage.setItem(MY_SERVICES_KEY, JSON.stringify(Array.from(mine))); }catch(e){}
  saveMyStreamingServicesRemote(Array.from(mine));
  return mine;
}

// Les mêmes abonnements sur PC et téléphone (draft Profil du 15/10) : la
// table user_prefs (migration 062, lisible par son seul propriétaire) fait
// foi quand elle existe ; le localStorage reste la copie locale, et le seul
// endroit tant que la migration n'est pas lancée.
let myServicesRemoteReady = false;

async function saveMyStreamingServicesRemote(list){
  if(!myServicesRemoteReady || !currentUser) return;
  const { error } = await supabaseClient.from('user_prefs')
    .upsert({ user_id: currentUser.id, streaming_services: list, updated_at: new Date().toISOString() });
  if(error) console.error(error);
}

// Appelée après la connexion (js/auth.js), sans être attendue. Premier
// appareil après la migration : rien en base, on y range ce qui est déjà
// coché ici.
async function syncMyStreamingServices(){
  if(!currentUser) return;
  const { data, error } = await supabaseClient.from('user_prefs')
    .select('streaming_services').eq('user_id', currentUser.id).maybeSingle();
  if(error){ myServicesRemoteReady = false; return; } // migration 062 pas encore lancée
  myServicesRemoteReady = true;
  if(data && Array.isArray(data.streaming_services)){
    try{ localStorage.setItem(MY_SERVICES_KEY, JSON.stringify(data.streaming_services)); }catch(e){}
    if(typeof parseRoute === 'function' && parseRoute().name === 'watchlist') renderWatchlist();
    return;
  }
  const local = Array.from(getMyStreamingServices());
  if(local.length) saveMyStreamingServicesRemote(local);
}

// Depuis Paramètres → Mes abonnements : le panneau s'ouvre dès que le bouton
// « Mes abonnements » d'À voir apparaît (il attend les plateformes).
function openMyServicesPanelWhenReady(){
  const started = Date.now();
  const tick = () => {
    const toggle = document.getElementById('wlSubsToggle');
    const panel = document.getElementById('wlSubsPanel');
    if(toggle && panel && toggle.style.display !== 'none' && parseRoute().name === 'watchlist'){
      if(panel.style.display === 'none') toggleMyServicesPanel();
      toggle.scrollIntoView({ block: 'center', behavior: motionReduced() ? 'auto' : 'smooth' });
      return;
    }
    if(Date.now() - started < 8000) setTimeout(tick, 150);
  };
  setTimeout(tick, 150);
}

// Logos dans le coin bas de l'affiche : deux au plus, puis « +n ». Avec des
// abonnements cochés, seulement ceux-là.
function watchlistServicesHtml(item){
  const mine = getMyStreamingServices();
  const services = watchlistServices(item).filter(s => mine.size === 0 || mine.has(s.key));
  if(services.length === 0) return '';
  const names = services.map(s => s.name).join(', ');
  const extra = services.length - WATCHLIST_MAX_LOGOS;
  return `<div class="wl-services" role="img" aria-label="Disponible sur ${escapeHtml(names)}" title="${escapeHtml(names)}">${
    services.slice(0, WATCHLIST_MAX_LOGOS).map(s => s.logoPath
      ? `<img src="${escapeHtml(WATCHLIST_LOGO_BASE + s.logoPath)}" alt="" loading="lazy">`
      : `<span class="wl-services-more">${escapeHtml(s.name.slice(0, 2))}</span>`).join('')
  }${extra > 0 ? `<span class="wl-services-more">+${extra}</span>` : ''}</div>`;
}

function renderWatchlist(){
  const list = document.getElementById('wlList');
  if(watchlist.length === 0){
    list.innerHTML = `<div class="empty-state">Rien pour l'instant. Ajoute un film ci-dessus.</div>`;
    return;
  }
  const filtered = getFilteredWatchlist();
  if(filtered.length === 0){
    const onMine = document.getElementById('wlProviderFilter').value === MY_SERVICES_FILTER;
    list.innerHTML = `<div class="empty-state">Aucun film à voir n'est disponible sur ${onMine ? 'tes abonnements' : 'cette plateforme'} pour l'instant.</div>`;
    return;
  }
  list.innerHTML = '';
  const navList = filtered.filter(item => item.tmdbId).map(item => ({ tmdbId: item.tmdbId, title: item.title }));
  filtered.forEach(item => {
    const row = document.createElement('div');
    row.className = 'wl-row';
    const friendLabel = friendRatingsLabel(item.id);
    row.innerHTML = `
      ${item.posterUrl
        ? `<img class="film-poster" src="${escapeHtml(item.posterUrl)}" alt="" loading="lazy">`
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
      ${watchlistServicesHtml(item)}
      <div class="wl-actions">${rowMoreButtonHtml(`Actions pour ${item.title}`)}</div>
    `;
    const quickForm = row.querySelector('[data-quick-form]');
    const quickInput = row.querySelector('.wl-quick-note-input');
    // Audit M6 : trois boutons sous chaque affiche (Rapide, Noter, Retirer)
    // remplacés par le menu « ⋯ » (openRowMenu(), js/ui.js) ; l'affiche,
    // elle, ouvre la fiche.
    const openQuickForm = () => {
      quickForm.style.display = '';
      quickInput.focus();
    };
    const moreBtn = row.querySelector('.row-more-btn');
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openRowMenu(moreBtn, [
        { label: 'Note rapide', onSelect: openQuickForm },
        { label: 'Noter avec la grille', onSelect: () => startRatingFromWatchlist(item) },
        { label: 'Retirer d\'À voir', danger: true, onSelect: () => handleRemoveFromWatchlist(item.id) }
      ]);
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
    // Fiche film (retour utilisateur : "dans à voir je ne peux pas cliquer
    // sur le film pour arriver sur sa fiche de présentation comme dans le
    // top"). Même goToFilmDetail() que le Top films (js/top.js). Ignore
    // les clics dans .wl-actions/.wl-quick-form (boutons, champ de note
    // rapide) : ce sont déjà leurs propres actions, jamais une navigation.
    if(item.tmdbId){
      row.classList.add('wl-row-clickable');
      makeRowClickable(row, (e) => {
        if(e.target.closest('.wl-actions, .wl-quick-form')) return;
        goToFilmDetail(item.tmdbId, navList);
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
// des films, on attend donc le lot entier avant de rendre la main.
// Audit C2 : une watchlist réelle compte plus de 200 films, tout lancer d'un
// coup faisait répondre TMDB « trop de requêtes » (429) en rafale. Au plus
// WATCHLIST_PROVIDERS_CONCURRENCY requêtes en vol ; fetchWatchProviders()
// réessaie après un 429 et garde ses réponses en cache (js/tmdb.js).
const WATCHLIST_PROVIDERS_CONCURRENCY = 6;

async function loadWatchlistProviders(){
  watchlistProviders = {};
  watchlistProvidersReady = false;
  const queue = watchlist.filter(item => item.tmdbId);
  const worker = async () => {
    while(queue.length > 0){
      const item = queue.shift();
      try{
        const providers = await fetchWatchProviders(item.tmdbId, 'movie');
        watchlistProviders[item.tmdbId] = (providers && providers.flatrate) || [];
      }catch(e){
        console.error(e);
        watchlistProviders[item.tmdbId] = [];
      }
    }
  };
  const workers = Math.min(WATCHLIST_PROVIDERS_CONCURRENCY, queue.length);
  await Promise.all(Array.from({ length: workers }, worker));
  watchlistProvidersReady = true;
  renderWatchlistReminder();
}

// Rappel de visionnage : combien de films de la watchlist sont disponibles en
// streaming (inclus dans un abonnement), et sur quelle plateforme il y en a le
// plus. Masqué s'il n'y en a aucun, pour ne pas ajouter du bruit.
function renderWatchlistReminder(){
  const el = document.getElementById('wlReminder');
  if(!el) return;
  const mine = getMyStreamingServices();
  if(mine.size > 0 && Object.keys(watchlistProviders).length > 0){
    // Avec « Mes abonnements » : ce que tu peux voir ce soir.
    const n = watchlist.filter(item => watchlistServices(item).some(s => mine.has(s.key))).length;
    el.textContent = n > 0
      ? `${n} film${n > 1 ? 's' : ''} à voir disponible${n > 1 ? 's' : ''} sur tes abonnements.`
      : 'Aucun film à voir sur tes abonnements pour l\'instant.';
    el.style.display = '';
    return;
  }
  const parPlateforme = new Map(); // clé du service -> { nom, n }
  let filmsDispo = 0;
  watchlist.forEach(item => {
    const offres = watchlistServices(item);
    if(offres.length) filmsDispo++;
    offres.forEach(s => {
      const entree = parPlateforme.get(s.key) || { nom: s.name, n: 0 };
      entree.n++;
      parPlateforme.set(s.key, entree);
    });
  });
  if(filmsDispo === 0){ el.style.display = 'none'; el.textContent = ''; return; }
  const meilleure = [...parPlateforme.values()].sort((a, b) => b.n - a.n)[0];
  el.textContent = `${filmsDispo} film${filmsDispo > 1 ? 's' : ''} à voir disponible${filmsDispo > 1 ? 's' : ''} en streaming. Le plus sur ${meilleure.nom} (${meilleure.n}).`;
  el.style.display = '';
}

// Options de #wlProviderFilter — même principe que buildGenreFilterOptions()
// (js/app.js) : seules les plateformes RÉELLEMENT présentes dans la
// watchlist (jamais une liste Netflix/Canal+/Prime... générique, une
// plateforme qui ne concerne aucun film n'a rien à faire dans ce select).
// Une option par service (variantes regroupées, voir
// groupStreamingServices()), plus « Mes abonnements » dès qu'il y en a.
function buildWatchlistProviderFilterOptions(){
  const sel = document.getElementById('wlProviderFilter');
  const toggle = document.getElementById('wlSubsToggle');
  const current = sel.value;
  const present = watchlistServiceCounts();
  if(present.size === 0){
    sel.style.display = 'none';
    sel.innerHTML = `<option value="">Toutes les plateformes</option>`;
    if(toggle) toggle.style.display = 'none';
    return;
  }
  const mine = getMyStreamingServices();
  const options = Array.from(present.values())
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    .map(s => `<option value="${escapeHtml(s.key)}">${escapeHtml(s.name)}</option>`)
    .join('');
  const mineOption = mine.size > 0 ? `<option value="${MY_SERVICES_FILTER}">Mes abonnements</option>` : '';
  sel.innerHTML = `<option value="">Toutes les plateformes</option>${mineOption}${options}`;
  sel.style.display = '';
  if(current && (present.has(current) || (current === MY_SERVICES_FILTER && mine.size > 0))) sel.value = current;
  if(toggle){
    toggle.style.display = '';
    toggle.textContent = mine.size > 0 ? `Mes abonnements · ${mine.size}` : 'Mes abonnements';
  }
}

// Services présents dans À voir : clé -> { key, name, logoPath, n }.
function watchlistServiceCounts(){
  const present = new Map();
  watchlist.forEach(item => {
    watchlistServices(item).forEach(s => {
      const entry = present.get(s.key) || { key: s.key, name: s.name, logoPath: s.logoPath, n: 0 };
      entry.n++;
      if(!entry.logoPath && s.logoPath) entry.logoPath = s.logoPath;
      present.set(s.key, entry);
    });
  });
  return present;
}

// Choix des abonnements : une pastille par service présent dans À voir,
// les plus fréquents d'abord.
function renderMyServicesChips(){
  const el = document.getElementById('wlSubsChips');
  if(!el) return;
  const mine = getMyStreamingServices();
  el.innerHTML = Array.from(watchlistServiceCounts().values())
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'fr'))
    .map(s => `<button type="button" class="wl-sub-chip" data-service="${escapeHtml(s.key)}" aria-pressed="${mine.has(s.key)}">${s.logoPath ? `<img src="${escapeHtml(WATCHLIST_LOGO_BASE + s.logoPath)}" alt="" loading="lazy">` : ''}${escapeHtml(s.name)}</button>`)
    .join('');
}

function toggleMyServicesPanel(){
  const panel = document.getElementById('wlSubsPanel');
  const toggle = document.getElementById('wlSubsToggle');
  const open = panel.style.display === 'none';
  panel.style.display = open ? '' : 'none';
  toggle.setAttribute('aria-expanded', String(open));
  if(open) renderMyServicesChips();
}

function handleMyServiceChipClick(e){
  const chip = e.target.closest('.wl-sub-chip');
  if(!chip) return;
  const mine = toggleMyStreamingService(chip.dataset.service);
  chip.setAttribute('aria-pressed', String(mine.has(chip.dataset.service)));
  const sel = document.getElementById('wlProviderFilter');
  if(sel.value === MY_SERVICES_FILTER && mine.size === 0) sel.value = '';
  buildWatchlistProviderFilterOptions();
  renderWatchlistReminder();
  renderWatchlist();
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
    onSurpriseProvidersReady();
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
  showToast('Ajouté à À voir');
}

// Un film tout juste noté pour la première fois quitte À voir, quel que
// soit le chemin pris pour le noter : recherche, fiche du film, « Noter »
// d'À voir (retour de Flix, 18/10 : « Les Enchantés », noté depuis la
// recherche juste après l'avoir mis dans À voir, y restait). Cherche en base
// par fiche TMDB, pas seulement dans `watchlist` : la page À voir n'a pas
// forcément été chargée pendant la session. Renvoie le nombre d'éléments
// retirés.
async function removeSeenFromWatchlist(tmdbId, watchlistId){
  if(!watchlistId && !tmdbId) return 0;
  const removed = new Set();
  try{
    const calls = [];
    if(watchlistId) calls.push(supabaseClient.from('watchlist').delete().eq('id', watchlistId).select('id'));
    if(tmdbId) calls.push(supabaseClient.from('watchlist').delete().eq('tmdb_id', tmdbId).select('id'));
    const results = await Promise.all(calls);
    results.forEach(r => {
      if(r.error){ console.error(r.error); return; }
      (r.data || []).forEach(row => removed.add(row.id));
    });
  }catch(e){
    console.error(e); // le film est déjà enregistré, on ne bloque pas là-dessus
  }
  if(removed.size) watchlist = watchlist.filter(w => !removed.has(w.id));
  return removed.size;
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
    `« ${removed.title} » retiré d'À voir`,
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

  await removeSeenFromWatchlist(item.tmdbId, item.id);

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

// --- Plateforme du tirage (retour de Flix, 22/10 : « je ne veux que la
// catégorie de film dans Netflix par ex ou Prime ») --- Choisie dans la
// fenêtre elle-même. Tes abonnements d'abord (2e retour, même jour : « trop
// chargé ») : Toutes, Mes abonnements, tes plateformes, et les autres
// derrière « + n autres ». C'est le même filtre que la liste
// (#wlProviderFilter, seule source de vérité, voir getFilteredWatchlist()) ;
// le dernier choix, fait ici ou dans le filtre de la page, est gardé sur cet
// appareil pour le tirage suivant.
const SURPRISE_SERVICE_KEY = 'kinetSurpriseService';
// Sans abonnement coché : les plateformes les plus fournies restant devant.
const SURPRISE_FRONT_WITHOUT_SUBS = 2;
// Ouvert sur une plateforme avant la fin de loadWatchlistProviders() : le
// tirage part dès qu'elle se termine (onSurpriseProvidersReady()).
let surpriseWaitingProviders = false;
// « + n autres » touché : toutes les plateformes, jusqu'à la fermeture.
let surpriseServicesExpanded = false;

function getSurpriseServicePref(){
  try{ return localStorage.getItem(SURPRISE_SERVICE_KEY) || ''; }catch(e){ return ''; }
}

function setSurpriseServicePref(value){
  try{
    if(value) localStorage.setItem(SURPRISE_SERVICE_KEY, value);
    else localStorage.removeItem(SURPRISE_SERVICE_KEY);
  }catch(e){}
}

// n : nombre de films tirables avec ce choix (jamais 0 : seules les
// plateformes présentes dans À voir). front : visible sans « + n autres ».
// « Mes abonnements » seulement à partir de deux plateformes cochées
// présentes, sinon il répète l'unique pastille d'abonnement.
function surpriseServiceChoices(){
  const mine = getMyStreamingServices();
  const services = Array.from(watchlistServiceCounts().values())
    .sort((a, b) => (mine.has(b.key) - mine.has(a.key)) || b.n - a.n || a.name.localeCompare(b.name, 'fr'));
  const subscribed = services.filter(s => mine.has(s.key));
  const choices = [{ value: '', label: 'Toutes', n: watchlist.length, front: true }];
  if(subscribed.length > 1){
    choices.push({
      value: MY_SERVICES_FILTER, label: 'Mes abonnements', front: true,
      n: watchlist.filter(item => watchlistServices(item).some(s => mine.has(s.key))).length
    });
  }
  services.forEach((s, i) => choices.push({
    value: s.key, label: s.name, logoPath: s.logoPath, n: s.n,
    front: subscribed.length > 0 ? mine.has(s.key) : i < SURPRISE_FRONT_WITHOUT_SUBS
  }));
  return choices;
}

// Pastilles en choix unique, désactivées pendant que la bande tourne. Rien
// tant qu'aucune plateforme n'est connue (liste sans fiche TMDB, ou aucun
// film en streaming).
function renderSurpriseServices(){
  const el = document.getElementById('surpriseServices');
  if(!watchlistProvidersReady){
    // En attente d'un tirage sur une plateforme, la fenêtre le dit déjà en
    // grand (showSurpriseMessage()) : pas deux fois.
    const checking = !surpriseWaitingProviders && watchlist.some(item => item.tmdbId);
    el.innerHTML = checking ? `<span class="surprise-services-wait">Vérification des plateformes…</span>` : '';
    el.style.display = checking ? '' : 'none';
    return;
  }
  const choices = surpriseServiceChoices();
  if(choices.length === 1){
    el.innerHTML = '';
    el.style.display = 'none';
    return;
  }
  const current = document.getElementById('wlProviderFilter').value;
  // Le choix en cours reste visible même s'il vient de « + n autres ».
  const shown = surpriseServicesExpanded ? choices : choices.filter(c => c.front || c.value === current);
  const hidden = choices.length - shown.length;
  el.innerHTML = shown.map(c => `<button type="button" class="wl-sub-chip" role="radio" aria-checked="${c.value === current}" data-surprise-service="${escapeHtml(c.value)}" title="${c.n} film${c.n > 1 ? 's' : ''}"${surpriseSpinning ? ' disabled' : ''}>${
    c.logoPath ? `<img src="${escapeHtml(WATCHLIST_LOGO_BASE + c.logoPath)}" alt="" loading="lazy">` : ''
  }${escapeHtml(c.label)}</button>`).join('') + (hidden > 0
    ? `<button type="button" class="surprise-services-more" data-surprise-more aria-label="Voir ${hidden} autre${hidden > 1 ? 's' : ''} plateforme${hidden > 1 ? 's' : ''}">+ ${hidden} autre${hidden > 1 ? 's' : ''}</button>`
    : '');
  el.style.display = '';
  // Au téléphone la rangée défile : le choix retenu reste en vue.
  const checked = el.querySelector('[aria-checked="true"]');
  if(checked && el.scrollWidth > el.clientWidth){
    el.scrollLeft = checked.offsetLeft - (el.clientWidth - checked.offsetWidth) / 2;
  }
}

function setSurpriseServicesBusy(busy){
  document.getElementById('surpriseServices').querySelectorAll('[data-surprise-service]').forEach(b => {
    b.disabled = busy;
  });
}

// Un choix qui n'existe plus (plateforme partie du catalogue, abonnements
// décochés) retombe sur Toutes. « Mes abonnements » avec une seule
// plateforme cochée présente devient cette plateforme.
function applySurpriseService(value){
  const choices = surpriseServiceChoices();
  let wanted = value;
  if(wanted === MY_SERVICES_FILTER && !choices.some(c => c.value === wanted)){
    const mine = getMyStreamingServices();
    const subscribed = choices.filter(c => c.value && mine.has(c.value));
    wanted = subscribed.length === 1 ? subscribed[0].value : '';
  }
  document.getElementById('wlProviderFilter').value = choices.some(c => c.value === wanted) ? wanted : '';
  renderWatchlist();
}

// Fenêtre ouverte sans tirage (plateformes en cours de vérification, aucun
// film sur ce choix) : la bande est cachée et les boutons attendent.
function showSurpriseMessage(text){
  currentSurpriseItem = null;
  document.getElementById('surpriseRoulette').style.display = 'none';
  document.getElementById('surpriseRouletteTrack').innerHTML = '';
  const content = document.getElementById('surpriseContent');
  content.innerHTML = `<p class="surprise-message">${escapeHtml(text)}</p>`;
  content.style.display = '';
  document.getElementById('surpriseRerollBtn').disabled = true;
  document.getElementById('surpriseRateBtn').disabled = true;
}

// Tire dans le lot du filtre actif. Appelée à l'ouverture, à « Encore un » et
// à chaque changement de plateforme.
function startSurpriseDraw(){
  renderSurpriseServices();
  const pool = getFilteredWatchlist();
  if(pool.length === 0){
    showSurpriseMessage('Aucun film à voir sur cette plateforme pour l\'instant. Choisis-en une autre.');
    return;
  }
  spinSurpriseRoulette(pool);
}

function onSurpriseProvidersReady(){
  const open = document.getElementById('surpriseOverlay').classList.contains('open');
  if(!open){ surpriseWaitingProviders = false; return; }
  if(surpriseWaitingProviders){
    surpriseWaitingProviders = false;
    applySurpriseService(getSurpriseServicePref());
    startSurpriseDraw();
    return;
  }
  renderSurpriseServices(); // tirage déjà fait dans toute la liste : les pastilles arrivent, sans relancer
}

function handleSurpriseServiceClick(e){
  if(e.target.closest('[data-surprise-more]')){
    surpriseServicesExpanded = true;
    renderSurpriseServices();
    // Le bouton disparaît : le focus passe à la première plateforme révélée.
    const first = surpriseServiceChoices().find(c => !c.front);
    const chips = Array.from(document.getElementById('surpriseServices').querySelectorAll('[data-surprise-service]'));
    const target = first && chips.find(b => b.dataset.surpriseService === first.value);
    if(target) target.focus();
    return;
  }
  const chip = e.target.closest('[data-surprise-service]');
  if(!chip || chip.disabled || surpriseSpinning || chip.getAttribute('aria-checked') === 'true') return;
  const value = chip.dataset.surpriseService;
  setSurpriseServicePref(value);
  applySurpriseService(value);
  startSurpriseDraw();
}

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
        ? `<img src="${escapeHtml(item.posterUrl)}" alt="" loading="lazy">`
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
  // Où le regarder : tes abonnements et la plateforme choisie pour le tirage
  // s'il y en a dessus, sinon toutes ses plateformes (même règle que les
  // logos des affiches).
  const services = watchlistServices(item);
  const mine = getMyStreamingServices();
  const picked = document.getElementById('wlProviderFilter').value;
  const preferred = services.filter(s => mine.has(s.key) || s.key === picked);
  const shown = preferred.length ? preferred : services;
  document.getElementById('surpriseContent').innerHTML = `
    <div class="surprise-info">
      <div class="wl-title">${escapeHtml(item.title)}${item.releaseYear ? ` <span class="wl-year">(${item.releaseYear})</span>` : ''}</div>
      ${shown.length ? `<div class="surprise-on">Sur ${escapeHtml(shown.map(s => s.name).join(', '))}</div>` : ''}
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
  setSurpriseServicesBusy(true);

  const frame = document.getElementById('surpriseRoulette');
  frame.style.display = ''; // cachée par showSurpriseMessage(), à remettre avant de mesurer
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
    setSurpriseServicesBusy(false);
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
  if(watchlist.length === 0){
    showToast('Ta watchlist est vide. Ajoute un film d\'abord');
    return;
  }
  surpriseWaitingProviders = false;
  surpriseServicesExpanded = false;
  openOverlay('surpriseOverlay');
  const pref = getSurpriseServicePref();
  if(pref && !watchlistProvidersReady){
    surpriseWaitingProviders = true;
    renderSurpriseServices();
    showSurpriseMessage('Vérification des plateformes…');
    return;
  }
  if(watchlistProvidersReady) applySurpriseService(pref || document.getElementById('wlProviderFilter').value);
  startSurpriseDraw();
}

document.getElementById('wlSurpriseBtn').addEventListener('click', openSurprise);
document.getElementById('surpriseServices').addEventListener('click', handleSurpriseServiceClick);
document.getElementById('closeSurprise').addEventListener('click', () => closeOverlay('surpriseOverlay'));
document.getElementById('surpriseOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'surpriseOverlay') closeOverlay('surpriseOverlay');
});
document.getElementById('surpriseRerollBtn').addEventListener('click', startSurpriseDraw);
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
      ${poster ? `<img loading="lazy" decoding="async" src="${escapeHtml(poster)}" alt="">` : `<div class="tmdb-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
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
document.getElementById('wlProviderFilter').addEventListener('change', (e) => {
  setSurpriseServicePref(e.target.value); // le prochain « Surprends-moi » part de ce choix
  renderWatchlist();
});
document.getElementById('wlSubsToggle').addEventListener('click', toggleMyServicesPanel);
document.getElementById('wlSubsChips').addEventListener('click', handleMyServiceChipClick);
