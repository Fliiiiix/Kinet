// --- Ouverture/fermeture partagée des modales (.overlay > .modal) ---
// Les fenêtres de l'app (édition de film, profil, stats, succès, admin,
// journal, profil d'ami, feedback) suivaient chacune le même schéma sans
// rien partager : classList.add/remove('open'), fermeture instantanée. Ouvrir
// avait déjà une animation (overlayIn/modalIn, voir css/style.css) mais
// fermer non — ce module ajoute une fermeture symétrique (overlayOut/
// modalOut) tout en laissant chaque close*() responsable de ses propres
// à-côtés (ex. closeModal() doit toujours faire editingId = null), via le
// paramètre extraCleanup plutôt que de dupliquer cette logique partout.
//
// Animation de fermeture = autonome une fois lancée par le clic (comme
// l'ouverture, la transition de page, le couloir Old Boy) : elle garde
// donc l'exception prefers-reduced-motion déjà en place pour ces cas-là —
// contrairement au pulse étoile/sauvegarde plus bas, piloté en direct par
// le clic et qui n'a jamais cette exception (même règle que le reste de la
// session).

const OVERLAY_CLOSE_MS = 200; // > durée de overlayOut/modalOut (150ms), filet de sécurité si animationend ne se déclenche pas

// --- Focus clavier (accessibilité) ---
// Aucune des 7 modales ne déplaçait le focus à l'ouverture (sauf
// openModal(), qui pointe explicitement sur #titleInput après avoir
// appelé openOverlay() — cet appel plus spécifique gagne simplement en
// s'exécutant après) ni ne le restaurait à la fermeture : un utilisateur
// au clavier/lecteur d'écran restait "perdu" derrière l'overlay, ou son
// focus atterrissait sur un bouton masqué (display:none) une fois la
// modale refermée. overlayReturnFocus retient, PAR modale, l'élément à
// refocaliser à la fermeture — pas une seule variable partagée, sinon
// closeProfileModal() → openAchievements() (voir js/achievements.js)
// écraserait la cible de la première avant que son délai de fermeture ne
// se déclenche, et volerait le focus à la modale ouverte par-dessus.
const overlayReturnFocus = {};

// --- Verrou de défilement du fond (retour utilisateur : "pendant le tuto
// je peux quand même scroll vers le bas, ça n'a pas de sens") — un voile
// plein écran en position:fixed n'empêche PAS nativement un balayage
// tactile de faire défiler la page EN DESSOUS sur mobile : il n'y a rien à
// faire défiler DANS le voile lui-même (pas plus grand que l'écran), le
// geste remonte donc naturellement au prochain conteneur défilable trouvé,
// html/body. Compteur plutôt qu'un simple booléen : deux voiles peuvent se
// chevaucher un court instant (ex. fermeture du tuto pendant qu'une autre
// modale finit de s'ouvrir) — ne déverrouiller qu'une fois le DERNIER
// refermé, jamais dès le premier.
let scrollLockCount = 0;
function lockBodyScroll(){
  scrollLockCount++;
  document.documentElement.classList.add('scroll-locked');
}
function unlockBodyScroll(){
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if(scrollLockCount === 0) document.documentElement.classList.remove('scroll-locked');
}

function openOverlay(id){
  const el = document.getElementById(id);
  overlayReturnFocus[id] = document.activeElement;
  el.classList.remove('closing'); // une fermeture pouvait être en cours
  el.classList.add('open');
  lockBodyScroll();
  const modal = el.querySelector('.modal');
  const focusable = modal && modal.querySelector(
    'input, textarea, select, button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  );
  if(focusable) focusable.focus({ preventScroll: true });
}

function closeOverlay(id, extraCleanup){
  const el = document.getElementById(id);
  if(!el.classList.contains('open')){
    // Déjà fermée (ex. deux gestionnaires de clic sur le même bouton) :
    // extraCleanup tourne quand même, closeModal()-like doit rester
    // idempotent.
    if(extraCleanup) extraCleanup();
    return;
  }
  el.classList.remove('open');
  unlockBodyScroll();
  const restoreFocus = () => {
    const target = overlayReturnFocus[id];
    delete overlayReturnFocus[id];
    // offsetParent === null : élément caché (display:none, une autre
    // modale ouverte par-dessus l'a fermé entre-temps) — rien à faire.
    // document.querySelector('.overlay.open') : une AUTRE modale s'est
    // ouverte pendant que celle-ci se refermait (cf. commentaire plus
    // haut) — ne pas lui voler le focus.
    if(target && document.contains(target) && target.offsetParent !== null && !document.querySelector('.overlay.open')){
      target.focus({ preventScroll: true });
    }
  };
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    restoreFocus();
    if(extraCleanup) extraCleanup();
    return;
  }
  el.classList.add('closing');
  let done = false;
  const finish = () => {
    if(done) return;
    done = true;
    el.removeEventListener('animationend', finish);
    el.classList.remove('closing');
    restoreFocus();
    if(extraCleanup) extraCleanup();
  };
  el.addEventListener('animationend', finish);
  setTimeout(finish, OVERLAY_CLOSE_MS);
}

