// --- Tests de l'alerte "un ami a noté un film de ta watchlist" (js/watchlist.js) ---
// get_watchlist_friend_ratings() (migrations/039) rapproche watchlist et
// films sur tmdb_id (jamais le titre, trop fragile) — friendRatingsLabel()
// formule le message ("Alice a mis 4.0" à 1 ami, décompte+moyenne à
// plusieurs), loadWatchlistFriendRatings() groupe les lignes par
// watchlist_id et hydrate les profils manquants.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(overrides = {}){
  const ctx = createContext(Object.assign({
    document: stubDocument(),
    goToWatchlist(){}, goHome(){}, closeOverlay(){}, openOverlay(){},
    blockIfOffline(){ return false; },
    showToast(){},
    escapeHtml(s){ return s; },
    friendDisplayName(id){ return id === 'alice' ? 'Alice' : id; },
    friendProfiles: {},
    cacheProfile(){},
    supabaseClient: { rpc(){ throw new Error('non utilisé par ce test'); } },
  }, overrides));
  loadFiles(ctx, ['js/watchlist.js']);
  return ctx;
}

test('friendRatingsLabel() : rien noté pour cet item -> null (pas d\'alerte)', () => {
  const ctx = buildContext();
  setState(ctx, { watchlistFriendRatings: {} });
  assert.strictEqual(ctx.friendRatingsLabel(1), null);
});

test('friendRatingsLabel() : un seul ami -> son nom et sa note', () => {
  const ctx = buildContext();
  setState(ctx, { watchlistFriendRatings: { 1: [{ friendId: 'alice', note: 4 }] } });
  assert.strictEqual(ctx.friendRatingsLabel(1), '👋 Alice a mis 4.0');
});

test('friendRatingsLabel() : plusieurs amis -> décompte + moyenne, pas une liste de noms', () => {
  const ctx = buildContext();
  setState(ctx, { watchlistFriendRatings: { 1: [{ friendId: 'alice', note: 5 }, { friendId: 'bob', note: 3 }] } });
  assert.strictEqual(ctx.friendRatingsLabel(1), '👋 2 amis l\'ont noté (moy. 4.0)');
});

test('loadWatchlistFriendRatings() : groupe les lignes par watchlist_id', async () => {
  const ctx = buildContext({
    supabaseClient: {
      rpc(name){
        assert.strictEqual(name, 'get_watchlist_friend_ratings');
        return Promise.resolve({
          data: [
            { watchlist_id: 1, tmdb_id: 42, friend_id: 'alice', note: 4 },
            { watchlist_id: 1, tmdb_id: 42, friend_id: 'bob', note: 3 },
            { watchlist_id: 2, tmdb_id: 43, friend_id: 'alice', note: 5 },
          ],
          error: null,
        });
      },
      // Profils manquants (alice/bob, ni l'un ni l'autre dans friendProfiles
      // ici) : loadWatchlistFriendRatings() les hydrate en plus du RPC.
      from(table){
        assert.strictEqual(table, 'profiles');
        return { select(){ return this; }, in(){ return Promise.resolve({ data: [], error: null }); } };
      },
    },
  });
  await ctx.loadWatchlistFriendRatings();
  const ratings = getState(ctx, 'watchlistFriendRatings');
  assert.strictEqual(ratings[1].length, 2);
  assert.strictEqual(ratings[2].length, 1);
  assert.strictEqual(ratings[2][0].note, 5);
});

test('loadWatchlistFriendRatings() : erreur RPC -> état vidé, pas d\'exception', async () => {
  const ctx = buildContext({
    supabaseClient: { rpc(){ return Promise.resolve({ data: null, error: { message: 'boom' } }); } },
  });
  setState(ctx, { watchlistFriendRatings: { 1: [{ friendId: 'alice', note: 4 }] } });
  await ctx.loadWatchlistFriendRatings();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(getState(ctx, 'watchlistFriendRatings'))), {});
});

module.exports = run('watchlist-friend-ratings.test.js');
