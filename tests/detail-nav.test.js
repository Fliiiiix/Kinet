// --- Tests de la navigation "film/série d'à côté" (retour utilisateur :
// "vu qu'on a de l'espace quand on est sur un film ou une série j'aimerais
// qu'on puisse naviguer à ceux d'à côté... si je suis sur arrival je veux
// pouvoir naviguer sur la page de paprika en cliquant sur une flèche à
// gauche et que justice soit faite en cliquant sur une flèche à droite") ---
//
// Trois couches testées séparément :
// - js/router.js : goToFilmDetail()/goToSeriesDetail() posent la liste
//   "d'à côté" dans pendingFilmNavList/pendingShowNavList juste avant de
//   changer le hash (consommée une seule fois par la page de destination).
// - js/filmDetail.js : setFilmNavFromPending()/renderFilmNavArrows()/
//   goFilmNav() — même principe côté séries dans js/series.js.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

// --- js/router.js ---
{
  function buildRouterContext(){
    const ctx = createContext({
      document: stubDocument(),
      location: { hash: '' },
      currentUser: { id: 'u1' },
      currentPage: 1,
      render(){},
      openProfileModal(){},
    });
    loadFiles(ctx, ['js/router.js']);
    return ctx;
  }

  test('goToFilmDetail() sans navList : pendingFilmNavList reste null, le hash change quand même', () => {
    const ctx = buildRouterContext();
    ctx.goToFilmDetail(550);
    assert.strictEqual(getState(ctx, 'pendingFilmNavList'), null);
    assert.strictEqual(ctx.location.hash, '#/film/550');
  });

  test('goToFilmDetail() avec navList : mémorisée telle quelle dans pendingFilmNavList', () => {
    const ctx = buildRouterContext();
    const navList = [{ tmdbId: 550, title: 'Fight Club' }, { tmdbId: 551, title: 'Paprika' }];
    ctx.goToFilmDetail(550, navList);
    assert.strictEqual(getState(ctx, 'pendingFilmNavList'), navList);
  });

  test('goToFilmDetail() : un navList qui n\'est pas un tableau (ex. undefined passé par erreur) retombe sur null', () => {
    const ctx = buildRouterContext();
    ctx.goToFilmDetail(550, 'pas-un-tableau');
    assert.strictEqual(getState(ctx, 'pendingFilmNavList'), null);
  });

  test('goToSeriesDetail() avec navList : mémorisée telle quelle dans pendingShowNavList', () => {
    const ctx = buildRouterContext();
    const navList = [{ id: 1, title: 'Arrival' }];
    ctx.goToSeriesDetail(1, navList);
    assert.strictEqual(getState(ctx, 'pendingShowNavList'), navList);
    assert.strictEqual(ctx.location.hash, '#/series/1');
  });
}

