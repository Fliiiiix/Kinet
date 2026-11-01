// --- Tests de la file d'attente hors ligne (js/offlineQueue.js) ---
// Ce qui a été fait dans l'avion part au retour du réseau, dans l'ordre : les
// numéros provisoires deviennent les vrais, une panne garde tout pour plus tard,
// et rien n'est créé en double si le film a été noté ailleurs pendant le vol.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument, fakeLocalStorage } = require('./helpers/vm-harness');
const { test, run } = createSuite();

const BASE = 'https://x.supabase.co/rest/v1';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function buildContext(respond){
  const calls = [];
  const storage = fakeLocalStorage();
  const ctx = createContext({
    document: stubDocument(), URL, URLSearchParams, Headers, Response,
    localStorage: storage, navigator: { onLine: true }, currentUser: { id: 'u1' },
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k',
    setTimeout: () => 0, clearTimeout(){},
    caches: { open: async () => ({ keys: async () => [], match: async () => undefined, put: async () => {}, delete: async () => {} }) },
    supabaseClient: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
    fetch: async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
      return respond(url, init, calls);
    },
  });
  loadFiles(ctx, ['js/offlineNet.js', 'js/offlineQueue.js']);
  return { ctx, calls, storage };
}

const writes = (calls) => calls.filter(c => c.method !== 'GET');

// Ce que produit la couche réseau quand Flix note un film en vol.
function queueFilmThenViewing(ctx){
  const headers = new Headers({ Prefer: 'return=representation' });
  const film = ctx.describeRestWrite(`${BASE}/films?select=*`, 'POST', headers, JSON.stringify({ title: 'Paprika', tmdb_id: 4977, fav: false, added: 5 }), 'u1');
  const tempId = film.rows[0].id;
  ctx.enqueueOfflineWrite(film);
  ctx.enqueueOfflineWrite(ctx.describeRestWrite(`${BASE}/viewings?select=*`, 'POST', headers, JSON.stringify({ film_id: tempId, watched_at: 5 }), 'u1'));
  ctx.enqueueOfflineWrite(ctx.describeRestWrite(`${BASE}/films?id=eq.${tempId}&user_id=eq.u1`, 'PATCH', new Headers(), JSON.stringify({ review: 'Superbe' }), 'u1'));
  return tempId;
}

test('enqueueOfflineWrite() : gardée sur l\'appareil, retrouvée après rechargement', () => {
  const { ctx } = buildContext(() => json([]));
  queueFilmThenViewing(ctx);
  ctx.loadOfflineQueue();
  assert.strictEqual(ctx.pendingOfflineWrites('films').length, 2);
  assert.strictEqual(ctx.pendingOfflineWrites('viewings').length, 1);
});

test('replayOfflineQueue() : les numéros provisoires deviennent les vrais, dans l\'ordre', async () => {
  const { ctx, calls } = buildContext((url, init) => {
    if(init.method === 'POST' && url.includes('/films')) return json([{ id: 900, title: 'Paprika' }], 201);
    if(init.method === 'POST') return json([{ id: 50, film_id: 900 }], 201);
    if(init.method === 'PATCH') return new Response(null, { status: 204 });
    return json([]);
  });
  queueFilmThenViewing(ctx);
  const result = await ctx.replayOfflineQueue();

  const sent = writes(calls);
  assert.deepStrictEqual(sent.map(c => c.method), ['POST', 'POST', 'PATCH']);
  assert.strictEqual(sent[0].body.id, undefined, 'le numéro provisoire ne part jamais en base');
  assert.strictEqual(sent[1].body.film_id, 900);
  assert.ok(sent[2].url.includes('id=eq.900'), sent[2].url);
  assert.strictEqual(sent[0].headers.Authorization, 'Bearer tok');
  assert.ok(sent[0].headers.Prefer.includes('return=representation'));
  assert.strictEqual(result.sent, 3);
  assert.strictEqual(ctx.pendingOfflineWrites('films').length, 0);
});

