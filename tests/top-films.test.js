// --- Tests du Top films (js/top.js, piste A du 15/10) ---
// Un film entre au classement à partir de 2 notes et y est trié par sa vraie
// moyenne : jamais un 5.0 derrière un 4.5. Les films à une seule note sont à
// part. Chaque ligne dit où tu en es : ta note, « Dans À voir », « + À voir ».
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(board){
  const elements = board ? { topBoard: board, topHow: stubElement() } : {};
  const ctx = createContext({
    document: stubDocument(elements),
    goToTop(){}, goHome(){}, goToFilmDetail(){}, closeProfileModal(){}, makeRowClickable(){},
    escapeHtml(s){ return String(s); },
    noteColorClass(n){ return n >= 4 ? 'rate-high' : n >= 2.5 ? 'rate-mid' : 'rate-low'; },
    getDisplayNote(f){ return f.manualNote != null ? f.manualNote : null; },
    skeletonRows(){ return ''; },
    FILM_PLACEHOLDER_SVG: '<svg></svg>',
  });
  loadFiles(ctx, ['js/top.js']);
  setState(ctx, { films: [], watchlist: [] });
  return ctx;
}

const film = (title, avg, count, tmdbId) => ({ tmdbId: tmdbId || title.length, title, posterUrl: null, year: 2000, avg, count });
const plain = (v) => JSON.parse(JSON.stringify(v));

test('classement : à partir de 2 notes, par moyenne ; les films à une note sont à part', () => {
  const ctx = buildContext();
  const { ranked, solo } = ctx.splitTopFilms([
    film('Paprika', 5, 1), film('Kill Bill', 4.5, 3), film('No Country', 5, 2),
    film('Dune', 4.75, 2), film('Shining', 4.5, 2), film('Godzilla', 4.5, 1),
  ]);
  assert.deepStrictEqual(plain(ranked.map(f => f.title)), ['No Country', 'Dune', 'Kill Bill', 'Shining']);
  assert.deepStrictEqual(plain(solo.map(f => f.title)), ['Paprika', 'Godzilla']);
});

test('jamais un 5.0 derrière un 4.5 dans le classement', () => {
  const ctx = buildContext();
  const { ranked } = ctx.splitTopFilms([film('A', 4.5, 9), film('B', 5, 2), film('C', 4.75, 4)]);
  for(let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].avg >= ranked[i].avg);
  assert.strictEqual(ranked[0].title, 'B');
});

test('à moyenne égale, le film le plus noté passe devant', () => {
  const ctx = buildContext();
  const { ranked } = ctx.splitTopFilms([film('Deux', 4.5, 2), film('Trois', 4.5, 3)]);
  assert.deepStrictEqual(plain(ranked.map(f => f.title)), ['Trois', 'Deux']);
});

test('moyennes lisibles : 5.0, 4.75, 4.5', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.formatTopAvg(5), '5.0');
  assert.strictEqual(ctx.formatTopAvg(4.75), '4.75');
  assert.strictEqual(ctx.formatTopAvg(4.5), '4.5');
  assert.strictEqual(ctx.formatTopAvg(3.67), '3.67');
});

test('toi : ta note si tu l\'as vu, « Dans À voir » s\'il y est, sinon « + À voir »', () => {
  const ctx = buildContext();
  setState(ctx, { films: [{ tmdbId: 1, manualNote: 4.5 }], watchlist: [{ tmdbId: 2 }] });
  assert.ok(ctx.topMineHtml({ tmdbId: 1 }).includes('Toi <b class="rate-high">4.5</b>'));
  assert.ok(ctx.topMineHtml({ tmdbId: 2 }).includes('Dans À voir'));
  assert.ok(ctx.topMineHtml({ tmdbId: 3 }).includes('data-top-add="3"'));
});

test('page : podium des trois premiers, suite numérotée à partir de 4, puis les films à une note', () => {
  const board = stubElement();
  const ctx = buildContext(board);
  setState(ctx, { topFilms: [
    film('Un', 5, 2, 1), film('Deux', 4.75, 2, 2), film('Trois', 4.7, 3, 3), film('Quatre', 4.5, 2, 4), film('Solo', 5, 1, 5),
  ] });
  ctx.renderTopFilms();
  const html = board.innerHTML;
  assert.strictEqual((html.match(/class="top-pod[ "]/g) || []).length, 3);
  assert.ok(html.includes('top-pod is-first'));
  assert.ok(html.includes('<span class="top-line-rank">4</span>'));
  assert.ok(html.indexOf('Une seule note pour l’instant') > html.indexOf('Quatre'));
  assert.ok(html.includes('<span class="top-line-rank"></span>'), 'pas de rang pour les films à une note');
});

test('page : sans film à 2 notes, le dire et montrer quand même les films à une note', () => {
  const board = stubElement();
  const ctx = buildContext(board);
  setState(ctx, { topFilms: [film('Solo', 5, 1, 5)] });
  ctx.renderTopFilms();
  assert.ok(board.innerHTML.includes('Aucun film n’a encore été noté par deux personnes'));
  assert.ok(board.innerHTML.includes('Solo'));
  assert.ok(!board.innerHTML.includes('top-podium'));
});

module.exports = run('top-films.test.js');
