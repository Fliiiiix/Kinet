// --- Tests du Journal dans le catalogue (js/journal.js, draft Profil du 15/10) ---
// Troisième vue des films : visionnages par mois, ta note, « revu » sur un
// revisionnage, et la recherche du catalogue qui filtre.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument, stubElement, fakeLocalStorage } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(query){
  const els = { filmJournal: stubElement(), countLine: stubElement(), search: stubElement({ value: query || '' }) };
  const ctx = createContext({
    document: stubDocument(els),
    localStorage: fakeLocalStorage(),
    escapeHtml(s){ return String(s); },
    normalizeSearch(s){ return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); },
    noteColorClass(n){ return n >= 4 ? 'rate-high' : n >= 2.5 ? 'rate-mid' : 'rate-low'; },
    getDisplayNote(f){ return f.manualNote != null ? f.manualNote : null; },
    makeRowClickable(){}, getViewMode(){ return 'grid'; }, setViewMode(){}, render(){},
    FILM_PLACEHOLDER_SVG: '', uiIcon(){ return ''; },
  });
  loadFiles(ctx, ['js/journal.js']);
  const films = [
    { id: 1, title: 'Godzilla Minus One', manualNote: 4.5, posterUrl: 'g.jpg' },
    { id: 2, title: 'La La Land', manualNote: 4, posterUrl: 'l.jpg' },
  ];
  const viewings = [
    { id: 10, filmId: 2, watchedAt: new Date(2026, 8, 1).getTime() },
    { id: 11, filmId: 1, watchedAt: new Date(2026, 9, 12).getTime() },
    { id: 12, filmId: 2, watchedAt: new Date(2026, 8, 19).getTime() },
  ];
  setState(ctx, { films, viewings });
  return { ctx, els };
}

test('par mois, du plus récent au plus ancien, avec le nombre de films', () => {
  const { ctx, els } = buildContext();
  ctx.renderFilmsJournal();
  const html = els.filmJournal.innerHTML;
  assert.ok(html.indexOf('Octobre 2026') < html.indexOf('Septembre 2026'));
  assert.ok(html.includes('Septembre 2026 <span>· 2 films</span>'));
  assert.strictEqual(els.countLine.textContent, '3 visionnages');
});

test('le deuxième visionnage d\'un film est marqué « revu », avec ta note', () => {
  const { ctx, els } = buildContext();
  ctx.renderFilmsJournal();
  const html = els.filmJournal.innerHTML;
  assert.strictEqual((html.match(/fj-again/g) || []).length, 1);
  assert.ok(html.includes('rate-high">4.5'));
});

test('la recherche du catalogue filtre le Journal', () => {
  const { ctx, els } = buildContext('godzilla');
  ctx.renderFilmsJournal();
  assert.ok(els.filmJournal.innerHTML.includes('Godzilla Minus One'));
  assert.ok(!els.filmJournal.innerHTML.includes('La La Land'));
  assert.strictEqual(els.countLine.textContent, '1 sur 3');
});

test('la vue Journal est retenue sur l\'appareil', () => {
  const { ctx } = buildContext();
  assert.strictEqual(ctx.isFilmsJournal(), false);
  ctx.setFilmsJournal(true);
  assert.strictEqual(ctx.isFilmsJournal(), true);
});

module.exports = run('films-journal.test.js');
