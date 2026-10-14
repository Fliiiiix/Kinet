// --- Tests du nom de saison affiché sur la fiche série (js/series.js) ---
// Audit T1 : TMDB renvoie « Season 1 » quand aucune traduction n'existe.
// seasonLabel() le remplace par « Saison 1 », garde un vrai nom de saison,
// et nomme la saison 0 « Épisodes spéciaux ».
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const ctx = createContext({
    document: stubDocument(),
    goToSeries(){},
    blockIfOffline(){ return false; },
    showToast(){},
    escapeHtml(s){ return s; },
    formatDateFr(){ return ''; },
    noteColorClass(){ return ''; },
    pulseCheckbox(){},
    supabaseClient: { from(){ throw new Error('non utilisé dans ce test'); } },
  });
  loadFiles(ctx, ['js/series.js']);
  return ctx;
}

test('seasonLabel() : « Season 1 » (TMDB non traduit) -> « Saison 1 »', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.seasonLabel({ season_number: 1, name: 'Season 1' }), 'Saison 1');
});

test('seasonLabel() : sans nom -> « Saison n »', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.seasonLabel({ season_number: 3, name: '' }), 'Saison 3');
});

test('seasonLabel() : un vrai nom de saison est gardé tel quel', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.seasonLabel({ season_number: 2, name: 'Le Retour' }), 'Le Retour');
});

test('seasonLabel() : saison 0 « Specials » -> « Épisodes spéciaux »', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.seasonLabel({ season_number: 0, name: 'Specials' }), 'Épisodes spéciaux');
});

module.exports = run('season-label.test.js');
