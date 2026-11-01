// --- Tests de la couche réseau hors ligne (js/offlineNet.js) ---
// Retour de Flix (01/11) : « un mode hors ligne, qu'on puisse être dans l'avion
// et noter ses films, les chercher, tout comme les séries ». Tout passe par
// kinetFetch() : une lecture sans réseau ressert ce qui est gardé, corrigé par
// la file d'attente, une écriture part en file et répond comme la base.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument, fakeLocalStorage } = require('./helpers/vm-harness');
const { test, run } = createSuite();

const BASE = 'https://x.supabase.co/rest/v1';

function fakeCaches(){
  const store = new Map();
  const cache = {
    async match(key){
      const url = typeof key === 'string' ? key : key.url;
      const hit = store.get(url);
      return hit ? new Response(hit.text, { status: 200, headers: hit.headers }) : undefined;
    },
    async put(key, res){
      store.set(typeof key === 'string' ? key : key.url, { text: await res.clone().text(), headers: Object.fromEntries(res.headers.entries()) });
    },
    async delete(key){ return store.delete(typeof key === 'string' ? key : key.url); },
    async keys(){ return [...store.keys()].map(url => ({ url })); },
  };
  return { open: async () => cache, store };
}

function buildContext(fetchImpl){
  const calls = [];
  const ctx = createContext({
    document: stubDocument(), URL, URLSearchParams, Headers, Response, AbortController,
    localStorage: fakeLocalStorage(), caches: fakeCaches(),
    navigator: { onLine: true }, currentUser: { id: 'u1' },
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k',
    setTimeout: () => 0, clearTimeout(){},
    fetch: async (url, init) => { calls.push({ url, init }); return fetchImpl(url, init); },
  });
  loadFiles(ctx, ['js/offlineNet.js', 'js/offlineQueue.js']);
  return { ctx, calls };
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const down = async () => { throw new TypeError('Failed to fetch'); };
const plain = (v) => JSON.parse(JSON.stringify(v));

// Une lecture faite en ligne, pour remplir ce qui est gardé.
async function keepRead(url, rows){
  const { ctx } = buildContext(async () => json(rows));
  await ctx.kinetFetch(url, { method: 'GET', headers: {} });
  await new Promise(r => setImmediate(r));
  return ctx;
}

test('parseRestUrl() : table, filtres, tri, en laissant de côté ce qui ne filtre pas', () => {
  const { ctx } = buildContext(down);
  const q = plain(ctx.parseRestUrl(`${BASE}/films?select=*&user_id=eq.u1&order=added.desc&limit=5`));
  assert.strictEqual(q.table, 'films');
  assert.deepStrictEqual(q.filters, [['user_id', 'eq.u1']]);
  assert.strictEqual(q.order, 'added.desc');
  assert.strictEqual(q.limit, '5');
});

test('restFilterMatches() : égal, liste, null et négation, un filtre inconnu ne juge pas', () => {
  const { ctx } = buildContext(down);
  const row = { id: 7, note: null, title: 'Dune' };
  assert.ok(ctx.restFilterMatches(row, 'id', 'eq.7'));
  assert.ok(!ctx.restFilterMatches(row, 'id', 'eq.8'));
  assert.ok(ctx.restFilterMatches(row, 'id', 'in.(3,7)'));
  assert.ok(ctx.restFilterMatches(row, 'title', 'in.("Dune","Moon")'));
  assert.ok(ctx.restFilterMatches(row, 'note', 'is.null'));
  assert.ok(ctx.restFilterMatches(row, 'id', 'not.is.null'));
  assert.ok(ctx.restFilterMatches(row, 'id', 'gte.7'));
  assert.ok(!ctx.restFilterMatches(row, 'id', 'gt.7'));
  assert.ok(ctx.restFilterMatches(row, 'or', '(a.eq.1,b.eq.2)'));
});

test('overlayRestRows() : création, modification et suppression, puis le tri de la lecture', () => {
  const { ctx } = buildContext(down);
  const query = { table: 'films', filters: [['user_id', 'eq.u1']], order: 'added.desc', limit: null };
  const rows = [{ id: 1, user_id: 'u1', title: 'A', added: 10 }, { id: 2, user_id: 'u1', title: 'B', added: 5 }];
  const writes = [
    { table: 'films', method: 'POST', filters: [], rows: [{ id: -1, user_id: 'u1', title: 'C', added: 20 }] },
    { table: 'films', method: 'PATCH', filters: [['id', 'eq.1']], body: { title: 'A2' } },
    { table: 'films', method: 'DELETE', filters: [['id', 'eq.2']] },
    { table: 'watchlist', method: 'DELETE', filters: [] },
  ];
  const out = plain(ctx.overlayRestRows(rows, query, writes));
  assert.deepStrictEqual(out.map(r => r.title), ['C', 'A2']);
  assert.strictEqual(rows[0].title, 'A', 'les lignes gardées ne bougent pas');
});

test('overlayRestRows() : une lecture qui ne garde pas sa colonne de filtre reste corrigée', () => {
  const { ctx } = buildContext(down);
  const query = { table: 'tv_episodes_watched', filters: [['tv_show_id', 'eq.28']], order: null, limit: null };
  const rows = [{ season_number: 1, episode_number: 1, note: null }];
  const mine = [{ table: 'tv_episodes_watched', method: 'PATCH', filters: [['tv_show_id', 'eq.28'], ['season_number', 'eq.1'], ['episode_number', 'eq.1']], body: { note: 4 } }];
  const other = [{ table: 'tv_episodes_watched', method: 'DELETE', filters: [['tv_show_id', 'eq.29'], ['season_number', 'eq.1']] }];
  assert.strictEqual(plain(ctx.overlayRestRows(rows, query, mine))[0].note, 4);
  assert.strictEqual(plain(ctx.overlayRestRows(rows, query, other)).length, 1, 'une autre série ne touche pas celle-ci');
});

test('overlayRestRows() : un épisode coché deux fois ne se double pas (clé de conflit)', () => {
  const { ctx } = buildContext(down);
  const query = { table: 'tv_episodes_watched', filters: [['tv_show_id', 'eq.28']], order: null, limit: null };
  const rows = [{ season_number: 1, episode_number: 1, note: 3 }];
  const write = (ep) => ({
    table: 'tv_episodes_watched', method: 'POST', filters: [], ignoreDuplicates: true, onConflict: 'user_id,tv_show_id,season_number,episode_number',
    rows: [{ user_id: 'u1', tv_show_id: 28, season_number: 1, episode_number: ep }],
  });
  const out = plain(ctx.overlayRestRows(rows, query, [write(1), write(2)]));
  assert.deepStrictEqual(out.map(r => r.episode_number), [1, 2]);
  assert.strictEqual(out[0].note, 3, 'la note déjà posée reste');
});

test('kinetFetch() : une panne en pleine lecture bascule hors ligne et ressert la dernière réponse', async () => {
  const url = `${BASE}/films?select=*&user_id=eq.u1`;
  const ctx = await keepRead(url, [{ id: 1, title: 'Dune' }]);
  const saved = ctx.caches;
  const { ctx: next } = buildContext(down);
  setState(next, { caches: saved });
  const res = await next.kinetFetch(url, { method: 'GET', headers: {} });
  assert.deepStrictEqual(await res.json(), [{ id: 1, title: 'Dune' }]);
  assert.strictEqual(getState(next, 'isOfflineMode'), true);
});

test('kinetFetch() : sans réseau, une note posée revient dans la lecture, même rechargée', async () => {
  const url = `${BASE}/films?select=*&user_id=eq.u1&order=added.desc`;
  const ctx = await keepRead(url, [{ id: 1, user_id: 'u1', title: 'Dune', added: 1 }]);
  setState(ctx, { isOfflineMode: true });
  const created = await ctx.kinetFetch(`${BASE}/films?select=*`, {
    method: 'POST', body: JSON.stringify({ title: 'Paprika', added: 5, tmdb_id: 4977 }),
    headers: { Prefer: 'return=representation', Accept: 'application/vnd.pgrst.object+json' },
  });
  assert.strictEqual(created.status, 201);
  const row = await created.json();
  assert.strictEqual(row.title, 'Paprika');
  assert.ok(row.id < 0, 'numéro provisoire');
  assert.strictEqual(row.user_id, 'u1');

  const list = await (await ctx.kinetFetch(url, { method: 'GET', headers: {} })).json();
  assert.deepStrictEqual(list.map(r => r.title), ['Paprika', 'Dune']);
  assert.strictEqual(list[0].id, row.id, 'le même numéro, pour pouvoir le modifier ensuite');
});

test('kinetFetch() : sans réseau, modifier un film créé en vol retrouve sa ligne', async () => {
  const url = `${BASE}/films?select=*&user_id=eq.u1`;
  const ctx = await keepRead(url, []);
  setState(ctx, { isOfflineMode: true });
  const made = await ctx.kinetFetch(`${BASE}/films?select=*`, { method: 'POST', body: JSON.stringify({ title: 'Paprika' }), headers: { Prefer: 'return=representation' } });
  const [row] = await made.json();
  const patched = await ctx.kinetFetch(`${BASE}/films?id=eq.${row.id}&user_id=eq.u1`, { method: 'PATCH', body: JSON.stringify({ review: 'Superbe' }), headers: {} });
  assert.strictEqual(patched.status, 204);
  const list = await (await ctx.kinetFetch(url, { method: 'GET', headers: {} })).json();
  assert.strictEqual(list[0].review, 'Superbe');
});

test('kinetFetch() : sans réseau, supprimer avec .select() rend les lignes touchées', async () => {
  const ctx = await keepRead(`${BASE}/watchlist?select=*`, [{ id: 3, tmdb_id: 99, title: 'Moon' }, { id: 4, tmdb_id: 12, title: 'Up' }]);
  setState(ctx, { isOfflineMode: true });
  const res = await ctx.kinetFetch(`${BASE}/watchlist?tmdb_id=eq.99&select=id`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  assert.deepStrictEqual((await res.json()).map(r => r.id), [3]);
  const left = await (await ctx.kinetFetch(`${BASE}/watchlist?select=*`, { method: 'GET', headers: {} })).json();
  assert.deepStrictEqual(left.map(r => r.id), [4]);
});

test('kinetFetch() : une lecture jamais faite reprend les lignes connues de la table', async () => {
  const ctx = await keepRead(`${BASE}/films?select=*`, [{ id: 1, tmdb_id: 42, title: 'Dune' }, { id: 2, tmdb_id: 43, title: 'Moon' }]);
  setState(ctx, { isOfflineMode: true });
  const res = await ctx.kinetFetch(`${BASE}/films?select=id,title&tmdb_id=eq.43`, { method: 'GET', headers: {} });
  assert.deepStrictEqual((await res.json()).map(r => r.title), ['Moon']);
});

test('kinetFetch() : hors des données perso, échec normal sans réseau et rien en file', async () => {
  const { ctx, calls } = buildContext(down);
  setState(ctx, { isOfflineMode: true });
  await assert.rejects(ctx.kinetFetch(`${BASE}/film_comments`, { method: 'POST', body: '{}', headers: {} }));
  await assert.rejects(ctx.kinetFetch(`${BASE}/rpc/get_top`, { method: 'POST', body: '{}', headers: {} }));
  await assert.rejects(ctx.kinetFetch(`${BASE}/profiles?select=*`, { method: 'GET', headers: {} }));
  assert.strictEqual(calls.length, 0, 'pas de tentative réseau');
  assert.strictEqual(ctx.pendingOfflineWrites('film_comments').length, 0);
});

test('kinetFetch() : une écriture qui échoue en ligne (coupure) part en file plutôt que d\'être perdue', async () => {
  const { ctx } = buildContext(down);
  const res = await ctx.kinetFetch(`${BASE}/watchlist`, { method: 'POST', body: JSON.stringify({ title: 'Moon' }), headers: {} });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(getState(ctx, 'isOfflineMode'), true);
  assert.strictEqual(ctx.pendingOfflineWrites('watchlist').length, 1);
});

test('kinetFetch() : une note posée en ligne corrige aussi la liste gardée (aéroport puis avion)', async () => {
  const url = `${BASE}/films?select=*&user_id=eq.u1&order=added.desc`;
  const ctx = await keepRead(url, [{ id: 1, user_id: 'u1', title: 'Dune', added: 1 }]);
  setState(ctx, { fetch: async () => json([{ id: 2, user_id: 'u1', title: 'Moon', added: 9 }], 201) });
  await ctx.kinetFetch(`${BASE}/films?select=*`, { method: 'POST', body: JSON.stringify({ title: 'Moon', added: 9 }), headers: { Prefer: 'return=representation' } });
  await getState(ctx, 'restCacheWork');
  setState(ctx, { isOfflineMode: true });
  const list = await (await ctx.kinetFetch(url, { method: 'GET', headers: {} })).json();
  assert.deepStrictEqual(list.map(r => r.id), [2, 1], 'la vraie ligne, avec son vrai numéro');
});

test('newOfflineTempId() : négatif et assez long pour ne croiser aucun vrai numéro', () => {
  const { ctx } = buildContext(down);
  assert.ok(/^-\d{13,}$/.test(String(ctx.newOfflineTempId())));
});

module.exports = run();
