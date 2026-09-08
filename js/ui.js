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

function openOverlay(id){
  const el = document.getElementById(id);
  overlayReturnFocus[id] = document.activeElement;
  el.classList.remove('closing'); // une fermeture pouvait être en cours
  el.classList.add('open');
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
    // Ajoutées après coup (audit clavier) — recherche globale et bilan
    // cinéphile n'avaient jamais rejoint cette table au moment de leur
    // ajout, contrairement à toutes les autres modales de l'app.
    globalSearchOverlay: () => closeOverlay('globalSearchOverlay'),
    recapOverlay: () => closeRecap(),
    settingsOverlay: () => closeSettingsModal(),
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
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view-btn]');
  if(btn) setViewMode(btn.dataset.viewBtn);
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

function setTheme(theme){
  document.documentElement.dataset.theme = theme;
  try{ localStorage.setItem('kinetTheme', theme); }catch(e){}
  const toggle = document.getElementById('lightThemeToggle');
  if(toggle) toggle.checked = theme === 'light';
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
const HEADER_NAV_DEFAULT_ORDER = ['globalSearchBtn', 'watchlistBtn', 'upcomingBtn', 'friendsBtn', 'topBtn', 'feedbackBtn', 'changelogBtn'];

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
// posés par chaque fichier propriétaire (js/globalSearch.js,
// js/watchlist.js, etc.), aucun n'a besoin de savoir que cet ordre existe.
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
// la façon dont elle a été calculée (déjà signalée par .manual-badge, à
// côté du titre, indépendamment de ceci). Seuils : <2.5 rouge, 2.5-3.99
// jaune/or, >=4 vert — appelée à chaque endroit qui construit un
// `.counter` (js/app.js, friends.js, groups.js, publicProfile.js, top.js).
function noteColorClass(note){
  if(note === null || note === undefined || isNaN(note)) return '';
  if(note < 2.5) return 'rate-low';
  if(note < 4) return 'rate-mid';
  return 'rate-high';
}

// --- Mark de l'entête : relai entrée → oscillation continue (v2.7) ---
// L'entrée (brandMarkGold, voir css/style.css) tourne une fois puis
// s'arrête (animation non infinite) ; une fois finie, .idle prend le
// relai pour l'oscillation en boucle — deux animations jamais actives en
// même temps sur le même élément (la cascade CSS choisit .idle une fois
// la classe posée), pas de conflit de transform.
if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
  document.querySelectorAll('.brand-mark-gold').forEach(el => {
    el.addEventListener('animationend', (e) => {
      if(e.animationName === 'brandMarkGold') el.classList.add('idle');
    });
  });
}

// --- Boutons magnétiques (v2.7, .magnetic) ---
// Se laissent tirer légèrement vers le curseur qui approche, reviennent
// avec un petit rebond au départ — réservé aux actions principales
// (Ajouter un film, Enregistrer), pas à chaque bouton de la page : un
// bouton "Retirer" qui se dérobe sous le curseur serait plus gênant
// qu'autre chose. mousemove + transform en JS simple, pas de librairie.
if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
  document.querySelectorAll('.magnetic').forEach(btn => {
    btn.addEventListener('mousemove', (e) => {
      const r = btn.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) * 0.3;
      const y = (e.clientY - r.top - r.height / 2) * 0.3;
      btn.style.transition = 'transform 0.15s ease-out';
      btn.style.transform = `translate(${x}px, ${y}px)`;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transition = 'transform 0.5s cubic-bezier(.34,1.56,.64,1)';
      btn.style.transform = 'translate(0,0)';
    });
  });
}

// --- Affiches qui s'inclinent vers le curseur (v2.8) ---
// Diversifie le mouvement au-delà des boutons magnétiques (retour
// utilisateur) — une ligne de catalogue/watchlist/série s'incline
// légèrement en 3D vers le pointeur, avec une lueur or au passage (même
// retour : "où est la couleur ?"). Délégation sur document (un seul
// listener plutôt qu'un par ligne — la liste est reconstruite à chaque
// render(), pas besoin de rebrancher quoi que ce soit) + throttle rAF.
if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
  let tiltRow = null;
  let tiltRaf = null;
  document.addEventListener('mousemove', (e) => {
    const row = e.target.closest('.film-row, .wl-row');
    if(!row){
      if(tiltRow){ tiltRow.classList.remove('tilting'); tiltRow.style.transform = ''; tiltRow = null; }
      return;
    }
    if(row !== tiltRow){
      if(tiltRow){ tiltRow.classList.remove('tilting'); tiltRow.style.transform = ''; }
      tiltRow = row;
      row.classList.add('tilting');
    }
    if(tiltRaf) return;
    tiltRaf = requestAnimationFrame(() => {
      tiltRaf = null;
      if(!tiltRow) return;
      const r = tiltRow.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      tiltRow.style.transform = `perspective(700px) rotateX(${(py * -6).toFixed(2)}deg) rotateY(${(px * 6).toFixed(2)}deg) translateY(-2px)`;
    });
  });
}

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
  const pullIndicator = document.getElementById('pullRefreshIndicator');
  let pullStartY = null;
  let pulling = false;
  let refreshing = false;

  function resetPull(){
    if(pullIndicator) pullIndicator.style.top = '-50px';
    pullIndicator && pullIndicator.classList.remove('ready');
    pullStartY = null;
    pulling = false;
  }

  if(pullIndicator){
    document.addEventListener('touchstart', (e) => {
      if(refreshing || window.scrollY > 0) return;
      if(document.querySelector('.overlay.open')) return; // modale ouverte : son propre scroll interne, pas ce geste
      if(e.target.closest('input, textarea, select, button, a, [role="button"]')) return; // ne vole pas le geste à un contrôle
      pullStartY = e.touches[0].clientY;
      pulling = true;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if(!pulling || pullStartY == null || refreshing) return;
      const delta = e.touches[0].clientY - pullStartY;
      if(delta <= 0){ resetPull(); return; }
      const dist = Math.min(delta * 0.5, PULL_MAX);
      pullIndicator.style.top = `${dist - 50}px`;
      pullIndicator.classList.toggle('ready', delta > PULL_THRESHOLD);
    }, { passive: true });

    document.addEventListener('touchend', async () => {
      if(!pulling || pullStartY == null){ resetPull(); return; }
      const shouldRefresh = pullIndicator.classList.contains('ready');
      pulling = false;
      pullStartY = null;
      if(!shouldRefresh){ resetPull(); return; }
      refreshing = true;
      pullIndicator.style.top = '12px';
      pullIndicator.classList.remove('ready');
      pullIndicator.classList.add('loading');
      try{
        await refreshCurrentPage();
      }catch(e){
        console.error(e);
      }finally{
        pullIndicator.classList.remove('loading');
        refreshing = false;
        resetPull();
      }
    });
  }
}
