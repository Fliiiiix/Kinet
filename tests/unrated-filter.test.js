// --- Tests du filtre "Sans note" (rattrapage des films vus non notés) ---
// Retour utilisateur : une vue dédiée pour retrouver facilement les films
// marqués vus mais jamais notés (notamment ceux importés via watched.csv
// de Letterboxd, qui n'a justement aucune note à donner). Partage le
// <select> de filtre genre existant plutôt qu'un nouvel élément d'UI —
// UNRATED_FILTER_VALUE (js/app.js) est une valeur sentinelle qui n'entre
// jamais en collision avec un vrai id de genre TMDB (toujours un entier).
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const genreFilterEl = stubElement({ value: '' });
  const ctx = createContext({
    document: stubDocument({ genreFilter: genreFilterEl }),
    escapeHtml(s){ return s; },
    // getDisplayNote() est une VRAIE fonction déclarée dans app.js lui-même
    // (pas un helper d'un autre fichier à stubber) — un override ici serait
    // de toute façon masqué par sa propre déclaration `function` une fois
    // le fichier chargé (piège vm documenté dans tests/README.md). Utiliser
    // la vraie implémentation à la place : elle retombe sur computeNote(crit),
    // d'où le `crit: {}` sur chaque film de test ci-dessous (un objet crit
    // vide, jamais undefined — cohérent avec un vrai film importé sans note).
    GENRE_MAP: { 18: 'Drame', 35: 'Comédie' },
    CRITERIA: [
      { key: 'scenario', label: 'Scénario' },
      { key: 'ressenti', label: 'Ressenti global' },
    ],
  });
  loadFiles(ctx, ['js/app.js']);
  return { ctx, genreFilterEl };
}

test('buildGenreFilterOptions() : ajoute "Sans note (N)" uniquement s\'il y a des films sans note', () => {
  const { ctx, genreFilterEl } = buildContext();
  setState(ctx, {
    films: [
      { id: 1, title: 'A', manualNote: 4, genreIds: [18], crit: {} },
      { id: 2, title: 'B', manualNote: null, genreIds: [], crit: {} }, // sans note
      { id: 3, title: 'C', manualNote: null, genreIds: [], crit: {} }, // sans note
    ],
  });
  ctx.buildGenreFilterOptions();
  assert.ok(genreFilterEl.innerHTML.includes('Sans note (2)'), 'doit afficher le bon décompte (2 films sans note)');
});

test('buildGenreFilterOptions() : n\'ajoute rien si tous les films sont notés', () => {
  const { ctx, genreFilterEl } = buildContext();
  setState(ctx, {
    films: [
      { id: 1, title: 'A', manualNote: 4, genreIds: [18], crit: {} },
      { id: 2, title: 'B', manualNote: 3, genreIds: [35], crit: {} },
    ],
  });
  ctx.buildGenreFilterOptions();
  assert.ok(!genreFilterEl.innerHTML.includes('Sans note'), 'aucun film sans note -> pas d\'option qui ne mènerait nulle part');
});

test('buildGenreFilterOptions() : préserve la sélection "Sans note" après une reconstruction (ex. ajout d\'un film)', () => {
  const { ctx, genreFilterEl } = buildContext();
  setState(ctx, {
    films: [
      { id: 1, title: 'A', manualNote: null, genreIds: [], crit: {} },
    ],
  });
  ctx.buildGenreFilterOptions();
  genreFilterEl.value = ctx.UNRATED_FILTER_VALUE;
  // Reconstruction (ex. buildGenreFilterOptions() rappelée après l'ajout
  // d'un film noté, comme le fait handleSave()/handleQuickRate()) — la
  // sélection ne doit pas silencieusement retomber sur "Tous les genres".
  setState(ctx, {
    films: [
      { id: 1, title: 'A', manualNote: null, genreIds: [], crit: {} },
      { id: 2, title: 'B', manualNote: 5, genreIds: [18], crit: {} },
    ],
  });
  ctx.buildGenreFilterOptions();
  assert.strictEqual(genreFilterEl.value, ctx.UNRATED_FILTER_VALUE, 'la sélection "Sans note" doit survivre à la reconstruction des options');
});

module.exports = run('unrated-filter.test.js');
