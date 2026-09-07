// --- Tuto d'accueil interactif ("Premiers pas") ---
// Retour utilisateur : "à la création d'un compte... je voudrais que
// l'utilisateur ait un tuto intéractif... étape par étape les différentes
// fonctionalités... très clair et dynamique... un peu différent entre pc
// et tel... l'utilisateur ne se sente pas obligé... qu'il puisse retenir
// correctement... bien s'assurer que l'utilisateur soit nouveau [...] pas
// par appareil" puis, sur draft : "j'aime bien l'hybride [...] je veux
// que tu reproduises parfaitement". Concept "Hybride" retenu : un bref
// écran de Bienvenue (jamais imposé, "Plus tard" toujours là) suivi d'une
// visite de 5 gestes réels, montrés directement sur les VRAIES icônes/
// boutons de l'app — jamais une liste séparée qui les duplique (même
// philosophie que enterHeaderEditMode(), js/ui.js).
//
// Nouveau compte détecté par profiles.onboarding_seen (migrations/040),
// PAR COMPTE et jamais par appareil/localStorage : posé à false
// EXPLICITEMENT à la création du profil (fetchOrCreateProfile(),
// js/profile.js), remis à true seulement quand ce tuto se termine ou est
// passé — jamais juste parce qu'un nouvel appareil se connecte à un
// compte déjà existant. "Revoir le tuto" (Ton profil → Paramètres) ne
// touche JAMAIS ce flag : un choix explicite de relecture, pas un signal
// de "nouveau compte".
//
// Technique visuelle : ni un .overlay/.modal classique (toujours un
// rectangle centré) ni le hack "box-shadow 9999px" du prototype (qui n'y
// avait recours que parce que la maquette vivait dans un cadre
// overflow:hidden confiné) — ici, un vrai voile plein écran
// (.onboarding-backdrop) plus un CLONE décoratif de la vraie icône visée
// (même technique que le ghost du glisser-déposer de l'entête, js/ui.js),
// jamais le vrai élément déplacé/modifié. L'ordre d'empilement (voile,
// puis clone, puis carte, simples enfants successifs de #onboardingLayer)
// suffit à tout superposer correctement sans le moindre z-index à gérer
// entre eux, voir css/style.css pour le détail.

const ONBOARDING_STEPS = [
  {
    key:'add',
    target:{ desktop:'openAddBtn', mobile:'fabAddBtn' },
    place:{ desktop:'bottom', mobile:'top' },
    title:'Note un film',
    body:'Cherche-le puis note-le sur 7 critères — ou donne directement une note manuelle si tu es pressé.'
  },
  {
    key:'watchlist',
    target:{ desktop:'watchlistBtn', mobile:'mobileTabWatchlist' },
    place:{ desktop:'bottom', mobile:'top' },
    title:'Ta liste à voir',
    body:"Garde une trace de ce que tu comptes regarder, avec sa date de sortie si le film n'est pas encore là."
  },
  {
    key:'series',
    target:{ desktop:'primaryTabSeries', mobile:'primaryTabSeries' },
    place:{ desktop:'bottom', mobile:'bottom' },
    title:'Suivi des séries',
    body:'Coche les épisodes vus, saison par saison — un suivi séparé du catalogue films.'
  },
  {
    key:'friends',
    target:{ desktop:'friendsBtn', mobile:'mobileTabFriends' },
    place:{ desktop:'bottom', mobile:'top' },
    title:'Amis & groupes',
    body:'Ajoute des amis, comparez vos goûts, votez ensemble pour la prochaine séance.'
  },
  {
    key:'profile',
    target:{ desktop:'userAvatarBtn', mobile:'mobileTabProfile' },
    place:{ desktop:'bottom', mobile:'top' },
    title:'Ton profil',
    body:'Thème, ordre des icônes, bilan cinéphile — et ce tuto, à revoir quand tu veux dans Paramètres.'
  }
];

// Même seuil que la vraie bascule desktop/mobile de l'entête (voir
// .header-nav/.mobile-tabbar, css/style.css @media max-width:600px) — les
// cibles ci-dessus n'existent/ne sont visibles que d'un côté ou l'autre de
// cette même limite.
const ONBOARDING_MOBILE_QUERY = '(max-width:600px)';

const ONBOARDING_COMPASS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="m14.5 9.5-2 5-3 2 2-5 3-2z"></path></svg>';

// null = fermé ; sinon { phase: 'welcome'|'spot'|'closing', stepIndex, replay }
let onboardingState = null;

