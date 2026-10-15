// --- Authentification (lien magique par email, via Supabase Auth) ---
// L'app entière (toolbar + liste de films) est masquée tant qu'aucune
// session n'est active ; loadFilms()/render() ne tournent qu'une fois connecté.

let currentUser = null;

function showMaintenanceScreen(message){
  document.getElementById('authContainer').style.display = 'none';
  showOnlyPage(null); // masque appContainer + les pages Groupes (js/router.js)
  document.getElementById('userBar').style.display = 'none';
  document.getElementById('mobileTabbar').style.display = 'none';
  document.getElementById('primaryTabs').style.display = 'none';
  if(message) document.getElementById('maintenanceMessage').textContent = message;
  document.getElementById('maintenanceContainer').style.display = '';
}

// Lit le flag maintenance avant toute chose (voir supabase/migrations/010).
// Lecture publique (RLS "using (true)"), pas besoin d'être connecté.
// Échec de lecture (table absente, réseau...) = on n'affiche rien et l'app
// continue normalement plutôt que de bloquer tout le monde par accident.
async function checkMaintenance(){
  const { data, error } = await supabaseClient
    .from('site_status')
    .select('maintenance, message')
    .eq('id', 1)
    .maybeSingle();
  if(error || !data) return false;
  if(data.maintenance) showMaintenanceScreen(data.message);
  return !!data.maintenance;
}

function showAuthScreen(){
  document.getElementById('authContainer').style.display = '';
  // Toujours le formulaire en arrivant (après une déconnexion, pas l'écran
  // « Regarde tes mails » d'un envoi précédent).
  document.getElementById('authSent').hidden = true;
  document.getElementById('authForm').hidden = false;
  showOnlyPage(null); // masque appContainer + les pages Groupes (js/router.js)
  document.getElementById('userBar').style.display = 'none';
  document.getElementById('mobileTabbar').style.display = 'none';
  document.getElementById('primaryTabs').style.display = 'none';
  // Réorganisation de l'entête (js/ui.js) : jamais laisser le bandeau/mode
  // édition "collé" après une déconnexion — le prochain compte connecté
  // sur cet appareil ne doit pas hériter d'un mode resté actif par accident.
  exitHeaderEditMode();
  if(location.hash) location.hash = ''; // pas de page Groupes fantôme à la prochaine connexion
}

async function showApp(){
  document.getElementById('authContainer').style.display = 'none';
  document.getElementById('userBar').style.display = '';
  document.getElementById('mobileTabbar').style.display = '';
  document.getElementById('primaryTabs').style.display = '';
  // Chargement plus rapide au démarrage (retour utilisateur) : ces 4
  // requêtes sont indépendantes (profil, films, visionnages, écarts admin —
  // aucune ne lit ce qu'une autre écrit), les lancer en parallèle plutôt
  // qu'en séquence (l'ordre précédent, un aller-retour après l'autre) ne
  // fait payer, dans les faits, que le plus lent des quatre au lieu de leur
  // somme. Écarts admin (seuils/succès/happenings modifiés, voir
  // js/admin.js) : ne concernent que le compte propriétaire, chargés avant
  // render() pour que badges/succès reflètent tout de suite les éventuels
  // réglages.
  await Promise.all([
    loadOrCreateProfile(),
    loadFilms(),
    loadViewings(),
    isAdmin() ? loadAdminConfig() : Promise.resolve()
  ]);
  buildGenreFilterOptions(); // js/app.js — avant render(), pour que le select soit déjà rempli au 1er affichage
  render();
  await renderRoute(); // gère un lien direct vers une page Groupes (F5, etc.)
  // Après renderRoute() : un lien d'invitation ouvert sans session (voir
  // renderInvitePage(), js/invites.js) mémorise son token en localStorage
  // avant la connexion — on le consomme ici, une fois l'app pleinement
  // chargée, pour rejoindre le groupe et y rediriger.
  await consumePendingInviteIfAny();
  // Lien de carte (?carte=ID) : ouvre la carte demandée une fois l'app chargée.
  if(typeof openCardFromLinkIfAny === 'function') await openCardFromLinkIfAny();
  // Badge 👥 + digest de retour + rappel d'inactivité (js/activityState.js)
  // + Nouveautés (js/changelog.js) : jamais attendus, pour ne pas allonger
  // le chemin critique déjà chargé de 4-5 allers-retours — ils se posent
  // tout seuls une fois prêts. maybeShowInactivityReminder() est SYNCHRONE
  // (films est déjà chargé à ce stade, aucun aller-retour réseau propre à
  // elle) — appelée directement, sans le `.then`/pas d'await des deux autres.
  refreshActivityBadge();
  maybeShowDigest();
  maybeShowInactivityReminder();
  initChangelog();
  // Tuto d'accueil (js/onboarding.js) : APRÈS initChangelog() dans cet
  // ordre de lecture, mais la vraie garantie qu'ils ne s'empilent jamais
  // vit dans initChangelog() elle-même (elle ne s'auto-ouvre pas tant que
  // currentProfile.onboarding_seen est encore false) — currentProfile est
  // déjà chargé pour les deux au moment où l'un ou l'autre s'exécute, peu
  // importe l'ordre exact des deux appels.
  maybeStartOnboarding();
}

