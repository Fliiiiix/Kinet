// --- Tests des épisodes sortis et du décochage annulable (js/series.js) ---
// Audit des six écrans, 16/10. S1 : TMDB compte les épisodes annoncés (Silo,
// saison 4 en 2027) ; seuls les épisodes sortis comptent et se cochent. S2 :
// « Tout décocher » une saison s'annule et remet notes et revisionnages.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(calls){
  const ctx = createContext({
    document: stubDocument(),
    goToSeries(){}, blockIfOffline(){ return false; }, showToast(){}, escapeHtml(s){ return String(s); },
    supabaseClient: {
      from(){
        const call = { op: null, payload: null };
        calls.push(call);
        const chain = {
          select(){ call.op = call.op || 'select'; return chain; },
          upsert(p, o){ call.op = 'upsert'; call.payload = p; call.options = o; return chain; },
          delete(){ call.op = 'delete'; return chain; },
          eq(){ return chain; },
          then(resolve){
            const data = call.op === 'select' ? [
              { season_number: 2, episode_number: 1, watched_at: 111, note: 4, times_watched: 2 },
            ] : null;
            return Promise.resolve({ data, error: null }).then(resolve);
          },
        };
        return chain;
      },
    },
  });
  loadFiles(ctx, ['js/series.js']);
  // Silo : S1 et S2 sorties, S3 sortie, S4 (1 épisode) annoncée pour 2027.
  setState(ctx, {
    trackedShows: [{ id: 28, tmdbId: 125988, title: 'Silo', lastEpisodeToAir: { s: 3, e: 10, d: '2026-09-03' }, nextEpisodeToAir: { s: 4, e: 1, d: '2027-07-08' } }],
    currentShowId: 28,
    currentShowSeasons: [
      { season_number: 1, episode_count: 10, air_date: '2023-05-04' },
      { season_number: 2, episode_count: 10, air_date: '2024-11-14' },
      { season_number: 3, episode_count: 10, air_date: '2026-07-02' },
      { season_number: 4, episode_count: 1, air_date: '2027-07-08' },
    ],
    loadedSeasonEpisodes: {},
    watchedEpisodeSet: new Set(['2-1']),
    watchedEpisodeExtras: { '2-1': { note: 4, timesWatched: 2 } },
  });
  ctx.renderSeriesBlocks = () => {};
  return ctx;
}

test('31 épisodes annoncés, 30 sortis : la saison 4 ne compte pas', () => {
  const ctx = buildContext([]);
  assert.strictEqual(ctx.airedEpisodeCount(), 30);
  assert.strictEqual(ctx.isEpisodeAired(4, 1), false);
  assert.strictEqual(ctx.isEpisodeAired(3, 10), true);
});

test('l’épisode à suivre est le premier pas vu, s’il est sorti', () => {
  const ctx = buildContext([]);
  const next = ctx.nextEpisodeToWatch();
  assert.strictEqual(`${next.s}-${next.e}`, '1-1');
});

test('tout ce qui est sorti est vu : rien à suivre, même avec la saison 4 annoncée', () => {
  const ctx = buildContext([]);
  const all = new Set();
  [[1, 10], [2, 10], [3, 10]].forEach(([s, n]) => { for(let e = 1; e <= n; e++) all.add(`${s}-${e}`); });
  setState(ctx, { watchedEpisodeSet: all });
  assert.strictEqual(ctx.nextEpisodeToWatch(), null);
});

test('marquer une saison ne coche que les épisodes sortis', async () => {
  const calls = [];
  const ctx = buildContext(calls);
  // Saison 3 en cours : seuls les épisodes 1 à 4 sont sortis selon TMDB.
  setState(ctx, { loadedSeasonEpisodes: { 3: Array.from({ length: 10 }, (_, i) => ({ episode_number: i + 1, air_date: i < 4 ? '2026-07-02' : '2099-01-01' })) } });
  await ctx.markSeasonWatched(3, 10);
  const up = calls.find(c => c.op === 'upsert');
  assert.strictEqual(up.payload.length, 4);
  assert.ok(!getState(ctx, 'watchedEpisodeSet').has('3-5'));
});

test('« Tout décocher » puis « Annuler » remet les épisodes avec leur note et leurs revisionnages', async () => {
  const calls = [];
  const ctx = buildContext(calls);
  await ctx.unmarkSeasonWatched(2);
  assert.ok(!getState(ctx, 'watchedEpisodeSet').has('2-1'));
  assert.strictEqual(getState(ctx, 'seriesUndo.rows.length'), 1);
  await ctx.undoUnmarkSeason();
  assert.ok(getState(ctx, 'watchedEpisodeSet').has('2-1'));
  const restored = calls.filter(c => c.op === 'upsert').pop();
  assert.strictEqual(restored.payload[0].note, 4);
  assert.strictEqual(restored.payload[0].times_watched, 2);
  assert.strictEqual(getState(ctx, 'watchedEpisodeExtras["2-1"].timesWatched'), 2);
});

module.exports = run('series-aired.test.js');