function isOnboardingMobile(){
  return window.matchMedia(ONBOARDING_MOBILE_QUERY).matches;
}

// Device relu à CHAQUE rendu d'étape (jamais figé à l'ouverture du tuto) —
// un redimensionnement de fenêtre ou une rotation d'écran pendant le tuto
// doit répointer la bonne cible plutôt que de viser un élément devenu
// invisible, voir le listener "resize" tout en bas.
function onboardingStepTargetEl(step){
  const id = isOnboardingMobile() ? step.target.mobile : step.target.desktop;
  return document.getElementById(id);
}
function onboardingStepPlace(step){
  return isOnboardingMobile() ? step.place.mobile : step.place.desktop;
}

// Appelée depuis showApp() (js/auth.js), après loadOrCreateProfile() —
// currentProfile est déjà chargé à ce stade, quel que soit l'ordre exact
// des autres appels post-connexion (voir aussi le garde-fou côté
// initChangelog(), js/changelog.js, pour ne jamais empiler les deux).
function maybeStartOnboarding(){
  if(currentProfile && currentProfile.onboarding_seen === false) startOnboarding({ replay:false });
}

// Accessible aussi depuis "Ton profil" → Paramètres (#replayOnboardingBtn,
// retour utilisateur : "qu'on remette le tuto dispo qlq part dans les
// paramètres") — replay:true saute directement la Bienvenue (un compte
// qui redemande le tuto connaît déjà Kinet, inutile de la lui rejouer) et
// ne touchera jamais onboarding_seen à la fermeture.
function startOnboarding({ replay }){
  if(onboardingState) return; // déjà ouvert (double-clic...) — jamais deux tutos empilés
  closeProfileModal();
  goHome();
  onboardingState = { phase: replay ? 'spot' : 'welcome', stepIndex: 0, replay: !!replay };
  const layer = document.getElementById('onboardingLayer');
  layer.classList.remove('closing');
  layer.classList.add('open');
  renderOnboardingStep();
}

function renderOnboardingStep(){
  clearOnboardingVisuals();
  const layer = document.getElementById('onboardingLayer');
  // Voile plein écran — reconstruit à chaque étape plutôt que conservé
  // entre deux : plus simple que de le faire survivre à
  // clearOnboardingVisuals(), pour un coût négligeable (un seul <div>).
  // Clic dessus = "Passer" (même convention que fermer une .overlay en
  // cliquant son fond, js/ui.js/js/*.js) — jamais un clic DANS la carte,
  // qui vit en dehors du voile (sibling, pas descendant) donc ne remonte
  // jamais jusqu'à ce listener.
  const backdrop = document.createElement('div');
  backdrop.className = 'onboarding-backdrop';
  backdrop.addEventListener('click', skipOnboarding);
  layer.appendChild(backdrop);

  if(onboardingState.phase === 'welcome') showOnboardingWelcome();
  else if(onboardingState.phase === 'closing') showOnboardingClosing();
  else showOnboardingSpot(onboardingState.stepIndex);
}

function clearOnboardingVisuals(){
  document.getElementById('onboardingLayer').innerHTML = '';
}

function buildOnboardingCard(centered){
  const card = document.createElement('div');
  card.className = 'onboarding-card' + (centered ? ' onboarding-card-center' : '');
  document.getElementById('onboardingLayer').appendChild(card);
  return card;
}

function wireOnboardingCard(card){
  card.querySelectorAll('[data-onb-act]').forEach(btn => {
    btn.addEventListener('click', () => handleOnboardingAction(btn.getAttribute('data-onb-act')));
  });
}

// Focus posé sur le bouton principal (même esprit que openOverlay(),
// js/ui.js) — sans effort de vrai piège de focus (Tab qui boucle dedans) :
// le reste de l'app ne le fait pas non plus pour ses modales, pas de
// raison d'être plus strict ici qu'ailleurs dans ce projet.
function focusOnboardingCard(card){
  const focusable = card.querySelector('button, [tabindex]');
  if(focusable) focusable.focus({ preventScroll:true });
}

function showOnboardingWelcome(){
  const card = buildOnboardingCard(true);
  card.innerHTML = `
    <div class="onboarding-icon-badge">${ONBOARDING_COMPASS_ICON}</div>
    <div class="onboarding-title">Bienvenue sur Kinet</div>
    <div class="onboarding-body">Ta grille perso pour films et séries, à ta façon — et partagée avec tes amis. Un tour en 30 secondes ?</div>
    <div class="onboarding-foot">
      <button class="onboarding-link-btn" type="button" data-onb-act="skip">Plus tard</button>
      <button class="btn" type="button" data-onb-act="welcome-start">Découvrir</button>
    </div>
  `;
  wireOnboardingCard(card);
  focusOnboardingCard(card);
}