test('replayOfflineQueue() : une panne au milieu garde la suite, et reprend avec le bon numéro', async () => {
  let up = true;
  const { ctx, calls } = buildContext((url, init) => {
    if(init.method === 'POST' && url.includes('/films')) return json([{ id: 900 }], 201);
    if(init.method === 'POST' && !up) throw new TypeError('Failed to fetch');
    if(init.method === 'POST') return json([{ id: 50 }], 201);
    if(init.method === 'PATCH') return new Response(null, { status: 204 });
    return json([]);
  });
  queueFilmThenViewing(ctx);
  up = false;
  const first = await ctx.replayOfflineQueue();
  assert.strictEqual(first.sent, 1);
  assert.strictEqual(ctx.pendingOfflineWrites('viewings').length, 1, 'rien de perdu');

  up = true;
  calls.length = 0;
  const second = await ctx.replayOfflineQueue();
  assert.strictEqual(second.sent, 2);
  assert.strictEqual(writes(calls)[0].body.film_id, 900, 'le lien survit à la coupure');
});

test('replayOfflineQueue() : un refus définitif est mis de côté, sans bloquer la suite', async () => {
  const { ctx, storage } = buildContext((url, init) => {
    if(init.method === 'POST' && url.includes('/watchlist')) return json({ code: '42501', message: 'interdit' }, 403);
    if(init.method === 'POST') return json([{ id: 1 }], 201);
    return json([]);
  });
  const headers = new Headers();
  ctx.enqueueOfflineWrite(ctx.describeRestWrite(`${BASE}/watchlist`, 'POST', headers, JSON.stringify({ title: 'Moon' }), 'u1'));
  ctx.enqueueOfflineWrite(ctx.describeRestWrite(`${BASE}/viewings`, 'POST', headers, JSON.stringify({ film_id: 3 }), 'u1'));
  const result = await ctx.replayOfflineQueue();
  assert.strictEqual(result.refused, 1);
  assert.strictEqual(result.sent, 1);
  assert.strictEqual(JSON.parse(storage.getItem('offlineFailed_u1')).length, 1);
});

test('replayOfflineQueue() : jeton expiré (401), on garde tout pour le prochain essai', async () => {
  const { ctx } = buildContext(() => json({ message: 'JWT expired' }, 401));
  ctx.enqueueOfflineWrite(ctx.describeRestWrite(`${BASE}/viewings`, 'POST', new Headers(), JSON.stringify({ film_id: 3 }), 'u1'));
  const result = await ctx.replayOfflineQueue();
  assert.strictEqual(result.sent, 0);
  assert.strictEqual(ctx.pendingOfflineWrites('viewings').length, 1);
});

test('replayOfflineQueue() : film noté ailleurs pendant le vol, mise à jour sans doublon', async () => {
  const { ctx, calls } = buildContext((url, init) => {
    if(!init.method || init.method === 'GET') return json(url.includes('tmdb_id=eq.4977') ? [{ id: 321 }] : []);
    if(init.method === 'POST') return json([{ id: 50 }], 201);
    return new Response(null, { status: 204 });
  });
  queueFilmThenViewing(ctx);
  await ctx.replayOfflineQueue();
  const sent = writes(calls);
  assert.deepStrictEqual(sent.map(c => c.method), ['PATCH', 'POST', 'PATCH']);
  assert.ok(sent[0].url.includes('id=eq.321'));
  assert.strictEqual(sent[0].body.fav, undefined, 'favori et date d\'ajout de la fiche existante restent');
  assert.strictEqual(sent[0].body.added, undefined);
  assert.strictEqual(sent[1].body.film_id, 321, 'le visionnage rejoint la fiche existante');
});