// Échap ferme la modale ouverte, gestionnaire unique plutôt qu'un par
// modale — cohérent avec l'ouverture/fermeture déjà centralisées ici.
// Construit la table à chaque appui plutôt qu'une fois au chargement : les
// close*() référencés ne sont pas encore déclarés quand ce fichier
// s'exécute (il est chargé avant app.js/profile.js/etc., voir index.html)
// — seule leur résolution AU MOMENT du keydown, bien après le chargement
// complet, est sûre.
document.addEventListener('keydown', (e) => {
  if(e.key !== 'Escape') return;
  // Les petits menus flottants passent avant les modales : Échap referme
  // d'abord ce qui est au premier plan.
  if(typeof closeRowMenu === 'function' && closeRowMenu()) return;
  const filters = document.getElementById('toolbarFilters');
  if(filters && filters.classList.contains('open') && typeof closeToolbarFilters === 'function'){
    closeToolbarFilters();
    return;
  }
  const closers = {
    overlay: () => closeModal(),
    profileOverlay: () => closeProfileModal(),
    statsOverlay: () => closeStats(),
    achievementsOverlay: () => closeAchievements(),
    adminOverlay: () => closeAdminModal(),
    journalOverlay: () => closeJournal(),
    friendProfileOverlay: () => closeFriendProfile(),
    feedbackOverlay: () => closeFeedbackModal(),
    shareOverlay: () => closeShareModal(),
    importLetterboxdTutoOverlay: () => closeOverlay('importLetterboxdTutoOverlay'),
    surpriseOverlay: () => closeOverlay('surpriseOverlay'),
    // Ajoutée après coup (audit clavier) : le bilan cinéphile n'avait
    // jamais rejoint cette table au moment de son ajout.
    recapOverlay: () => closeRecap(),
    settingsOverlay: () => closeSettingsModal(),
    tcgOverlay: () => closeTcgModal(),
    // Même garde que le clic sur le fond (js/tcg.js) : Échap ne doit pas
    // couper la révélation en cours, seulement refermer une fois les 5
    // cartes retournées (bouton "Génial !" visible).
    tcgBoosterOverlay: () => {
      if(document.getElementById('tcgBoosterDoneBtn').style.display !== 'none'){
        closeOverlay('tcgBoosterOverlay');
        loadTcgCollection().then(renderTcgCollection);
      }
    },
    chatbotOverlay: () => closeChatbotModal(),
    // Tuto d'accueil (js/onboarding.js) : pas un .overlay (voile+carte
    // construits à part, voir css/style.css) mais même convention de
    // classe "open" sur son conteneur, pour rejoindre cette table sans
    // logique séparée. skipOnboarding() est idempotent (comme les autres
    // close*() ici) : ne fait rien si le tuto n'est pas ouvert.
    onboardingLayer: () => skipOnboarding()
  };
  for(const id in closers){
    if(document.getElementById(id).classList.contains('open')){
      closers[id]();
      return; // une seule à la fois : les modales ne s'empilent jamais dans cette app
    }
  }
  // Happenings (easter eggs, js/happenings.js) : chaque modale est créée à
  // la volée (document.body.appendChild(overlay)) sans id fixe, donc absente
  // de la table ci-dessus — jamais rejointe par l'audit clavier d'origine,
  // Échap n'y faisait donc rien jusqu'ici. Repli générique plutôt qu'une
  // entrée par happening (une douzaine, et ça grandit) : si la boucle
  // au-dessus n'a rien trouvé, la seule .overlay.open qui puisse encore
  // traîner est forcément une modale de happening (.happening-modal, classe
  // exclusive à js/happenings.js) — pas besoin de la distinguer plus que ça.
  // Retrait direct (pas de closeOverlay()) : les happenings ferment déjà
  // ainsi au clic sur le voile/✕, jamais avec l'animation de sortie
  // overlayOut/modalOut réservée aux modales "officielles" de l'app.
  const happeningOverlay = document.querySelector('.overlay.open');
  if(happeningOverlay) happeningOverlay.remove();
});

// --- Molette pour affiner un curseur de note ---
// Retour utilisateur : le drag à la souris manque de précision pour poser
// une valeur exacte, et sur tactile un scroll de page dont le doigt
// traversait une barre de notation la faisait changer par erreur (déjà
// réglé au doigt via touch-action:pan-y sur input[type="range"], voir
// css/style.css). Même risque à la souris avec la molette :
// sans garde-fou, un simple scroll de PAGE dont le curseur croise une
// barre de notation la ferait changer sans le vouloir. Double condition
// donc, pas une seule : la molette doit être SUR la barre (e.target)
// ET cette barre doit déjà avoir le focus (cliquée ou atteinte au clavier
// juste avant) — un simple survol pendant qu'on scrolle la page ne suffit
// jamais à déclencher un changement.
document.addEventListener('wheel', (e) => {
  const input = e.target.closest('input[type="range"]');
  if(!input || document.activeElement !== input) return;
  e.preventDefault();
  const step = parseFloat(input.step) || 1;
  const min = parseFloat(input.min);
  const max = parseFloat(input.max);
  const dir = e.deltaY < 0 ? 1 : -1; // molette vers le haut = augmente, comme un volume
  let next = parseFloat(input.value) + dir * step;
  next = Math.min(max, Math.max(min, next));
  // toFixed() plutôt que la valeur brute : 0.1 + 0.2 en JS donne
  // 0.30000000000000004, ce qui casserait le prochain calcul de pas
  // (0.30000000000000004 + 0.1 dérive encore plus) au fil des crans.
  const decimals = (String(step).split('.')[1] || '').length;
  input.value = next.toFixed(decimals);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}, { passive: false });

// --- Micro-interactions ponctuelles (étoile favori, sauvegarde) ---
// Pilotées en direct par un clic (pas autonomes/en boucle) : PAS
// d'exception prefers-reduced-motion, voir starPulse/savePulse dans
// css/style.css.
// Confettis au 5/5 (retour utilisateur : une petite célébration pour les coups
// de cœur). Une couche jetable : des pastilles animées en CSS, retirées à la
// fin. Rien n'est créé si le mouvement est réduit.
const CONFETTI_COULEURS = ['#8c7cff', '#e7b24c', '#6fa39f', '#ff6b57'];
function celebrateConfetti(){
  if(motionReduced()) return;
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  layer.setAttribute('aria-hidden', 'true');
  for(let i = 0; i < 36; i++){
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.left = (Math.random() * 100) + '%';
    piece.style.background = CONFETTI_COULEURS[i % CONFETTI_COULEURS.length];
    piece.style.animationDelay = (Math.random() * 0.25) + 's';
    piece.style.animationDuration = (1.3 + Math.random() * 0.7) + 's';
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 2200);
}

