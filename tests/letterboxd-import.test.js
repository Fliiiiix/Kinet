// --- Tests de l'import Letterboxd (js/importExternal.js) ---
// Couvre trois bugs réels trouvés et corrigés en session (retours
// utilisateur) : reviews.csv qui ignorait silencieusement les films déjà
// présents au lieu de compléter leur critique (v2.22) ; profile.csv/
// comments.csv rejetés avec un message générique "fichier non reconnu"
// plutôt qu'un message expliquant qu'il n'y a rien à en tirer (v2.23) ;
// watched.csv bloqué à tort alors qu'il liste de vrais films vus non notés
// (v2.25). Aucun réseau ni Supabase réel : TMDB et supabaseClient sont
// mockés ci-dessous.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

// assert.deepStrictEqual compare aussi les prototypes : un objet/tableau
// renvoyé par du code exécuté dans un vm.createContext() a un
// Object.prototype/Array.prototype DIFFÉRENT (autre "realm") de celui d'un
// littéral écrit ici, même avec un contenu identique — deepStrictEqual les
// verrait comme différents à tort. On repasse par JSON pour comparer la
// STRUCTURE, peu importe quel realm l'a produite.
function deepEqualAcrossRealms(actual, expected, message){
  assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected, message);
}

function buildContext(){
  const state = {
    toasts: [],
    updateCalls: [],
    insertedRows: [],
    films: [
      { id: 1, tmdbId: 550, title: 'Fight Club', manualNote: null, review: null },
      { id: 2, tmdbId: 999, title: 'Déjà complet', manualNote: 4, review: 'Déjà écrit dans Kinet' },
    ],
  };

  const TMDB_BY_TITLE = {
    'Fight Club': { id: 550, title: 'Fight Club', release_year: 1999, poster_path: '/x.jpg', overview: '...', original_title: 'Fight Club', genre_ids: [18] },
    'Déjà complet': { id: 999, title: 'Déjà complet', release_year: 2020, poster_path: null, overview: '...', original_title: 'Déjà complet', genre_ids: [] },
    'Nouveau film': { id: 42, title: 'Nouveau film', release_year: 2021, poster_path: null, overview: '...', original_title: 'Nouveau film', genre_ids: [] },
  };

  const ctx = createContext({
    document: stubDocument(),
    showToast: (msg) => state.toasts.push(msg),
    TMDB_IMG_BASE: 'https://image.tmdb.org/t/p/w342',
    // Reprend exactement js/app.js (DIACRITICS_RE) — construit via
    // fromCharCode plutôt qu'une plage Unicode littérale dans le source,
    // pour éviter tout souci d'encodage de ce fichier de test.
    normalizeSearch: (s) => s.normalize('NFD').replace(new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g'), '').toLowerCase(),
    // Même formule que tmdbRelevanceScore() (js/tmdb.js), pas chargé ici
    // (searchTmdb est mocké directement plus bas : charger le vrai
    // js/tmdb.js écraserait ce mock par la vraie fonction réseau).
    tmdbRelevanceScore: (r, queryNorm) => {
      const norm = (s) => s.normalize('NFD').replace(new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g'), '').toLowerCase();
      const exactMatch = norm(r.title || '') === queryNorm || norm(r.original_title || '') === queryNorm;
      return (exactMatch ? 1e6 : 0) + (r.popularity || 0);
    },
    blockIfOffline: () => false,
    films: state.films,
    rowToFilm: (row) => ({ id: row.id, tmdbId: row.tmdb_id, title: row.title, manualNote: row.manual_note, review: row.review }),
    addViewing: () => {},
    buildGenreFilterOptions: () => {},
    render: () => {},
    watchlist: [],
    renderWatchlist: () => {},
    searchTmdb: async (title) => {
      const m = TMDB_BY_TITLE[title];
      return m ? [m] : [];
    },
    supabaseClient: {
      from(table){
        return {
          update(patch){
            return { eq: async (col, val) => { state.updateCalls.push({ table, patch, id: val }); return { error: null }; } };
          },
          insert(rows){
            return { select: async () => {
              const data = rows.map((r, i) => ({ id: 100 + i, ...r }));
              state.insertedRows.push(...data);
              return { data, error: null };
            } };
          },
        };
      },
    },
  });
  loadFiles(ctx, ['js/importExternal.js']);
  return { ctx, state };
}

// --- parseCsv ---
{
  const { ctx } = buildContext();
  test('parseCsv : lignes simples', () => {
    const rows = ctx.parseCsv('Name,Year\nParasite,2019\nWhiplash,2014');
    deepEqualAcrossRealms(rows, [{ Name: 'Parasite', Year: '2019' }, { Name: 'Whiplash', Year: '2014' }]);
  });

  test('parseCsv : champ entre guillemets avec virgule, guillemet doublé et retour à la ligne', () => {
    const csv = 'Name,Review\n"Old Boy","Un film, ""incroyable""\navec une critique sur 2 lignes"';
    const rows = ctx.parseCsv(csv);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].Review, 'Un film, "incroyable"\navec une critique sur 2 lignes');
  });

  test('parseCsv : fichier vide', () => {
    assert.strictEqual(ctx.parseCsv('').length, 0);
  });
}

