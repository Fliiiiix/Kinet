// --- Import Trakt (préparation, PAS branché) ---
// Chantier suivant après Letterboxd (voir js/importExternal.js et le
// commentaire en tête de ce fichier). Écrit maintenant pour qu'il ne reste
// plus qu'à connecter une fois l'appli OAuth créée — voir
// js/traktConfig.js pour TRAKT_CLIENT_ID (vide tant que ce n'est pas fait)
// et le garde-fou juste en dessous, qui empêche tout appel tant qu'il
// manque.
//
// Contrairement à Letterboxd (juste un titre + une année à recouper via
// bestTmdbCandidate — voir importExternal.js et le bug "Handmaiden"),
// Trakt renvoie directement le tmdb_id de chaque film dans sa réponse
// (movie.ids.tmdb) : aucune recherche/désambiguïsation TMDB par titre
// nécessaire pour ASSOCIER le bon film, seulement un fetchMovieDetails(id)
// direct pour récupérer affiche/résumé/genres (js/tmdb.js) une fois le film
// identifié.
//
// !!! À VÉRIFIER avant de brancher pour de vrai (non testé, pas de
// client_id disponible pour un aller-retour OAuth réel pendant que ce
// fichier a été écrit) :
// 1. exchangeTraktCodeForToken() suppose le flux "Authorization Code"
//    standard documenté par Trakt (POST /oauth/token avec client_id +
//    client_secret + code + redirect_uri) — à reconfirmer sur
//    https://trakt.docs.apiary.io au moment de connecter, l'API a pu
//    changer depuis. Embarquer un client_secret côté client (site 100%
//    statique, pas de backend) l'expose au même titre que TMDB_API_KEY/
//    la clé anon Supabase déjà publiques dans ce dépôt — décision à
//    reconfirmer explicitement avec l'utilisateur avant de l'ajouter à
//    traktConfig.js, pas à supposer silencieusement acceptable.
// 2. redirect_uri doit être un match EXACT (avec ou sans slash final) avec
//    ce qui est enregistré sur trakt.tv/oauth/applications, à ajuster une
//    fois l'appli créée.
// 3. Comportement de refresh_token (durée de vie, endpoint exact) à
//    reconfirmer aussi — refreshTraktTokenIfNeeded() ci-dessous est écrite
//    par analogie avec le flux OAuth2 standard, pas vérifiée en conditions
//    réelles.

const TRAKT_API_BASE = 'https://api.trakt.tv';
const TRAKT_REDIRECT_URI = location.origin + location.pathname; // doit matcher l'appli Trakt à l'identique

function traktConfigured(){
  return typeof TRAKT_CLIENT_ID === 'string' && TRAKT_CLIENT_ID.length > 0;
}

function traktHeaders(accessToken){
  const h = {
    'Content-Type': 'application/json',
    'trakt-api-version': '2',
    'trakt-api-key': TRAKT_CLIENT_ID
  };
  if(accessToken) h['Authorization'] = `Bearer ${accessToken}`;
  return h;
}

// --- Étape 1 : rediriger vers l'écran d'autorisation Trakt ---
function getTraktAuthorizeUrl(){
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: TRAKT_CLIENT_ID,
    redirect_uri: TRAKT_REDIRECT_URI
  });
  return `https://trakt.tv/oauth/authorize?${params}`;
}

function startTraktConnect(){
  if(!traktConfigured()){
    showToast('Import Trakt pas encore configuré (voir js/traktConfig.js)');
    return;
  }
  location.href = getTraktAuthorizeUrl();
}

