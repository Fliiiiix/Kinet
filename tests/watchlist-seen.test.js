// --- Un film noté pour la première fois quitte À voir (js/watchlist.js) ---
// Retour de Flix (18/10) : « Les Enchantés », mis dans À voir puis noté
// depuis la recherche juste après, y restait. Seul le bouton « Noter »
// d'À voir retirait le film. removeSeenFromWatchlist() cherche aussi par
// fiche TMDB, en base, quel que soit le chemin pris pour noter.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(rowsInDb){
  const deletes = [];
  const ctx = createContext({
    document: stubDocument(),
    goToWatchlist(){}, goHome(){}, closeOverlay(){}, openOverlay(){},
    blockIfOffline(){ return false; }, showToast(){},
    escapeHtml(s){ return String(s); },
    FILM_PLACEHOLDER_SVG: '', TMDB_IMG_BASE: '',
    supabaseClient: {
      from(table){
        assert.strictEqual(table, 'watchlist');
        return {
          delete(){
            return {
              eq(col, v){
                deletes.push(`${col}=${v}`);
                const hit = rowsInDb.filter(r => r[col] === v);
                return { select(){ return Promise.resolve({ data: hit.map(r => ({ id: r.id })), error: null }); } };
              },
            };
          },
        };
      },
    },
  });
  loadFiles(ctx, ['js/watchlist.js']);
  setState(ctx, { watchlist: [
    { id: 1, title: 'Les Enchantés', tmdbId: 1100 },
    { id: 2, title: 'Interstellar', tmdbId: 157336 },
  ] });
  return { ctx, deletes };
}

test('noté depuis la recherche : retiré d’À voir par sa fiche TMDB', async () => {
  const { ctx, deletes } = buildContext([{ id: 1, tmdb_id: 1100 }, { id: 2, tmdb_id: 157336 }]);
  const n = await ctx.removeSeenFromWatchlist(1100, null);
  assert.strictEqual(n, 1);
  assert.strictEqual(JSON.stringify(deletes), '["tmdb_id=1100"]');
  assert.strictEqual(JSON.stringify(getState(ctx, 'watchlist').map(w => w.id)), '[2]');
});

test('noté depuis « Noter » d’À voir : retiré par son id et par sa fiche', async () => {
  const { ctx, deletes } = buildContext([{ id: 1, tmdb_id: 1100 }]);
  const n = await ctx.removeSeenFromWatchlist(1100, 1);
  assert.strictEqual(n, 1, 'compté une seule fois');
  assert.strictEqual(deletes.length, 2);
});

test('film absent d’À voir : rien de retiré, et rien à faire sans fiche ni id', async () => {
  const { ctx, deletes } = buildContext([]);
  assert.strictEqual(await ctx.removeSeenFromWatchlist(999, null), 0);
  assert.strictEqual(await ctx.removeSeenFromWatchlist(null, null), 0);
  assert.strictEqual(deletes.length, 1);
  assert.strictEqual(getState(ctx, 'watchlist').length, 2);
});

module.exports = run('watchlist-seen.test.js');
