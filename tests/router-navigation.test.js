// --- Tests du routeur (js/router.js) --- Deux bugs réels corrigés en
// session (retours utilisateur) : revenir d'une fiche film laissait le
// catalogue sur la page de pagination où on l'avait quitté (v2.26) ;
// cliquer sur le logo/l'onglet Films EN ÉTANT DÉJÀ sur le catalogue ne
// faisait rien du tout, `location.hash = ''` étant un no-op quand le hash
// est déjà vide (v2.27). currentPage/render() sont normalement définis
// dans js/app.js (trop de dépendances DOM pour le charger ici tel quel) —
// injectés directement dans le contexte, exactement le rôle qu'ils jouent
// pour router.js (une variable globale + une fonction, peu importe le
// fichier qui les définit en pratique).
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(initialHash){
  const state = { currentPage: 7, renderCalls: 0 };
  const ctx = createContext({
    document: stubDocument(),
    location: { hash: initialHash },
    currentUser: { id: 'u1' }, // renderRoute() n'est pas appelée ici, mais garde une valeur réaliste
    currentPage: state.currentPage,
    render: () => { state.renderCalls++; },
    openProfileModal: () => {}, // référencé par router.js comme handler du bouton mobile "Profil", jamais appelé ici
  });
  loadFiles(ctx, ['js/router.js']);
  return { ctx, state };
}

// --- parseRoute() ---
{
  const { ctx } = buildContext('');
  const cases = [
    ['', 'home'],
    ['#', 'home'],
    ['#/watchlist', 'watchlist'],
    ['#/series', 'seriesList'],
    ['#/series/42', 'seriesDetail'],
    ['#/series/abc', 'home'],       // id non numérique -> repli home
    ['#/film/550', 'filmDetail'],
    ['#/film/abc', 'home'],         // id non numérique -> repli home
    ['#/amis', 'amis'],
    ['#/top', 'top'],
    ['#/groupes', 'groupsList'],
    ['#/groupes/12', 'groupDetail'],
    ['#/groupes/12/propositions/3', 'proposalDetail'],
    ['#/listes', 'listsList'],
    ['#/listes/7', 'listDetail'],
    ['#/listes/abc', 'home'],       // id non numérique -> repli home
    ['#/listes/7/extra', 'home'],   // segment en trop -> repli home
    ['#/n-importe-quoi', 'home'],   // route inconnue -> repli home
  ];
  for(const [hash, expected] of cases){
    test(`parseRoute() sur "${hash}" -> ${expected}`, () => {
      ctx.location.hash = hash;
      assert.strictEqual(ctx.parseRoute().name, expected);
    });
  }
}

// --- goHome() : le no-op de location.hash quand on est déjà sur le catalogue ---
{
  const { ctx, state } = buildContext('');
  test('goHome() depuis le catalogue (hash déjà vide) : remet currentPage à 1 directement, sans dépendre de hashchange', () => {
    ctx.currentPage = 7;
    ctx.goHome();
    assert.strictEqual(ctx.currentPage, 1);
    assert.strictEqual(state.renderCalls, 1);
  });
}

{
  const { ctx, state } = buildContext('#/watchlist');
  test('goHome() depuis une AUTRE page : change le hash, ne touche pas currentPage/render ici (c\'est renderRoute(), sur hashchange, qui s\'en charge)', () => {
    ctx.currentPage = 7;
    ctx.goHome();
    assert.strictEqual(ctx.location.hash, '');
    assert.strictEqual(ctx.currentPage, 7, 'pas modifié par goHome() lui-même dans ce cas — seul resetHomeView(), appelé depuis renderRoute() sur le hashchange réel, le fait');
    assert.strictEqual(state.renderCalls, 0);
  });
}

// --- resetHomeView() en tant que tel (utilisé aussi bien par goHome() que
// par la branche 'home' de renderRoute(), voir js/router.js) ---
{
  const { ctx, state } = buildContext('');
  test('resetHomeView() : remet currentPage à 1 et rappelle render()', () => {
    ctx.currentPage = 4;
    ctx.resetHomeView();
    assert.strictEqual(ctx.currentPage, 1);
    assert.strictEqual(state.renderCalls, 1);
  });
}

module.exports = run('router-navigation.test.js');