function showOnboardingClosing(){
  const card = buildOnboardingCard(true);
  // Message différent en relecture (retour utilisateur implicite : la
  // personne vient JUSTE de cliquer "Revoir le tuto" dans Paramètres, lui
  // redire où le retrouver serait redondant) — voir startOnboarding().
  card.innerHTML = onboardingState.replay ? `
    <div class="onboarding-title">Rappel terminé</div>
    <div class="onboarding-body">À bientôt sur Kinet !</div>
    <div class="onboarding-foot"><button class="btn" type="button" data-onb-act="finish">Fermer</button></div>
  ` : `
    <div class="onboarding-title">Tu es prêt·e</div>
    <div class="onboarding-body">Retrouve ce tuto à tout moment dans Ton profil → Paramètres → "Revoir le tuto".</div>
    <div class="onboarding-foot"><button class="btn" type="button" data-onb-act="finish">Terminer</button></div>
  `;
  wireOnboardingCard(card);
  focusOnboardingCard(card);
}

function showOnboardingSpot(stepIndex){
  const step = ONBOARDING_STEPS[stepIndex];
  const target = onboardingStepTargetEl(step);
  if(!target){
    // Cible introuvable (id absent, page pas encore rendue...) — jamais
    // planter/bloquer le tuto dessus, passe directement à la suite plutôt
    // que d'afficher une carte qui ne pointerait rien.
    advanceOnboarding(1);
    return;
  }
  // Toujours remis dans le champ visible avant de mesurer sa position — le
  // header (desktop) défile AVEC la page (contrairement à la barre
  // mobile/au FAB, position:fixed) : sans ça, une icône déjà scrollée hors
  // champ recevrait quand même un clone+carte, invisibles à l'écran.
  // 'nearest' plutôt que 'center' : ne scrolle QUE si nécessaire, jamais
  // un petit à-coup pour une icône déjà visible.
  target.scrollIntoView({ block:'nearest', inline:'nearest' });

  // Clone purement décoratif (jamais interactif) du VRAI bouton — garde
  // ses classes d'origine (fond/rayon/icône déjà corrects sans rien
  // redéfinir, voir css/style.css) ; id retiré PARTOUT dans le clone (le
  // nœud lui-même et ses descendants, ex. l'<img> d'avatar a son propre
  // id) pour ne jamais dupliquer un id dans le DOM le temps de l'étape.
  const clone = target.cloneNode(true);
  clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  clone.setAttribute('aria-hidden', 'true');
  clone.tabIndex = -1;
  clone.classList.add('onboarding-clone');
  const rect = target.getBoundingClientRect();
  clone.style.left = rect.left + 'px';
  clone.style.top = rect.top + 'px';
  clone.style.width = rect.width + 'px';
  clone.style.height = rect.height + 'px';
  clone.style.margin = '0';
  document.getElementById('onboardingLayer').appendChild(clone);

  const place = onboardingStepPlace(step);
  const total = ONBOARDING_STEPS.length;
  const isLast = stepIndex === total - 1;
  const card = buildOnboardingCard(false);
  card.innerHTML = `
    <div class="onboarding-eyebrow">
      <span>Étape ${stepIndex + 1} / ${total}</span>
      ${stepIndex > 0 ? '<button class="onboarding-link-btn" type="button" data-onb-act="prev">← Précédent</button>' : ''}
    </div>
    <div class="onboarding-title">${step.title}</div>
    <div class="onboarding-body">${step.body}</div>
    <div class="onboarding-foot">
      <button class="onboarding-link-btn" type="button" data-onb-act="skip">Passer le tuto</button>
      <button class="btn" type="button" data-onb-act="next">${isLast ? 'Terminer' : 'Suivant'}</button>
    </div>
    <div class="onboarding-arrow place-${place}"></div>
  `;
  positionOnboardingCard(card, rect, place);
  wireOnboardingCard(card);
  focusOnboardingCard(card);
}

// position:fixed sur les deux (carte et rect de la cible sont déjà en
// coordonnées viewport, aucune conversion à faire, contrairement au
// prototype qui devait soustraire l'offset d'un cadre englobant). Clampée
// dans la fenêtre des deux côtés — largeur (une carte proche d'un bord) ET
// hauteur (un petit viewport en paysage mobile, une carte 'top' pourrait
// sinon partir au-dessus de l'écran).
function positionOnboardingCard(card, targetRect, place){
  const margin = 8;
  const gap = 14;
  const cw = card.offsetWidth, ch = card.offsetHeight;
  let top = place === 'top' ? (targetRect.top - ch - gap) : (targetRect.bottom + gap);
  top = Math.max(margin, Math.min(top, window.innerHeight - ch - margin));
  let left = targetRect.left + targetRect.width / 2 - cw / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - cw - margin));
  card.style.top = top + 'px';
  card.style.left = left + 'px';
}