// --- js/filmDetail.js ---
{
  function buildFilmContext(pendingFilmNavList){
    const prevBtn = stubElement();
    const nextBtn = stubElement();
    const doc = stubDocument({
      filmDetailPrevBtn: prevBtn,
      filmDetailNextBtn: nextBtn,
    });
    const goToFilmDetailCalls = [];
    const ctx = createContext({
      document: doc,
      goHome(){},
      escapeHtml(s){ return s; },
      blockIfOffline(){ return false; },
      showToast(){},
      currentUser: { id: 'me' },
      friendProfiles: {},
      friendDisplayName(id){ return id; },
      friendAvatarHtml(){ return ''; },
      cacheProfile(){},
      films: [], watchlist: [],
      getDisplayNote(){ return null; },
      noteColorClass(){ return ''; },
      supabaseClient: { from(){ throw new Error('non utilisé dans ce test'); } },
      pendingFilmNavList,
      goToFilmDetail(tmdbId, navList){ goToFilmDetailCalls.push({ tmdbId, navList }); },
    });
    loadFiles(ctx, ['js/filmDetail.js']);
    return { ctx, prevBtn, nextBtn, goToFilmDetailCalls };
  }

  test('setFilmNavFromPending() : liste en attente -> flèches affichées sauf en bout de liste, puis liste consommée une seule fois (pendingFilmNavList redevient null)', () => {
    const navList = [{ tmdbId: 10, title: 'A' }, { tmdbId: 20, title: 'B' }, { tmdbId: 30, title: 'C' }];
    const { ctx, prevBtn, nextBtn } = buildFilmContext(navList);
    ctx.setFilmNavFromPending(20); // film du milieu : les deux flèches visibles
    assert.strictEqual(prevBtn.style.display, '');
    assert.strictEqual(nextBtn.style.display, '');
    assert.ok(prevBtn.title.includes('A'), prevBtn.title);
    assert.ok(nextBtn.title.includes('C'), nextBtn.title);
    assert.strictEqual(getState(ctx, 'pendingFilmNavList'), null, 'consommée : ne doit pas resservir sur une navigation suivante non liée');
  });

  test('setFilmNavFromPending() : premier élément de la liste -> flèche précédente masquée', () => {
    const navList = [{ tmdbId: 10, title: 'A' }, { tmdbId: 20, title: 'B' }];
    const { ctx, prevBtn, nextBtn } = buildFilmContext(navList);
    ctx.setFilmNavFromPending(10);
    assert.strictEqual(prevBtn.style.display, 'none');
    assert.strictEqual(nextBtn.style.display, '');
  });

  test('setFilmNavFromPending() : dernier élément de la liste -> flèche suivante masquée', () => {
    const navList = [{ tmdbId: 10, title: 'A' }, { tmdbId: 20, title: 'B' }];
    const built = buildFilmContext(navList);
    built.ctx.setFilmNavFromPending(20);
    assert.strictEqual(built.prevBtn.style.display, '');
    assert.strictEqual(built.nextBtn.style.display, 'none');
  });

  test('setFilmNavFromPending() : aucune liste en attente (arrivée directe, pas depuis une liste) -> les deux flèches masquées', () => {
    const { ctx, prevBtn, nextBtn } = buildFilmContext(null);
    ctx.setFilmNavFromPending(10);
    assert.strictEqual(prevBtn.style.display, 'none');
    assert.strictEqual(nextBtn.style.display, 'none');
  });

  test('setFilmNavFromPending() : le film ouvert n\'est pas dans la liste reçue (cas limite) -> les deux flèches masquées, pas d\'exception', () => {
    const navList = [{ tmdbId: 10, title: 'A' }];
    const { ctx, prevBtn, nextBtn } = buildFilmContext(navList);
    ctx.setFilmNavFromPending(999);
    assert.strictEqual(prevBtn.style.display, 'none');
    assert.strictEqual(nextBtn.style.display, 'none');
  });

  test('goFilmNav(-1)/goFilmNav(1) : navigue vers le voisin ET lui transmet la MÊME liste, pour continuer à naviguer de suite en suite', () => {
    const navList = [{ tmdbId: 10, title: 'A' }, { tmdbId: 20, title: 'B' }, { tmdbId: 30, title: 'C' }];
    const { ctx, goToFilmDetailCalls } = buildFilmContext(navList);
    ctx.setFilmNavFromPending(20);
    ctx.goFilmNav(1);
    assert.strictEqual(goToFilmDetailCalls[0].tmdbId, 30);
    assert.strictEqual(goToFilmDetailCalls[0].navList, navList);
    ctx.goFilmNav(-1); // toujours relatif à l'index du film initialement ouvert (20), pas 30 : cohérent avec un rechargement de page à chaque navigation
    assert.strictEqual(goToFilmDetailCalls[1].tmdbId, 10);
  });

  test('goFilmNav() : hors limites (déjà sur le premier/dernier) -> ne fait rien', () => {
    const navList = [{ tmdbId: 10, title: 'A' }];
    const { ctx, goToFilmDetailCalls } = buildFilmContext(navList);
    ctx.setFilmNavFromPending(10);
    ctx.goFilmNav(-1);
    ctx.goFilmNav(1);
    assert.strictEqual(goToFilmDetailCalls.length, 0);
  });

  test('goFilmNav() : sans liste du tout -> ne fait rien (pas d\'exception)', () => {
    const { ctx, goToFilmDetailCalls } = buildFilmContext(null);
    ctx.setFilmNavFromPending(10);
    ctx.goFilmNav(1);
    assert.strictEqual(goToFilmDetailCalls.length, 0);
  });
}

// --- js/series.js ---
{
  function buildSeriesContext(pendingShowNavList){
    const prevBtn = stubElement();
    const nextBtn = stubElement();
    const doc = stubDocument({
      seriesDetailPrevBtn: prevBtn,
      seriesDetailNextBtn: nextBtn,
    });
    const goToSeriesDetailCalls = [];
    const ctx = createContext({
      document: doc,
      goToSeries(){},
      blockIfOffline(){ return false; },
      showToast(){},
      escapeHtml(s){ return s; },
      formatDateFr(){ return ''; },
      noteColorClass(){ return ''; },
      pulseCheckbox(){},
      supabaseClient: { from(){ throw new Error('non utilisé dans ce test'); } },
      pendingShowNavList,
      goToSeriesDetail(id, navList){ goToSeriesDetailCalls.push({ id, navList }); },
    });
    loadFiles(ctx, ['js/series.js']);
    return { ctx, prevBtn, nextBtn, goToSeriesDetailCalls };
  }

  test('setShowNavFromPending() : même logique que côté film — flèches affichées sauf en bout de liste, liste consommée une seule fois', () => {
    const navList = [{ id: 1, title: 'Arrival' }, { id: 2, title: 'Paprika' }];
    const { ctx, prevBtn, nextBtn } = buildSeriesContext(navList);
    ctx.setShowNavFromPending(1);
    assert.strictEqual(prevBtn.style.display, 'none');
    assert.strictEqual(nextBtn.style.display, '');
    assert.ok(nextBtn.title.includes('Paprika'), nextBtn.title);
    assert.strictEqual(getState(ctx, 'pendingShowNavList'), null);
  });

  test('goShowNav() : navigue vers la série voisine en lui transmettant la même liste', () => {
    const navList = [{ id: 1, title: 'Arrival' }, { id: 2, title: 'Paprika' }];
    const { ctx, goToSeriesDetailCalls } = buildSeriesContext(navList);
    ctx.setShowNavFromPending(1);
    ctx.goShowNav(1);
    assert.strictEqual(goToSeriesDetailCalls[0].id, 2);
    assert.strictEqual(goToSeriesDetailCalls[0].navList, navList);
  });

  test('setShowNavFromPending() : aucune liste en attente -> les deux flèches masquées', () => {
    const { ctx, prevBtn, nextBtn } = buildSeriesContext(null);
    ctx.setShowNavFromPending(1);
    assert.strictEqual(prevBtn.style.display, 'none');
    assert.strictEqual(nextBtn.style.display, 'none');
  });
}

module.exports = run('detail-nav.test.js');
