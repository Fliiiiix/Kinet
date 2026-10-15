// --- Tests de la sauvegarde complète (js/backup.js, draft Profil du 15/10) ---
// « Tout sauvegarder » : films, visionnages, À voir, séries, listes dans un
// seul fichier. « Restaurer » : ajoute ce qui manque, sans doublon, et lit
// aussi les anciens fichiers (films seuls).
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

// Base simulée : chaque insert reçoit des ids et est gardé pour inspection.
function fakeSupabase(){
  const inserted = {};
  let nextId = 1000;
  const client = {
    inserted,
    from(table){
      const q = {
        _rows: null,
        select(){ return q; }, eq(){ return q; }, in(){ return q; }, order(){ return q; }, single(){ return q; },
        insert(rows){ q._rows = (Array.isArray(rows) ? rows : [rows]).map(r => Object.assign({ id: nextId++ }, r)); (inserted[table] = inserted[table] || []).push(...q._rows); return q; },
        upsert(rows){ return q.insert(rows); },
        then(resolve){
          const data = q._rows ? (Array.isArray(q._rows) && q._single ? q._rows[0] : q._rows) : [];
          resolve({ data, error: null });
        },
      };
      return q;
    },
  };
  return client;
}

function buildContext(){
  const ctx = createContext({
    document: stubDocument(),
    showToast(){}, blockIfOffline(){ return false; }, render(){}, buildGenreFilterOptions(){},
    normalizeSearch(s){ return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); },
    isValidImportedFilm(f){ return f && typeof f.title === 'string' && f.title.trim() && typeof f.crit === 'object' && f.crit !== null; },
    rowToFilm(row){ return { id: row.id, title: row.title, tmdbId: row.tmdb_id || null, added: row.added }; },
    rowToShow(row){ return { id: row.id, tmdbId: row.tmdb_id, title: row.title }; },
    loadWatchlist(){ return Promise.resolve(); }, loadTrackedShows(){ return Promise.resolve(); },
  });
  loadFiles(ctx, ['js/backup.js']);
  const sb = fakeSupabase();
  setState(ctx, { supabaseClient: sb, currentUser: { id: 'me' }, films: [], viewings: [], watchlist: [], trackedShows: [] });
  return { ctx, sb };
}

test('clé d\'un film : l\'identifiant TMDB, sinon le titre sans accents ni majuscules', () => {
  const { ctx } = buildContext();
  assert.strictEqual(ctx.backupKey(238, 'Le Parrain'), 't:238');
  assert.strictEqual(ctx.backupKey(null, '  Amélie '), 'n:amelie');
});

test('restaurer : n\'ajoute que les films absents, une seule fois chacun', async () => {
  const { ctx, sb } = buildContext();
  setState(ctx, { films: [{ id: 1, tmdbId: 238, title: 'Le Parrain' }] });
  const report = await ctx.restoreBackup({ films: [
    { title: 'Le Parrain', tmdbId: 238, crit: {} },
    { title: 'Paprika', tmdbId: 4977, crit: {} },
    { title: 'Paprika', tmdbId: 4977, crit: {} },
  ] });
  assert.strictEqual(report.films, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sb.inserted.films.map(r => r.title))), ['Paprika']);
});

test('restaurer : les visionnages retrouvent leur film, sans doublon de date', async () => {
  const { ctx, sb } = buildContext();
  setState(ctx, { films: [{ id: 1, tmdbId: 238, title: 'Le Parrain' }], viewings: [{ id: 9, filmId: 1, watchedAt: 100 }] });
  const report = await ctx.restoreBackup({ films: [], viewings: [
    { tmdbId: 238, title: 'Le Parrain', watchedAt: 100 },
    { tmdbId: 238, title: 'Le Parrain', watchedAt: 200 },
    { tmdbId: 999, title: 'Inconnu', watchedAt: 300 },
  ] });
  assert.strictEqual(report.viewings, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sb.inserted.viewings.map(r => [r.film_id, r.watched_at]))), [[1, 200]]);
});

test('ancien fichier (films seuls) : un premier visionnage daté de l\'ajout', async () => {
  const { ctx, sb } = buildContext();
  const report = await ctx.restoreBackup([{ title: 'Paprika', tmdbId: 4977, crit: {}, added: 555 }]);
  assert.strictEqual(report.films, 1);
  assert.strictEqual(sb.inserted.viewings.length, 1);
  assert.strictEqual(sb.inserted.viewings[0].watched_at, 555);
});

test('À voir : ni ce qui y est déjà, ni un film noté depuis', async () => {
  const { ctx, sb } = buildContext();
  setState(ctx, { films: [{ id: 1, tmdbId: 238, title: 'Le Parrain' }], watchlist: [{ tmdbId: 11, title: 'Star Wars' }] });
  const report = await ctx.restoreBackup({ watchlist: [
    { title: 'Le Parrain', tmdbId: 238 }, { title: 'Star Wars', tmdbId: 11 }, { title: 'Mars Express', tmdbId: 22 },
  ] });
  assert.strictEqual(report.watchlist, 1);
  assert.strictEqual(sb.inserted.watchlist[0].title, 'Mars Express');
});

test('séries : la série manquante est recréée et ses épisodes recochés', async () => {
  const { ctx, sb } = buildContext();
  const report = await ctx.restoreBackup({ series: [{ tmdbId: 70523, title: 'Dark', episodes: [{ season: 1, episode: 1, watchedAt: 10 }, { season: 1, episode: 2, watchedAt: 20 }] }] });
  assert.strictEqual(report.series, 1);
  assert.strictEqual(report.episodes, 2);
  assert.strictEqual(sb.inserted.tv_episodes_watched[0].tv_show_id, sb.inserted.tv_shows[0].id);
});

test('compte rendu : ce qui a été ajouté, ou « Rien à ajouter »', () => {
  const { ctx } = buildContext();
  assert.strictEqual(ctx.restoreReportText({ films: 2, viewings: 0, watchlist: 1, series: 0, episodes: 12, lists: 0 }), 'Restauré : 2 films, 1 à voir, 12 épisodes');
  assert.strictEqual(ctx.restoreReportText({ films: 0, viewings: 0, watchlist: 0, series: 0, episodes: 0, lists: 0 }), 'Rien à ajouter : tout y est déjà');
});

module.exports = run('backup.test.js');
