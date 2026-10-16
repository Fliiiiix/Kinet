// --- Tests du badge des séries en cours (js/series.js) ---
// Audit des six écrans (S3, 16/10) : « Nouvel épisode » s'affichait dès qu'il
// restait un épisode à voir, même sur une série jamais commencée. Désormais :
// « Nouvel épisode » seulement pour un épisode sorti après ton dernier
// visionnage, « À rattraper » s'il reste des épisodes sortis à voir, rien
// sinon. Ce qui est sorti vient de TMDB (dernier épisode diffusé), gardé en
// cache par saveShowAiring().
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const ctx = createContext({
    document: stubDocument(),
    goToSeries(){}, blockIfOffline(){ return false; }, showToast(){}, escapeHtml(s){ return s; },
    supabaseClient: { from(){ throw new Error('non utilisé par ce test'); } },
  });
  loadFiles(ctx, ['js/series.js']);
  return ctx;
}

// TMDB : saisons 1 (10 épisodes) et 2 (10), dernier épisode diffusé S2E3 le 20/09.
const details = {
  last_episode_to_air: { season_number: 2, episode_number: 3, air_date: '2026-09-20' },
  seasons: [{ season_number: 0, episode_count: 4 }, { season_number: 1, episode_count: 10 }, { season_number: 2, episode_count: 10 }],
};
const show = { id: 1, tmdbId: 77, status: 'Returning Series', numberOfEpisodes: 20 };

test('saveShowAiring() : compte les épisodes sortis (hors épisodes spéciaux)', () => {
  const ctx = buildContext();
  ctx.saveShowAiring(77, details);
  assert.strictEqual(ctx.showAiring(show).aired, 13);
});

test('un épisode sorti après ton dernier visionnage : « Nouvel épisode »', () => {
  const ctx = buildContext();
  ctx.saveShowAiring(77, details);
  setState(ctx, { watchedEpisodeCounts: { 1: 12 }, lastWatchedAtByShow: { 1: new Date('2026-09-15T20:00:00').getTime() } });
  assert.strictEqual(ctx.showEpisodeBadge(show), 'new');
  assert.strictEqual(ctx.hasNewEpisode(show), true);
});

test('en retard sur des épisodes déjà sortis avant ton dernier visionnage : « À rattraper »', () => {
  const ctx = buildContext();
  ctx.saveShowAiring(77, details);
  setState(ctx, { watchedEpisodeCounts: { 1: 5 }, lastWatchedAtByShow: { 1: new Date('2026-10-01T20:00:00').getTime() } });
  assert.strictEqual(ctx.showEpisodeBadge(show), 'catchup');
  assert.strictEqual(ctx.hasNewEpisode(show), false);
});

test('jamais commencée : aucun badge', () => {
  const ctx = buildContext();
  ctx.saveShowAiring(77, details);
  setState(ctx, { watchedEpisodeCounts: {} });
  assert.strictEqual(ctx.showEpisodeBadge(show), null);
});

test('à jour sur tout ce qui est sorti (les épisodes annoncés ne comptent pas) : aucun badge', () => {
  const ctx = buildContext();
  ctx.saveShowAiring(77, details);
  setState(ctx, { watchedEpisodeCounts: { 1: 13 }, lastWatchedAtByShow: { 1: Date.now() } });
  assert.strictEqual(ctx.showEpisodeBadge(show), null);
});

test('série terminée, ou sorties pas encore connues : aucun badge', () => {
  const ctx = buildContext();
  setState(ctx, { watchedEpisodeCounts: { 1: 2, 2: 2 } });
  assert.strictEqual(ctx.showEpisodeBadge({ id: 2, tmdbId: 88, status: 'Ended', numberOfEpisodes: 10 }), null);
  assert.strictEqual(ctx.showEpisodeBadge(show), null, 'pas encore de données TMDB en cache');
});

module.exports = run('new-episode-badge.test.js');
