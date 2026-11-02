// --- Réseau de Kinet : au sol comme dans l'avion (retour de Flix, 01/11) ---
// Tout ce que l'app échange avec Supabase passe par kinetFetch(), branché sur le
// client (js/supabaseConfig.js). Les pages n'ont donc rien à savoir du réseau :
// - une lecture réussie est gardée sur l'appareil, et resservie sans réseau ;
// - sans réseau, une écriture sur les données perso (OFFLINE_WRITE_TABLES) part
//   en file d'attente (js/offlineQueue.js) et répond comme la base l'aurait
//   fait, avec un numéro provisoire pour une création ;
// - une lecture sans réseau montre ce qui est gardé, corrigé par la file : une
//   note posée en vol reste là, même après avoir fermé et rouvert l'app.
// Le reste (amis, groupes, cartes...) échoue normalement sans réseau.

const OFFLINE_WRITE_TABLES = ['films', 'viewings', 'watchlist', 'tv_shows', 'tv_episodes_watched'];
const OFFLINE_DATA_CACHE = 'kinet-donnees-v1';
const NET_READ_TIMEOUT_MS = 7000;
// La toute première lecture décide si on démarre sur le réseau ou sur ce qui est
// gardé : le Wi-Fi d'un avion se dit connecté et ne répond jamais.
const NET_FIRST_READ_TIMEOUT_MS = 3500;
const NET_WRITE_TIMEOUT_MS = 20000;
// Un import de centaines de films prend son temps : ce n'est pas une coupure.
const NET_BIG_WRITE_TIMEOUT_MS = 120000;
const NET_BIG_WRITE_CHARS = 20000;
const NET_AUTH_TIMEOUT_MS = 12000;
const OFFLINE_DATA_MAX_ENTRIES = 1500;
const NET_PROBE_MS = 20000;
// Paramètres d'adresse qui ne sont pas des filtres de lignes.
const REST_NOT_FILTERS = ['select', 'order', 'limit', 'offset', 'columns', 'on_conflict', 'kinet_u', 'kinet_m'];

let isOfflineMode = typeof navigator !== 'undefined' && navigator.onLine === false;
let netFirstRead = true;
// Vrai dès que l'écran montre des données gardées : au retour du réseau, on relit.
let servedFromDevice = false;

// --- Lire une adresse PostgREST, et ce qu'elle filtre ---
function parseRestUrl(url){
  const u = new URL(url);
  const m = u.pathname.match(/\/rest\/v1\/(.+)$/);
  if(!m) return null;
  const filters = [];
  u.searchParams.forEach((value, key) => { if(!REST_NOT_FILTERS.includes(key)) filters.push([key, value]); });
  return { table: m[1], filters, order: u.searchParams.get('order'), limit: u.searchParams.get('limit'), onConflict: u.searchParams.get('on_conflict') };
}

function restFilterMatches(row, col, expr){
  const negated = expr.startsWith('not.');
  const e = negated ? expr.slice(4) : expr;
  const dot = e.indexOf('.');
  const op = e.slice(0, dot), val = e.slice(dot + 1);
  const cur = row[col];
  let ok;
  if(op === 'eq') ok = cur != null && String(cur) === val;
  else if(op === 'neq') ok = cur != null && String(cur) !== val;
  else if(op === 'is') ok = val === 'null' ? cur == null : String(cur) === val;
  else if(op === 'in') ok = cur != null && val.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(cur));
  else if(['gt', 'gte', 'lt', 'lte'].includes(op)){
    const a = Number(cur), b = Number(val);
    const [x, y] = Number.isNaN(a) || Number.isNaN(b) ? [String(cur), val] : [a, b];
    ok = cur != null && (op === 'gt' ? x > y : op === 'gte' ? x >= y : op === 'lt' ? x < y : x <= y);
  }else return true; // filtre inconnu (or, ilike...) : on ne juge pas
  return negated ? !ok : ok;
}

function restRowMatches(row, filters){
  return filters.every(([col, expr]) => restFilterMatches(row, col, expr));
}

// Une lecture ne garde pas forcément les colonnes qu'elle filtre : ses lignes
// ont quand même, par construction, la valeur de ses filtres « égal à ».
function restQueryContext(query){
  const context = {};
  query.filters.forEach(([col, expr]) => { if(expr.startsWith('eq.')) context[col] = expr.slice(3); });
  return context;
}