test('replayOfflineQueue() : déjà dans À voir, rien à créer', async () => {
  const { ctx, calls } = buildContext((url, init) => (init.method ? json([{ id: 1 }], 201) : json([{ id: 77 }])));
  ctx.enqueueOfflineWrite(ctx.describeRestWrite(`${BASE}/watchlist`, 'POST', new Headers(), JSON.stringify({ title: 'Moon', tmdb_id: 17431 }), 'u1'));
  const result = await ctx.replayOfflineQueue();
  assert.strictEqual(writes(calls).length, 0);
  assert.strictEqual(result.sent, 1);
});

test('replayOfflineQueue() : déjà cochée ailleurs (23505), l\'épisode est considéré comme envoyé', async () => {
  const { ctx } = buildContext(() => json({ code: '23505', message: 'duplicate key' }, 409));
  ctx.enqueueOfflineWrite(ctx.describeRestWrite(`${BASE}/tv_episodes_watched`, 'POST', new Headers(), JSON.stringify({ tv_show_id: 28, season_number: 1, episode_number: 1 }), 'u1'));
  const result = await ctx.replayOfflineQueue();
  assert.strictEqual(result.sent, 1);
  assert.strictEqual(result.refused, 0);
});

test('replayOfflineQueue() : une série suivie ailleurs reprend le numéro existant', async () => {
  const { ctx, calls } = buildContext((url, init) => {
    if(init.method === 'POST' && url.includes('/tv_shows')) return json({ code: '23505' }, 409);
    if(!init.method) return json([{ id: 66 }]);
    return json([{ id: 1 }], 201);
  });
  const show = ctx.describeRestWrite(`${BASE}/tv_shows?select=*`, 'POST', new Headers(), JSON.stringify({ title: 'Dark', tmdb_id: 70523 }), 'u1');
  ctx.enqueueOfflineWrite(show);
  ctx.enqueueOfflineWrite(ctx.describeRestWrite(`${BASE}/tv_episodes_watched`, 'POST', new Headers(), JSON.stringify({ tv_show_id: show.rows[0].id, season_number: 1, episode_number: 1 }), 'u1'));
  await ctx.replayOfflineQueue();
  assert.strictEqual(writes(calls).pop().body.tv_show_id, 66);
});

test('replayOfflineQueue() : file vide ou plus de session, rien ne part', async () => {
  const { ctx, calls } = buildContext(() => json([]));
  assert.strictEqual(await ctx.replayOfflineQueue(), null);
  ctx.enqueueOfflineWrite(ctx.describeRestWrite(`${BASE}/viewings`, 'POST', new Headers(), '{}', 'u1'));
  setState(ctx, { supabaseClient: { auth: { getSession: async () => ({ data: { session: null } }) } } });
  assert.strictEqual(await ctx.replayOfflineQueue(), null);
  assert.strictEqual(calls.length, 0);
});

test('loadOfflineQueue() : une file de l\'ancien format est reprise, rien n\'est perdu', async () => {
  const { ctx, calls, storage } = buildContext(() => new Response(null, { status: 204 }));
  storage.setItem('offlineQueue_u1', JSON.stringify([
    { table: 'watchlist', op: 'delete', match: { id: 7 }, queuedAt: 1 },
    { table: 'films', op: 'update', match: { id: 3, user_id: 'u1' }, payload: { fav: true }, queuedAt: 2 },
    { table: 'tv_episodes_watched', op: 'upsert', payload: { tv_show_id: 28, season_number: 1, episode_number: 2 }, upsertOptions: {}, queuedAt: 3 },
  ]));
  await ctx.replayOfflineQueue();
  assert.deepStrictEqual(writes(calls).map(c => c.method), ['DELETE', 'PATCH', 'POST']);
  assert.ok(writes(calls)[0].url.endsWith('/watchlist?id=eq.7'));
  assert.deepStrictEqual(writes(calls)[1].body, { fav: true });
  assert.ok(writes(calls)[2].url.includes('on_conflict=user_id,tv_show_id,season_number,episode_number'));
  assert.ok(writes(calls)[2].headers.Prefer.includes('resolution=ignore-duplicates'));
});

module.exports = run();
