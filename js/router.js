// --- Routeur minimaliste (hash-based) ---
// Groupes contenait membres + ajout d'amis + propositions + votes +
// discussion, empilé sur 3 niveaux de modal (Groupes > détail groupe >
// détail proposition) — trop pour ce format. Watchlist, Amis et Séries ont
// suivi le même traitement (contenu trop riche, ou destination assez
// fréquente pour mériter une URL propre plutôt qu'être noyée dans une
// popup) :
//   (pas de hash)                           -> catalogue (#appContainer)
//   #/watchlist                             -> liste "à voir"
//   #/series                                -> séries suivies
//   #/series/:showId                        -> détail d'une série (saisons/épisodes)
//   #/prochainement                         -> films/séries à venir
//   #/amis                                  -> amis (demandes, liste) + accès Groupes
//   #/top                                   -> top films (tout le monde / mes amis)
//   #/groupes                               -> liste des groupes
//   #/groupes/:groupId                      -> détail d'un groupe
//   #/groupes/:groupId/propositions/:propId -> détail d'une proposition
//   #/invite/:token                         -> invitation à rejoindre un groupe
//   #/profil                                -> page Profil (draft navigation, option B)
// La page Profil remplace l'ancienne grande fenêtre « Ton profil » (audit
// M1) : voir js/profilePage.js. Statistiques/Succès/Cartes/Journal restent
// des .overlay mais s'affichent comme des pages (.overlay.as-page).
//
// Pas de framework : hashchange + un switch sur les segments suffisent pour
// ces écrans. Les fonctions de chargement/rendu (loadGroups, openGroupDetail,
// openProposalDetail, openWatchlist, openFriends, openSeries,
// openShowDetail, openUpcoming...) restent dans js/groups.js,
// js/proposals.js, js/watchlist.js, js/friends.js, js/series.js et
// js/upcoming.js — ce fichier ne fait que décider laquelle appeler.
//
// #/u/:userId (js/publicProfile.js) est à part : seule page accessible SANS
// connexion (lien à partager) — voir le if(route.name === 'publicProfile')
// tout en haut de renderRoute(), avant le if(!currentUser) qui bloque tout
// le reste, et js/auth.js → initAuth() qui la laisse passer avant même de
// vérifier la session Supabase.

const PAGE_IDS = ['appContainer', 'groupsListPage', 'groupDetailPage', 'proposalDetailPage', 'watchlistPage', 'seriesPage', 'seriesDetailPage', 'upcomingPage', 'amisPage', 'topPage', 'publicProfilePage', 'invitePage', 'filmDetailPage', 'listsPage', 'listDetailPage', 'profilePage'];

// null cache tout (utile pour l'écran de connexion / maintenance, qui gère
// sa propre visibilité par ailleurs).
function showOnlyPage(id){
  PAGE_IDS.forEach(pid => {
    document.getElementById(pid).style.display = (pid === id) ? '' : 'none';
  });
  // Bouton flottant "+ Ajouter" (mobile, <600px) : n'a de sens que sur le
  // catalogue. Sans ce garde-fou il flotte par-dessus TOUTE page en
  // dessous de 600px (watchlist, amis, groupes, et même l'écran de
  // connexion — bug constaté sur mobile, .fab n'était scopé qu'à la media
  // query, jamais à la page active). Chaîne vide (pas 'none') sur le
  // catalogue : rend la main à la media query CSS plutôt que de la
  // court-circuiter avec un style inline fixe.
  const fab = document.getElementById('fabAddBtn');
  if(fab) fab.style.display = (id === 'appContainer') ? '' : 'none';
}

// Sélecteur principal Films/Séries (v2.0.6, #primaryTabs dans le header) :
// reflète la route active à chaque rendu — actif seulement sur les deux
// vraies "sections" de contenu (catalogue films / séries suivies), aucun
// des deux en surbrillance sur les pages utilitaires (Watchlist, Amis,
// Top...) plutôt que de garder artificiellement le dernier onglet visité
// actif alors qu'on n'y est plus.
function updatePrimaryTabs(routeName){
  // Une fiche film reste « dans » Films, comme une fiche série dans Séries
  // (audit C6 : aucun onglet n'était allumé sur une fiche film).
  const filmsActive = routeName === 'home' || routeName === 'filmDetail';
  const seriesActive = routeName === 'seriesList' || routeName === 'seriesDetail';
  document.getElementById('primaryTabFilms').setAttribute('aria-selected', String(filmsActive));
  document.getElementById('primaryTabSeries').setAttribute('aria-selected', String(seriesActive));
}
document.getElementById('primaryTabFilms').addEventListener('click', goHome);
document.getElementById('primaryTabSeries').addEventListener('click', goToSeries);

