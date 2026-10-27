// --- Les mieux notés sur tes abonnements (À voir) ---
// Idée retenue par Flix le 28/10, après une soirée à ne trouver « que des
// films un peu mid » : la liste qu'on lui avait faite à la main (les mieux
// notés de Netflix France), mais dans Kinet. Les films les mieux notés
// disponibles en abonnement sur ses plateformes (« Mes abonnements »), dans
// le pays choisi (getWatchRegion(), js/tmdb.js), jamais un film déjà noté ou
// déjà dans À voir. Sans abonnement coché : toutes les plateformes du pays.
//
// La note est celle de TMDB, avec un minimum de votes : Letterboxd n'ouvre pas
// ses données. Calculé à la demande, rien en base ; même rangée d'affiches que
// les suggestions (.wls-strip, js/suggestions.js).

const STREAMING_TOP_MIN_VOTES = 1000;
const STREAMING_TOP_PAGES = 3;       // 60 candidats TMDB au plus
const STREAMING_TOP_MAX = 20;        // affichés
const STREAMING_TOP_TTL_MS = 6 * 60 * 60 * 1000;
// Téléfilms (10770) : TMDB les classe haut avec peu de sens ici.
const STREAMING_TOP_WITHOUT_GENRES = '10770';

let streamingTopFilms = [];          // résultats TMDB affichés
const streamingTopCache = {};        // clé (pays + plateformes) -> { t, results }
let streamingTopRequest = 0;         // ignore une réponse arrivée après une plus récente

function streamingTopHeaders(){
  return { 'Authorization': `Bearer ${TMDB_API_KEY}`, 'Accept': 'application/json' };
}

// Identifiants TMDB des plateformes cochées, dans ce pays. Un service compte
// avec ses variantes (« Netflix Standard with Ads », chaînes Amazon…), le même
// regroupement que les logos d'À voir (streamingServiceName(), js/watchlist.js).
async function streamingTopProviderIds(region, mine){
  if(mine.size === 0) return [];
  const res = await fetch(`https://api.themoviedb.org/3/watch/providers/movie?language=fr-FR&watch_region=${region}`, { headers: streamingTopHeaders() });
  if(!res.ok) throw new Error(`Erreur TMDB (${res.status})`);
  const data = await res.json();
  return (data.results || [])
    .filter(p => mine.has(streamingServiceName(p.provider_name).toLowerCase()))
    .map(p => p.provider_id);
}

async function fetchStreamingTop(region, providerIds){
  const key = `${region}|${providerIds.slice().sort((a, b) => a - b).join(',')}`;
  const cached = streamingTopCache[key];
  if(cached && Date.now() - cached.t < STREAMING_TOP_TTL_MS) return cached.results;
  const params = new URLSearchParams({
    language: 'fr-FR',
    watch_region: region,
    with_watch_monetization_types: 'flatrate',
    sort_by: 'vote_average.desc',
    'vote_count.gte': String(STREAMING_TOP_MIN_VOTES),
    without_genres: STREAMING_TOP_WITHOUT_GENRES,
  });
  if(providerIds.length) params.set('with_watch_providers', providerIds.join('|'));
  const pages = await Promise.all(Array.from({ length: STREAMING_TOP_PAGES }, async (_, i) => {
    const res = await fetch(`https://api.themoviedb.org/3/discover/movie?${params}&page=${i + 1}`, { headers: streamingTopHeaders() });
    if(!res.ok) throw new Error(`Erreur TMDB (${res.status})`);
    return (await res.json()).results || [];
  }));
  const seen = new Set();
  const results = pages.flat().filter(r => !seen.has(r.id) && seen.add(r.id));
  streamingTopCache[key] = { t: Date.now(), results };
  return results;
}

// Jamais un film déjà noté ou déjà dans À voir ; le mieux noté d'abord.
function pickStreamingTop(results, filmsList, watchlistList){
  const known = new Set([...filmsList, ...watchlistList].map(f => f.tmdbId).filter(Boolean));
  return results
    .filter(r => !known.has(r.id))
    .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))
    .slice(0, STREAMING_TOP_MAX);
}

function streamingTopTitle(mine){
  return mine.size ? 'Les mieux notés sur tes abonnements' : 'Les mieux notés en streaming';
}