// Applique une écriture à des lignes, comme la base l'aurait fait.
function applyRestWrite(rows, write, query, context){
  const touches = (row) => restRowMatches(Object.assign({}, context, row), write.filters);
  if(write.method === 'DELETE') return rows.filter(row => !touches(row));
  if(write.method === 'PATCH'){
    rows.forEach(row => { if(touches(row)) Object.assign(row, write.body); });
    return rows;
  }
  const conflict = write.onConflict ? write.onConflict.split(',') : null;
  (write.rows || []).forEach(next => {
    const same = conflict && rows.find(row => conflict.every(c => row[c] === undefined || next[c] === undefined || String(row[c]) === String(next[c])));
    if(same){
      if(!write.ignoreDuplicates) Object.assign(same, next);
    }else if(restRowMatches(next, query.filters)){
      rows.push(Object.assign({}, next));
    }
  });
  return rows;
}

function sortRestRows(rows, order){
  if(!order) return rows;
  const [col, dir] = order.split(',')[0].split('.');
  const sign = dir === 'desc' ? -1 : 1;
  return rows.sort((a, b) => {
    const x = a[col], y = b[col];
    if(x === y) return 0;
    if(x == null) return 1;
    if(y == null) return -1;
    return x < y ? -sign : sign;
  });
}

// Ce qu'une lecture verrait une fois les écritures passées.
function overlayRestRows(rows, query, writes){
  const context = restQueryContext(query);
  let out = rows.map(row => Object.assign({}, row));
  writes.filter(w => w.table === query.table).forEach(w => { out = applyRestWrite(out, w, query, context); });
  sortRestRows(out, query.order);
  return query.limit ? out.slice(0, parseInt(query.limit, 10)) : out;
}

// --- Numéros provisoires --- Assez grands pour ne jamais croiser un vrai
// numéro : la synchronisation les remplace partout (js/offlineQueue.js).
function newOfflineTempId(){
  return -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
}

function describeRestWrite(url, method, headers, rawBody, userId){
  const query = parseRestUrl(url);
  const prefer = headers.get('Prefer') || '';
  const body = rawBody ? JSON.parse(rawBody) : null;
  const write = {
    method, table: query.table, url, prefer, body,
    filters: query.filters, onConflict: query.onConflict,
    ignoreDuplicates: /ignore-duplicates/.test(prefer),
    queuedAt: Date.now(),
  };
  if(method === 'POST'){
    write.rows = (Array.isArray(body) ? body : [body]).map(row => Object.assign({ id: newOfflineTempId(), user_id: userId }, row));
  }
  return write;
}

// --- Qui est connecté, même sans réseau ---
function storedOfflineSession(){
  try{
    const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
    const raw = localStorage.getItem(`sb-${ref}-auth-token`);
    const session = raw ? JSON.parse(raw) : null;
    return session && session.user ? session : null;
  }catch(e){
    return null;
  }
}

function offlineUserId(){
  if(typeof currentUser !== 'undefined' && currentUser) return currentUser.id;
  const session = storedOfflineSession();
  return session ? session.user.id : 'anon';
}

// --- Ce qui est gardé sur l'appareil ---
// Cache Storage plutôt que localStorage : un catalogue dépasse vite ses 5 Mo.
function restCacheKey(url, method){
  const extra = `kinet_u=${encodeURIComponent(offlineUserId())}&kinet_m=${method}`;
  return `${url}${url.includes('?') ? '&' : '?'}${extra}`;
}

function restJsonResponse(body, status, contentRange){
  const headers = { 'Content-Type': 'application/json' };
  if(contentRange) headers['Content-Range'] = contentRange;
  return new Response(body, { status, headers });
}

let restCacheWrites = 0;
async function rememberRestResponse(url, method, res){
  try{
    const text = await res.text();
    const cache = await caches.open(OFFLINE_DATA_CACHE);
    await cache.put(restCacheKey(url, method), restJsonResponse(text, 200, res.headers.get('Content-Range')));
    restCacheWrites++;
    if(restCacheWrites % 100 === 0){
      // Les plus anciennes partent : ce qui compte est relu à chaque ouverture.
      const keys = await cache.keys();
      for(let i = 0; i < keys.length - OFFLINE_DATA_MAX_ENTRIES; i++) await cache.delete(keys[i]);
    }
  }catch(e){
    // Stockage plein ou indisponible : juste moins de choses sans réseau.
  }
}

// À la déconnexion : l'appareil peut être partagé.
function clearOfflineData(){
  return caches.delete(OFFLINE_DATA_CACHE).catch(e => console.error(e));
}

