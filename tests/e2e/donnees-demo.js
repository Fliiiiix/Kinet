// --- Données de démonstration des tests d'écrans (tests/e2e/ecrans.spec.js) ---
// Injectées dans la page servie par tests/e2e/static-server.js : remplace
// supabaseClient.from/rpc par une petite base en mémoire et se connecte avec
// un compte fictif (admin, pour voir aussi l'onglet Admin). Aucune lecture ni
// écriture n'atteint Supabase ; seules les affiches viennent de TMDB.
// Le pseudo de Sam contient des guillemets et des chevrons exprès (échappement).
window.__kinetDemo = async function(){
  const ME = 'u-me', SAM = 'u-sam', NAVY = 'u-navy', LEA = 'u-lea';
  const titles = ['Arrival','Interstellar','Contact','Paprika','Moon','Solaris','After Yang','Her','Ex Machina','Parasite','Le Fabuleux Destin d\'Amélie Poulain','Mad Max: Fury Road','Dune','Whiplash'];
  const D = {};
  for(const t of titles){
    try{
      const r = await searchTmdb(t);
      const f = r[0];
      D[t] = { id: f.id, title: f.title, poster: f.poster_path ? TMDB_IMG_BASE + f.poster_path : null, year: (f.release_date || '').slice(0, 4), overview: f.overview, genres: f.genre_ids || [], original: f.original_title };
    }catch(e){ D[t] = { id: 1000 + titles.indexOf(t), title: t, poster: null, year: '2000', overview: '', genres: [] }; }
  }
  window.__demo = D;
  const crit = (a) => ({ scenario: a[0], mise_en_scene: a[1], jeu: a[2], esthetique: a[3], son: a[4], musique: a[5], ressenti: a[6] });
  const filmRow = (id, t, extra) => Object.assign({ id, user_id: ME, title: D[t].title, tmdb_id: D[t].id, poster_url: D[t].poster, overview: D[t].overview, release_year: +D[t].year || null, original_title: D[t].original !== D[t].title ? D[t].original : null, genre_ids: D[t].genres, crit: {}, fav: false, manual_note: null, is_private: false, review: null, added: Date.UTC(2026, id % 9, 1 + (id % 27)) }, extra); // en millisecondes, comme la vraie base (Date.now())
  const db = {
    profiles: [
      { user_id: ME, display_name: 'Flix (démo)', avatar_url: null, public_profile: true, top_films: [], onboarding_seen: true, annual_goal: 60 },
      { user_id: SAM, display_name: 'Sam l\'ami "Tom" & <Co>', avatar_url: null, public_profile: true },
      { user_id: NAVY, display_name: 'Navy', avatar_url: null, public_profile: false },
      { user_id: LEA, display_name: 'Léa', avatar_url: null },
    ],
    films: [
      filmRow(1, 'Arrival', { crit: crit([0.9, 0.95, 0.8, 0.9, 0.85, 0.9, 1]), fav: true, review: 'La scène de la première rencontre, inoubliable.' }),
      filmRow(2, 'Paprika', { manual_note: 5, fav: true }),
      filmRow(3, 'Moon', { crit: crit([0.7, 0.6, 0.9, 0.6, 0.7, 0.8, 0.7]) }),
      filmRow(4, 'Her', { crit: crit([0.8, 0.8, 0.9, 0.9, 0.7, 0.8, 0.8]), manual_note: 4.1 }),
      filmRow(5, 'Ex Machina', { manual_note: 3.5 }),
      filmRow(6, 'Parasite', { crit: crit([1, 1, 0.9, 0.9, 0.8, 0.7, 1]) }),
      filmRow(7, 'Le Fabuleux Destin d\'Amélie Poulain', { manual_note: 2.5, is_private: true }),
      filmRow(8, 'Mad Max: Fury Road', {}),
      filmRow(9, 'Dune', {}),
      filmRow(10, 'Whiplash', { crit: crit([0.6, 0.9, 1, 0.7, 0.9, 1, 0.9]) }),
      filmRow(11, 'Solaris', {}),
      filmRow(12, 'Contact', { crit: crit([0.4, 0.5, 0.6, 0.5, 0.5, 0.4, 0.3]) }),
      Object.assign(filmRow(101, 'Arrival', { manual_note: 4 }), { user_id: SAM }),
      Object.assign(filmRow(102, 'Interstellar', { manual_note: 4.5 }), { user_id: SAM }),
      Object.assign(filmRow(103, 'Dune', { manual_note: 3 }), { user_id: NAVY }),
    ],
    viewings: [1, 2, 3, 4, 5, 6, 7, 10, 12].map((fid, i) => ({ id: 200 + i, user_id: ME, film_id: fid, watched_at: new Date(2026, 9 - i, 3 + i).toISOString(), note: null })).concat([{ id: 300, user_id: ME, film_id: 1, watched_at: new Date(2025, 4, 2).toISOString(), note: null }]),
    watchlist: ['Interstellar', 'After Yang', 'Solaris', 'Contact'].map((t, i) => ({ id: 400 + i, user_id: ME, title: D[t].title, tmdb_id: D[t].id, poster_url: D[t].poster, overview: D[t].overview, release_year: +D[t].year || null, release_date: null, note: i === 0 ? 'Conseillé par Sam' : null, added: Date.UTC(2026, 9, i + 1) })),
    tv_shows: [
      { id: 28, user_id: ME, tmdb_id: 125988, title: 'Silo', poster_url: null, status: 'Returning Series', number_of_seasons: 3, number_of_episodes: 30, added: Date.UTC(2026, 8, 1), manual_note: 4 },
      { id: 29, user_id: ME, tmdb_id: 95396, title: 'Severance', poster_url: null, status: 'Returning Series', number_of_seasons: 2, number_of_episodes: 19, added: Date.UTC(2026, 7, 1), manual_note: null },
    ],
    tv_episodes_watched: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(e => ({ id: 500 + e, user_id: ME, tv_show_id: 28, season_number: 1, episode_number: e, watched_at: 1760000000000 + e, note: e === 1 ? 4 : null, times_watched: 1 })),
    friendships: [
      { id: 1, requester_id: ME, addressee_id: SAM, status: 'accepted', created_at: '2026-01-01' },
      { id: 2, requester_id: NAVY, addressee_id: ME, status: 'accepted', created_at: '2026-02-01' },
      { id: 3, requester_id: LEA, addressee_id: ME, status: 'pending', created_at: '2026-10-10' },
    ],
    groups: [{ id: 5, name: 'Ciné du dimanche', description: 'Un film par semaine.', owner_id: ME, created_at: '2026-09-01' }],
    group_members: [ME, SAM, NAVY].map((u, i) => ({ group_id: 5, user_id: u, joined_at: '2026-09-0' + (i + 1) })),
    group_proposals: [
      { id: 11, group_id: 5, proposed_by: NAVY, title: D.Moon.title, tmdb_id: D.Moon.id, poster_url: D.Moon.poster, release_year: 2009, overview: D.Moon.overview, created_at: '2026-10-12', chosen: true, chosen_at: '2026-10-13', watch_date: '2026-10-19', seen_at: null },
      { id: 12, group_id: 5, proposed_by: ME, title: D.Interstellar.title, tmdb_id: D.Interstellar.id, poster_url: D.Interstellar.poster, release_year: 2014, created_at: '2026-10-08', chosen: false, seen_at: null },
      { id: 13, group_id: 5, proposed_by: SAM, title: D.Contact.title, tmdb_id: D.Contact.id, poster_url: D.Contact.poster, release_year: 1997, created_at: '2026-10-11', chosen: false, seen_at: null },
    ],
    group_proposal_votes: [{ proposal_id: 12, user_id: SAM, value: 1 }, { proposal_id: 12, user_id: NAVY, value: 1 }, { proposal_id: 13, user_id: ME, value: 1 }],
    group_proposal_comments: [{ id: 1, proposal_id: 12, user_id: SAM, body: 'Je suis partant, en VO !', created_at: '2026-10-09T20:00:00Z' }],
    lists: [
      { id: 1, user_id: ME, title: 'SF qui fait réfléchir', description: 'Les films qui laissent une question en tête.', created_at: '2026-10-10', numbered: true },
      { id: 3, user_id: SAM, title: 'Mon top 2014', description: null, created_at: '2026-09-01', numbered: false },
    ],
    list_items: [],
    list_likes: [{ id: 1, list_id: 1, user_id: SAM }],
    film_likes: [], film_comments: [{ id: 1, user_id: SAM, tmdb_id: D.Arrival.id, body: 'Le meilleur Villeneuve.', created_at: '2026-10-01T10:00:00Z' }],
    comment_reactions: [],
    activity_events: [
      { id: 1, actor_id: SAM, event_type: 'film_rated', target_label: D.Interstellar.title, target_note: 4.5, created_at: '2026-10-15T20:00:00Z', group_id: null },
      { id: 2, actor_id: NAVY, event_type: 'watchlist_added', target_label: D.Dune.title, created_at: '2026-10-14T20:00:00Z', group_id: null },
    ],
    changelog_entries: [{ id: 15, version: '4.0', title: 'Nouvelle identité', body: 'NOUVELLE IDENTITÉ\n• Un nouveau look.', published: true, published_at: '2026-10-15T10:00:00Z', created_at: '2026-10-15T10:00:00Z' }],
    user_activity_state: [{ user_id: ME, last_seen_amis: '2026-10-01', last_seen_groupes: '2026-10-01', last_seen_changelog: '2026-10-16' }],
    feedback: [{ id: 1, user_id: SAM, category: 'bug', message: 'La saison ne se déplie pas', created_at: '2026-10-16T09:00:00Z', status: 'open' }],
    user_prefs: [], app_events: [], tcg_cards: [], tcg_card_links: [], tcg_user_cards: [], tcg_trades: [], group_invites: [], film_note_history: [],
  };
  ['Arrival', 'Interstellar', 'Contact', 'Paprika', 'Moon', 'Solaris', 'After Yang'].forEach((t, i) => db.list_items.push({ id: 600 + i, list_id: 1, user_id: ME, tmdb_id: D[t].id, title: D[t].title, poster_url: D[t].poster, release_year: +D[t].year, position: i }));
  ['Interstellar', 'Her', 'Ex Machina'].forEach((t, i) => db.list_items.push({ id: 700 + i, list_id: 3, user_id: SAM, tmdb_id: D[t].id, title: D[t].title, poster_url: D[t].poster, release_year: +D[t].year, position: i }));
  let nid = 5000;
  window.__db = db;
  function q(table){
    const st = { filters: [], order: null, single: false, maybe: false, op: 'select', payload: null, limit: null, head: false };
    const run = () => {
      if(!db[table]) db[table] = [];
      const rows = db[table];
      const match = r => st.filters.every(([k, v, kind]) => {
        if(kind === 'in') return v.includes(r[k]);
        if(kind === 'neq') return r[k] !== v;
        if(kind === 'is') return v === null ? r[k] == null : r[k] === v;
        if(kind === 'gt') return r[k] > v;
        if(kind === 'gte') return r[k] >= v;
        if(kind === 'lt') return r[k] < v;
        if(kind === 'lte') return r[k] <= v;
        return r[k] === v;
      });
      if(st.op === 'insert'){
        const list = Array.isArray(st.payload) ? st.payload : [st.payload];
        const out = list.map(p => { const row = Object.assign({ id: nid++, created_at: new Date().toISOString() }, p); rows.push(row); return Object.assign({}, row); });
        return { data: st.single || st.maybe ? out[0] : out, error: null };
      }
      if(st.op === 'update'){ const hit = rows.filter(match); hit.forEach(r => Object.assign(r, st.payload)); return { data: st.single ? (hit[0] || null) : hit.map(r => Object.assign({}, r)), error: null }; }
      if(st.op === 'delete'){ db[table] = rows.filter(r => !match(r)); return { data: null, error: null }; }
      let out = rows.filter(match);
      if(st.order) out = out.slice().sort((a, b) => (a[st.order.col] > b[st.order.col] ? 1 : a[st.order.col] < b[st.order.col] ? -1 : 0) * (st.order.asc ? 1 : -1));
      if(st.limit != null) out = out.slice(0, st.limit);
      if(st.head) return { data: null, count: out.length, error: null };
      if(st.single || st.maybe) return { data: out[0] ? Object.assign({}, out[0]) : null, error: null };
      return { data: out.map(r => Object.assign({}, r)), count: out.length, error: null };
    };
    const b = {
      select(cols, opts){ if(opts && opts.head) st.head = true; return b; },
      eq(k, v){ st.filters.push([k, v]); return b; }, in(k, v){ st.filters.push([k, v, 'in']); return b; },
      neq(k, v){ st.filters.push([k, v, 'neq']); return b; }, is(k, v){ st.filters.push([k, v, 'is']); return b; },
      gt(k, v){ st.filters.push([k, v, 'gt']); return b; }, gte(k, v){ st.filters.push([k, v, 'gte']); return b; },
      lt(k, v){ st.filters.push([k, v, 'lt']); return b; }, lte(k, v){ st.filters.push([k, v, 'lte']); return b; },
      or(){ return b; }, not(){ return b; }, ilike(){ return b; }, like(){ return b; }, contains(){ return b; }, filter(){ return b; }, match(){ return b; },
      order(col, o){ st.order = { col, asc: !o || o.ascending !== false }; return b; },
      limit(n){ st.limit = n; return b; }, range(){ return b; },
      single(){ st.single = true; return b; }, maybeSingle(){ st.maybe = true; return b; },
      insert(p){ st.op = 'insert'; st.payload = p; return b; }, upsert(p){ st.op = 'insert'; st.payload = p; return b; },
      update(p){ st.op = 'update'; st.payload = p; return b; }, delete(){ st.op = 'delete'; return b; },
      then(res, rej){ return Promise.resolve(run()).then(res, rej); }
    };
    return b;
  }
  supabaseClient.from = q;
  supabaseClient.rpc = async (name, args) => {
    if(name === 'get_friends_lists') return { data: [{ id: 3, user_id: SAM, title: 'Mon top 2014', item_count: 3, like_count: 2, poster_urls: [D.Interstellar.poster, D.Her.poster, D['Ex Machina'].poster] }], error: null };
    if(name === 'get_top_films' || name === 'get_friends_top_films') return { data: ['Parasite', 'Arrival', 'Her', 'Moon', 'Whiplash'].map((t, i) => ({ tmdb_id: D[t].id, title: D[t].title, poster_url: D[t].poster, release_year: +D[t].year, avg_note: 4.6 - i * 0.3, note_count: 5 - i % 3 })), error: null };
    if(name === 'get_public_profile') return { data: [{ user_id: SAM, display_name: 'Sam', avatar_url: null }], error: null };
    return { data: [], error: null };
  };
  currentUser = { id: ME, email: ADMIN_EMAIL };
  await showApp();
  return true;
};