// Compteurs animés (tuiles de statistiques) : chaque valeur numérique monte
// de 0 à sa valeur en quelques centaines de ms. Les textes non numériques
// (« — », libellés) sont laissés tels quels. Mouvement réduit : valeur finale
// directement.
function animateCounters(root, dureeMs = 700){
  if(!root) return;
  const els = root.querySelectorAll('.stat-value');
  const reduced = motionReduced();
  els.forEach(el => {
    const texte = el.textContent.trim();
    const cible = Number(texte.replace(',', '.'));
    if(!/^-?\d+([.,]\d+)?$/.test(texte) || Number.isNaN(cible) || reduced) return;
    const decimales = (texte.split(/[.,]/)[1] || '').length;
    const debut = performance.now();
    const pas = (now) => {
      const t = Math.min(1, (now - debut) / dureeMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubique : ralentit à la fin
      el.textContent = (cible * eased).toFixed(decimales);
      if(t < 1) requestAnimationFrame(pas);
      else el.textContent = texte;
    };
    requestAnimationFrame(pas);
  });
}

function pulseElement(el){
  if(!el) return;
  el.classList.remove('pulse');
  // Force un reflow pour rejouer l'animation si pulse() est appelé deux
  // fois de suite très vite (ex. double favori/défavori rapide) — sans ça
  // la 2e classList.add('pulse') ne redéclenche rien puisque la classe est
  // déjà présente.
  void el.offsetWidth;
  el.classList.add('pulse');
  el.addEventListener('animationend', () => el.classList.remove('pulse'), { once: true });
}

// pulseCheckbox() : même principe que pulseElement() ci-dessus (rejoue
// checkbox-pop, css/style.css), réservé aux cases à cocher — déclenché EN
// MÊME TEMPS que le clic, pas après la réponse réseau, pour un retour
// instantané (voir toggleEpisodeWatched(), js/series.js, qui reconstruit
// ensuite toute la ligne : sans ce coup de pouce immédiat, la case
// réapparaîtrait déjà cochée, sans jamais avoir eu l'air de s'animer).
function pulseCheckbox(el){
  if(!el) return;
  el.classList.remove('checkbox-pop');
  void el.offsetWidth;
  el.classList.add('checkbox-pop');
  el.addEventListener('animationend', () => el.classList.remove('checkbox-pop'), { once: true });
}

// --- Bascule grille / liste (catalogue, watchlist, séries, top) ---
// Une seule préférence partagée par toutes les listes à affiches plutôt
// qu'un réglage par page — si quelqu'un préfère scanner en grille ou en
// liste compacte, c'est vrai partout où il y a des affiches, pas juste sur
// le catalogue. Stockée en localStorage (préférence d'affichage pure, pas
// une donnée à synchroniser entre appareils, contrairement à ce que gère
// js/offline.js). Portée par un attribut sur <body> plutôt qu'une classe
// par conteneur de liste : chaque page qui a une liste à affiches (voir
// les sélecteurs body[data-view-mode="list"] #filmList, #wlList, #topList,
// #seriesList dans css/style.css) réagit sans qu'aucune fonction de rendu
// n'ait à connaître ce réglage.
function getViewMode(){
  return localStorage.getItem('kinetViewMode') === 'list' ? 'list' : 'grid';
}

function setViewMode(mode){
  document.body.dataset.viewMode = mode;
  localStorage.setItem('kinetViewMode', mode);
  document.querySelectorAll('[data-view-btn]').forEach(btn => {
    const active = btn.dataset.viewBtn === mode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

// setViewMode() plutôt qu'une simple lecture : synchronise aussi la classe
// is-active/aria-pressed des boutons déjà présents dans le HTML statique de
// chaque page (tous existent dans le DOM dès le chargement, même les pages
// masquées par display:none — voir js/router.js) avec la préférence
// mémorisée, pas seulement l'attribut sur <body>.
setViewMode(getViewMode());

// Délégué au document plutôt qu'un listener par bouton : la bascule
// apparaît sur plusieurs pages (catalogue, watchlist, top, séries), toutes
// avec le même markup `[data-view-btn]="grid|list"` — un seul gestionnaire
// couvre les boutons déjà présents au chargement ET ceux qu'une page ajoute
// plus tard à son propre rythme.
// Dans la pilule de recherche (catalogue, séries : draft navigation option
// B), la bascule n'est plus qu'UNE icône, celle du mode affiché (l'autre
// bouton est masqué en CSS) : un clic dessus passe à l'autre mode.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view-btn]');
  if(!btn) return;
  const single = btn.closest('.toolbar-search');
  if(single && btn.classList.contains('is-active')){
    setViewMode(btn.dataset.viewBtn === 'grid' ? 'list' : 'grid');
    // Le bouton cliqué vient d'être masqué : le focus passe à son jumeau.
    const twin = single.querySelector('.view-toggle-btn.is-active');
    if(twin && document.activeElement === btn) twin.focus();
    return;
  }
  setViewMode(btn.dataset.viewBtn);
});

// --- Thème clair en option (retour utilisateur) --- Sombre par défaut
// (toute l'app est conçue dans ce sens depuis la refonte v2.0) — même
// principe que kinetViewMode ci-dessus : préférence PAR APPAREIL, jamais
// synchronisée à Supabase (un simple réglage d'affichage, pas une donnée à
// partager entre appareils). try/catch (contrairement à getViewMode() plus
// haut, un choix plus ancien non repris ici) : un thème qui ne persiste
// pas d'une session à l'autre en navigation privée est un inconvénient
// mineur, une exception qui empêcherait l'app de démarrer ne le serait pas.
function getTheme(){
  try{ return localStorage.getItem('kinetTheme') === 'light' ? 'light' : 'dark'; }
  catch(e){ return 'dark'; }
}

// Couleurs de <meta name="theme-color"> (barre de statut/chrome du
// navigateur) pour chaque thème — doivent matcher --ink/--surface (voir
// css/style.css), la couleur tout en haut de la page, pas une couleur de
// marque. Audit design (skill mobile-native) : le thème de Kinet est un
// choix manuel en appareil (pas prefers-color-scheme), donc une seule
// balise <meta> statique ne suivait jamais le bouton clair/sombre — figée
// sur le sombre même une fois passé en thème clair.
const THEME_COLOR = { dark: '#0f0e16', light: '#fbfaff' };

function setTheme(theme){
  document.documentElement.dataset.theme = theme;
  try{ localStorage.setItem('kinetTheme', theme); }catch(e){}
  const toggle = document.getElementById('lightThemeToggle');
  if(toggle) toggle.checked = theme === 'light';
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if(themeColorMeta) themeColorMeta.setAttribute('content', THEME_COLOR[theme] || THEME_COLOR.dark);
}

setTheme(getTheme());

// --- Réduire les animations (retour utilisateur, Paramètres, proposition
// validée sur draft) --- Même principe que getTheme()/setTheme()
// ci-dessus : préférence PAR APPAREIL (localStorage), jamais synchronisée
// à Supabase. S'ajoute au réglage système déjà respecté partout ailleurs
// (prefers-reduced-motion) — coupe tout via une seule règle CSS globale
// (html.reduce-motion, voir css/style.css) plutôt que de dupliquer chacune
// des règles @media (prefers-reduced-motion:reduce) déjà écrites dans ce
// fichier pour le réglage système : les deux mènent au même résultat par
// des chemins différents, sans avoir à maintenir la logique à deux endroits.
function getReduceMotion(){
  try{ return localStorage.getItem('kinetReduceMotion') === '1'; }
  catch(e){ return false; }
}

// Vrai si les animations doivent être réduites, PAR CE RÉGLAGE OU PAR CELUI
// DU SYSTÈME — bug retour utilisateur ("le bouton réduire les animations...
// je crois qu'il ne fait rien") : le mark de l'entête, les boutons
// "magnétiques" et l'inclinaison des lignes au survol (plus bas dans ce
// fichier) ne regardaient QUE prefers-reduced-motion, jamais ce réglage
// (getReduceMotion()) — et seulement UNE FOIS au chargement du script, donc
// même en le corrigeant naïvement, activer le réglage APRÈS coup (sans
// recharger la page) n'aurait rien changé. Appelée à chaque interaction
// (pas juste au chargement) dans les 3 blocs concernés, pour un effet
// immédiat dès qu'on bascule le réglage, sans recharger.
function motionReduced(){
  return getReduceMotion() || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function setReduceMotion(on){
  document.documentElement.classList.toggle('reduce-motion', on);
  try{ localStorage.setItem('kinetReduceMotion', on ? '1' : '0'); }catch(e){}
  const toggle = document.getElementById('reduceMotionToggle');
  if(toggle) toggle.checked = on;
}

setReduceMotion(getReduceMotion());

document.getElementById('reduceMotionToggle').addEventListener('change', (e) => {
  setReduceMotion(e.target.checked);
});

document.getElementById('lightThemeToggle').addEventListener('change', (e) => {
  setTheme(e.target.checked ? 'light' : 'dark');
});

// --- Personnaliser l'ordre des icônes de l'entête (retour utilisateur) ---
// Même principe que kinetViewMode/kinetTheme ci-dessus : préférence PAR
// APPAREIL (localStorage). installHeaderBtn (PWA, affiché seulement quand
// pertinent — voir js/pwa.js) exclu délibérément : un bouton dont la
// présence même est déjà conditionnelle n'a rien à faire dans un ordre à
// mémoriser (il resterait où il est déjà dans le DOM, jamais déplacé par
// applyHeaderNavOrder() ci-dessous, qui ne touche que les ids listés ici).
// v3.2 (retour utilisateur : "dans l'entête droite je veux me débarasser
// de la loupe, de l'avis et de l'annonce" — trop d'icônes, l'entête ne
// respire pas) — Rechercher/Avis/Nouveautés retirés de cette liste ET du
// DOM de .header-nav (voir index.html, #feedbackBtn/#changelogBtn
// masqués ; Rechercher est devenu la recherche du catalogue, audit M2) :
// seuls les 4 vrais liens de page restent réordonnables ici.
// Avis/Nouveautés vivent désormais dans la modale profil (.mm-row), déjà
// le seul chemin sur mobile pour
// Avis/Nouveautés avant ce changement — juste rendu permanent aussi sur
// desktop plutôt que réservé au seuil mobile.
const HEADER_NAV_DEFAULT_ORDER = ['watchlistBtn', 'upcomingBtn', 'friendsBtn', 'topBtn'];

function getHeaderNavOrder(){
  let saved = null;
  try{ saved = JSON.parse(localStorage.getItem('kinetHeaderOrder') || 'null'); }catch(e){}
  if(!Array.isArray(saved)) return HEADER_NAV_DEFAULT_ORDER.slice();
  // Filtre les ids obsolètes (une sauvegarde plus ancienne peut référencer
  // un bouton depuis retiré) et rajoute à la fin ceux qu'elle ne connaît
  // pas encore (un bouton ajouté après coup) — jamais un bouton qui
  // disparaît silencieusement d'une préférence enregistrée avant lui.
  const valid = saved.filter(id => HEADER_NAV_DEFAULT_ORDER.includes(id));
  const missing = HEADER_NAV_DEFAULT_ORDER.filter(id => !valid.includes(id));
  return valid.concat(missing);
}

// appendChild() DÉPLACE un élément déjà dans le DOM (ne le clone pas) —
// réordonne donc les boutons existants sans perdre leurs listeners déjà
// posés par chaque fichier propriétaire (js/watchlist.js, js/friends.js,
// etc.), aucun n'a besoin de savoir que cet ordre existe.
function applyHeaderNavOrder(){
  const nav = document.querySelector('.header-nav');
  if(!nav) return;
  getHeaderNavOrder().forEach(id => {
    const btn = document.getElementById(id);
    if(btn) nav.appendChild(btn);
  });
}

function saveHeaderNavOrder(order){
  try{ localStorage.setItem('kinetHeaderOrder', JSON.stringify(order)); }catch(e){}
  applyHeaderNavOrder();
}

// --- Édition EN PLACE de l'entête (retour utilisateur : "si on clique
// dessus on revient sur la page d'accueil sauf que cette fois on peut
// modifier les icones", avec un indicateur pour comprendre qu'il faut les
// sélectionner/déplacer) — plus de liste séparée qui duplique les icônes
// (ancienne #headerOrderOverlay) : le glisser-déposer agit directement sur
// les VRAIS .header-nav-btn déjà visibles. Pointer Events plutôt que l'API
// HTML5 Drag and Drop (draggable="true") — celle-ci ne fonctionne pas au
// toucher sans polyfill, alors que pointerdown/move/up couvrent souris ET
// tactile avec le même code, cohérent avec le reste de l'app.
let headerEditMode = false;

// Accessible depuis "Ton profil" → Paramètres (#openHeaderOrderBtn) —
// ferme le profil ET ramène sur l'accueil (demande explicite : un contexte
// propre pour éditer, pas par-dessus une page de contenu quelconque).
// .edit-mode (css/style.css) fait trembler les icônes — c'est l'indicateur
// lui-même, pas juste une classe technique.
function enterHeaderEditMode(){
  // Vit dans Paramètres (#settingsOverlay), pas directement dans "Ton
  // profil" — les deux closeOverlay() sont idempotents (aucun effet si
  // déjà fermée), fermer les deux inconditionnellement évite de dépendre
  // de LAQUELLE des deux était ouverte au moment du clic. Pas
  // closeSettingsModal() : elle rouvrirait "Ton profil" juste après, alors
  // qu'on part vers l'accueil pour de bon.
  closeProfileModal();
  closeOverlay('settingsOverlay');
  goHome();
  headerEditMode = true;
  const nav = document.querySelector('.header-nav');
  if(nav) nav.classList.add('edit-mode');
  const banner = document.getElementById('headerEditBanner');
  if(banner) banner.style.display = '';
}

function exitHeaderEditMode(){
  headerEditMode = false;
  const nav = document.querySelector('.header-nav');
  if(nav) nav.classList.remove('edit-mode');
  const banner = document.getElementById('headerEditBanner');
  if(banner) banner.style.display = 'none';
}

// Technique "liste triable" déjà utilisée ailleurs dans l'app, mais
// géométrie HORIZONTALE (une rangée d'icônes, pas une liste verticale) :
// clientX comparé au milieu (rect.left + width/2) de chaque voisin plutôt
// que clientY. L'ORDRE FINAL est relu directement depuis le DOM au
// relâchement, pas depuis un état séparé à garder synchronisé.
// installHeaderBtn (PWA, affiché seulement quand pertinent) exclu des
// voisins ET jamais lui-même déplaçable — un bouton dont la présence même
// est déjà conditionnelle n'a rien à faire dans un ordre à mémoriser (même
// exclusion que HEADER_NAV_DEFAULT_ORDER) ; il reste cliquable normalement
// pendant l'édition, voir le bloqueur de clic plus bas.
//
// "Ghost" (retour utilisateur — "je dois pouvoir une fois prise la
// déplacer librement", sans lui l'icône ne bougeait qu'au moment de
// franchir le milieu d'un voisin, "l'impression de forcer") : un clone
// visuel en position:fixed qui suit le pointeur au pixel près (translate
// relatif au point de départ). Le VRAI bouton reste dans le flux — rendu
// quasi invisible par .dragging — pour continuer à porter le
// réordonnancement (insertBefore/appendChild) sans lui-même bouger à
// l'écran ; seul le ghost, purement décoratif (aria-hidden, id retiré pour
// ne jamais dupliquer un id dans le DOM), donne l'impression de tenir
// l'icône en main.
function wireHeaderNavDrag(){
  const nav = document.querySelector('.header-nav');
  if(!nav) return;
  let draggedEl = null;
  let ghost = null;
  let dragStartX = 0, dragStartY = 0;

  nav.addEventListener('pointerdown', (e) => {
    if(!headerEditMode) return;
    const btn = e.target.closest('.header-nav-btn');
    if(!btn || btn.id === 'installHeaderBtn') return;
    draggedEl = btn;
    btn.classList.add('dragging');
    // setPointerCapture : garde les événements move/up adressés à CET
    // élément même si le pointeur sort de ses limites pendant le glisser.
    btn.setPointerCapture(e.pointerId);

    const rect = btn.getBoundingClientRect();
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    ghost = btn.cloneNode(true);
    ghost.removeAttribute('id'); // jamais deux ids identiques dans le DOM en même temps
    ghost.setAttribute('aria-hidden', 'true');
    ghost.tabIndex = -1;
    ghost.classList.add('header-nav-drag-ghost');
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    ghost.style.transform = 'scale(1.06)';
    document.body.appendChild(ghost);
  });

  nav.addEventListener('pointermove', (e) => {
    if(!draggedEl) return;
    if(ghost) ghost.style.transform = `translate(${e.clientX - dragStartX}px, ${e.clientY - dragStartY}px) scale(1.06)`;
    const siblings = Array.from(nav.querySelectorAll('.header-nav-btn:not(.dragging)'))
      .filter(el => el.id !== 'installHeaderBtn');
    const after = siblings.find(sib => {
      const rect = sib.getBoundingClientRect();
      return e.clientX < rect.left + rect.width / 2;
    });
    if(after) nav.insertBefore(draggedEl, after);
    else nav.appendChild(draggedEl);
  });

  function endDrag(){
    if(!draggedEl) return;
    draggedEl.classList.remove('dragging');
    draggedEl = null;
    if(ghost){ ghost.remove(); ghost = null; }
    const newOrder = Array.from(nav.querySelectorAll('.header-nav-btn'))
      .map(el => el.id)
      .filter(id => HEADER_NAV_DEFAULT_ORDER.includes(id));
    saveHeaderNavOrder(newOrder);
  }
  nav.addEventListener('pointerup', endDrag);
  // pointercancel (ex. une notification système interrompt le geste) :
  // sans ce filet, draggedEl resterait "collé" en mode glisser jusqu'au
  // prochain pointerdown, un état incohérent invisible mais bien réel.
  nav.addEventListener('pointercancel', endDrag);

  // Pendant l'édition, un clic sur une icône ne doit JAMAIS naviguer —
  // chaque bouton a déjà son propre listener posé par son fichier
  // propriétaire (js/watchlist.js, js/friends.js...). Écouteur en phase de
  // CAPTURE (3e argument `true`) : s'exécute avant que ces listeners
  // (posés en phase normale) n'aient la moindre chance de tourner.
  nav.addEventListener('click', (e) => {
    if(!headerEditMode) return;
    if(e.target.closest('#installHeaderBtn')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
}
wireHeaderNavDrag();

document.getElementById('openHeaderOrderBtn').addEventListener('click', enterHeaderEditMode);
document.getElementById('exitHeaderEditBtn').addEventListener('click', exitHeaderEditMode);

applyHeaderNavOrder();

// --- Barème couleur du cadran (.counter) ---
// Retenté v2.0 : la première version distinguait manuel/grille par
// couleur (or vs teal), ce qui ne voulait rien dire pour quelqu'un qui
// regarde juste la note — le barème demandé porte sur la VALEUR, pas sur
// la façon dont elle a été calculée (une distinction que plus rien
// n'affiche depuis le retrait de .manual-badge, v3.2). Seuils : <2.5 rouge, 2.5-3.99
// jaune/or, >=4 vert — appelée à chaque endroit qui construit un
// `.counter` (js/app.js, friends.js, groups.js, publicProfile.js, top.js).
function noteColorClass(note){
  if(note === null || note === undefined || isNaN(note)) return '';
  if(note < 2.5) return 'rate-low';
  if(note < 4) return 'rate-mid';
  return 'rate-high';
}

// Mark de l'entête (.brand-mark-gold, oscillation v2.7) retiré en v3.1 —
// plus de logo séparé, juste le wordmark "Kinet" en <h1>. Ce bloc ne
// faisait plus rien depuis la refonte v3.0 (querySelectorAll sur une
// classe qui n'existait déjà plus dans le DOM), supprimé pour de bon
// plutôt que laissé mort.

// --- Boutons magnétiques (v2.7, .magnetic) ---
// Se laissent tirer légèrement vers le curseur qui approche, reviennent
// avec un petit rebond au départ — réservé aux actions principales
// (Ajouter un film, Enregistrer), pas à chaque bouton de la page : un
// bouton "Retirer" qui se dérobe sous le curseur serait plus gênant
// qu'autre chose. mousemove + transform en JS simple, pas de librairie.
// Bug retour utilisateur ("réduire les animations... je crois qu'il ne
// fait rien") : ce bloc ne regardait QUE prefers-reduced-motion, UNE FOIS
// au chargement — le réglage getReduceMotion() n'y changeait jamais rien,
// même après un rechargement. motionReduced() lue à CHAQUE mousemove (pas
// à la pose de l'écouteur) : bascule le réglage en cours d'utilisation
// coupe l'effet tout de suite, sans recharger la page — le point qui
// manquait le plus, ce sont des boutons qu'on regarde/survole en direct.
document.querySelectorAll('.magnetic').forEach(btn => {
  btn.addEventListener('mousemove', (e) => {
    if(motionReduced()) return;
    const r = btn.getBoundingClientRect();
    const x = (e.clientX - r.left - r.width / 2) * 0.3;
    const y = (e.clientY - r.top - r.height / 2) * 0.3;
    btn.style.transition = 'transform 0.15s ease-out';
    btn.style.transform = `translate(${x}px, ${y}px)`;
  });
  btn.addEventListener('mouseleave', () => {
    // Toujours ramené à sa place, même juste après avoir basculé le
    // réglage en cours de survol — sinon un bouton resterait décalé.
    btn.style.transition = 'transform 0.5s cubic-bezier(.34,1.56,.64,1)';
    btn.style.transform = 'translate(0,0)';
  });
});

// L'inclinaison 3D des cartes vers le curseur (v2.8, lueur or) a été
// retirée au lot 3 de l'audit : sur des affiches sans cadre, le code de
// design ne garde qu'un léger soulèvement de l'affiche au survol (CSS).

// --- Listes repliées par défaut (v2.1.x, retour utilisateur : "on défile
// beaucoup trop", l'activité récente et la liste d'amis pouvaient à elles
// seules repousser le reste d'une page hors champ) ---
// Généralise le principe déjà utilisé pour le catalogue replié d'un profil
// d'ami (openFriendProfile(), js/friends.js) : affiche les `previewCount`
// premiers éléments d'une liste déjà chargée, un bouton "Voir plus (N)"
// démasque le reste — jamais de second appel réseau, tout est déjà là.
// `container` reçoit le HTML rendu par `renderFn` ; le bouton "Voir
// plus"/"Voir moins" est recréé à chaque appel juste après le conteneur,
// identifié par un id dérivé du sien pour ne jamais en laisser deux.
function renderCollapsible(container, items, renderFn, opts = {}){
  const previewCount = opts.previewCount || 4;
  const btnId = container.id + 'ToggleBtn';
  const old = document.getElementById(btnId);
  if(old) old.remove();

  const expanded = !!opts.expanded;
  const shown = expanded ? items : items.slice(0, previewCount);
  container.innerHTML = shown.length === 0
    ? (opts.emptyHtml || '')
    : shown.map(renderFn).join('');
  if(opts.wire) opts.wire(container);

  if(items.length > previewCount){
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = btnId;
    btn.className = 'btn secondary list-toggle-btn';
    btn.textContent = expanded ? 'Voir moins' : `Voir plus (${items.length - previewCount})`;
    btn.addEventListener('click', () => renderCollapsible(container, items, renderFn, { ...opts, expanded: !expanded }));
    container.insertAdjacentElement('afterend', btn);
  }
}

// --- Révélation au scroll (v2.1.x, "Halation" plus loin — suite du
// chantier design, retour utilisateur) ---
// Un seul IntersectionObserver partagé pour toute l'app (root par défaut =
// viewport — fonctionne aussi pour du contenu qui défile DANS une modale
// .overlay, la géométrie clippée par son overflow:auto est prise en compte
// automatiquement) plutôt qu'un par page : les éléments à révéler portent
// la classe .reveal (état caché, voir css/style.css), observeReveal() les
// enregistre après CHAQUE rendu qui vient d'en ajouter — le contenu de ces
// pages est reconstruit via innerHTML à chaque changement de données,
// jamais de DOM stable à observer une bonne fois pour toutes. Révélation à
// sens unique : une fois visible, unobserve() — remonter/redescendre ne
// doit pas faire re-clignoter le contenu, seule la toute première
// apparition compte. Pas de support IntersectionObserver (très ancien
// navigateur) : tout affiché directement, jamais de contenu qui resterait
// invisible faute d'API.
const revealObserver = ('IntersectionObserver' in window) ? new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if(entry.isIntersecting){
      entry.target.classList.add('in-view');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12, rootMargin: '0px 0px -30px 0px' }) : null;

function observeReveal(container){
  const els = container.querySelectorAll('.reveal:not(.in-view)');
  if(!revealObserver){ els.forEach(el => el.classList.add('in-view')); return; }
  els.forEach(el => revealObserver.observe(el));
}

// --- Lignes de liste cliquables, accessibles au clavier ---
// Audit d'accessibilité (retour utilisateur) : beaucoup de lignes de liste
// à travers l'app (catalogue, top films, séries, catalogue d'un ami,
// distribution des stats...) ne sont que des <div> avec un simple clic
// souris — injoignables au clavier/lecteur d'écran (Tab les saute, Entrée
// n'y fait rien), alors que c'est souvent la SEULE façon d'ouvrir le
// détail depuis cette ligne. Un seul endroit (le graphique de distribution,
// js/stats.js) le faisait déjà bien (role="button" + tabindex="0" + clic +
// Entrée/Espace) — généralisé ici plutôt que réécrit à la main à chaque
// site d'appel. Reste une <div> (pas de <button>) : ces lignes contiennent
// souvent déjà un vrai bouton (favori, actions...), et un <button> ne peut
// pas légalement en contenir un autre.
function makeRowClickable(el, handler){
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.addEventListener('click', handler);
  el.addEventListener('keydown', (e) => {
    // Ignore Entrée/Espace venant d'un bouton enfant (favori, actions...) —
    // seul le clavier sur la ligne ELLE-MÊME doit déclencher l'ouverture,
    // exactement comme le clic ne se déclenche que sur la ligne (voir les
    // gardes-fous e.target.closest(...) déjà en place à chaque site d'appel).
    if(e.target !== el) return;
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); handler(e); }
  });
}

// Flèches gauche/droite sur une fiche (film ou série d'à côté, audit C3) :
// seulement si cette fiche est affichée, sans fenêtre ouverte, et jamais
// pendant une saisie (un curseur de note se règle lui aussi aux flèches).
function isDetailKeyNavAllowed(pageId, e){
  if(e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  const page = document.getElementById(pageId);
  if(!page || page.style.display === 'none') return false;
  if(document.querySelector('.overlay.open')) return false;
  const a = document.activeElement;
  if(a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return false;
  return true;
}

// --- Menu d'actions d'une ligne (bouton « ⋯ ») ---
// Code de design (docs/code-design.md) : une action visible par ligne, les
// autres ici. Un seul menu ouvert à la fois ; Échap, un clic dehors, le
// défilement ou le choix d'une action le referment.
// items : [{ label, danger, onSelect }]
const ROW_MORE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="19" cy="12" r="1.8"></circle></svg>';
let rowMenuState = null;

function rowMoreButtonHtml(label){
  return `<button class="row-more-btn" type="button" aria-label="${escapeHtml(label)}" aria-haspopup="menu" aria-expanded="false">${ROW_MORE_ICON}</button>`;
}

function closeRowMenu(){
  if(!rowMenuState) return false;
  const { menu, anchor } = rowMenuState;
  rowMenuState = null;
  menu.remove();
  anchor.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', onRowMenuPointerDown, true);
  window.removeEventListener('scroll', closeRowMenu, true);
  window.removeEventListener('resize', closeRowMenu);
  return true;
}

function onRowMenuPointerDown(e){
  if(!rowMenuState) return;
  if(rowMenuState.menu.contains(e.target) || rowMenuState.anchor.contains(e.target)) return;
  closeRowMenu();
}

function openRowMenu(anchor, items){
  const sameAnchor = rowMenuState && rowMenuState.anchor === anchor;
  closeRowMenu();
  if(sameAnchor) return; // second clic sur le même « ⋯ » : on referme seulement

  const menu = document.createElement('div');
  menu.className = 'row-menu';
  menu.setAttribute('role', 'menu');
  items.forEach(item => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'row-menu-item' + (item.danger ? ' danger' : '');
    b.setAttribute('role', 'menuitem');
    b.textContent = item.label;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      closeRowMenu();
      anchor.focus({ preventScroll: true });
      item.onSelect();
    });
    menu.appendChild(b);
  });
  menu.addEventListener('keydown', (e) => {
    if(e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const btns = [...menu.querySelectorAll('.row-menu-item')];
    const i = btns.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
    btns[next].focus();
  });
  document.body.appendChild(menu);

  // Sous le bouton, aligné à droite ; au-dessus s'il n'y a pas la place.
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
  const fitsBelow = r.bottom + 6 + h <= window.innerHeight - 8;
  menu.style.left = `${left}px`;
  menu.style.top = `${fitsBelow ? r.bottom + 6 : Math.max(8, r.top - 6 - h)}px`;

  anchor.setAttribute('aria-expanded', 'true');
  rowMenuState = { menu, anchor };
  document.addEventListener('pointerdown', onRowMenuPointerDown, true);
  window.addEventListener('scroll', closeRowMenu, true);
  window.addEventListener('resize', closeRowMenu);
  menu.querySelector('.row-menu-item').focus({ preventScroll: true });
}

// --- Garde anti double-soumission ---
// Bug réel trouvé et corrigé sur "Note rapide" (js/watchlist.js) : rien ne
// retirait le bouton/la ligne de l'écran avant la fin de la requête
// Supabase, donc un double-clic (ou Entrée puis clic, sur mobile un tap
// répété par lenteur réseau) pouvait insérer le même enregistrement deux
// fois. Généralisé ici plutôt que réécrit à la main à chaque site d'appel —
// enveloppe un handler async : désactive btn avant l'appel, le réactive une
// fois résolu (succès ou erreur), sans effet si btn a entre-temps disparu
// (modale fermée, ligne re-rendue par le handler lui-même en cas de succès).
function withSubmitGuard(btn, handler){
  return async (...args) => {
    if(btn.disabled) return;
    btn.disabled = true;
    try{
      return await handler(...args);
    }finally{
      btn.disabled = false;
    }
  };
}

// --- Squelettes de chargement (retour utilisateur) ---
// Remplace le texte brut "Chargement…" par une silhouette animée sur les
// listes à fort trafic (watchlist, séries, top, amis, groupes, recherche
// globale) — un seul gabarit .skeleton-row (poster + 2 lignes de texte,
// voir css/style.css) suffit à toutes les approximer, ces listes
// partageant déjà .wl-row (poster + titre + sous-texte). count : nombre de
// lignes à afficher — 4-6 selon la place disponible, assez pour remplir le
// premier écran sans en dessiner des dizaines pour rien.
function skeletonRows(count = 5){
  let html = '';
  for(let i = 0; i < count; i++){
    html += `
      <div class="skeleton-row" aria-hidden="true">
        <div class="skeleton-poster"></div>
        <div class="skeleton-lines">
          <div class="skeleton-line medium"></div>
          <div class="skeleton-line short"></div>
        </div>
      </div>
    `;
  }
  return html;
}

// --- Toast d'annulation (undo) (retour utilisateur : "Annuler une action
// destructrice") --- Complète l'audit confirmations (v2.7, voir
// js/app.js/friends.js/groups.js) plutôt que de le remplacer : les actions
// qui avaient délibérément été laissées sans confirm() (retirer un film de
// la watchlist, retirer une entrée de journal — réversibles mais avec une
// vraie perte de donnée si c'est un vrai clic malheureux) gagnent une
// fenêtre d'annulation au lieu d'un confirm() bloquant à chaque clic. Pas
// appliqué aux actions déjà triviales à refaire en un clic (like, vote —
// un simple re-clic suffit, une annulation dédiée n'apporterait rien).
//
// Principe : l'appelant retire l'élément de son état local et re-rend
// AVANT d'appeler showUndoToast — l'écran change tout de suite. La
// suppression réelle en base (onCommit) n'a lieu qu'à l'expiration du
// délai ci-dessous ; un clic sur "Annuler" (onUndo) l'annule et restaure
// l'élément, sans qu'aucune écriture n'ait jamais atteint la base.
// Jamais "supprimer puis ré-insérer" : ça changerait l'id et risquerait de
// perdre une écriture concurrente pendant la fenêtre d'annulation.
const UNDO_TOAST_DELAY_MS = 6000;
let undoToastTimer = null;
let undoToastCommit = null;       // callback à exécuter à l'expiration du délai
let undoToastClickHandler = null; // listener actuellement posé sur #undoToastBtn

function showUndoToast(message, onCommit, onUndo){
  // Une annulation déjà en attente est validée tout de suite avant d'en
  // afficher une nouvelle : jamais deux suppressions en attente à la fois,
  // le bouton "Annuler" ne pourrait viser que l'une des deux.
  finalizePendingUndo();

  const toast = document.getElementById('undoToast');
  document.getElementById('undoToastMsg').textContent = message;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('show'));

  undoToastCommit = onCommit;
  undoToastTimer = setTimeout(finalizePendingUndo, UNDO_TOAST_DELAY_MS);

  undoToastClickHandler = () => {
    undoToastCommit = null;
    clearTimeout(undoToastTimer);
    undoToastTimer = null;
    detachUndoToastHandler();
    hideUndoToast();
    onUndo();
  };
  document.getElementById('undoToastBtn').addEventListener('click', undoToastClickHandler);
}

function detachUndoToastHandler(){
  if(!undoToastClickHandler) return;
  document.getElementById('undoToastBtn').removeEventListener('click', undoToastClickHandler);
  undoToastClickHandler = null;
}

function finalizePendingUndo(){
  if(!undoToastCommit) return;
  const commit = undoToastCommit;
  undoToastCommit = null;
  clearTimeout(undoToastTimer);
  undoToastTimer = null;
  detachUndoToastHandler();
  hideUndoToast();
  commit();
}

function hideUndoToast(){
  const toast = document.getElementById('undoToast');
  toast.classList.remove('show');
  setTimeout(() => { if(!toast.classList.contains('show')) toast.hidden = true; }, 200);
}

// --- Retour en haut (retour utilisateur : le catalogue peut dépasser 300
// films) --- Un seul bouton global (#scrollTopBtn, index.html) plutôt
// qu'un par page : toute page défile au niveau de la fenêtre (aucun
// conteneur interne n'a son propre scroll dans cette app), donc un seul
// listener suffit. Révélé après un scroll suffisant pour que ça vaille le
// coup (300px — sous ce seuil, revenir en haut à la molette est aussi
// rapide que de viser le bouton).
// behavior:'auto' (saut instantané) plutôt que 'smooth' — vérifié en
// testant réellement le bouton : sur le catalogue (330+ affiches en
// `loading="lazy"`), les affiches qui finissent de charger PENDANT le
// scroll animé changent la hauteur de contenu au-dessus du viewport, et
// l'ancrage de scroll du navigateur (overflow-anchor, actif par défaut)
// entre alors en conflit avec l'animation en cours — le scroll "smooth"
// peut se figer en cours de route plutôt que d'atteindre le haut. Un saut
// instantané n'a rien à quoi s'ancrer une fois terminé, donc rien à quoi
// ce conflit puisse s'accrocher.
const SCROLL_TOP_REVEAL_THRESHOLD = 300;
const scrollTopBtn = document.getElementById('scrollTopBtn');
if(scrollTopBtn){
  window.addEventListener('scroll', () => {
    scrollTopBtn.style.display = window.scrollY > SCROLL_TOP_REVEAL_THRESHOLD ? 'flex' : 'none';
  }, { passive: true });
  scrollTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  });
}