// Supabase revérifie/rafraîchit la session toute seule (notamment à chaque
// retour de l'onglet au premier plan, comportement de la librairie) et
// déclenche onAuthStateChange() à chaque fois, même quand c'est exactement
// le même compte déjà affiché — ça n'a rien d'une vraie (re)connexion.
// Sans ce garde-fou, showApp() (tout le chargement : profil, films,
// visionnages, + rejoue la page actuelle depuis zéro) tournait à chaque
// fois, d'où un flash visible sur toute page avec un état dépliable (ex.
// une saison de série) — retour utilisateur : "elle se ferme une toute
// petite seconde". Le jeton de session, lui, est déjà géré en interne par
// supabaseClient : currentUser n'a besoin que d'être à jour pour les
// requêtes qui filtrent par user_id, pas de recharger quoi que ce soit.
function handleSession(session){
  const user = session ? session.user : null;
  const memeCompteDejaAffiche = currentUser && user && currentUser.id === user.id;
  currentUser = user;
  if(user){
    if(!memeCompteDejaAffiche) showApp();
  }else{
    showAuthScreen();
  }
}

async function handleSendMagicLink(){
  const email = document.getElementById('authEmail').value.trim();
  const statusEl = document.getElementById('authStatus');
  if(!email || !email.includes('@')){
    statusEl.textContent = 'Entre ton email pour recevoir le lien.';
    return;
  }
  statusEl.textContent = 'Envoi en cours…';
  const error = await sendMagicLink(email);
  if(error){
    statusEl.textContent = `Erreur : ${error.message}`;
    return;
  }
  statusEl.textContent = '';
  showAuthSent(email);
}

function sendMagicLink(email){
  return supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href.split('#')[0].split('?')[0] }
  }).then(({ error }) => error || null);
}

// Écran « Regarde tes mails » (page de connexion, piste A du 15/10) : à la
// place du formulaire, avec « Renvoyer le lien » et « Changer d'email ».
function showAuthSent(email){
  document.getElementById('authSentEmail').textContent = email;
  document.getElementById('authForm').hidden = true;
  document.getElementById('authSent').hidden = false;
  document.getElementById('authResendBtn').textContent = 'Renvoyer le lien';
}

function showAuthForm(){
  document.getElementById('authSent').hidden = true;
  document.getElementById('authForm').hidden = false;
  document.getElementById('authEmail').focus();
}

async function handleResendMagicLink(){
  const btn = document.getElementById('authResendBtn');
  const email = document.getElementById('authSentEmail').textContent;
  btn.textContent = 'Envoi en cours…';
  const error = await sendMagicLink(email);
  btn.textContent = error ? 'Erreur, réessaie' : 'Lien renvoyé';
}

// Connexion Google (v2.1, retour utilisateur) — en plus du lien magique,
// pas à sa place : évite l'aller-retour par la boîte mail à chaque
// nouvel appareil. Redirige vers Google puis revient sur cette même page
// (emailRedirectTo réutilisé tel quel, même raisonnement que
// handleSendMagicLink() juste au-dessus) ; handleSession()/onAuthStateChange
// (voir plus bas) prennent le relais au retour, comme pour n'importe
// quelle autre connexion.
async function signInWithGoogle(){
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href.split('#')[0].split('?')[0] }
  });
  if(error){
    document.getElementById('authStatus').textContent = `Erreur : ${error.message}`;
  }
  // Pas de else : en cas de succès, le navigateur quitte déjà la page pour
  // Google avant même que ce code ne s'exécute plus loin.
}

async function handleLogout(){
  // Le bouton vit dans Paramètres (voir js/settings.js) — on referme les
  // deux modales (idempotent si l'une des deux est déjà fermée) avant de
  // couper la session, sinon l'une resterait ouverte par-dessus l'écran de
  // connexion.
  closeProfileModal();
  closeOverlay('settingsOverlay');
  await supabaseClient.auth.signOut();
}

document.getElementById('authSendBtn').addEventListener('click', handleSendMagicLink);
document.getElementById('authEmail').addEventListener('keydown', (e) => {
  if(e.key === 'Enter') handleSendMagicLink();
});
document.getElementById('googleSignInBtn').addEventListener('click', signInWithGoogle);
document.getElementById('authResendBtn').addEventListener('click', handleResendMagicLink);
document.getElementById('authChangeEmailBtn').addEventListener('click', showAuthForm);
document.getElementById('logoutBtn').addEventListener('click', handleLogout);

