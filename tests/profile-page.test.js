// --- Tests de la page Profil (js/profilePage.js) ---
// Draft navigation, option B (audit M1) : la page relaie chaque rangée au
// bouton d'origine resté dans #profileOverlay, et affiche identité, 4
// chiffres et films préférés à partir de ce qui est déjà en mémoire.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument, stubElement, stubEventTarget } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext({ profile, filmsList, shows = [], friends = [] } = {}){
  const page = stubEventTarget();
  const els = {
    profilePage: page,
    ppName: stubElement(), ppSub: stubElement(), ppFigures: stubElement(), ppFavs: stubElement(),
    ppAvatarImg: stubElement(), ppAvatarFallback: stubElement(),
    ppRecapLabel: stubElement(), ppAchVal: stubElement(), ppTcgBadge: stubElement({ hidden: true }),
    ppChangelogRow: stubElement({ hidden: true }), ppAdminRow: stubElement({ hidden: true }),
    ppPublicToggle: stubElement(), ppCopyLinkBtn: stubElement({ hidden: true }),
    tcgTradeBadge: stubElement({ hidden: false, textContent: '2' }),
    profileChangelogLinkBtn: stubElement({ style: { display: 'none' } }),
  };
  const clicked = [];
  els.statsBtn = stubElement({ click(){ clicked.push('statsBtn'); } });
  const ctx = createContext({
    document: stubDocument(els),
    location: { hash: '#/profil' },
    currentUser: { id: 'u1', email: 'flix@example.com' },
    currentProfile: profile,
    films: filmsList,
    trackedShows: shows,
    friendships: friends,
    computeStats: (list) => ({ total: list.length, avg: 3.44, favCount: list.filter(f => f.fav).length, activity: [] }),
    rythmeAnnuel: () => '16.8',
    computeAchievements: () => ({ tiersUnlocked: 20, tiersTotal: 30, hiddenUnlocked: 4, hiddenTotal: 7 }),
    isAdmin: () => false,
    escapeHtml: (s) => String(s),
    FILM_PLACEHOLDER_SVG: '<svg></svg>',
    parseRoute: () => ({ name: 'profil' }),
    openProfileModal(){}, openYearRecap(){}, goToFilmDetail(){}, closeOverlay(){},
  });
  loadFiles(ctx, ['js/profilePage.js']);
  return { ctx, els, page, clicked };
}

const FILMS = [
  { tmdbId: 1, title: 'Arrival', posterUrl: 'a.jpg', fav: true },
  { tmdbId: 2, title: 'Whiplash', posterUrl: 'w.jpg', fav: false },
  { tmdbId: 3, title: 'Sicario', posterUrl: null, fav: true },
];

test('renderProfilePage() : pseudo, ligne films · séries · amis, 4 chiffres', () => {
  const { ctx, els } = buildContext({
    profile: { display_name: 'Fliiiiix', top_films: [] },
    filmsList: FILMS,
    shows: [{ id: 1 }, { id: 2 }],
    friends: [{ status: 'accepted' }, { status: 'pending' }],
  });
  ctx.renderProfilePage();
  assert.strictEqual(els.ppName.textContent, 'Fliiiiix');
  assert.strictEqual(els.ppSub.textContent, '3 films · 2 séries · 1 ami');
  assert.ok(els.ppFigures.innerHTML.includes('<b>3</b>'), 'films notés');
  assert.ok(els.ppFigures.innerHTML.includes('<b>3.4</b>'), 'note moyenne à une décimale');
  assert.ok(els.ppFigures.innerHTML.includes('<b>2</b>'), 'favoris');
  assert.ok(els.ppFigures.innerHTML.includes('<b>16.8</b>'), 'films par mois');
  assert.strictEqual(els.ppAchVal.textContent, '24 / 37', 'paliers + secrets');
});

test('renderProfilePage() : sans film préféré choisi, une invitation plutôt qu\'une case vide', () => {
  const { ctx, els } = buildContext({ profile: { display_name: 'A', top_films: [] }, filmsList: FILMS });
  ctx.renderProfilePage();
  assert.ok(els.ppFavs.innerHTML.includes('Choisis tes 4 films préférés'));
});

test('renderProfilePage() : films préférés dans l\'ordre choisi, ceux retirés du catalogue ignorés', () => {
  const { ctx, els } = buildContext({ profile: { display_name: 'A', top_films: [3, 99, 1] }, filmsList: FILMS });
  ctx.renderProfilePage();
  const html = els.ppFavs.innerHTML;
  assert.ok(html.indexOf('Sicario') > -1 && html.indexOf('Arrival') > html.indexOf('Sicario'));
  assert.ok(!html.includes('data-tmdb-id="99"'));
});

test('renderProfilePage() : reflète le badge d\'échanges, Nouveautés masqué sans contenu, profil public', () => {
  const { ctx, els } = buildContext({ profile: { display_name: 'A', top_films: [], public_profile: true }, filmsList: FILMS });
  ctx.renderProfilePage();
  assert.strictEqual(els.ppTcgBadge.hidden, false);
  assert.strictEqual(els.ppTcgBadge.textContent, '2');
  assert.strictEqual(els.ppChangelogRow.hidden, true);
  assert.strictEqual(els.ppPublicToggle.checked, true);
  assert.strictEqual(els.ppCopyLinkBtn.hidden, false);
});

test('une rangée data-proxy relaie le clic au bouton d\'origine', () => {
  const { page, clicked } = buildContext({ profile: { display_name: 'A', top_films: [] }, filmsList: FILMS });
  const row = { dataset: { proxy: 'statsBtn' } };
  page.dispatch('click', { target: { closest: (sel) => sel === '[data-proxy]' ? row : null } });
  assert.deepStrictEqual(clicked, ['statsBtn']);
});

module.exports = run('profile-page.test.js');
