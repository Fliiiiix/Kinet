// --- Tests du matching TMDB pour l'import Letterboxd (js/importExternal.js,
// bestTmdbCandidate/matchLetterboxdToTmdb) ---
// Bug réel corrigé en v2.24 (retour utilisateur : "The Handmaiden importé
// sous le mauvais film"). Rejoué ici hors-ligne avec les VRAIES données
// capturées en interrogeant l'API TMDB pendant la session (tests/fixtures/
// tmdb-search-results.json) — aucun réseau ni clé API requis pour ce
// fichier. Un test séparé (tests/tmdb-matching.live.js, PAS exécuté par
// run-all.js) revérifie ponctuellement contre l'API réelle.
const path = require('path');
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

const FIXTURES = require('./fixtures/tmdb-search-results.json');

// Même formule que tmdbRelevanceScore() (js/tmdb.js), pas chargé ici (ce
// fichier mocke searchTmdb directement, voir plus bas : charger le vrai
// js/tmdb.js écraserait ce mock par la vraie fonction réseau).
function normalizeSearch(s){
  return s.normalize('NFD').replace(new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g'), '').toLowerCase();
}
function tmdbRelevanceScore(r, queryNorm){
  const exactMatch = normalizeSearch(r.title || '') === queryNorm || normalizeSearch(r.original_title || '') === queryNorm;
  return (exactMatch ? 1e6 : 0) + (r.popularity || 0);
}

function buildContext(searchResultsByTitle){
  const ctx = createContext({
    document: stubDocument(),
    normalizeSearch,
    tmdbRelevanceScore,
    searchTmdb: async (title) => searchResultsByTitle[title] || [],
    // Non utilisés par bestTmdbCandidate/matchLetterboxdToTmdb mais lus au
    // chargement du fichier par d'autres fonctions qu'on n'appelle pas ici.
    showToast: () => {}, TMDB_IMG_BASE: '', blockIfOffline: () => false,
    films: [], rowToFilm: (r) => r, addViewing: () => {}, buildGenreFilterOptions: () => {},
    render: () => {}, watchlist: [], renderWatchlist: () => {}, supabaseClient: {},
  });
  loadFiles(ctx, ['js/importExternal.js']);
  return ctx;
}

{
  const ctx = buildContext(FIXTURES);

  test('bestTmdbCandidate : "The Handmaiden" doit matcher Mademoiselle, pas le making-of homonyme', () => {
    const best = ctx.bestTmdbCandidate(FIXTURES['The Handmaiden'], 'The Handmaiden');
    assert.strictEqual(best.id, 290098, `attendu Mademoiselle (290098), reçu "${best.title}" (${best.id})`);
  });

  test('matchLetterboxdToTmdb("The Handmaiden", 2016) : même résultat via le chemin complet (filtre année + départage)', async () => {
    const m = await ctx.matchLetterboxdToTmdb('The Handmaiden', 2016);
    assert.strictEqual(m.id, 290098);
  });

  test('matchLetterboxdToTmdb : cas simple sans ambiguïté (Fight Club)', async () => {
    const m = await ctx.matchLetterboxdToTmdb('Fight Club', 1999);
    assert.strictEqual(m.id, 550);
  });

  test('matchLetterboxdToTmdb : titre introuvable sur TMDB -> null', async () => {
    const m = await ctx.matchLetterboxdToTmdb('Un Film Qui N\'existe Pas Xyz', 2020);
    assert.strictEqual(m, null);
  });

  test('matchLetterboxdToTmdb : ±1 an toléré (année Letterboxd US vs sortie France TMDB)', async () => {
    const m = await ctx.matchLetterboxdToTmdb('Parasite', 2020); // TMDB dit 2019
    assert.strictEqual(m.id, 496243);
  });
}

// --- Bonus "titre exactement identique" en isolation ---
// Synthétique plutôt que sur The Handmaiden : là-bas AUCUN des deux
// candidats ne correspond littéralement à la recherche (Mademoiselle est un
// titre traduit) — la popularité seule seule les départage. Ce cas-ci
// vérifie le second signal (correspondance exacte de titre) indépendamment,
// avec un candidat exact MOINS populaire qui doit quand même gagner.
{
  const synthetic = {
    'Cars': [
      { id: 1, title: 'Cars Land : Behind the Scenes', original_title: 'Cars Land : Behind the Scenes', release_year: 2012, popularity: 50 },
      { id: 2, title: 'Cars', original_title: 'Cars', release_year: 2012, popularity: 10 },
    ],
  };
  const ctx = buildContext(synthetic);
  test('bestTmdbCandidate : une correspondance de titre EXACTE l\'emporte sur une popularité plus haute', () => {
    const best = ctx.bestTmdbCandidate(synthetic['Cars'], 'Cars');
    assert.strictEqual(best.id, 2);
  });
}

module.exports = run('tmdb-matching.test.js');