// --- Étape 2 : échanger le code contre un jeton (voir l'avertissement en
// tête de fichier — client_secret non confirmé pour un site 100% statique) ---
async function exchangeTraktCodeForToken(code){
  const res = await fetch(`${TRAKT_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      client_id: TRAKT_CLIENT_ID,
      client_secret: typeof TRAKT_CLIENT_SECRET === 'string' ? TRAKT_CLIENT_SECRET : '',
      redirect_uri: TRAKT_REDIRECT_URI,
      grant_type: 'authorization_code'
    })
  });
  if(!res.ok) throw new Error(`Erreur OAuth Trakt (${res.status})`);
  return res.json(); // { access_token, refresh_token, expires_in, ... }
}

// Reconnu si l'utilisateur revient d'une autorisation Trakt (?code=... dans
// l'URL) — à appeler une fois au chargement (comme consumePendingInviteIfAny()
// pour les invitations de groupe, js/invites.js), jamais câblé pour l'instant
// (traktConfigured() bloque tout avant même de lire l'URL).
async function handleTraktOAuthCallback(){
  if(!traktConfigured()) return;
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if(!code) return;
  try{
    const tokens = await exchangeTraktCodeForToken(code);
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 0) * 1000).toISOString();
    const { error } = await supabaseClient.from('trakt_tokens').upsert({
      user_id: currentUser.id,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt
    });
    if(error){ console.error(error); showToast('Erreur de connexion à Trakt'); return; }
    showToast('Trakt connecté');
  }catch(e){
    console.error(e);
    showToast('Erreur de connexion à Trakt');
  }finally{
    // Retire ?code=... de l'URL (comme un lien d'invitation déjà consommé) —
    // un F5 après coup ne doit pas retenter le même code (Trakt le rejette,
    // usage unique).
    history.replaceState(null, '', location.pathname + location.hash);
  }
}

async function getTraktAccessToken(){
  const { data, error } = await supabaseClient.from('trakt_tokens').select('*').eq('user_id', currentUser.id).maybeSingle();
  if(error || !data) return null;
  if(new Date(data.expires_at) > new Date()) return data.access_token;
  return refreshTraktTokenIfNeeded(data.refresh_token);
}

// Non vérifiée en conditions réelles — voir l'avertissement en tête de
// fichier (point 3).
async function refreshTraktTokenIfNeeded(refreshToken){
  const res = await fetch(`${TRAKT_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refresh_token: refreshToken,
      client_id: TRAKT_CLIENT_ID,
      client_secret: typeof TRAKT_CLIENT_SECRET === 'string' ? TRAKT_CLIENT_SECRET : '',
      redirect_uri: TRAKT_REDIRECT_URI,
      grant_type: 'refresh_token'
    })
  });
  if(!res.ok) return null;
  const tokens = await res.json();
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 0) * 1000).toISOString();
  await supabaseClient.from('trakt_tokens').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt
  }).eq('user_id', currentUser.id);
  return tokens.access_token;
}

// --- Étape 3 : lire les données Trakt --- Endpoints "sync" documentés et
// stables (https://trakt.docs.apiary.io/#reference/sync), contrairement au
// flux OAuth ci-dessus c'est la partie dont je suis confiant sans pouvoir
// la tester ici faute de jeton réel.
async function fetchTraktWatchedMovies(accessToken){
  const res = await fetch(`${TRAKT_API_BASE}/sync/watched/movies`, { headers: traktHeaders(accessToken) });
  if(!res.ok) throw new Error(`Erreur Trakt (${res.status})`);
  return res.json(); // [{ plays, last_watched_at, movie: { title, year, ids: { tmdb } } }]
}

async function fetchTraktRatings(accessToken){
  const res = await fetch(`${TRAKT_API_BASE}/sync/ratings/movies`, { headers: traktHeaders(accessToken) });
  if(!res.ok) throw new Error(`Erreur Trakt (${res.status})`);
  return res.json(); // [{ rated_at, rating (1-10), movie: {...} }]
}

async function fetchTraktWatchlist(accessToken){
  const res = await fetch(`${TRAKT_API_BASE}/sync/watchlist/movies`, { headers: traktHeaders(accessToken) });
  if(!res.ok) throw new Error(`Erreur Trakt (${res.status})`);
  return res.json(); // [{ rank, listed_at, movie: {...} }]
}

