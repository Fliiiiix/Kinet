// --- Tests des notes et commentaires d'épisode, et de la note de série tirée
// des épisodes (js/series.js) --- Retour de Flix (28/10) : « pouvoir aussi
// noter et commenter par ep de manière discrète et que la moyenne des ep
// puisse faire celle de la saison puis de la série ».
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const updates = [];
  const ctx = createContext({
    document: stubDocument(),
    goToSeries(){}, blockIfOffline(){ return false; }, showToast(m){ ctx.lastToast = m; },
    escapeHtml(s){ return String(s); },
    noteColorClass(){ return ''; },
    supabaseClient: {
      from(table){
        const call = { table, update: null, eq: [] };
        updates.push(call);
        const chain = {
          update(p){ call.update = p; return chain; },
          eq(c, v){ call.eq.push([c, v]); return chain; },
          then(resolve){ return Promise.resolve({ error: null }).then(resolve); },
        };
        return chain;
      },
    },
  });
  loadFiles(ctx, ['js/series.js']);
  return { ctx, updates };
}

test('moyenne des saisons : une saison de 6 épisodes pèse autant qu’une de 2', () => {
  const { ctx } = buildContext();
  // Saison 1 : 4,0 de moyenne ; saison 2 : 2,0. La série : 3,0, pas la moyenne des 8 épisodes (3,5).
  assert.strictEqual(ctx.averageOfSeasons({ 1: [4, 4, 4, 4, 4, 4], 2: [2, 2] }), 3);
  assert.strictEqual(ctx.averageOfSeasons({}), null);
  assert.strictEqual(ctx.averageOfSeasons({ 1: [] }), null);
});

test('note de la série : celle posée à la main d’abord, sinon la moyenne des épisodes', () => {
  const { ctx } = buildContext();
  setState(ctx, { showEpisodeNotes: { 7: { 1: [5, 4], 2: [3] } } });
  assert.strictEqual(ctx.showDisplayNote({ id: 7, manualNote: null }), 3.75);
  assert.strictEqual(ctx.showDisplayNote({ id: 7, manualNote: 4.5 }), 4.5);
  assert.strictEqual(ctx.showDisplayNote({ id: 8, manualNote: null }), null, 'aucun épisode noté');
});

test('fiche ouverte : noter un épisode met à jour la moyenne de la série', async () => {
  const { ctx } = buildContext();
  setState(ctx, {
    currentShowId: 7, watchedEpisodesShowId: 7,
    trackedShows: [{ id: 7, title: 'Silo', manualNote: null }],
    currentShowSeasons: [{ season_number: 1, episode_count: 2 }],
    watchedEpisodeSet: new Set(['1-1', '1-2']),
    watchedEpisodeExtras: { '1-1': { note: 4, timesWatched: 1 }, '1-2': { note: null, timesWatched: 1 } },
  });
  await ctx.updateEpisodeNote(1, 2, '2');
  assert.strictEqual(ctx.showEpisodeAverage(7), 3);
  // Un épisode décoché ne compte plus.
  getState(ctx, 'watchedEpisodeSet').delete('1-2');
  ctx.syncCurrentShowEpisodeNotes();
  assert.strictEqual(ctx.showEpisodeAverage(7), 4);
});

test('commentaire : enregistré tel quel (500 caractères au plus), vide = effacé', async () => {
  const { ctx, updates } = buildContext();
  setState(ctx, { currentShowId: 7, watchedEpisodeExtras: { '1-1': { note: null, timesWatched: 1, comment: null } } });
  assert.strictEqual(await ctx.updateEpisodeComment(1, 1, '  Le meilleur épisode.  '), true);
  const call = updates[updates.length - 1];
  assert.strictEqual(call.table, 'tv_episodes_watched');
  assert.strictEqual(call.update.comment, 'Le meilleur épisode.');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(call.eq)), [['tv_show_id', 7], ['season_number', 1], ['episode_number', 1]]);
  assert.strictEqual(getState(ctx, 'watchedEpisodeExtras')['1-1'].comment, 'Le meilleur épisode.');
  await ctx.updateEpisodeComment(1, 1, 'x'.repeat(800));
  assert.strictEqual(updates[updates.length - 1].update.comment.length, 500);
  await ctx.updateEpisodeComment(1, 1, '   ');
  assert.strictEqual(updates[updates.length - 1].update.comment, null);
});

test('épisode vu : « Commenter » discret, puis le texte en une ligne avec « Modifier »', () => {
  const { ctx } = buildContext();
  setState(ctx, { watchedEpisodeExtras: { '1-1': { note: 4, timesWatched: 1, comment: null }, '1-2': { note: null, timesWatched: 1, comment: 'Quelle fin' } } });
  assert.ok(ctx.episodeExtrasHtml('1-1').includes('data-ep-comment-edit="1-1">Commenter<'));
  const withComment = ctx.episodeExtrasHtml('1-2');
  assert.ok(withComment.includes('<span>Quelle fin</span>') && withComment.includes('>Modifier<'));
  setState(ctx, { seriesEditingComment: '1-2' });
  assert.ok(ctx.episodeExtrasHtml('1-2').includes('maxlength="500"'));
});

// Retour de Flix (28/10, capture) : en vue liste, deux épisodes cochés sur 8
// et la barre de la saison restait vide, seul « 2 / 8 » changeait.
test('cocher un épisode : la barre de la saison avance avec le compteur', () => {
  const { ctx } = buildContext();
  const bar = { style: { width: '0%' } };
  const progress = { textContent: '' };
  ctx.document.querySelector = (sel) => sel === '.season-block[data-season="4"] .sx-bar b' ? bar : null;
  const getById = ctx.document.getElementById;
  ctx.document.getElementById = (id) => id === 'seasonProgress-4' ? progress : getById(id);
  setState(ctx, {
    currentShowId: 7, currentShowSeasons: [{ season_number: 4, episode_count: 8, air_date: '2026-10-23' }],
    loadedSeasonEpisodes: { 4: Array.from({ length: 8 }, (_, i) => ({ episode_number: i + 1, air_date: '2026-10-23' })) },
    watchedEpisodeSet: new Set(['4-1', '4-2']),
    trackedShows: [{ id: 7, title: 'Série', manualNote: null }],
  });
  ctx.renderEpisodesFicheValue = () => {}; ctx.renderSeriesNextBlock = () => {}; ctx.renderSeriesProgress = () => {};
  ctx.updateSeasonProgressUI(4, 8);
  assert.strictEqual(progress.textContent, '2 / 8');
  assert.strictEqual(bar.style.width, '25%');
});

module.exports = run('series-episode-average.test.js');
