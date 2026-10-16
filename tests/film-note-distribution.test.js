// --- Tests de l'histogramme de répartition des notes sur la fiche film
// (js/filmDetail.js, réutilise renderBarChart() de js/stats.js) ---
// Retour utilisateur (étude comparative Letterboxd/Goodreads) : la fiche
// #/film/:tmdbId n'affichait qu'une moyenne unique (get_film_stats,
// migrations/030), jamais comment ces notes se répartissent — voir
// get_film_note_distribution() (migrations/059).
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(rpcResponses){
  const notesEl = stubElement();
  const avgEl = stubElement();
  const doc = stubDocument({ filmDetailNotes: notesEl, filmDetailHistory: stubElement(), filmDetailAvg: avgEl });
  const ctx = createContext({
    document: doc,
    goHome(){},
    escapeHtml(s){ return s; },
    blockIfOffline(){ return false; },
    showToast(){},
    currentUser: { id: 'me' },
    friendProfiles: {},
    friendDisplayName(){ return ''; },
    friendAvatarHtml(){ return ''; },
    cacheProfile(){},
    films: [], watchlist: [],
    getDisplayNote(){ return null; },
    noteColorClass(){ return ''; },
    supabaseClient: {
      rpc(fn, args){
        assert.deepStrictEqual(JSON.parse(JSON.stringify(args)), { p_tmdb_id: 550 });
        return Promise.resolve(rpcResponses[fn]);
      },
      from(){ throw new Error('non utilisé dans ce test (films vide : renderNoteHistory() sort avant tout accès réseau)'); },
    },
  });
  loadFiles(ctx, ['js/stats.js', 'js/filmDetail.js']);
  setState(ctx, { currentFilmTmdbId: 550 });
  return { ctx, notesEl, avgEl };
}

test('renderFilmDetailNotes() : 0 ou 1 note -> pas d\'histogramme (rien à répartir)', async () => {
  const { ctx, notesEl } = buildContext({
    get_film_stats: { data: [{ avg_note: 4, rating_count: 1 }], error: null },
    get_film_note_distribution: { data: [{ note: 4, note_count: 1 }], error: null },
  });
  await ctx.renderFilmDetailNotes();
  assert.ok(!notesEl.innerHTML.includes('bar-chart'), notesEl.innerHTML);
});

test('renderFilmDetailNotes() : moins de 5 notes -> pas d’histogramme (audit des six écrans, F6)', async () => {
  const { ctx, notesEl } = buildContext({
    get_film_stats: { data: [{ avg_note: 4.3, rating_count: 2 }], error: null },
    get_film_note_distribution: { data: [{ note: 4, note_count: 1 }, { note: 4.5, note_count: 1 }], error: null },
  });
  await ctx.renderFilmDetailNotes();
  assert.ok(!notesEl.innerHTML.includes('bar-chart'), notesEl.innerHTML);
});

test('renderFilmDetailNotes() : à partir de 5 notes -> histogramme affiché avec les 11 paliers', async () => {
  const dist = [];
  for(let n = 0; n <= 5; n += 0.5) dist.push({ note: n, note_count: n === 4 ? 5 : 0 });
  const { ctx, notesEl } = buildContext({
    get_film_stats: { data: [{ avg_note: 4, rating_count: 5 }], error: null },
    get_film_note_distribution: { data: dist, error: null },
  });
  await ctx.renderFilmDetailNotes();
  assert.ok(notesEl.innerHTML.includes('bar-chart'), notesEl.innerHTML);
  assert.strictEqual((notesEl.innerHTML.match(/bar-col/g) || []).length, 11, 'les 11 paliers doivent tous apparaître, y compris à zéro vote');
});

test('renderFilmDetailNotes() : erreur sur la répartition (ex. migration 059 pas encore appliquée) -> moyenne affichée quand même, pas d\'histogramme, pas d\'exception', async () => {
  const { ctx, notesEl, avgEl } = buildContext({
    get_film_stats: { data: [{ avg_note: 4, rating_count: 5 }], error: null },
    get_film_note_distribution: { data: null, error: { message: 'function get_film_note_distribution does not exist' } },
  });
  await ctx.renderFilmDetailNotes();
  assert.ok(!notesEl.innerHTML.includes('bar-chart'), notesEl.innerHTML);
  // La moyenne vit dans la ligne « Note Kinet » de la fiche (audit M4).
  assert.ok(avgEl.textContent.includes('4.0'), 'la moyenne reste affichée malgré l\'échec de la répartition');
});

module.exports = run('film-note-distribution.test.js');
