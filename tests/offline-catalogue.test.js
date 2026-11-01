// --- Tests de la recherche sans réseau (js/offlinePrep.js) ---
// Dans l'avion, TMDB ne répond plus : la recherche se fait dans le catalogue
// gardé sur l'appareil, et rend la même forme que searchTmdbGeneric().
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

const ROWS = [
  [155, 'The Dark Knight : Le Chevalier noir', 'The Dark Knight', 2008, 'a.jpg', [28], 2570],
  [4977, 'Paprika', 'パプリカ', 2006, 'b.jpg', [16, 878], 9],
  [329865, 'Premier Contact', 'Arrival', 2016, 'c.jpg', [18], 23],
  [11, 'Paprika mon amour', 0, 1991, 0, [], 400],
  [12, 'Les Enchantés', 0, 0, 0, [], 1],
];

function buildContext(){
  const ctx = createContext({
    document: stubDocument(),
    normalizeSearch: (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(),
  });
  loadFiles(ctx, ['js/tmdb.js', 'js/offlinePrep.js']);
  const entries = ROWS.map(row => ({ row, key: `${ctx.normalizeSearch(row[1])} ${ctx.normalizeSearch(row[2] || '')}` }));
  return { ctx, search: (q) => JSON.parse(JSON.stringify(ctx.searchCatalogueEntries(entries, q))) };
}

test('searchCatalogueEntries() : même forme que la recherche TMDB, année et affiche comprises', () => {
  const { search } = buildContext();
  const [r] = search('premier contact');
  assert.strictEqual(r.id, 329865);
  assert.strictEqual(r.original_title, 'Arrival');
  assert.strictEqual(r.release_year, 2016);
  assert.strictEqual(r.release_date.slice(0, 4), '2016', 'les pages lisent l\'année dans cette date');
  assert.strictEqual(r.poster_path, '/c.jpg');
  assert.deepStrictEqual(r.genre_ids, [18]);
});

test('searchCatalogueEntries() : titre français ou original, accents et casse ignorés', () => {
  const { search } = buildContext();
  assert.strictEqual(search('ARRIVAL')[0].id, 329865);
  assert.strictEqual(search('les enchantes')[0].id, 12);
});

test('searchCatalogueEntries() : mots dans n\'importe quel ordre', () => {
  const { search } = buildContext();
  assert.strictEqual(search('chevalier dark')[0].id, 155);
});

test('searchCatalogueEntries() : le titre exact passe avant un titre plus connu', () => {
  const { search } = buildContext();
  assert.deepStrictEqual(search('paprika').map(r => r.id), [4977, 11]);
});

test('searchCatalogueEntries() : rien de trouvé, ou recherche vide', () => {
  const { search } = buildContext();
  assert.deepStrictEqual(search('zzzz'), []);
  assert.deepStrictEqual(search('   '), []);
});

test('catalogueRowToResult() : sans année ni affiche, des champs vides plutôt que des zéros', () => {
  const { ctx } = buildContext();
  const r = ctx.catalogueRowToResult(ROWS[4]);
  assert.strictEqual(r.release_date, null);
  assert.strictEqual(r.release_year, null);
  assert.strictEqual(r.poster_path, null);
  assert.strictEqual(r.original_title, null);
});

module.exports = run();