// --- Étape 4 : importer dans le catalogue --- Même dédoublonnage par
// tmdb_id que l'import Letterboxd (js/importExternal.js), mais SANS
// bestTmdbCandidate : Trakt donne déjà le tmdb_id exact, fetchMovieDetails()
// (js/tmdb.js) sert seulement à récupérer affiche/résumé/genres pour CE
// film précis, jamais à en deviner un parmi plusieurs candidats.
async function importTraktMovies(){
  if(!traktConfigured()){ showToast('Import Trakt pas encore configuré'); return; }
  if(blockIfOffline()) return;
  const accessToken = await getTraktAccessToken();
  if(!accessToken){ showToast('Connecte d\'abord ton compte Trakt'); return; }

  const [watched, ratings] = await Promise.all([
    fetchTraktWatchedMovies(accessToken),
    fetchTraktRatings(accessToken)
  ]);

  // Fusionne les deux par tmdb_id : une note Trakt (1-10) convertie sur
  // l'échelle Kinet (0.5-5.0, /2) quand elle existe, sinon un film vu sans
  // note (voir watched.csv de l'import Letterboxd, même principe).
  const ratingByTmdbId = new Map();
  ratings.forEach(r => {
    const id = r.movie && r.movie.ids && r.movie.ids.tmdb;
    if(id) ratingByTmdbId.set(id, r.rating / 2);
  });

  const existingTmdbIds = new Set(films.map(f => f.tmdbId).filter(Boolean));
  const toInsert = [];
  const datesForRow = [];
  let matched = 0, skipped = 0, unmatched = 0, done = 0;

  let idx = 0;
  const entries = watched.filter(w => w.movie && w.movie.ids && w.movie.ids.tmdb);
  async function worker(){
    while(idx < entries.length){
      const entry = entries[idx++];
      done++;
      if(done % 5 === 0 || done === entries.length) showToast(`Import Trakt… ${done}/${entries.length}`);
      const tmdbId = entry.movie.ids.tmdb;
      if(existingTmdbIds.has(tmdbId)){ skipped++; continue; }
      let details;
      try{
        details = await fetchMovieDetails(tmdbId);
      }catch(e){
        console.error(e);
        unmatched++;
        continue;
      }
      existingTmdbIds.add(tmdbId);
      matched++;
      toInsert.push({
        title: details.title || entry.movie.title,
        crit: {},
        fav: false,
        added: entry.last_watched_at ? new Date(entry.last_watched_at).getTime() : Date.now(),
        manual_note: ratingByTmdbId.has(tmdbId) ? ratingByTmdbId.get(tmdbId) : null,
        review: null,
        tmdb_id: tmdbId,
        poster_url: details.poster_path ? TMDB_IMG_BASE + details.poster_path : null,
        overview: details.overview || null,
        release_year: entry.movie.year || null,
        original_title: details.original_title && details.original_title !== details.title ? details.original_title : null,
        genre_ids: (details.genres || []).map(g => g.id)
      });
      datesForRow.push(entry.last_watched_at ? [entry.last_watched_at] : []);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));

  if(toInsert.length === 0){
    showToast(`Rien à importer (${skipped} déjà présent(s), ${unmatched} erreur(s) TMDB)`);
    return;
  }

  const { data: inserted, error } = await supabaseClient.from('films').insert(toInsert).select();
  if(error){
    showToast('Erreur pendant l\'import, réessaie');
    console.error(error);
    return;
  }
  inserted.forEach((row, i) => {
    films.push(rowToFilm(row));
    const dates = datesForRow[i];
    if(dates && dates.length) dates.forEach(d => addViewing(row.id, new Date(d).getTime()));
    else addViewing(row.id, row.added);
  });
  buildGenreFilterOptions();
  render();
  showToast(`${matched} film(s) importé(s) depuis Trakt (${skipped} déjà présent(s), ${unmatched} erreur(s) TMDB)`);
}

// Aucun wiring DOM ici volontairement (pas de bouton dans index.html, pas
// de <script> chargeant ce fichier) : à ajouter au moment de connecter pour
// de vrai, une fois TRAKT_CLIENT_ID renseigné et le flux OAuth ci-dessus
// vérifié contre un vrai jeton.
