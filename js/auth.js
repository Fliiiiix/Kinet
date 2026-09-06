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
  showOnlyPage(null); // masque appContainer + les pages Groupes (js/router.js)
  document.getElementById('userBar').style.display = 'none';
  document.getElementById('mobileTabbar').style.display = 'none';
  document.getElementById('primaryTabs').style.display = 'none';
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
  // Badge 👥 + digest de retour (js/activityState.js) + Nouveautés
  // (js/changelog.js) : jamais attendus, pour ne pas allonger le chemin
  // critique déjà chargé de 4-5 allers-retours — ils se posent tout seuls
  // une fois prêts.
  refreshActivityBadge();
  maybeShowDigest();
  initChangelog();
}

function handleSession(session){
  currentUser = session ? session.user : null;
  if(currentUser){
    showApp();
  }else{
    showAuthScreen();
  }
}

async function handleSendMagicLink(){
  const email = document.getElementById('authEmail').value.trim();
  const statusEl = document.getElementById('authStatus');
  if(!email){
    statusEl.textContent = 'Entre un email valide.';
    return;
  }
  statusEl.textContent = 'Envoi en cours…';
  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href.split('#')[0].split('?')[0] }
  });
  statusEl.textContent = error
    ? `Erreur : ${error.message}`
    : `Lien envoyé à ${email}, vérifie ta boîte mail (et les spams).`;
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
  // Le bouton vit maintenant dans la modale profil (voir js/profile.js) —
  // on la referme avant de couper la session, sinon elle resterait ouverte
  // par-dessus l'écran de connexion.
  closeProfileModal();
  await supabaseClient.auth.signOut();
}

document.getElementById('authSendBtn').addEventListener('click', handleSendMagicLink);
document.getElementById('authEmail').addEventListener('keydown', (e) => {
  if(e.key === 'Enter') handleSendMagicLink();
});
document.getElementById('googleSignInBtn').addEventListener('click', signInWithGoogle);
document.getElementById('logoutBtn').addEventListener('click', handleLogout);

// --- Démo jouable de la grille (v2.0.16) ---
// Signature element de l'écran de connexion (voir index.html pour le
// diagnostic complet) : 7 curseurs générés depuis CRITERIA (js/data.js —
// la même source que le vrai formulaire de notation, js/app.js), avec la
// note recalculée en direct via computeNote()/noteColorClass() — les
// MÊMES fonctions que le catalogue, pas une simulation à part réécrite
// ici. Remplace setupAuthTagPanel()/#authTags/#authShowcasePanel
// (v2.0.12-v2.0.13, supprimés).
(function setupAuthDemo(){
  const wrap = document.getElementById('authDemoSliders');
  const counterEl = document.getElementById('authDemoCounter');
  if(!wrap || !counterEl) return; // page publique/invite : pas de démo ici
  const values = {};
  CRITERIA.forEach(c => {
    values[c.key] = 0.5; // point de départ neutre, au milieu de l'échelle
    const row = document.createElement('div');
    row.className = 'auth-demo-row';
    // step="0.1" (retour utilisateur : step="0.5" ne donnait que 3
    // positions possibles par curseur — 0/0.5/1, "un peu bizarre") plutôt
    // que le step="0.05" du vrai formulaire (js/app.js) : assez fin pour
    // ne plus sauter par paliers grossiers, sans les 20 crans du vrai
    // formulaire, hors de propos pour une démo qu'on manipule 2 secondes.
    row.innerHTML = `
      <span class="auth-demo-label">${escapeHtml(c.label)}</span>
      <input type="range" min="0" max="1" step="0.1" value="0.5" data-key="${c.key}" aria-label="${escapeHtml(c.label)}">
    `;
    wrap.appendChild(row);
  });
  function updateCounter(){
    const note = computeNote(values);
    counterEl.textContent = note.toFixed(1);
    counterEl.className = 'counter auth-demo-counter ' + noteColorClass(note);
  }
  wrap.querySelectorAll('input[type="range"]').forEach(input => {
    input.addEventListener('input', () => {
      values[input.dataset.key] = parseFloat(input.value);
      updateCounter();
    });
  });
  updateCounter();
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