// Interrupteur Films / Séries dans le titre (draft navigation, option B) :
// chaque page porte le sien, déjà dans le bon état dans le HTML. Flèches
// gauche/droite comme un vrai groupe d'onglets.
function goToCatalog(kind){
  if(kind === 'series') goToSeries(); else goHome();
}
document.querySelectorAll('.catalog-switch-btn[data-catalog]').forEach(btn => {
  btn.addEventListener('click', () => {
    if(!btn.classList.contains('is-active')) goToCatalog(btn.dataset.catalog);
  });
  btn.addEventListener('keydown', (e) => {
    if(e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    goToCatalog(btn.dataset.catalog === 'films' ? 'series' : 'films');
  });
});

// Barre de navigation mobile (v2.1.x, #mobileTabbar dans index.html) —
// même principe qu'updatePrimaryTabs() ci-dessus : reflète la route
// active à chaque rendu. "Catalogue" couvre films ET séries (l'interrupteur
// Films / Séries est dans le titre de la page, draft navigation option B).
// "Profil" est une vraie page depuis l'option B (#/profil).
function updateMobileTabbar(routeName){
  const homeActive = routeName === 'home' || routeName === 'seriesList' || routeName === 'seriesDetail' || routeName === 'filmDetail';
  const map = {
    mobileTabHome: homeActive,
    mobileTabWatchlist: routeName === 'watchlist',
    mobileTabUpcoming: routeName === 'upcoming',
    mobileTabFriends: routeName === 'amis' || routeName === 'groupsList' || routeName === 'groupDetail' || routeName === 'proposalDetail' || routeName === 'listsList' || routeName === 'listDetail',
    mobileTabProfile: routeName === 'profil'
  };
  Object.keys(map).forEach(id => {
    document.getElementById(id).classList.toggle('active', map[id]);
  });
}

// Pilule de l'entête (v3.0, draft Scope, retour utilisateur : "une
// couleur bleue pour le bouton sur lequel on est" — la pilule active se
// remplit en glace pleine, .header-nav-btn.active dans css/style.css)
// — même principe qu'updateMobileTabbar() ci-dessus, pour les seuls
// boutons qui correspondent à une VRAIE route (pas une modale : Rechercher/
// Avis/Installer/Nouveautés restent sans état actif, comme #mobileTabProfile
// juste au-dessus).
function updateHeaderNav(routeName){
  const map = {
    watchlistBtn: routeName === 'watchlist',
    upcomingBtn: routeName === 'upcoming',
    friendsBtn: routeName === 'amis' || routeName === 'groupsList' || routeName === 'groupDetail' || routeName === 'proposalDetail' || routeName === 'listsList' || routeName === 'listDetail',
    topBtn: routeName === 'top',
    userAvatarBtn: routeName === 'profil'
  };
  Object.keys(map).forEach(id => {
    document.getElementById(id).classList.toggle('active', map[id]);
  });
}
document.getElementById('mobileTabHome').addEventListener('click', goHome);
document.getElementById('mobileTabWatchlist').addEventListener('click', goToWatchlist);
document.getElementById('mobileTabUpcoming').addEventListener('click', goToUpcoming);
document.getElementById('mobileTabFriends').addEventListener('click', goToAmis);
document.getElementById('mobileTabProfile').addEventListener('click', () => goToProfile());

// Retour utilisateur : cliquer sur le logo/l'onglet Films en pleine
// pagination (page 3, 4...) alors qu'on est DÉJÀ sur le catalogue ne
// ramenait pas en page 1 — `location.hash = ''` ne change rien quand le
// hash est déjà vide, donc `hashchange` ne se déclenche pas, et
// renderRoute() (seul endroit qui remettait currentPage à 1) ne tournait
// jamais. Partagée par renderRoute() (vraie navigation, hash différent) et
// goHome() (cas où le hash ne change pas) plutôt que dupliquée.
function resetHomeView(){
  currentPage = 1;
  render();
}
function goHome(){
  if(parseRoute().name === 'home'){ resetHomeView(); return; }
  location.hash = '';
}
// Listes thématiques (retour utilisateur, étude comparative Letterboxd :
// "Movies everyone should watch once") — même raisonnement que Groupes
// juste en dessous : accès depuis la page Amis plutôt qu'une icône dédiée
// dans l'entête, voir js/lists.js.
function goToLists(){ location.hash = '#/listes'; }
function goToListDetail(listId){ location.hash = `#/listes/${listId}`; }
function goToGroups(){ location.hash = '#/groupes'; }
function goToGroup(groupId){ location.hash = `#/groupes/${groupId}`; }
function goToProposal(groupId, proposalId){ location.hash = `#/groupes/${groupId}/propositions/${proposalId}`; }
function goToWatchlist(){ location.hash = '#/watchlist'; }
function goToSeries(){ location.hash = '#/series'; }
// pendingShowNavList : liste "d'à côté" (retour utilisateur : "je veux
// pouvoir naviguer à ceux d'à côté"), dans l'ordre affiché sur la liste
// d'où on vient — consommée UNE SEULE FOIS par openShowDetail() au
// prochain routage (voir js/series.js), jamais gardée au-delà : un lien
// direct ou F5 sur #/series/:id n'a pas de "liste d'à côté", les flèches
// sont alors simplement absentes plutôt que de pointer n'importe où.
let pendingShowNavList = null; // [{ id, title }] ou null
function goToSeriesDetail(showId, navList){
  pendingShowNavList = Array.isArray(navList) ? navList : null;
  rememberDetailOrigin();
  location.hash = `#/series/${showId}`;
}

// « Retour » d'une fiche film ou série (retour de Flix, 15/10 : un film
// ouvert depuis À voir ramenait au catalogue) : revient à la page d'où la
// fiche a été ouverte, à la même hauteur. L'origine tient tant qu'on va de
// fiche en fiche (flèches, films similaires) et s'oublie dès qu'on change
// de page autrement (renderRoute()). Lien direct ou F5 sur une fiche : pas
// d'origine, retour par défaut (catalogue ou liste des séries). Le
// catalogue, lui, repart toujours du haut (goHome(), voir resetHomeView()).
let detailOrigin = null; // { hash, scrollY } ou null
let pendingScrollRestore = null; // { hash, scrollY } ou null
function isDetailRoute(name){
  return name === 'filmDetail' || name === 'seriesDetail';
}
function rememberDetailOrigin(){
  if(isDetailRoute(parseRoute().name)) return;
  detailOrigin = { hash: location.hash || '', scrollY: window.scrollY || 0 };
}
function returnFromDetail(fallback){
  const origin = detailOrigin;
  detailOrigin = null;
  if(!origin){ fallback(); return; }
  if(origin.hash === '' || origin.hash === '#'){ goHome(); return; }
  pendingScrollRestore = { hash: origin.hash, scrollY: origin.scrollY };
  location.hash = origin.hash;
}
function goToUpcoming(){ location.hash = '#/prochainement'; }
function goToAmis(){ location.hash = '#/amis'; }
function goToTop(){ location.hash = '#/top'; }
// Page Profil (draft navigation, option B). Referme d'abord une rubrique
// affichée en page (Statistiques, Succès...) : déjà sur #/profil, le hash ne
// change pas et rien d'autre ne la fermerait.
function goToProfile(){
  if(typeof closeAsPageOverlays === 'function') closeAsPageOverlays();
  if(parseRoute().name !== 'profil') location.hash = '#/profil';
}
// Retour depuis une rubrique ouverte depuis la page Profil (Statistiques,
// Succès, Cartes, Journal, Paramètres...) : remplace l'ancien
// « rouvrir la modale Ton profil ».
function returnToProfile(){
  if(parseRoute().name !== 'profil') location.hash = '#/profil';
}
function goToPublicProfile(userId){ location.hash = `#/u/${userId}`; }
// Fiche film (v2.1) — voir js/filmDetail.js. Un changement de hash ne
// ferme jamais tout seul une modale déjà ouverte (profil d'ami...) : à
// chaque site d'appel de fermer la sienne avant de naviguer ici, sinon
// elle resterait visuellement par-dessus la nouvelle page.
// pendingFilmNavList : même principe que pendingShowNavList ci-dessus,
// pour les films — voir openFilmDetail(), js/filmDetail.js.
let pendingFilmNavList = null; // [{ tmdbId, title }] ou null
function goToFilmDetail(tmdbId, navList){
  pendingFilmNavList = Array.isArray(navList) ? navList : null;
  rememberDetailOrigin();
  location.hash = `#/film/${tmdbId}`;
}

function parseRoute(){
  const hash = location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/').filter(Boolean);
  if(parts[0] === 'watchlist' && parts.length === 1) return { name: 'watchlist' };
  if(parts[0] === 'series' && parts.length === 1) return { name: 'seriesList' };
  if(parts[0] === 'series' && parts.length === 2){
    const showId = parseInt(parts[1], 10);
    if(Number.isFinite(showId)) return { name: 'seriesDetail', showId };
    return { name: 'home' };
  }
  if(parts[0] === 'film' && parts.length === 2){
    const tmdbId = parseInt(parts[1], 10);
    if(Number.isFinite(tmdbId)) return { name: 'filmDetail', tmdbId };
    return { name: 'home' };
  }
  if(parts[0] === 'prochainement' && parts.length === 1) return { name: 'upcoming' };
  if(parts[0] === 'amis' && parts.length === 1) return { name: 'amis' };
  if(parts[0] === 'top' && parts.length === 1) return { name: 'top' };
  if(parts[0] === 'profil' && parts.length === 1) return { name: 'profil' };
  if(parts[0] === 'u' && parts.length === 2) return { name: 'publicProfile', userId: parts[1] };
  if(parts[0] === 'invite' && parts.length === 2) return { name: 'invite', token: parts[1] };
  if(parts[0] === 'listes'){
    if(parts.length === 1) return { name: 'listsList' };
    const listId = parseInt(parts[1], 10);
    if(parts.length === 2 && Number.isFinite(listId)) return { name: 'listDetail', listId };
    return { name: 'home' };
  }
  if(parts[0] !== 'groupes') return { name: 'home' };
  if(parts.length === 1) return { name: 'groupsList' };
  const groupId = parseInt(parts[1], 10);
  if(!Number.isFinite(groupId)) return { name: 'home' };
  if(parts.length === 2) return { name: 'groupDetail', groupId };
  if(parts.length === 4 && parts[2] === 'propositions'){
    const proposalId = parseInt(parts[3], 10);
    if(Number.isFinite(proposalId)) return { name: 'proposalDetail', groupId, proposalId };
  }
  return { name: 'home' };
}

// Appelé au hashchange et une fois après connexion (pour gérer un lien
// direct vers une page groupe/proposition, y compris après un F5).
async function renderRoute(){
  const route = parseRoute();
  // Origine d'une fiche oubliée dès qu'on change de page autrement que de
  // fiche en fiche ; hauteur à rétablir si on revient par « Retour ».
  if(!isDetailRoute(route.name)) detailOrigin = null;
  const restoreScrollY = (pendingScrollRestore && pendingScrollRestore.hash === location.hash) ? pendingScrollRestore.scrollY : null;
  pendingScrollRestore = null;
  // États actifs (onglets Films/Séries, barre mobile, entête) mis à jour
  // AVANT les pages à part ci-dessous : sinon le profil public gardait
  // l'onglet de la page précédente allumé (audit C6).
  if(currentUser){
    updatePrimaryTabs(route.name);
    updateMobileTabbar(route.name);
    updateHeaderNav(route.name);
  }
  // Seule page qui doit marcher sans session (voir le commentaire en haut
  // de ce fichier) — vérifiée avant le if(!currentUser) qui bloque tout le
  // reste, pour rester accessible qu'on soit connecté ou non.
  if(route.name === 'publicProfile'){
    // #authContainer n'est pas dans PAGE_IDS (showOnlyPage() ne le touche
    // jamais) : sur un premier chargement à froid il est déjà display:none
    // par défaut, donc invisible sans rien faire — mais si quelqu'un colle
    // ce lien dans la barre d'adresse d'un onglet déjà ouvert SANS session
    // (écran de connexion déjà affiché par showAuthScreen()), renderRoute()
    // tourne via hashchange sans jamais repasser par showAuthScreen()/
    // showApp(), et l'écran de connexion restait affiché par-dessus le
    // profil public — bug constaté en testant ce scénario précis. Masqué
    // explicitement ici, quel que soit l'état de départ.
    document.getElementById('authContainer').style.display = 'none';
    showOnlyPage('publicProfilePage');
    await renderPublicProfilePage(route.userId);
    return;
  }
  // #/invite/:token doit rester affichable qu'on soit connecté ou non
  // (renderInvitePage() gère les deux cas) — mais l'ARRIVÉE sur cette URL
  // sans session (lien ouvert dans un nouvel onglet, F5...) passe par
  // initAuth() (js/auth.js), pas par ici : ce cas ne couvre qu'une
  // navigation vers #/invite/:token depuis une session déjà active.
  if(route.name === 'invite'){
    // Même raisonnement que publicProfile juste au-dessus : ce chemin
    // tourne aussi sur un simple hashchange, pas seulement à froid.
    document.getElementById('authContainer').style.display = 'none';
    showOnlyPage('invitePage');
    await renderInvitePage(route.token);
    return;
  }
  if(!currentUser) return;
  if(route.name === 'home'){
    showOnlyPage('appContainer');
    // Repart de la page 1 à chaque vraie navigation vers le catalogue
    // (retour depuis une fiche film, logo/onglet Films cliqué depuis une
    // AUTRE page) — voir resetHomeView() plus haut pour le cas où on est
    // déjà sur le catalogue (hash inchangé, ce bloc ne tourne alors pas).
    // currentPage reste préservé pour un simple re-rendu SANS changement de
    // route (ex. cocher un favori, voir render() dans js/app.js).
    resetHomeView();
  }else if(route.name === 'watchlist'){
    showOnlyPage('watchlistPage');
    await openWatchlist();
  }else if(route.name === 'seriesList'){
    showOnlyPage('seriesPage');
    await openSeries();
  }else if(route.name === 'seriesDetail'){
    showOnlyPage('seriesDetailPage');
    await openShowDetail(route.showId);
  }else if(route.name === 'filmDetail'){
    showOnlyPage('filmDetailPage');
    await openFilmDetail(route.tmdbId);
  }else if(route.name === 'upcoming'){
    showOnlyPage('upcomingPage');
    await openUpcoming();
  }else if(route.name === 'amis'){
    showOnlyPage('amisPage');
    await openFriends();
  }else if(route.name === 'top'){
    showOnlyPage('topPage');
    await openTop();
  }else if(route.name === 'profil'){
    showOnlyPage('profilePage');
    await openProfilePage();
  }else if(route.name === 'groupsList'){
    showOnlyPage('groupsListPage');
    await openGroups();
  }else if(route.name === 'groupDetail'){
    showOnlyPage('groupDetailPage');
    await openGroupDetail(route.groupId);
  }else if(route.name === 'proposalDetail'){
    showOnlyPage('proposalDetailPage');
    await openProposalDetailRoute(route.groupId, route.proposalId);
  }else if(route.name === 'listsList'){
    showOnlyPage('listsPage');
    await openLists();
  }else if(route.name === 'listDetail'){
    showOnlyPage('listDetailPage');
    await openListDetail(route.listId);
  }
  if(restoreScrollY !== null) requestAnimationFrame(() => window.scrollTo(0, restoreScrollY));
}

window.addEventListener('hashchange', renderRoute);

// Titre "Critique de films" cliquable = retour à l'accueil en 1 clic depuis
// n'importe quelle page (le header est toujours visible hors modal — voir
// css .overlay qui les recouvre). div+role="link" plutôt que <button> car
// un <h1> n'est pas un contenu autorisé dans <button> (phrasing content).
//
// goHome() seul ne suffit pas ici : contrairement aux autres boutons
// "← Retour" de l'app (tous sur des pages qui exigent déjà une session),
// le logo reste cliquable sur #publicProfilePage/#invitePage, les deux
// seules pages accessibles SANS connexion (voir js/publicProfile.js,
// js/invites.js, qui ont déjà exactement cette même garde sur leur
// propre bouton retour). Sans ce garde-fou : `location.hash = ''` change
// bien l'URL mais renderRoute() s'arrête à `if(!currentUser) return;`
// sans rien afficher — la page reste figée sur l'ancien contenu, bug
// constaté en cliquant le logo depuis un profil public en étant
// déconnecté.
function goHomeOrAuth(){
  if(currentUser) goHome();
  else showAuthScreen();
}
const homeLinkEl = document.getElementById('homeLink');
homeLinkEl.addEventListener('click', goHomeOrAuth);
homeLinkEl.addEventListener('keydown', (e) => {
  if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); goHomeOrAuth(); }
});

// Lien d'évitement (#skipToContentLink, index.html — audit accessibilité) :
// une seule page de PAGE_IDS est visible à la fois (showOnlyPage()), pas
// d'id de "contenu" fixe à viser directement en <a href="#...">. On
// retrouve donc la page actuellement affichée au moment du clic plutôt
// qu'à la construction de la page (la route change sans recharger).
document.getElementById('skipToContentLink').addEventListener('click', (e) => {
  e.preventDefault();
  const visible = PAGE_IDS.map(id => document.getElementById(id)).find(el => el && el.style.display !== 'none');
  if(visible) visible.focus();
});