// « Netflix, Prime Video », et le pays quand ce n'est pas la France. Les clés
// d'abonnement sont en minuscules (« prime video ») : majuscules remises.
function streamingTopHint(mine, region){
  const label = (k) => String(k).replace(/(^|[\s-])(\S)/g, (m, sep, c) => sep + c.toUpperCase());
  const names = Array.from(mine).map(label).sort((a, b) => a.localeCompare(b, 'fr'));
  const parts = names.length ? [names.join(', ')] : [];
  if(region !== 'FR') parts.push(watchRegionName(region));
  return parts.join(' · ');
}

const streamingTopNote = (v) => Number(v || 0).toFixed(1).replace('.', ',');

function streamingTopItemHtml(r){
  const year = r.release_date ? r.release_date.slice(0, 4) : null;
  const poster = r.poster_path ? TMDB_IMG_BASE + r.poster_path : null;
  const label = `${r.title}${year ? ` (${year})` : ''}`;
  return `
    <div class="wls-item">
      <button class="wls-poster" type="button" data-action="open-film" data-id="${r.id}" title="${escapeHtml(label)}" aria-label="Voir la fiche de ${escapeHtml(label)}">
        ${poster
          ? `<img src="${escapeHtml(poster)}" alt="" loading="lazy" decoding="async">`
          : `<span class="film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</span>`}
      </button>
      <div class="wls-meta">
        <span class="wls-note" title="Note TMDB">${streamingTopNote(r.vote_average)}</span>
        <button class="wls-add" data-action="add-watchlist" data-id="${r.id}" type="button" aria-label="Ajouter ${escapeHtml(label)} à À voir">+ À voir</button>
      </div>
    </div>
  `;
}

function renderStreamingTop(){
  const section = document.getElementById('streamingTopSection');
  const list = document.getElementById('streamingTopList');
  if(streamingTopFilms.length === 0){ section.style.display = 'none'; return; }
  const mine = getMyStreamingServices();
  const region = getWatchRegion();
  document.getElementById('streamingTopTitle').textContent = streamingTopTitle(mine);
  document.getElementById('streamingTopHint').textContent = streamingTopHint(mine, region);
  list.innerHTML = streamingTopFilms.map(streamingTopItemHtml).join('');
  list.querySelectorAll('[data-action="add-watchlist"]').forEach(btn => {
    btn.addEventListener('click', withSubmitGuard(btn, () => addStreamingTopToWatchlist(Number(btn.dataset.id))));
  });
  const navList = streamingTopFilms.map(r => ({ tmdbId: r.id, title: r.title }));
  list.querySelectorAll('[data-action="open-film"]').forEach(btn => {
    btn.addEventListener('click', () => goToFilmDetail(Number(btn.dataset.id), navList));
  });
  section.style.display = '';
}

// Appelée par openWatchlist() et quand « Mes abonnements » change
// (js/watchlist.js), sans être attendue : la page s'affiche avant.
async function loadStreamingTop(){
  const request = ++streamingTopRequest;
  const mine = getMyStreamingServices();
  const region = getWatchRegion();
  try{
    const ids = await streamingTopProviderIds(region, mine);
    // Abonnements cochés mais absents de ce pays : rien à proposer.
    if(mine.size && ids.length === 0){
      if(request === streamingTopRequest){ streamingTopFilms = []; renderStreamingTop(); }
      return;
    }
    const results = await fetchStreamingTop(region, ids);
    if(request !== streamingTopRequest) return;
    streamingTopFilms = pickStreamingTop(results, films, watchlist);
  }catch(e){
    console.error(e);
    if(request !== streamingTopRequest) return;
    streamingTopFilms = [];
  }
  renderStreamingTop();
}

async function addStreamingTopToWatchlist(tmdbId){
  const r = streamingTopFilms.find(x => x.id === tmdbId);
  if(!r) return;
  const item = await addTmdbMovieToWatchlist(r); // js/watchlist.js
  if(!item) return;
  streamingTopFilms = streamingTopFilms.filter(x => x.id !== tmdbId);
  renderStreamingTop();
  renderWatchlist();
  showToast('Ajouté à À voir');
}