// Les lectures gardées d'une table, pour ce compte.
async function cachedRestEntries(table){
  const cache = await caches.open(OFFLINE_DATA_CACHE);
  const uid = offlineUserId();
  const entries = [];
  for(const req of await cache.keys()){
    const u = new URL(req.url);
    if(u.pathname.endsWith(`/rest/v1/${table}`) && u.searchParams.get('kinet_u') === uid && u.searchParams.get('kinet_m') === 'GET'){
      entries.push({ req, cache });
    }
  }
  return entries;
}

// Toutes les lignes connues d'une table qui passent ces filtres, écritures en
// attente comprises. Sert aux écritures qui veulent les lignes touchées en
// retour, et aux lectures jamais faites en ligne.
async function localRestRows(table, filters){
  const merged = new Map();
  try{
    for(const { req, cache } of await cachedRestEntries(table)){
      const data = await (await cache.match(req)).json();
      (Array.isArray(data) ? data : [data]).forEach(row => {
        if(row && row.id != null) merged.set(row.id, Object.assign(merged.get(row.id) || {}, row));
      });
    }
  }catch(e){
    console.error(e);
  }
  const rows = overlayRestRows([...merged.values()], { table, filters: [], order: null, limit: null }, pendingOfflineWrites(table));
  return rows.filter(row => restRowMatches(row, filters));
}

// Réponse faite maison : comme la base, un objet seul pour .single().
function restRowsResponse(rows, headers, status){
  if(/vnd\.pgrst\.object/.test(headers.get('Accept') || '')){
    if(rows.length !== 1) return restJsonResponse(JSON.stringify({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: null, hint: null }), 406);
    return restJsonResponse(JSON.stringify(rows[0]), status);
  }
  return restJsonResponse(JSON.stringify(rows), status);
}

async function readRestOffline(url, method, headers){
  const query = parseRestUrl(url);
  const writable = OFFLINE_WRITE_TABLES.includes(query.table);
  let hit = null;
  try{
    hit = await (await caches.open(OFFLINE_DATA_CACHE)).match(restCacheKey(url, method));
  }catch(e){
    console.error(e);
  }
  if(!hit){
    if(!writable || method !== 'GET') throw new TypeError('Failed to fetch');
    servedFromDevice = true;
    return restRowsResponse(await localRestRows(query.table, query.filters), headers, 200);
  }
  servedFromDevice = true;
  const writes = method === 'GET' ? pendingOfflineWrites(query.table) : [];
  if(!writes.length) return hit;
  const data = await hit.json();
  return restRowsResponse(overlayRestRows(Array.isArray(data) ? data : [data], query, writes), headers, 200);
}

// Sans réseau : l'écriture part en file, et l'app reçoit la réponse attendue.
async function queueRestWrite(url, method, headers, rawBody){
  const write = describeRestWrite(url, method, headers, rawBody, offlineUserId());
  const wantsRows = /return=representation/.test(write.prefer);
  let rows = write.rows || [];
  if(method !== 'POST' && wantsRows){
    rows = await localRestRows(write.table, write.filters);
    if(method === 'PATCH') rows = rows.map(row => Object.assign({}, row, write.body));
  }
  enqueueOfflineWrite(write);
  if(!wantsRows) return new Response(null, { status: method === 'POST' ? 201 : 204 });
  return restRowsResponse(rows, headers, method === 'POST' ? 201 : 200);
}

// Une écriture passée en ligne corrige aussi les lectures gardées : sinon une
// note posée à l'aéroport disparaîtrait de l'app rouverte dans l'avion.
let restCacheWork = Promise.resolve();
function patchCachedRestReads(write){
  restCacheWork = restCacheWork.then(async () => {
    for(const { req, cache } of await cachedRestEntries(write.table)){
      const data = await (await cache.match(req)).json();
      const query = parseRestUrl(req.url);
      const rows = overlayRestRows(Array.isArray(data) ? data : [data], query, [write]);
      const text = JSON.stringify(Array.isArray(data) ? rows : (rows[0] || null));
      if(!Array.isArray(data) && !rows.length) await cache.delete(req);
      else await cache.put(req, restJsonResponse(text, 200));
    }
  }).catch(e => console.error(e));
  return restCacheWork;
}

// Lignes réellement écrites : celles renvoyées par la base si elle les a
// renvoyées, sinon celles envoyées, sans numéro provisoire.
function serverWriteFrom(url, method, headers, rawBody, returnedRows){
  const write = describeRestWrite(url, method, headers, rawBody, offlineUserId());
  if(method === 'POST'){
    write.rows = returnedRows || write.rows.map(row => { const { id, ...rest } = row; return rest; });
  }
  return write;
}

