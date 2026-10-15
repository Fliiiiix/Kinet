// --- Tests du fil Bientôt (js/upcoming.js, piste A du 15/10) ---
// Déjà là, Cette semaine, Plus tard, En attente d'une date, Au cinéma :
// les dates lisibles (« Sam. 17 oct. », « dans 2 jours »), le classement
// d'une série à partir de sa fiche TMDB et de tes épisodes cochés, et le
// choix des films « Au cinéma ».
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

const TODAY = new Date(2026, 9, 15); // jeudi 15 octobre 2026

function buildContext(){
  const ctx = createContext({
    document: stubDocument(),
    goToUpcoming(){}, goHome(){}, observeReveal(){}, goToSeriesDetail(){}, goToFilmDetail(){}, goToWatchlist(){},
    escapeHtml(s){ return s; }, formatDateFr(iso){ return iso; },
    normalizeSearch(s){ return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); },
    getDisplayNote(f){ return f.note != null ? f.note : null; },
    FILM_PLACEHOLDER_SVG: '', TV_PLACEHOLDER_SVG: '',
  });
  loadFiles(ctx, ['js/upcoming.js']);
  setState(ctx, { films: [], watchlist: [] });
  return ctx;
}

const day = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const plain = (v) => JSON.parse(JSON.stringify(v));

test('dates à venir : « Sam. 17 oct. » cette année, « 8 juil. 2027 » ensuite', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.upcomingFutureLabel(new Date(2026, 9, 17), TODAY), 'Sam. 17 oct.');
  assert.strictEqual(ctx.upcomingFutureLabel(new Date(2027, 6, 8), TODAY), '8 juil. 2027');
  assert.strictEqual(ctx.upcomingPastLabel(new Date(2025, 2, 20), TODAY), '20 mars 2025');
});

test('délais : demain, dans 2 jours, dans 3 semaines, dans 9 mois ; il y a 5 jours, il y a 6 semaines', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.upcomingRelFuture(1), 'demain');
  assert.strictEqual(ctx.upcomingRelFuture(2), 'dans 2 jours');
  assert.strictEqual(ctx.upcomingRelFuture(20), 'dans 3 semaines');
  assert.strictEqual(ctx.upcomingRelFuture(266), 'dans 9 mois');
  assert.strictEqual(ctx.upcomingRelPast(5), 'il y a 5 jours');
  assert.strictEqual(ctx.upcomingRelPast(42), 'il y a 6 semaines');
});

const show = { id: 1, title: 'Black Clover', posterUrl: null };

test('série : épisode sorti il y a 5 jours pas coché -> Déjà là, et le suivant -> à venir', () => {
  const ctx = buildContext();
  const c = plain(ctx.classifyShow(show, {
    last_episode_to_air: { air_date: day(2026, 10, 10), season_number: 2, episode_number: 2 },
    next_episode_to_air: { air_date: day(2026, 10, 17), season_number: 2, episode_number: 3 },
    seasons: [{ season_number: 2, episode_count: 12 }],
  }, new Set(['2-1']), TODAY));
  assert.strictEqual(c.now.sub, 'Saison 2, épisode 2');
  assert.strictEqual(c.now.when, 'Sorti le 10 oct.');
  assert.strictEqual(c.now.rel, 'il y a 5 jours');
  assert.strictEqual(c.soon.sub, 'Saison 2, épisode 3');
  assert.strictEqual(c.waiting, null);
});

test('série : saison entière sortie et pas commencée -> « Saison 2 en entier », pas en attente', () => {
  const ctx = buildContext();
  const c = plain(ctx.classifyShow(show, {
    last_episode_to_air: { air_date: day(2026, 9, 3), season_number: 2, episode_number: 8 },
    next_episode_to_air: null,
    seasons: [{ season_number: 1, episode_count: 8 }, { season_number: 2, episode_count: 8 }],
  }, new Set(['1-1', '1-8']), TODAY));
  assert.strictEqual(c.now.sub, 'Saison 2 en entier, 8 épisodes');
  assert.strictEqual(c.now.when, 'Depuis le 3 sept.');
  assert.strictEqual(c.now.rel, 'saison terminée');
  assert.strictEqual(c.waiting, null);
});

test('série : dernier épisode déjà coché, pas de date -> En attente « Saison 1 finie le 29 juin »', () => {
  const ctx = buildContext();
  const c = plain(ctx.classifyShow(show, {
    last_episode_to_air: { air_date: day(2026, 6, 29), season_number: 1, episode_number: 13 },
    next_episode_to_air: null,
    seasons: [{ season_number: 1, episode_count: 13 }],
  }, new Set(['1-13']), TODAY));
  assert.strictEqual(c.now, null);
  assert.strictEqual(c.waiting.sub, 'Saison 1 finie le 29 juin');
});

test('série : épisodes cochés inconnus (hors ligne) -> jamais Déjà là', () => {
  const ctx = buildContext();
  const c = plain(ctx.classifyShow(show, {
    last_episode_to_air: { air_date: day(2026, 10, 10), season_number: 2, episode_number: 2 },
    next_episode_to_air: null,
    seasons: [{ season_number: 2, episode_count: 12 }],
  }, null, TODAY));
  assert.strictEqual(c.now, null);
  assert.strictEqual(c.waiting.sub, 'Saison 2, épisode 2 le 10 oct.');
});

test('Au cinéma : 45 jours au plus, jamais un film déjà chez toi, le film lié à un de tes coups de cœur en tête', () => {
  const ctx = buildContext();
  setState(ctx, {
    films: [{ title: 'Godzilla Minus One', originalTitle: null, note: 4.5, tmdbId: 940721 }, { title: 'Hope Floats', note: 2, tmdbId: 5 }],
    watchlist: [{ title: 'Clayface', tmdbId: 30 }],
  });
  const results = [
    { id: 10, title: 'Hope', release_date: day(2026, 10, 28), popularity: 191 },
    { id: 20, title: 'Godzilla Minus Zero', release_date: day(2026, 11, 4), popularity: 20 },
    { id: 30, title: 'Clayface', release_date: day(2026, 10, 21), popularity: 39 }, // déjà dans À voir
    { id: 40, title: 'Trop loin', release_date: day(2027, 2, 1), popularity: 500 }, // au-delà de 45 jours
    { id: 50, title: 'Déjà sorti', release_date: day(2026, 10, 1), popularity: 300 },
    { id: 10, title: 'Hope', release_date: day(2026, 10, 28), popularity: 191 }, // doublon de page
  ];
  const picked = plain(ctx.pickCinemaMovies(results, TODAY));
  assert.deepStrictEqual(picked.map(m => m.title), ['Godzilla Minus Zero', 'Hope']);
  assert.strictEqual(picked[0].why, 'Tu as mis 4.5 à Godzilla Minus One');
  assert.strictEqual(picked[1].why, null, 'Hope Floats n\'a que 2 : pas de lien');
});

test('résumé : « 4 choses à voir dès maintenant, 1 épisode cette semaine. »', () => {
  const ctx = buildContext();
  setState(ctx, { upcomingNow: [{}, {}, {}, {}], upcomingSoon: [{ type: 'episode' }] });
  assert.strictEqual(ctx.upcomingSummaryText([{ type: 'episode' }]), '<b>4 choses à voir</b> dès maintenant, 1 épisode cette semaine.');
  setState(ctx, { upcomingNow: [], upcomingSoon: [] });
  assert.strictEqual(ctx.upcomingSummaryText([]), 'Rien de prévu pour l’instant chez toi.');
});

module.exports = run('upcoming-feed.test.js');
