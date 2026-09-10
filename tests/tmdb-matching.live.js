// --- Revérification ponctuelle contre la VRAIE API TMDB ---
// PAS exécuté par run-all.js (nécessite le réseau + js/tmdbConfig.js, un
// fichier non versionné avec une clé personnelle — voir README.md) : à
// lancer à la main de temps en temps, ou si on soupçonne un nouveau
// mismatch d'import. tmdb-matching.test.js (hors-ligne, fixtures figées)
// reste le test de non-régression exécuté normalement.
const fs = require('fs');
const path = require('path');
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

const configPath = path.join(__dirname, '..', 'js', 'tmdbConfig.js');
if(!fs.existsSync(configPath)){
  console.log('js/tmdbConfig.js introuvable (clé TMDB non configurée dans cet environnement) — test live sauté.');
  process.exit(0);
}
const TMDB_API_KEY = fs.readFileSync(configPath, 'utf8').match(/TMDB_API_KEY = '([^']+)'/)[1];

const ctx = createContext({
  document: stubDocument(),
  normalizeSearch: (s) => s.normalize('NFD').replace(new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g'), '').toLowerCase(),
  TMDB_API_KEY,
  fetch, // fetch global (Node 18+)
  showToast: () => {}, TMDB_IMG_BASE: '', blockIfOffline: () => false,
  films: [], rowToFilm: (r) => r, addViewing: () => {}, buildGenreFilterOptions: () => {},
  render: () => {}, watchlist: [], renderWatchlist: () => {}, supabaseClient: {},
});
loadFiles(ctx, ['js/tmdb.js', 'js/importExternal.js']);

test('The Handmaiden (2016) -> Mademoiselle, en direct contre l\'API TMDB', async () => {
  const m = await ctx.matchLetterboxdToTmdb('The Handmaiden', 2016);
  assert.ok(m, 'aucun résultat renvoyé par TMDB');
  assert.strictEqual(m.title, 'Mademoiselle', `reçu "${m.title}" (id=${m.id}) au lieu de Mademoiselle`);
});

for(const [title, year] of [['Fight Club', 1999], ['Parasite', 2019], ['Whiplash', 2014]]){
  test(`${title} (${year}) : toujours correctement matché`, async () => {
    const m = await ctx.matchLetterboxdToTmdb(title, year);
    assert.ok(m, `aucun résultat pour ${title}`);
    assert.strictEqual(m.release_year, year);
  });
}

// Bug réel constaté (retour utilisateur, "encore un problème avec City of
// God") : "City of God" (le titre anglais, tel qu'exporté par Letterboxd)
// ne correspond LITTÉRALEMENT ni au titre FR ("La Cité de Dieu") ni au
// titre original ("Cidade de Deus") renvoyés par TMDB. Le classement
// "pertinence texte" brut de TMDB reléguait le vrai film derrière une
// poignée de résultats obscurs dont le titre contient littéralement "city
// of god". Vérifié ici à deux niveaux : la désambiguïsation d'import
// (matchLetterboxdToTmdb, toujours protégée par le filtre année) ET
// l'affichage brut des résultats de recherche (searchTmdb, PAS filtré par
// année : c'était le chemin réellement cassé, voir tmdbRelevanceScore()
// dans js/tmdb.js).
test('City of God (2002) -> La Cité de Dieu, via l\'import (avec année)', async () => {
  const m = await ctx.matchLetterboxdToTmdb('City of God', 2002);
  assert.ok(m, 'aucun résultat pour City of God');
  assert.strictEqual(m.id, 598, `reçu "${m.title}" (id=${m.id}) au lieu de La Cité de Dieu`);
});
test('City of God : présent dans les 6 premiers résultats affichés (recherche manuelle, sans année)', async () => {
  const results = await ctx.searchTmdb('City of God');
  const found = results.find(r => r.id === 598);
  assert.ok(found, `La Cité de Dieu (id=598) absente des ${results.length} résultats affichés : ${results.map(r => r.title).join(', ')}`);
});

run('tmdb-matching.live.js').then(ok => { if(!ok) process.exitCode = 1; });
