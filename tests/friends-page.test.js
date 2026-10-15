// --- Tests de la page Amis (js/friends.js, draft du 15/10) ---
// Piste A (fil d'affiches) avec les lignes d'amis de la piste B : chaque ami
// montre s'il est « en phase » (compatibilité, à partir de 5 films en
// commun), ses films en commun et son dernier film noté ; le fil « Ce
// qu'ils regardent » montre l'affiche et la note en couleur.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const ctx = createContext({
    document: stubDocument(),
    goToAmis(){}, goToGroups(){}, goToLists(){}, goHome(){}, goToFilmDetail(){}, goToPublicProfile(){},
    escapeHtml(s){ return String(s); },
    noteColorClass(n){ return n >= 4 ? 'rate-high' : n >= 2.5 ? 'rate-mid' : 'rate-low'; },
    getDisplayNote(f){ return f.manualNote != null ? f.manualNote : null; },
    rowMoreButtonHtml(){ return '<button class="row-more-btn"></button>'; },
    activityEventLabel(e){ return `autre : ${e.eventType}`; },
    FILM_PLACEHOLDER_SVG: '<svg></svg>',
  });
  loadFiles(ctx, ['js/friends.js']);
  setState(ctx, {
    currentUser: { id: 'me' },
    friendProfiles: { u1: { displayName: 'Camille' }, u2: { displayName: 'Jules' }, u3: { displayName: 'Navid' } },
  });
  return ctx;
}

const friendship = (other) => ({ requesterId: 'me', addresseeId: other, status: 'accepted' });

test('compatibilité : « 82 % en phase » dès 5 films en commun, « pas assez en commun » en dessous', () => {
  const ctx = buildContext();
  assert.ok(ctx.friendCompatHtml({ compat: 81.6, common: 41 }).includes('<b>82 %</b><span>en phase</span>'));
  assert.ok(ctx.friendCompatHtml({ compat: 95, common: 3 }).includes('pas assez en commun'));
  assert.ok(ctx.friendCompatHtml({ compat: null, common: 12 }).includes('pas assez en commun'));
  assert.ok(!ctx.friendCompatHtml(undefined).includes('en commun'), 'rien tant que les chiffres ne sont pas chargés');
});

test('les amis les plus en phase d\'abord, puis les autres par pseudo', () => {
  const ctx = buildContext();
  setState(ctx, { friendStats: { u1: { compat: 64, common: 23 }, u2: { compat: 82, common: 41 }, u3: { compat: 99, common: 3 } } });
  const order = ctx.sortFriendsByCompat([friendship('u1'), friendship('u3'), friendship('u2')]).map(f => f.addresseeId);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(order)), ['u2', 'u1', 'u3']);
});

test('ligne d\'ami : films en commun, dernier film noté avec sa note', () => {
  const ctx = buildContext();
  setState(ctx, { friendStats: { u1: { compat: 82, common: 41, last: { title: 'Dune', posterUrl: 'https://img/dune.jpg', note: 4.5 } } } });
  const html = ctx.friendRichRowHtml(friendship('u1'));
  assert.ok(html.includes('41 films en commun · dernier : Dune'));
  assert.ok(html.includes('https://img/dune.jpg'));
  assert.ok(html.includes('rate-high">4.5'));
  assert.ok(html.includes('82 %'));
});

test('fil : « a noté » avec la note en couleur et l\'affiche', () => {
  const ctx = buildContext();
  const html = ctx.friendFeedRowHtml({ id: 1, actorId: 'u2', eventType: 'film_rated', targetLabel: 'Le Parrain', targetNote: 5, targetPosterUrl: 'https://img/p.jpg', createdAt: new Date().toISOString() });
  assert.ok(html.includes('<b>Jules</b> a noté <b class="fr-film">Le Parrain</b>'));
  assert.ok(html.includes('rate-high">5.0'));
  assert.ok(html.includes('https://img/p.jpg'));
  const wl = ctx.friendFeedRowHtml({ id: 2, actorId: 'u1', eventType: 'watchlist_added', targetLabel: 'Mars Express', createdAt: new Date().toISOString() });
  assert.ok(wl.includes('a ajouté à À voir') && !wl.includes('fr-note'));
});

test('dates du fil : à l\'instant, il y a 3 h, hier, il y a 4 jours, puis la date', () => {
  const ctx = buildContext();
  const now = new Date(2026, 9, 15, 18, 0).getTime();
  const ago = (ms) => new Date(now - ms).toISOString();
  assert.strictEqual(ctx.friendFeedWhen(ago(30 * 1000), now), 'à l’instant');
  assert.strictEqual(ctx.friendFeedWhen(ago(3 * 3600e3), now), 'il y a 3 h');
  assert.strictEqual(ctx.friendFeedWhen(ago(26 * 3600e3), now), 'hier');
  assert.strictEqual(ctx.friendFeedWhen(ago(4 * 86400e3), now), 'il y a 4 jours');
  assert.strictEqual(ctx.friendFeedWhen(new Date(2026, 8, 3, 12).toISOString(), now), '3 sept.');
});

test('fil : retrouve la fiche du film noté dans le catalogue de l\'ami', async () => {
  const ctx = buildContext();
  let query = null;
  setState(ctx, { supabaseClient: { from(){
    const q = { select(){ return q; }, in(col, vals){ query = query || {}; query[col] = vals; return q; },
      then(resolve){ resolve({ data: [{ user_id: 'u2', title: 'Le Parrain', tmdb_id: 238 }], error: null }); } };
    return q;
  } } });
  const map = await ctx.lookupFeedFilms([
    { actorId: 'u2', eventType: 'film_rated', targetLabel: 'Le Parrain' },
    { actorId: 'u1', eventType: 'watchlist_added', targetLabel: 'Mars Express' },
  ]);
  assert.strictEqual(map['u2|Le Parrain'], 238);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(query)), { user_id: ['u2'], title: ['Le Parrain'] });
});

module.exports = run('friends-page.test.js');