// Suppression de compte (décision validée, migration 053). Irréversible : on
// exige la saisie exacte de SUPPRIMER. Sans la migration appliquée, la fonction
// n'existe pas et on le dit, au lieu de faire comme si ça avait marché.
async function handleDeleteAccount(){
  if(blockIfOffline()) return;
  const saisie = prompt('Pour supprimer ton compte et toutes tes données, tape SUPPRIMER (en majuscules).');
  if(saisie !== 'SUPPRIMER'){
    if(saisie !== null) showToast("Suppression annulée : le mot exact n'a pas été tapé.");
    return;
  }
  const { error } = await supabaseClient.rpc('delete_my_account');
  if(error){
    showToast(/function .* does not exist|Could not find/i.test(error.message)
      ? "Suppression indisponible : la migration 053 n'est pas encore appliquée."
      : 'Erreur, réessaie');
    console.error(error);
    return;
  }
  closeProfileModal();
  closeOverlay('settingsOverlay');
  await supabaseClient.auth.signOut();
  showToast('Compte supprimé.');
}
document.getElementById('deleteAccountBtn').addEventListener('click', handleDeleteAccount);

// --- Mur d'affiches de la page de connexion (piste A du 15/10) ---
// Une sélection fixe de films connus (affiches françaises de TMDB), pas le
// catalogue de quelqu'un : la page est vue sans être connecté. 24 sur PC
// (6 colonnes), le CSS n'en montre que 12 sur téléphone.
const AUTH_WALL_POSTERS = [
  'k3uIbYtiuK8pwbCcbma29nTqmgG', '12TAqK0AUgdcYE9ZYZ9r7ASbH5Q', 'pyNXnq8QBWoK3b37RS6C3axwUOy', '7hLSzZX2jROmEXz2aEoh6JKUFy2',
  'aej3LRUga5rhgkmRP6XMFw3ejbl', 'sSQDxwm4r28YpJSQVyVOtpYVs0E', 'tdXtLG6L1QMwrv0MNdW6B9IwC8B', '1pnigkWWy8W032o9TKDneBa3eVK',
  '4TBdF7nFw2aKNM0gPOlDNq3v3se', 'tBzOqSc51CiUeOlxW2unvYVBU8v', '3XriEpTdnplQRzyphAC0cu3emns', '45PVXJUYfH6yIINcQKelQ0SJPvh',
  'pEoqbqtLc4CcwDUDqxmEDSWpWTZ', 'oLy2V6AWSEfdPgKOtrSGnwB3Q2R', 'qpyaW4xUPeIiYA5ckg5zAZFHvsb', 'iCgFtDUZxN8iUzNBCisjUrBmg2q',
  'zi6RNYK1vXjIvpSBgjatXRcFYh2', 'v4c6WMVqUlSJHMyjHNj72iTFGhm', 'mSgYBWMybY9Ug4ZnCGsttPIjUx7', 'boAUuJBeID7VNp4L7LNMQs8mfQS',
  'ywJsnH7BmM6GmugCvN6ZjIfgSHv', 'u0Ct3708zXaoJCkF65bLfenQmhM', 'zHKWxyG4j404HVeSYHNH4niUpkW', 't30GjttOdb5At1sYy8b3TOwFgWV'
];
(function setupAuthWall(){
  const wall = document.getElementById('authWall');
  if(!wall) return;
  wall.innerHTML = AUTH_WALL_POSTERS
    .map(path => `<img src="https://image.tmdb.org/t/p/w185/${path}.jpg" alt="" decoding="async">`)
    .join('');
})();

(async function initAuth(){
  buildSortOptions();
  // Lien de profil public (#/u/:userId) : doit s'afficher même sans compte,
  // donc avant tout le reste — ni maintenance, ni session Supabase à
  // vérifier pour une simple page en lecture seule. Un F5 ou un lien direct
  // sur cette URL ne passe pas par hashchange (voir js/router.js), d'où ce
  // rendu explicite ici.
  if(parseRoute().name === 'publicProfile'){ await renderRoute(); return; }
  // #/invite/:token doit aussi rester accessible SANS session (aperçu +
  // "Se connecter"), et surtout SURVIVRE à showAuthScreen() qui viderait le
  // hash (location.hash = '') si on laissait le flux normal gérer une
  // session absente — donc traité à part, avant checkMaintenance(), comme
  // publicProfile juste au-dessus.
  if(parseRoute().name === 'invite'){
    const { data: { session } } = await supabaseClient.auth.getSession();
    currentUser = session ? session.user : null;
    if(currentUser){
      // Connecté : le flux normal (showApp -> renderRoute) affiche la page
      // d'invitation comme n'importe quelle autre route, avec un vrai
      // bouton "Rejoindre" plutôt qu'une adhésion automatique au chargement.
      handleSession(session);
    }else{
      showOnlyPage('invitePage');
      await renderInvitePage(parseRoute().token);
    }
    supabaseClient.auth.onAuthStateChange((_event, s) => handleSession(s));
    return;
  }
  if(await checkMaintenance()) return; // stoppe tout : pas de session, pas de films chargés
  const { data: { session } } = await supabaseClient.auth.getSession();
  handleSession(session);
  supabaseClient.auth.onAuthStateChange((_event, session) => handleSession(session));
})();