// --- Geste de rafraîchissement façon app native (retour utilisateur) ---
// Tirer vers le bas en haut d'une page recharge ses données depuis
// Supabase, comme sur une vraie app mobile — jusqu'ici il fallait recharger
// toute la page (F5) pour ça. Tactile uniquement ('ontouchstart' absent =
// pas d'écran tactile, rien n'est câblé) ; désactivé quand on n'est pas
// tout en haut de la page (sinon ça déclencherait au milieu d'un scroll
// normal), quand une modale est ouverte (elle a son propre scroll interne,
// voir .overlay{overflow-y:auto}), ou quand le tirer démarre sur un
// contrôle interactif (slider de note, champ de texte...) pour ne jamais
// lui voler le geste.
//
// Recharge : renderRoute() (js/router.js) rejoue la route actuelle, ce qui
// rappelle le open<Page>() correspondant — TOUS rechargent déjà leurs
// données depuis Supabase avant de re-rendre (loadWatchlist(), etc.),
// SAUF la route "home" (catalogue), qui ne fait que ré-afficher `films`
// déjà en mémoire (chargé une seule fois au login) — cas spécial ici :
// recharge explicitement films/viewings, comme au démarrage (showApp(),
// js/auth.js).
async function refreshCurrentPage(){
  if(location.hash === '' || location.hash === '#' || location.hash === '#/'){
    await Promise.all([loadFilms(), loadViewings()]);
    buildGenreFilterOptions();
    render();
  }else{
    await renderRoute();
  }
}