function handleOnboardingAction(act){
  if(act === 'skip') return skipOnboarding();
  if(act === 'finish') return finishOnboarding();
  if(act === 'welcome-start'){
    onboardingState.phase = 'spot';
    onboardingState.stepIndex = 0;
    renderOnboardingStep();
    return;
  }
  if(act === 'next') return advanceOnboarding(1);
  if(act === 'prev') return advanceOnboarding(-1);
}

function advanceOnboarding(dir){
  onboardingState.stepIndex += dir;
  if(onboardingState.stepIndex >= ONBOARDING_STEPS.length){
    onboardingState.phase = 'closing';
  }else if(onboardingState.stepIndex < 0){
    // Ne devrait jamais arriver ("← Précédent" absent à l'étape 0) — filet
    // de sécurité plutôt qu'un index négatif silencieux.
    onboardingState.stepIndex = 0;
  }
  renderOnboardingStep();
}

// "Passer le tuto"/"Plus tard"/clic sur le voile/Échap (table centralisée,
// js/ui.js) — comptent comme "vu" au même titre qu'une visite terminée
// (retour utilisateur : jamais culpabilisant, mais jamais répété non plus
// une fois explicitement refusé).
function skipOnboarding(){
  if(!onboardingState) return;
  logEvent('onboarding_skipped', onboardingState.replay ? 'replay' : 'first');
  closeOnboardingLayer(!onboardingState.replay);
}

function finishOnboarding(){
  if(!onboardingState) return;
  logEvent('onboarding_completed', onboardingState.replay ? 'replay' : 'first');
  closeOnboardingLayer(!onboardingState.replay);
}

// Même structure que closeOverlay() (js/ui.js) : classe "open" retirée
// tout de suite, "closing" ajoutée pour rejouer overlayOut/modalOut (le
// voile RESTE display:block pendant que "closing" est posée, voir
// .onboarding-layer.closing dans css/style.css — sans ce doublon, retirer
// "open" ferait disparaître le tuto d'un coup, avant la moindre animation
// de sortie).
function closeOnboardingLayer(markSeen){
  const layer = document.getElementById('onboardingLayer');
  layer.classList.remove('open');
  const finalize = () => {
    layer.classList.remove('closing');
    layer.innerHTML = '';
    onboardingState = null;
  };
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    finalize();
  }else{
    layer.classList.add('closing');
    let done = false;
    const finish = () => {
      if(done) return;
      done = true;
      layer.removeEventListener('animationend', finish);
      finalize();
    };
    layer.addEventListener('animationend', finish);
    setTimeout(finish, OVERLAY_CLOSE_MS);
  }
  if(markSeen) markOnboardingSeen();
}

async function markOnboardingSeen(){
  if(!currentUser) return;
  // Mis à jour en mémoire tout de suite (avant même la réponse réseau) :
  // un double-déclenchement (ex. Échap juste après "Terminer") ne doit
  // jamais rouvrir le tuto entre-temps, currentProfile.onboarding_seen
  // reflète déjà le nouvel état pour maybeStartOnboarding().
  if(currentProfile) currentProfile.onboarding_seen = true;
  const { error } = await supabaseClient
    .from('profiles')
    .update({ onboarding_seen: true })
    .eq('user_id', currentUser.id);
  if(error) console.error(error);
}

// Redimensionnement/rotation PENDANT une étape pointée (jamais pendant
// Bienvenue/clôture, centrées en CSS pur — rien à recalculer en JS pour
// elles) : redéclenche un rendu complet de l'étape courante plutôt qu'un
// simple repositionnement, pour que la cible elle-même se répointe si le
// redimensionnement franchit le seuil desktop/mobile (600px) en cours de
// route — voir onboardingStepTargetEl().
function onOnboardingViewportChange(){
  if(onboardingState && onboardingState.phase === 'spot') renderOnboardingStep();
}
window.addEventListener('resize', onOnboardingViewportChange);
window.addEventListener('orientationchange', onOnboardingViewportChange);

document.getElementById('replayOnboardingBtn').addEventListener('click', () => startOnboarding({ replay:true }));
