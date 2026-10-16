// --- Tests des bugs du lot 2 de l'audit général (16/10) ---
// B2 : « Films notés » comptait aussi les films sans note (imports « vus »).
// B4 : la recherche de la notation laissait noter une seconde fois un film
// déjà au catalogue, ce qui créait un doublon.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

test('computeStats() : rated ne compte que les films notés, total tout le catalogue', () => {
  const ctx = createContext({
    document: stubDocument(),
    escapeHtml(s){ return String(s); },
    getDisplayNote(f){ return f.manualNote != null ? f.manualNote : null; },
    GENRE_MAP: {}, CRITERIA: [{ key: 'scenario', label: 'Scénario' }],
    openOverlay(){}, closeOverlay(){}, showToast(){},
  });
  loadFiles(ctx, ['js/recap.js', 'js/stats.js']);
  const s = ctx.computeStats([
    { id: 1, manualNote: 4, added: 1, genreIds: [] },
    { id: 2, manualNote: null, added: 2, genreIds: [] },
    { id: 3, manualNote: 2.5, added: 3, genreIds: [] },
  ]);
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.rated, 2);
});

function tmdbContext(){
  const wrap = stubElement();
  const created = [];
  const opened = [];
  const selected = [];
  const doc = stubDocument({ tmdbResults: wrap });
  doc.createElement = () => {
    const listeners = {};
    const el = stubElement({ addEventListener(type, fn){ listeners[type] = fn; } });
    el.fire = (type) => listeners[type]({ preventDefault(){} });
    created.push(el);
    return el;
  };
  const ctx = createContext({
    document: doc,
    escapeHtml(s){ return String(s); },
    getDisplayNote(f){ return f.manualNote != null ? f.manualNote : null; },
    FILM_PLACEHOLDER_SVG: '', TMDB_IMG_BASE: 'https://img/',
  });
  loadFiles(ctx, ['js/tmdb.js']);
  ctx.openModal = (id) => opened.push(id);
  ctx.selectTmdbResult = (r) => selected.push(r.id);
  setState(ctx, { films: [{ id: 7, tmdbId: 329865, title: 'Premier Contact', manualNote: 4.5 }], editingId: null });
  return { ctx, created, opened, selected };
}

test('notation : un film déjà noté est signalé et ouvre sa note au lieu d’un doublon', () => {
  const { ctx, created, opened, selected } = tmdbContext();
  ctx.renderTmdbResults([
    { id: 329865, title: 'Premier Contact', release_date: '2016-11-10', poster_path: null },
    { id: 157336, title: 'Interstellar', release_date: '2014-11-05', poster_path: null },
  ]);
  assert.ok(created[0].innerHTML.includes('déjà noté 4.5'), created[0].innerHTML);
  assert.ok(created[0].innerHTML.includes('Ouvrir'));
  assert.ok(!created[1].innerHTML.includes('déjà noté'));
  created[0].fire('mousedown');
  created[1].fire('mousedown');
  assert.strictEqual(JSON.stringify(opened), '[7]');
  assert.strictEqual(JSON.stringify(selected), '[157336]');
});

test('notation : le film qu’on modifie lui-même n’est pas signalé comme doublon', () => {
  const { ctx, created } = tmdbContext();
  setState(ctx, { editingId: 7 });
  ctx.renderTmdbResults([{ id: 329865, title: 'Premier Contact', release_date: '2016-11-10', poster_path: null }]);
  assert.ok(!created[0].innerHTML.includes('déjà noté'));
});

module.exports = run('audit-general-bugs.test.js');