if('ontouchstart' in window){
  const PULL_THRESHOLD = 70;
  const PULL_MAX = 100;
  // Position "posé" une fois le rafraîchissement déclenché — équivaut à
  // l'ancien top:12px, exprimée ici en décalage depuis la position cachée
  // (translateY(0), voir plus bas) plutôt qu'en valeur absolue de `top`.
  const PULL_SETTLE_Y = 62;
  const pullIndicator = document.getElementById('pullRefreshIndicator');
  let pullStartY = null;
  let pulling = false;
  let refreshing = false;
  // Petit historique position/temps (audit design, apple-design §5 "vélocité
  // au relâchement") : sert à faire partir le ressort de relâchement à la
  // VRAIE vitesse du geste plutôt que figée à 0, pour qu'un tiré rapide
  // "lâché" se sente lancé plutôt que juste repositionné.
  let touchHistory = [];
  let currentDist = 0;
  let springCtrl = null;

  function setPullY(y){
    currentDist = y;
    if(pullIndicator) pullIndicator.style.transform = `translateY(${y}px)`;
  }

  // Ressort critique (damping 1, jamais de rebond) : on vient soit de
  // relâcher sans atteindre le seuil (retour doux à 0), soit de confirmer
  // le rafraîchissement (se pose à PULL_SETTLE_Y) — aucun des deux n'est un
  // geste "lancé" à faire rebondir, juste un relâchement qui mérite de
  // garder la vélocité du doigt pour ne pas repartir de zéro d'un coup.
  function springTo(target, velocity){
    if(springCtrl) springCtrl.cancel();
    springCtrl = animateSpring({
      from: currentDist, to: target, velocity, dampingRatio: 1, response: 0.32,
      onUpdate(y){ setPullY(y); },
      onComplete(){ springCtrl = null; },
    });
  }

  function resetPull(animated){
    pullIndicator && pullIndicator.classList.remove('ready');
    pullStartY = null;
    pulling = false;
    if(animated) springTo(0, 0);
    else{
      if(springCtrl){ springCtrl.cancel(); springCtrl = null; }
      setPullY(0);
    }
  }

  if(pullIndicator){
    document.addEventListener('touchstart', (e) => {
      if(refreshing || window.scrollY > 0) return;
      if(document.querySelector('.overlay.open')) return; // modale ouverte : son propre scroll interne, pas ce geste
      if(e.target.closest('input, textarea, select, button, a, [role="button"]')) return; // ne vole pas le geste à un contrôle
      // Interruptible (skill apple-design §3) : un ressort de relâchement
      // encore en cours de pose reprend EXACTEMENT où il en est (currentDist
      // déjà à jour à chaque frame via onUpdate), jamais un saut à 0.
      if(springCtrl){ springCtrl.cancel(); springCtrl = null; }
      pullStartY = e.touches[0].clientY;
      pulling = true;
      touchHistory = [{ y: e.touches[0].clientY, t: e.timeStamp }];
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if(!pulling || pullStartY == null || refreshing) return;
      const y = e.touches[0].clientY;
      const delta = y - pullStartY;
      if(delta <= 0){ resetPull(false); return; }
      touchHistory.push({ y, t: e.timeStamp });
      if(touchHistory.length > 5) touchHistory.shift();
      let dist = delta * 0.5;
      // Résistance progressive au-delà de PULL_MAX (skill apple-design §9) :
      // continue de suivre le doigt, de moins en moins, jamais un mur figé.
      if(dist > PULL_MAX) dist = PULL_MAX + rubberband(dist - PULL_MAX, PULL_MAX);
      setPullY(dist);
      pullIndicator.classList.toggle('ready', delta > PULL_THRESHOLD);
    }, { passive: true });

    document.addEventListener('touchend', async () => {
      if(!pulling || pullStartY == null){ resetPull(true); return; }
      const shouldRefresh = pullIndicator.classList.contains('ready');
      pulling = false;
      pullStartY = null;
      // Vélocité du geste (px/s) à partir des 2 derniers points assez
      // espacés dans le temps — un seul couple de points trop proche
      // donnerait une vélocité bruitée (division par un dt quasi nul).
      let velocity = 0;
      const last = touchHistory[touchHistory.length - 1];
      const ref = touchHistory.find(p => last.t - p.t >= 16) || touchHistory[0];
      if(last && ref && last.t > ref.t){
        velocity = ((last.y - ref.y) / (last.t - ref.t)) * 1000 * 0.5; // ×0.5 : même échelle que dist = delta*0.5
      }
      if(!shouldRefresh){ springTo(0, velocity); return; }
      refreshing = true;
      pullIndicator.classList.remove('ready');
      springTo(PULL_SETTLE_Y, velocity);
      pullIndicator.classList.add('loading');
      try{
        await refreshCurrentPage();
      }catch(e){
        console.error(e);
      }finally{
        pullIndicator.classList.remove('loading');
        refreshing = false;
        resetPull(true);
      }
    });
  }
}
