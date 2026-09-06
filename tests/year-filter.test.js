// --- Tests du filtre catalogue par année/décennie (js/app.js) ---
// Retour utilisateur : "Filtre catalogue par année/décennie" — même
// principe que le filtre genre déjà existant (buildGenreFilterOptions()) :
// seules les années RÉELLEMENT présentes au catalogue, groupées par
// décennie pour rester lisible. buildYearFilterOptions() est appelée
// DEPUIS buildGenreFilterOptions() (jamais dupliquée aux ~9 sites d'appel
// existants) — donc appeler buildGenreFilterOptions() suffit à couvrir
// les deux dans ces tests aussi.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const genreFilterEl = stubElement({ value: '' });
  const yearFilterEl = stubElement({ value: '' });
  const ctx = createContext({
    document: stubDocument({ genreFilter: genreFilterEl, yearFilter: yearFilterEl }),
    escapeHtml(s){ return s; },
    GENRE_MAP: { 18: 'Drame' },
    CRITERIA: [{ key: 'scenario', label: 'Scénario' }],
  });
  loadFiles(ctx, ['js/app.js']);
  return { ctx, genreFilterEl, yearFilterEl };
}

test('buildYearFilterOptions() : une option par année réellement présente, groupées par décennie', () => {
  const { ctx, yearFilterEl } = buildContext();
  setState(ctx, {
    films: [
      { id: 1, title: 'A', manualNote: 4, genreIds: [], crit: {}, releaseYear: 2023 },
      { id: 2, title: 'B', manualNote: 3, genreIds: [], crit: {}, releaseYear: 1998 },
      { id: 3, title: 'C', manualNote: 5, genreIds: [], crit: {}, releaseYear: 2023 }, // doublon d'année -> une seule option
    ],
  });
  ctx.buildGenreFilterOptions();
  assert.ok(yearFilterEl.innerHTML.includes('<optgroup label="2020s">'));
  assert.ok(yearFilterEl.innerHTML.includes('<optgroup label="1990s">'));
  assert.strictEqual((yearFilterEl.innerHTML.match(/<option value="2023">/g) || []).length, 1, 'une seule option malgré 2 films de la même année');
  assert.ok(yearFilterEl.innerHTML.includes('<option value="1998">'));
});

test('buildYearFilterOptions() : ignore les films sans année connue, pas d\'option vide', () => {
  const { ctx, yearFilterEl } = buildContext();
  setState(ctx, {
    films: [{ id: 1, title: 'A', manualNote: 4, genreIds: [], crit: {}, releaseYear: null }],
  });
  ctx.buildGenreFilterOptions();
  assert.strictEqual(yearFilterEl.innerHTML, `<option value="">Toutes les années</option>`);
});

test('buildYearFilterOptions() : préserve la sélection après une reconstruction (ex. ajout d\'un film)', () => {
  const { ctx, yearFilterEl } = buildContext();
  setState(ctx, {
    films: [{ id: 1, title: 'A', manualNote: 4, genreIds: [], crit: {}, releaseYear: 2010 }],
  });
  ctx.buildGenreFilterOptions();
  yearFilterEl.value = '2010';
  setState(ctx, {
    films: [
      { id: 1, title: 'A', manualNote: 4, genreIds: [], crit: {}, releaseYear: 2010 },
      { id: 2, title: 'B', manualNote: 5, genreIds: [], crit: {}, releaseYear: 2021 },
    ],
  });
  ctx.buildGenreFilterOptions();
  assert.strictEqual(yearFilterEl.value, '2010', 'la sélection doit survivre à la reconstruction des options');
});

module.exports = run('year-filter.test.js');
