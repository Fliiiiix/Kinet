// --- Tests des notes des amis sur la fiche film (js/filmDetail.js) ---
// Retour utilisateur (étude comparative Letterboxd/Goodreads) : la fiche
// #/film/:tmdbId n'affichait jusqu'ici que la note moyenne COMMUNAUTAIRE
// globale, jamais qui parmi mes amis a vu/noté ce film précis — voir
// get_film_friend_ratings() (migrations/057) et renderFilmDetailFriendRatings().
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(rpcResult, overrides = {}){
  const wrapEl = stubElement();
  const doc = stubDocument({ filmDetailFriendRatings: wrapEl });
  // friendProfiles fourni directement en override (jamais peuplé par
  // cacheProfile(), ici un no-op) : ensureProfilesCached() dans
  // js/filmDetail.js ne fait donc rien d'utile dans ce test, mais les
  // données sont déjà là pour friendDisplayName()/friendAvatarHtml().
  const friendProfilesData = overrides.friendProfiles || {};
  const ctx = createContext(Object.assign({
    document: doc,
    goHome(){},
    escapeHtml(s){ return s; },
    blockIfOffline(){ return false; },
    showToast(){},
    currentUser: { id: 'me' },
    friendProfiles: friendProfilesData,
    friendDisplayName(id){ return (friendProfilesData[id] && friendProfilesData[id].displayName) || 'Utilisateur'; },
    friendAvatarHtml(id, name){ return `<span class="avatar">${name}</span>`; },
    cacheProfile(){},
    films: [], watchlist: [],
    getDisplayNote(){ return null; },
    noteColorClass(){ return ''; },
    supabaseClient: {
      rpc(fn, args){
        assert.strictEqual(fn, 'get_film_friend_ratings');
        assert.deepStrictEqual(JSON.parse(JSON.stringify(args)), { p_tmdb_id: 550 });
        return Promise.resolve(rpcResult);
      },
      from(){ throw new Error('non utilisé dans ce test'); },
    },
  }, overrides));
  loadFiles(ctx, ['js/filmDetail.js']);
  return { ctx, wrapEl };
}

test('renderFilmDetailFriendRatings() : aucun ami n\'a ce film -> strip vidé, jamais un cadre vide', async () => {
  const { ctx, wrapEl } = buildContext({ data: [], error: null });
  wrapEl.innerHTML = 'contenu précédent';
  await ctx.renderFilmDetailFriendRatings(550);
  assert.strictEqual(wrapEl.innerHTML, '');
});

test('renderFilmDetailFriendRatings() : un ami l\'a noté -> une puce avec son nom et sa note', async () => {
  const { ctx, wrapEl } = buildContext(
    { data: [{ friend_id: 'ami1', note: '4.5' }], error: null },
    { friendProfiles: { ami1: { displayName: 'Sam', avatarUrl: null } } }
  );
  await ctx.renderFilmDetailFriendRatings(550);
  assert.ok(wrapEl.innerHTML.includes('Sam'), wrapEl.innerHTML);
  assert.ok(wrapEl.innerHTML.includes('4.5'), wrapEl.innerHTML);
  // /g sur "friend-rating-chip" seul compterait aussi friend-rating-chip-name
  // (préfixe partagé) — \b"> ancre la fin exacte de la classe du conteneur.
  assert.strictEqual((wrapEl.innerHTML.match(/friend-rating-chip">/g) || []).length, 1);
});

test('renderFilmDetailFriendRatings() : plusieurs amis -> une puce chacun', async () => {
  const { ctx, wrapEl } = buildContext(
    { data: [{ friend_id: 'ami1', note: '4' }, { friend_id: 'ami2', note: '2.5' }], error: null },
    { friendProfiles: { ami1: { displayName: 'Sam', avatarUrl: null }, ami2: { displayName: 'Alex', avatarUrl: null } } }
  );
  await ctx.renderFilmDetailFriendRatings(550);
  assert.ok(wrapEl.innerHTML.includes('Sam'));
  assert.ok(wrapEl.innerHTML.includes('Alex'));
});

test('renderFilmDetailFriendRatings() : erreur RPC (ex. migration 057 pas encore appliquée) -> strip vidé, pas d\'exception', async () => {
  const { ctx, wrapEl } = buildContext({ data: null, error: { message: 'function get_film_friend_ratings does not exist' } });
  wrapEl.innerHTML = 'contenu précédent';
  await ctx.renderFilmDetailFriendRatings(550);
  assert.strictEqual(wrapEl.innerHTML, '');
});

module.exports = run('film-friend-ratings.test.js');