// --- État du réseau ---
let netProbeTimer = null;
let netDownResolve = null;
let netDownPromise = null;

function whenNetworkDown(){
  if(!netDownPromise) netDownPromise = new Promise(resolve => { netDownResolve = resolve; });
  return netDownPromise;
}

function noteNetworkDown(){
  if(isOfflineMode) return;
  isOfflineMode = true;
  if(netDownResolve){ netDownResolve(); netDownPromise = null; netDownResolve = null; }
  if(typeof onOfflineChange === 'function') onOfflineChange();
  scheduleNetProbe(3000);
}

function scheduleNetProbe(delay){
  clearTimeout(netProbeTimer);
  netProbeTimer = setTimeout(probeNetwork, delay);
}

// navigator.onLine n'est qu'un indice : le Wi-Fi d'un avion se dit connecté sans
// laisser sortir quoi que ce soit. Seule une vraie réponse de Supabase tranche.
async function probeNetwork(){
  if(!isOfflineMode) return;
  let up = false;
  if(navigator.onLine !== false){
    try{
      const res = await timedFetch(`${SUPABASE_URL}/rest/v1/site_status?select=id&limit=1`, { headers: { apikey: SUPABASE_ANON_KEY } }, 5000);
      up = res.status < 500;
    }catch(e){ /* toujours rien */ }
  }
  if(!up){
    if(typeof tellServiceWorkerNetwork === 'function') tellServiceWorkerNetwork();
    scheduleNetProbe(NET_PROBE_MS);
    return;
  }
  isOfflineMode = false;
  if(typeof onBackOnline === 'function') onBackOnline();
}

if(typeof window !== 'undefined'){
  window.addEventListener('online', probeNetwork);
  window.addEventListener('offline', noteNetworkDown);
  if(isOfflineMode) scheduleNetProbe(NET_PROBE_MS);
}

// --- Le fetch du client Supabase ---
function timedFetch(url, init, ms){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const outer = init.signal;
  if(outer){
    if(outer.aborted) ctrl.abort();
    else outer.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  return fetch(url, Object.assign({}, init, { signal: ctrl.signal })).finally(() => clearTimeout(timer));
}

async function kinetFetch(input, init = {}){
  const url = typeof input === 'string' ? input : input.url;
  const method = (init.method || (typeof input === 'string' ? 'GET' : input.method) || 'GET').toUpperCase();
  const headers = new Headers(init.headers || (typeof input === 'string' ? undefined : input.headers));
  const askedToStop = () => !!(init.signal && init.signal.aborted);
  const query = parseRestUrl(url);
  const isRest = query && !query.table.startsWith('rpc/');

  if(!isRest){
    // Connexion, RPC, fichiers : échec immédiat sans réseau.
    if(isOfflineMode) throw new TypeError('Failed to fetch');
    if(!url.includes('/auth/v1/')) return fetch(url, init);
    try{
      return await timedFetch(url, init, NET_AUTH_TIMEOUT_MS);
    }catch(e){
      if(!askedToStop()) noteNetworkDown();
      throw e;
    }
  }

  if(method === 'GET' || method === 'HEAD'){
    if(!isOfflineMode){
      try{
        const res = await timedFetch(url, init, netFirstRead ? NET_FIRST_READ_TIMEOUT_MS : NET_READ_TIMEOUT_MS);
        netFirstRead = false;
        if(res.ok) rememberRestResponse(url, method, res.clone());
        return res;
      }catch(e){
        if(askedToStop()) throw e;
        netFirstRead = false;
        noteNetworkDown();
      }
    }
    return readRestOffline(url, method, headers);
  }

  const writable = OFFLINE_WRITE_TABLES.includes(query.table);
  if(!isOfflineMode){
    try{
      const big = typeof init.body === 'string' && init.body.length > NET_BIG_WRITE_CHARS;
      const res = await timedFetch(url, init, big ? NET_BIG_WRITE_TIMEOUT_MS : NET_WRITE_TIMEOUT_MS);
      if(res.ok && writable){
        const returned = /return=representation/.test(headers.get('Prefer') || '') ? await res.clone().json().catch(() => null) : null;
        const rows = returned == null ? null : (Array.isArray(returned) ? returned : [returned]);
        patchCachedRestReads(serverWriteFrom(url, method, headers, init.body, rows));
      }
      return res;
    }catch(e){
      if(askedToStop()) throw e;
      noteNetworkDown();
    }
  }
  if(!writable) throw new TypeError('Failed to fetch');
  return queueRestWrite(url, method, headers, init.body);
}
