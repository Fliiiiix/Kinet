// --- Test de bout en bout du mode hors ligne : un vol complet ---
// Retour de Flix (01/11) : noter ses films, les chercher, tout comme les séries,
// dans l'avion. Un vrai navigateur, avec le vrai service worker et une fausse
// base : on prépare en ligne, on coupe le réseau, on ferme et rouvre l'app avec
// un jeton expiré, on note, on suit, on coche, puis on se reconnecte et on
// regarde ce qui arrive en base.
const path = require('path');
const { test, expect } = require('@playwright/test');

const CAPTURES = path.join(__dirname, '..', '..', 'test-results', 'hors-ligne');

const USER = { id: '11111111-1111-1111-1111-111111111111', email: 'test@kinet.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
const CLE_SESSION = 'sb-ethhacnngepckeakhsch-auth-token';

function baseDeDemo(){
  return {
    profiles: [{ id: USER.id, username: 'testeur', is_admin: false, onboarding_seen: true, avatar_url: null }],
    site_status: [{ id: 1, maintenance: false, message: null }],
    films: [{ id: 1, user_id: USER.id, title: 'Premier Contact', crit: {}, fav: false, added: 1700000000000, manual_note: 4.5, review: null, tmdb_id: 329865, poster_url: null, overview: 'Des vaisseaux arrivent.', release_year: 2016, original_title: 'Arrival', genre_ids: [18] }],
    viewings: [{ id: 1, user_id: USER.id, film_id: 1, watched_at: 1700000000000, note: null }],
    watchlist: [{ id: 1, user_id: USER.id, title: 'Moon', note: null, added: 1700000000000, tmdb_id: 17431, poster_url: null, overview: 'Sur la Lune.', release_year: 2009, release_date: '2009-06-12', original_title: null }],
    tv_shows: [{ id: 5, user_id: USER.id, tmdb_id: 1396, title: 'Breaking Bad', poster_url: null, overview: 'Un professeur.', first_air_year: 2008, status: 'Ended', number_of_seasons: 1, number_of_episodes: 3, in_production: false, added: 1700000000000, manual_note: null }],
    tv_episodes_watched: [{ id: 1, user_id: USER.id, tv_show_id: 5, season_number: 1, episode_number: 1, watched_at: 1700000000000, note: null, times_watched: 1, comment: null }],
  };
}

const TMDB = {
  '/tv/1396': { id: 1396, name: 'Breaking Bad', status: 'Ended', number_of_seasons: 1, number_of_episodes: 3, in_production: false, seasons: [{ season_number: 1, name: 'Saison 1', episode_count: 3, air_date: '2008-01-20' }], last_episode_to_air: { season_number: 1, episode_number: 3, air_date: '2008-02-10' }, genres: [], created_by: [] },
  '/movie/329865': { id: 329865, title: 'Premier Contact', overview: 'Des vaisseaux arrivent.', release_date: '2016-12-07', genres: [] },
  '/movie/17431': { id: 17431, title: 'Moon', overview: 'Sur la Lune.', release_date: '2009-06-12', genres: [] },
  '/tv/1396/season/1': { season_number: 1, episodes: [1, 2, 3].map(n => ({ episode_number: n, name: `Épisode ${n}`, air_date: '2008-01-20', overview: '' })) },
};

// Une base PostgREST très simple, qui compte ce qu'elle reçoit.
function brancherServeurs(context, etat){
  const lignes = (table, url) => {
    let rows = (etat.base[table] || []).slice();
    url.searchParams.forEach((v, k) => {
      if(v.startsWith('eq.')) rows = rows.filter(r => r[k] === undefined || String(r[k]) === v.slice(3));
    });
    return rows;
  };
  context.route(/ethhacnngepckeakhsch\.supabase\.co/, async (route) => {
    if(etat.horsLigne) return route.abort('internetdisconnected');
    const req = route.request();
    const url = new URL(req.url());
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*' };
    const reponse = (status, body) => route.fulfill({ status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if(req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if(url.pathname.startsWith('/auth/v1/token')){
      return reponse(200, { access_token: 'jeton-neuf', refresh_token: 'r2', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER });
    }
    if(url.pathname.startsWith('/auth/')) return reponse(200, {});
    if(url.pathname.includes('/rest/v1/rpc/')) return reponse(200, []);
    const table = url.pathname.split('/').pop();
    const objet = (req.headers().accept || '').includes('vnd.pgrst.object');
    if(req.method() === 'GET' || req.method() === 'HEAD'){
      const rows = lignes(table, url);
      return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'Content-Range': `0-${rows.length}/${rows.length}` }, body: JSON.stringify(objet ? (rows[0] || null) : rows) });
    }
    const corps = req.postData() ? JSON.parse(req.postData()) : null;
    etat.recu.push({ methode: req.method(), table, url: req.url(), corps });
    if(req.method() === 'POST'){
      const crees = (Array.isArray(corps) ? corps : [corps]).map(r => ({ id: etat.prochainId++, user_id: USER.id, ...r }));
      (etat.base[table] = etat.base[table] || []).push(...crees);
      return reponse(201, objet ? crees[0] : crees);
    }
    if(req.method() === 'PATCH'){
      const rows = lignes(table, url);
      rows.forEach(r => Object.assign(r, corps));
      return reponse(200, rows);
    }
    const parties = lignes(table, url);
    etat.base[table] = (etat.base[table] || []).filter(r => !parties.includes(r));
    return reponse(200, parties);
  });
  context.route(/api\.themoviedb\.org/, async (route) => {
    if(etat.horsLigne) return route.abort('internetdisconnected');
    const url = new URL(route.request().url());
    const chemin = url.pathname.replace('/3', '');
    return route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, body: JSON.stringify(TMDB[chemin] || { id: 1, results: [], cast: [], crew: [] }) });
  });
  context.route(/image\.tmdb\.org|fonts\.g/, route => (etat.horsLigne ? route.abort('internetdisconnected') : route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' })));
}

async function couper(context, etat){
  etat.horsLigne = true;
  etat.recu = [];
  await context.setOffline(true);
}

// Une app connectée, service worker en place et séries préparées.
async function preparerEnLigne(browser, etat){
  const context = await browser.newContext({ baseURL: 'http://localhost:8765', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  brancherServeurs(context, etat);
  await context.addInitScript(([cle, user]) => {
    if(localStorage.getItem(cle)) return;
    localStorage.setItem(cle, JSON.stringify({ access_token: 'jeton-vieux', refresh_token: 'r1', token_type: 'bearer', expires_in: 3600, expires_at: 1000, user }));
  }, [CLE_SESSION, USER]);
  const page = await context.newPage();
  await ouvrirApp(page);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 25000 });
  await page.waitForTimeout(2500);
  await expect(page.locator('#appContainer')).toBeVisible({ timeout: 25000 });
  await page.evaluate(() => prepareOffline(true));
  return { context, page };
}

async function ouvrirApp(page){
  await page.goto('/index.html');
  await expect(page.locator('#appContainer')).toBeVisible({ timeout: 25000 });
}

test('un vol complet : tout marche sans réseau, et tout arrive en base au retour', async ({ browser }) => {
  test.setTimeout(180000);
  const context = await browser.newContext({ baseURL: 'http://localhost:8765', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const etat = { base: baseDeDemo(), recu: [], horsLigne: false, prochainId: 1000 };
  brancherServeurs(context, etat);
  // Jeton déjà expiré : le cas de l'app rouverte après plus d'une heure de vol.
  await context.addInitScript(([cle, user]) => {
    if(localStorage.getItem(cle)) return;
    localStorage.setItem(cle, JSON.stringify({ access_token: 'jeton-vieux', refresh_token: 'r1', token_type: 'bearer', expires_in: 3600, expires_at: 1000, user }));
  }, [CLE_SESSION, USER]);

  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(String(e.message).slice(0, 200)));

  // --- Au sol : on ouvre l'app, le service worker s'installe, on prépare ---
  await ouvrirApp(page);
  // La première prise en main par le service worker recharge la page toute seule.
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 25000 });
  await page.waitForTimeout(2500);
  await expect(page.locator('#appContainer')).toBeVisible({ timeout: 25000 });
  await page.evaluate(() => prepareOffline(true));

  // --- Dans l'avion : l'app se rouvre, avec un jeton expiré, sans déconnexion ---
  await couper(context, etat);
  const debut = Date.now();
  await page.reload();
  await expect(page.locator('#appContainer')).toBeVisible({ timeout: 15000 });
  expect(Date.now() - debut, 'démarrage sans attendre le réseau').toBeLessThan(12000);
  await expect(page.locator('#authContainer')).toBeHidden();
  await expect(page.locator('#offlineBanner')).toHaveText('Hors ligne');
  await expect(page.locator('#filmList')).toContainText('Premier Contact');

  // Chercher un film inconnu de l'appareil : le catalogue gardé répond.
  const trouves = await page.evaluate(() => searchTmdb('paprika'));
  expect(trouves[0].title).toBe('Paprika');
  expect(trouves[0].poster_path).toBeTruthy();

  // Le noter, comme dans l'app : notation directe depuis ce résultat.
  await page.evaluate((film) => {
    openModal(null, { tmdb_id: film.id, title: film.title, poster_url: null, overview: null, release_year: film.release_year, original_title: film.original_title, genre_ids: film.genre_ids });
    ntGo('direct');
  }, trouves[0]);
  await page.evaluate(() => {
    const curseur = document.querySelector('[data-nt-direct-range]');
    curseur.value = 4.5;
    curseur.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('reviewInput').value = 'Vu à 10 000 mètres';
  });
  await page.locator('#saveBtn').click();
  await expect(page.locator('#filmList')).toContainText('Paprika');
  await expect(page.locator('#offlineBanner')).toContainText('à envoyer');

  // Sa fiche s'ouvre quand même, sans TMDB.
  await page.evaluate((id) => { location.hash = `#/film/${id}`; }, trouves[0].id);
  await expect(page.locator('#filmDetailTitle')).toHaveText('Paprika');

  // À voir : ajouter un film du catalogue, retirer un film existant.
  await page.evaluate(async () => {
    const [film] = await searchTmdb('premier contact');
    await addTmdbMovieToWatchlist({ ...film, id: 999001, title: 'Film du catalogue' });
  });
  await page.evaluate(() => { location.hash = '#/watchlist'; });
  await expect(page.locator('#wlList')).toContainText('Moon');

  // Séries : cocher un épisode et le noter, sur une série préparée à l'avance.
  await page.evaluate(() => { location.hash = '#/series/5'; });
  await expect(page.locator('#seriesDetailTitle')).toHaveText('Breaking Bad');
  await expect(page.locator('[data-sq="1-2"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-sq="1-1"]')).toHaveClass(/on/);
  await page.evaluate(async () => {
    await toggleEpisodeWatched(1, 2, true);
    await updateEpisodeNote(1, 2, '4');
  });
  await expect(page.locator('[data-sq="1-2"]')).toHaveClass(/on/);

  // Suivre une nouvelle série, trouvée dans le catalogue.
  const nouvelle = await page.evaluate(async () => {
    const [serie] = await searchTmdbTv('dark');
    selectSeriesTmdbResult(serie);
    await handleAddShow();
    return serie;
  });
  expect(nouvelle.title).toBeTruthy();

  // Fermer et rouvrir l'app en plein vol : rien n'a bougé.
  await page.evaluate(() => { location.hash = '#/'; });
  await page.reload();
  await expect(page.locator('#appContainer')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#filmList')).toContainText('Paprika');
  await page.evaluate(() => { location.hash = '#/series/5'; });
  await expect(page.locator('[data-sq="1-2"]')).toHaveClass(/on/, { timeout: 10000 });
  expect(etat.recu, 'rien ne part sans réseau').toEqual([]);

  // --- À l'atterrissage : tout part, dans l'ordre, avec les vrais numéros ---
  etat.horsLigne = false;
  await context.setOffline(false);
  await expect(page.locator('#offlineBanner')).toBeHidden({ timeout: 30000 });
  await expect.poll(() => page.evaluate(() => { loadOfflineQueue(); return offlineQueue.length; }), { timeout: 15000 }).toBe(0);

  const films = etat.base.films.filter(f => f.title === 'Paprika');
  expect(films.length, 'pas de doublon').toBe(1);
  expect(films[0].id).toBeGreaterThan(0);
  expect(films[0].review).toBe('Vu à 10 000 mètres');
  expect(films[0].tmdb_id).toBe(trouves[0].id);
  expect(etat.base.viewings.some(v => v.film_id === films[0].id), 'visionnage rattaché au vrai film').toBe(true);
  expect(etat.base.watchlist.some(w => w.title === 'Film du catalogue')).toBe(true);
  expect(etat.base.tv_shows.some(s => s.tmdb_id === nouvelle.id)).toBe(true);
  const episode = etat.base.tv_episodes_watched.find(e => e.tv_show_id === 5 && e.episode_number === 2);
  expect(episode, 'épisode coché').toBeTruthy();
  expect(episode.note).toBe(4);
  const provisoires = etat.recu.filter(r => /-\d{13,}/.test(r.url) || /-\d{13,}/.test(JSON.stringify(r.corps)));
  expect(provisoires, 'aucun numéro provisoire en base').toEqual([]);
  await expect(page.locator('#filmList').or(page.locator('#seriesDetailTitle')).first()).toBeAttached();

  expect(erreurs, erreurs.join('\n')).toEqual([]);
  await context.close();
});

test('chercher à la main dans la fenêtre de notation, sans réseau', async ({ browser }) => {
  test.setTimeout(120000);
  const etat = { base: baseDeDemo(), recu: [], horsLigne: false, prochainId: 1000 };
  const { context, page } = await preparerEnLigne(browser, etat);
  await couper(context, etat);
  await page.reload();
  await expect(page.locator('#appContainer')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => openModal());
  await page.locator('#titleInput').fill('paprik');
  await expect(page.locator('#tmdbResults')).toContainText('2006', { timeout: 5000 });
  await page.screenshot({ path: path.join(CAPTURES, 'recherche-notation.png') });
  await context.close();
});

test('tour de toutes les pages sans réseau : aucune erreur, rien ne reste bloqué', async ({ browser }) => {
  test.setTimeout(180000);
  const etat = { base: baseDeDemo(), recu: [], horsLigne: false, prochainId: 1000 };
  const { context, page } = await preparerEnLigne(browser, etat);
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(String(e.message).slice(0, 200)));
  await couper(context, etat);
  await page.reload();
  await expect(page.locator('#appContainer')).toBeVisible({ timeout: 15000 });

  const soucis = [];
  const routes = ['#/', '#/series', '#/series/5', '#/film/329865', '#/film/17431', '#/watchlist', '#/prochainement', '#/amis', '#/top', '#/profil', '#/parametres', '#/avis', '#/groupes', '#/listes'];
  for(const route of routes){
    await page.evaluate(h => { location.hash = h; }, route);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(CAPTURES, `${route.replace(/\W+/g, '-')}.png`) });
    const texte = await page.evaluate(() => {
      const visible = [...document.querySelectorAll('.page, #appContainer')].find(p => p.style.display !== 'none');
      return (visible || document.body).innerText;
    });
    if(/Chargement…/.test(texte)) soucis.push(`${route} : reste sur « Chargement… »`);
    if(route.startsWith('#/film/') && !(await page.locator('#filmDetailTitle').textContent()).trim()) soucis.push(`${route} : fiche sans titre`);
    if(await page.locator('.skeleton-row:visible').count()) soucis.push(`${route} : lignes grises sans fin`);
    if(/\bundefined\b|\bNaN\b/.test(texte)) soucis.push(`${route} : texte cassé`);
  }
  expect(soucis, soucis.join('\n')).toEqual([]);
  expect(erreurs, erreurs.join('\n')).toEqual([]);
  await context.close();
});

test('Wi-Fi d\'avion : connecté en apparence, rien ne répond, l\'app démarre quand même', async ({ browser }) => {
  test.setTimeout(120000);
  const etat = { base: baseDeDemo(), recu: [], horsLigne: false, prochainId: 1000 };
  const { context, page } = await preparerEnLigne(browser, etat);
  await context.route(/ethhacnngepckeakhsch\.supabase\.co|api\.themoviedb\.org|image\.tmdb\.org|localhost:8765\/index\.html/, () => { /* jamais de réponse */ });
  const debut = Date.now();
  await page.reload({ waitUntil: 'commit' });
  await expect(page.locator('#filmList')).toContainText('Premier Contact', { timeout: 15000 });
  expect(Date.now() - debut, 'démarrage en quelques secondes').toBeLessThan(10000);
  await expect(page.locator('#offlineBanner')).toHaveText('Hors ligne');
  await page.evaluate(() => { location.hash = '#/film/329865'; });
  await expect(page.locator('#filmDetailTitle')).toHaveText('Premier Contact', { timeout: 6000 });
  await context.close();
});