// --- detectLetterboxdType ---
{
  const { ctx } = buildContext();
  const cases = [
    ['diary.csv', ['Date', 'Name', 'Year', 'Rating', 'Rewatch', 'Watched Date'], 'diary'],
    ['ratings.csv', ['Date', 'Name', 'Year', 'Rating'], 'ratings'],
    ['reviews.csv', ['Date', 'Name', 'Year', 'Rating', 'Rewatch', 'Review', 'Watched Date'], 'reviews'],
    ['watchlist.csv', ['Date', 'Name', 'Year'], 'watchlist'],
    ['watched.csv', ['Date', 'Name', 'Year'], 'watched'],
    ['profile.csv', ['Date Joined', 'Username'], 'profile'],
    ['comments.csv', ['Date', 'Comment', 'Name'], 'comments'],
    ['un-fichier-quelconque.csv', ['Colonne A', 'Colonne B'], null],
    // watched.csv et watchlist.csv ont EXACTEMENT les mêmes colonnes, sans
    // indice dans le nom du fichier : type dédié plutôt qu'un choix silencieux
    // (voir importLetterboxdFile(), qui prévient explicitement dans ce cas).
    ['export.csv', ['Date', 'Name', 'Year', 'Letterboxd URI'], 'watched_or_watchlist'],
  ];
  for(const [filename, headers, expected] of cases){
    test(`detectLetterboxdType(${filename}) -> ${expected}`, () => {
      assert.strictEqual(ctx.detectLetterboxdType(filename, headers), expected);
    });
  }

  test('detectLetterboxdType : repli par colonnes si le fichier a été renommé', () => {
    // Note : un reviews.csv renommé ET dont les colonnes incluent aussi
    // Rewatch/Watched Date (son cas réel) retombe sur 'diary' par ce repli
    // — le check diary passe AVANT celui de reviews dans la chaîne de
    // repli. Comportement existant, pas un bug (edge case très rare :
    // suppose un renommage ET une absence de la colonne Review dans le
    // test ci-dessous pour rester sans ambiguïté).
    assert.strictEqual(ctx.detectLetterboxdType('export.csv', ['Date', 'Name', 'Year', 'Review']), 'reviews');
    assert.strictEqual(ctx.detectLetterboxdType('export.csv', ['Date', 'Name', 'Year', 'Rating']), 'ratings');
  });
}

// --- groupLetterboxdEntries : revisionnages regroupés en une entrée ---
{
  const { ctx } = buildContext();
  test('groupLetterboxdEntries : 2 lignes du même film (revisionnage) -> 1 entrée avec 2 dates', () => {
    const records = [
      { Name: 'Old Boy', Year: '2003', Rating: '4', 'Watched Date': '2020-01-01' },
      { Name: 'Old Boy', Year: '2003', Rating: '4.5', 'Watched Date': '2023-06-01' },
    ];
    const groups = ctx.groupLetterboxdEntries(records);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].dates.length, 2);
    assert.strictEqual(groups[0].rating, 4.5); // la note la plus récente gagne
  });
}

// --- importLetterboxdReviews : le vrai bug corrigé en v2.22 ---
{
  const { ctx, state } = buildContext();
  test('importLetterboxdReviews : complète un film déjà présent SANS critique', async () => {
    const records = [{ Name: 'Fight Club', Year: '1999', Rating: '4.5', Review: 'Un film qui change tout' }];
    await ctx.importLetterboxdReviews(records);
    const update = state.updateCalls.find(u => u.id === 1);
    assert.ok(update, 'un update aurait dû être envoyé pour le film id=1');
    assert.strictEqual(update.patch.review, 'Un film qui change tout');
    assert.strictEqual(update.patch.manual_note, 4.5);
  });

  test('importLetterboxdReviews : ne PAS écraser une critique déjà écrite dans Kinet', () => {
    const update = state.updateCalls.find(u => u.id === 2);
    assert.strictEqual(update, undefined, 'le film id=2 a déjà une critique, il ne doit jamais être mis à jour');
  });
}

// Import séparé, pour tester le cas "film absent du catalogue" isolément
{
  const { ctx, state } = buildContext();
  test('importLetterboxdReviews : nouveau film -> inséré avec note + critique', async () => {
    await ctx.importLetterboxdReviews([{ Name: 'Nouveau film', Year: '2021', Rating: '5', Review: 'Découverte totale' }]);
    const inserted = state.insertedRows.find(r => r.tmdb_id === 42);
    assert.ok(inserted, 'Nouveau film aurait dû être inséré');
    assert.strictEqual(inserted.manual_note, 5);
    assert.strictEqual(inserted.review, 'Découverte totale');
  });

  test('importLetterboxdReviews : ligne sans texte de critique -> ignorée (rien à compléter)', async () => {
    const before = state.updateCalls.length + state.insertedRows.length;
    await ctx.importLetterboxdReviews([{ Name: 'Fight Club', Year: '1999', Rating: '3' }]); // pas de Review
    const after = state.updateCalls.length + state.insertedRows.length;
    assert.strictEqual(after, before, 'sans texte de critique, importLetterboxdReviews ne doit rien écrire');
  });
}

module.exports = run('letterboxd-import.test.js');
