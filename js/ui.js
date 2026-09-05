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
    surpriseOverlay: () => closeOverlay('surpriseOverlay')
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
