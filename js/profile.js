// --- Profil (pseudo + avatar) ---
// Une ligne par utilisateur dans `profiles` (RLS, voir supabase/migrations/005).
// Appelé depuis js/auth.js → showApp() une fois la session confirmée.

let currentProfile = null;
let profileLoadPromise = null;
let topFilmsSelection = []; // tmdb_id choisis pour le top films, dans l'ordre — état local de la modale profil, voir renderTopFilmsPicker()

// Supabase peut déclencher plusieurs événements de session en cascade au
// chargement (getSession() + onAuthStateChange), ce qui appelait cette
// fonction deux fois en concurrence et faisait échouer le second insert
// (conflit de clé primaire). On mémorise la promesse en cours pour n'avoir
// qu'un seul aller-retour réseau.
function loadOrCreateProfile(){
  if(!profileLoadPromise){
    profileLoadPromise = fetchOrCreateProfile().finally(() => { profileLoadPromise = null; });
  }
  return profileLoadPromise;
}

async function fetchOrCreateProfile(){
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('user_id', currentUser.id)
    .maybeSingle();

  if(error){
    console.error(error);
    currentProfile = null;
    renderUserBar();
    return;
  }

  if(data){
    currentProfile = data;
  }else{
    // Première connexion pour ce compte : profil par défaut (pseudo = préfixe email).
    // onboarding_seen: false posé EXPLICITEMENT ici (pas le défaut de la
    // colonne, voir migrations/040) — c'est ce flag, par compte et jamais
    // par appareil, que showApp() (js/auth.js) relit pour décider de
    // lancer le tuto d'accueil ; un vrai nouveau compte doit toujours
    // l'avoir à false, indépendamment de ce que vaut le défaut SQL.
    const defaultName = currentUser.email.split('@')[0];
    const { data: created, error: insErr } = await supabaseClient
      .from('profiles')
      .insert({ user_id: currentUser.id, display_name: defaultName, onboarding_seen: false })
      .select()
      .single();
    if(insErr){
      // Conflit probable (profil déjà créé entre-temps, ex. autre onglet) :
      // on relit plutôt que d'écraser silencieusement.
      const { data: existing } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('user_id', currentUser.id)
        .maybeSingle();
      if(existing){
        currentProfile = existing;
      }else{
        console.error(insErr);
        // Sans onboarding_seen ici (undefined) : maybeStartOnboarding()
        // (js/auth.js) ne lance JAMAIS le tuto sur ce repli synthétique
        // (elle exige strictement === false) — volontaire, un double échec
        // réseau n'est pas le moment d'empiler un tuto par-dessus.
        currentProfile = { user_id: currentUser.id, display_name: defaultName, avatar_url: null };
      }
    }else{
      currentProfile = created;
      // Vraie première connexion (pas une simple relecture après course
      // avec un autre onglet, voir le bloc insErr ci-dessus) — voir
      // js/logging.js, section "Croissance" de l'onglet admin.
      logEvent('signup');
    }
  }
  renderUserBar();
}

function renderUserBar(){
  const name = (currentProfile && currentProfile.display_name) || currentUser.email;
  document.getElementById('userDisplayName').textContent = name;

  // La photo de profil (agrandie) sert aussi de bouton d'accès au profil,
  // voir #userAvatarBtn plus bas — pas d'avatar renseigné = icône 👤.
  const avatarEl = document.getElementById('userAvatar');
  const fallbackEl = document.getElementById('userAvatarFallback');
  const avatarUrl = currentProfile && currentProfile.avatar_url;
  // friendProfiles (js/friends.js) ne contenait jamais SON PROPRE profil —
  // friendDisplayName(currentUser.id) retombait sur "Utilisateur" partout
  // où on affiche l'auteur d'un like/commentaire/membre de groupe alors
  // que c'est soi-même (constaté sur la fiche film, js/filmDetail.js).
  // Caché ici (donnée déjà en main, aucun appel réseau de plus) plutôt que
  // dans chacun de ces endroits séparément.
  if(typeof cacheProfile === 'function') cacheProfile(currentUser.id, name, avatarUrl);
  // Même photo/repli sur l'onglet Profil de la barre mobile (v2.1.x, voir
  // #mobileTabbar, index.html) — un seul point de mise à jour plutôt que
  // de dupliquer cette logique là où renderUserBar() est déjà appelée.
  const mobileAvatarEl = document.getElementById('mobileTabAvatar');
  const mobileFallbackEl = document.getElementById('mobileTabAvatarFallback');
  if(avatarUrl){
    avatarEl.src = avatarUrl;
    avatarEl.style.display = '';
    fallbackEl.style.display = 'none';
    mobileAvatarEl.src = avatarUrl;
    mobileAvatarEl.style.display = '';
    mobileFallbackEl.style.display = 'none';
  }else{
    avatarEl.style.display = 'none';
    fallbackEl.style.display = '';
    mobileAvatarEl.style.display = 'none';
    mobileFallbackEl.style.display = '';
  }
}

function openProfileModal(){
  document.getElementById('displayNameInput').value = (currentProfile && currentProfile.display_name) || '';
  const avatarUrl = (currentProfile && currentProfile.avatar_url) || '';
  document.getElementById('avatarUrlInput').value = avatarUrl;
  document.getElementById('avatarFileInput').value = '';
  document.getElementById('avatarUploadStatus').textContent = '';
  document.getElementById('avatarUploadStatus').classList.remove('error');
  document.getElementById('avatarFilmSearch').value = '';
  document.getElementById('avatarFilmResults').innerHTML = '';
  setAvatarSourceTab('file');
  updateAvatarPreview(avatarUrl);
  // Replié par défaut (retour utilisateur : "ça prend toute la place") —
  // se déplie seulement au clic sur le crayon, voir toggleAvatarPanel().
  setAvatarPanelOpen(false);
  document.getElementById('publicProfileToggle').checked = !!(currentProfile && currentProfile.public_profile);
  updatePublicProfileLinkVisibility();
  // Ordre des icônes de l'entête (js/ui.js) : rien à préparer ici — le
  // bouton "Réorganiser..." (Paramètres) ferme les deux modales et active
  // directement le glisser-déposer sur les vraies icônes de l'entête, voir
  // enterHeaderEditMode().
  topFilmsSelection = (currentProfile && Array.isArray(currentProfile.top_films)) ? currentProfile.top_films.slice() : [];
  document.getElementById('topFilmsSearch').value = '';
  document.getElementById('topFilmsResults').innerHTML = '';
  renderTopFilmsPicker();
  updateTopFilmsVisibilityNote();
  // Bouton Admin (js/admin.js) : masqué pour tout le monde sauf ADMIN_EMAIL.
  document.getElementById('adminBtn').style.display = isAdmin() ? '' : 'none';
  openOverlay('profileOverlay');
}

// --- Panneau avatar repliable (retour utilisateur : refonte du profil,
// "beaucoup trop confus") — les 2 onglets d'upload restaient toujours
// grands ouverts alors qu'on les touche rarement. Replié par défaut,
// déplié au clic sur le crayon posé sur l'avatar (#toggleAvatarPanelBtn).
function setAvatarPanelOpen(open){
  document.getElementById('avatarPanel').classList.toggle('open', open);
  document.getElementById('toggleAvatarPanelBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
}
document.getElementById('toggleAvatarPanelBtn').addEventListener('click', () => {
  const panel = document.getElementById('avatarPanel');
  setAvatarPanelOpen(!panel.classList.contains('open'));
});

// Aperçu en tête de modale (nouveau, refonte du profil) : reflète
// avatarUrlInput en direct — appelée à l'ouverture, après un upload
// réussi, après le choix d'une affiche de film, et à chaque frappe dans le
// champ URL (voir le listener plus bas). avatarUrlInput reste la seule
// source de vérité envoyée à la sauvegarde, ceci n'en est qu'un reflet
// visuel, jamais une 2e donnée à garder synchronisée à part.
function updateAvatarPreview(url){
  const img = document.getElementById('profileAvatarPreview');
  const fallback = document.getElementById('profileAvatarFallback');
  if(url){
    img.src = url;
    img.style.display = '';
    fallback.style.display = 'none';
  }else{
    img.style.display = 'none';
    fallback.style.display = '';
  }
}
document.getElementById('avatarUrlInput').addEventListener('input', (e) => updateAvatarPreview(e.target.value.trim()));

// --- Onglets "Depuis cet appareil" / "URL ou un de tes films" ---
// Regroupe ce qui était 3 champs toujours visibles (URL, fichier, affiche
// d'un film) en 2 onglets — avatarUrlInput reste seul à faire foi à
// l'enregistrement, voir handleSaveProfile().
function setAvatarSourceTab(tab){
  document.querySelectorAll('.avatar-source-tab').forEach(btn => {
    const active = btn.dataset.avatarTab === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.getElementById('avatarPaneFile').style.display = tab === 'file' ? '' : 'none';
  document.getElementById('avatarPaneUrl').style.display = tab === 'url' ? '' : 'none';
}
document.querySelectorAll('.avatar-source-tab').forEach(btn => {
  btn.addEventListener('click', () => setAvatarSourceTab(btn.dataset.avatarTab));
});

// --- Upload d'avatar réel (Supabase Storage, voir migrations/017) ---
// Envoi dès le choix du fichier (pas de bouton "Uploader" séparé) : remplit
// avatarUrlInput avec l'URL publique obtenue, même principe que le choix
// d'une affiche de film ci-dessous — un seul champ fait foi à
// l'enregistrement (handleSaveProfile).

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

async function handleAvatarFileUpload(e){
  const file = e.target.files[0];
  if(!file) return;
  const status = document.getElementById('avatarUploadStatus');
  status.classList.remove('error');

  if(file.size > AVATAR_MAX_BYTES){
    status.textContent = 'Image trop lourde (5 Mo max).';
    status.classList.add('error');
    e.target.value = '';
    return;
  }

  status.textContent = 'Envoi…';
  // Chemin fixe par utilisateur : un nouvel upload remplace l'ancien avatar
  // au lieu d'accumuler des fichiers orphelins dans le bucket.
  const path = `${currentUser.id}/avatar`;
  const { error: upErr } = await supabaseClient.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });

  if(upErr){
    status.textContent = 'Erreur d\'envoi, réessaie.';
    status.classList.add('error');
    console.error(upErr);
    return;
  }

  const { data } = supabaseClient.storage.from('avatars').getPublicUrl(path);
  // ?t=... : l'URL publique est la même à chaque upload (chemin fixe) —
  // sans ça, le cache du navigateur (ou d'un autre visiteur) pourrait
  // garder l'ancienne image malgré le remplacement côté Storage.
  const publicUrl = `${data.publicUrl}?t=${Date.now()}`;
  document.getElementById('avatarUrlInput').value = publicUrl;
  updateAvatarPreview(publicUrl);
  status.textContent = 'Image envoyée ✓';
  e.target.value = '';
}
document.getElementById('avatarFileInput').addEventListener('change', handleAvatarFileUpload);

// --- Profil public (#/u/:userId, voir js/publicProfile.js) ---
// Juste le lien à afficher/copier ici — la case n'est enregistrée en base
// qu'au clic sur "Enregistrer" (handleSaveProfile), comme le pseudo/avatar.

function publicProfileUrl(){
  return `${location.origin}${location.pathname}#/u/${currentUser.id}`;
}

// Retour utilisateur : "je voudrais qu'avec un profil public tout le monde
// voit le top4, et pas public seul les amis" — le top films (section "Tes
// meilleurs films", plus haut dans la modale) n'est plus caché derrière
// Profil public, mais sa visibilité dépend du réglage plus bas ; ce texte le
// rappelle sans obliger à faire défiler jusqu'au switch pour comprendre.
// Lu à l'ouverture de la modale et à chaque bascule du switch — jamais une
// 2e source de vérité, juste un reflet de publicProfileToggle.checked.
function updateTopFilmsVisibilityNote(){
  const on = document.getElementById('publicProfileToggle').checked;
  document.getElementById('topFilmsVisibilityNote').textContent = on
    ? 'Visibles par tout le monde (profil public activé).'
    : 'Visibles par tes amis. Active « Profil public » plus bas pour les montrer à tout le monde.';
}

function updatePublicProfileLinkVisibility(){
  const on = document.getElementById('publicProfileToggle').checked;
  document.getElementById('publicProfileLinkHint').classList.toggle('open', on);
}
document.getElementById('publicProfileToggle').addEventListener('change', () => {
  updatePublicProfileLinkVisibility();
  updateTopFilmsVisibilityNote();
});

document.getElementById('copyPublicProfileLink').addEventListener('click', async () => {
  try{
    await navigator.clipboard.writeText(publicProfileUrl());
    showToast('Lien copié');
  }catch(e){
    showToast('Impossible de copier, sélectionne le lien à la main');
    console.error(e);
  }
});

// --- Choisir l'affiche d'un film déjà noté comme avatar ---
// Réutilise les films déjà chargés (js/app.js) et le style .tmdb-result —
// pas d'appel réseau, juste un filtre sur les films qui ont une affiche.

function renderAvatarFilmResults(query){
  const wrap = document.getElementById('avatarFilmResults');
  const q = normalizeSearch(query.trim());
  const candidates = films.filter(f => f.posterUrl && (!q || getSearchTerms(f).some(t => t.includes(q))));

  if(candidates.length === 0){
    wrap.innerHTML = `<div class="tmdb-empty">${q ? 'Aucun film avec affiche ne correspond.' : 'Aucun film avec affiche dans ton catalogue.'}</div>`;
    return;
  }

  wrap.innerHTML = '';
  candidates.slice(0, 20).forEach(f => {
    const item = document.createElement('div');
    item.className = 'tmdb-result';
    item.innerHTML = `
      <img src="${f.posterUrl}" alt="">
      <div class="tmdb-result-info">
        <div class="tmdb-result-title">${escapeHtml(f.title)}</div>
        ${f.releaseYear ? `<div class="tmdb-result-year">${f.releaseYear}</div>` : ''}
      </div>
    `;
    item.addEventListener('click', () => {
      document.getElementById('avatarUrlInput').value = f.posterUrl;
      updateAvatarPreview(f.posterUrl);
      document.getElementById('avatarUploadStatus').textContent = '';
      wrap.innerHTML = '';
      document.getElementById('avatarFilmSearch').value = '';
    });
    wrap.appendChild(item);
  });
}

document.getElementById('avatarFilmSearch').addEventListener('input', (e) => {
  renderAvatarFilmResults(e.target.value);
});

// --- Top films (v2.3, retour utilisateur) ---
// Jusqu'à 4 films du catalogue déjà noté, choisis à la main (pas triés par
// note) et réordonnables — mis en avant sur le profil public
// (js/publicProfile.js). État local (topFilmsSelection, un tableau de
// tmdb_id) écrasé à l'ouverture de la modale par currentProfile.top_films,
// persisté seulement au clic sur "Enregistrer" comme le reste du formulaire
// profil — voir handleSaveProfile().

// Réordonnable par glisser-déposer direct sur la poignée (retour
// utilisateur, même geste que l'entête) — remplace les anciens boutons
// monter/descendre, voir wireTopFilmsDrag() plus bas.
function renderTopFilmsPicker(){
  const wrap = document.getElementById('topFilmsPicker');
  if(topFilmsSelection.length === 0){
    wrap.innerHTML = `<div class="tmdb-empty">Aucun film choisi pour l'instant.</div>`;
  }else{
    // Un tmdb_id choisi avant que le film correspondant soit retiré du
    // catalogue (suppression depuis) n'a plus de match ici — ignoré à
    // l'affichage, disparaît pour de bon au prochain "Enregistrer" (le
    // tableau sauvegardé ne contient que ce qui reste rendu).
    wrap.innerHTML = topFilmsSelection.map((tmdbId) => {
      const f = films.find(x => x.tmdbId === tmdbId);
      if(!f) return '';
      return `
        <div class="top-film-chip" data-tmdb-id="${tmdbId}">
          <span class="top-film-grip" aria-hidden="true">⠿</span>
          ${f.posterUrl
            ? `<img src="${f.posterUrl}" alt="">`
            : `<div class="tmdb-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
          <div class="tmdb-result-info">
            <div class="tmdb-result-title">${escapeHtml(f.title)}</div>
            ${f.releaseYear ? `<div class="tmdb-result-year">${f.releaseYear}</div>` : ''}
          </div>
          <button type="button" class="top-film-chip-remove" data-action="remove" title="Retirer" aria-label="Retirer">✕</button>
        </div>
      `;
    }).join('');
  }
  document.getElementById('topFilmsSearch').placeholder = topFilmsSelection.length >= 4
    ? 'Maximum 4 films — retire-en un pour en ajouter un autre'
    : 'Chercher un film déjà noté…';
  wrap.querySelectorAll('.top-film-chip').forEach(chip => {
    const tmdbId = parseInt(chip.dataset.tmdbId, 10);
    chip.querySelector('button[data-action="remove"]').addEventListener('click', () => {
      const idx = topFilmsSelection.indexOf(tmdbId);
      if(idx > -1) topFilmsSelection.splice(idx, 1);
      renderTopFilmsPicker();
    });
  });
  // wireTopFilmsDrag() N'EST PAS rappelée ici : #topFilmsPicker lui-même
  // ne change jamais d'identité (seul son innerHTML est reconstruit à
  // chaque rendu) — la câbler une seule fois pour de bon, plus bas dans ce
  // fichier, évite d'empiler un jeu de listeners en double à chaque
  // ouverture de la modale ou chaque retrait de film.
}

// Glisser-déposer direct sur la poignée (retour utilisateur : "prend le
// temps de tout bien faire comme sur la draft") — même technique déjà
// éprouvée pour l'entête (wireHeaderNavDrag(), js/ui.js) : un clone
// décoratif en position:fixed suit le pointeur (.top-film-drag-ghost)
// pendant que la VRAIE ligne, sous lui, porte le réordonnancement
// (insertBefore direct dans le DOM) sans elle-même bouger à l'écran.
// L'ordre final est relu du DOM au relâchement, jamais recalculé à part.
// Câblée UNE SEULE FOIS (voir l'appel tout en bas de ce fichier) : le
// conteneur #topFilmsPicker ne change jamais d'identité, seul son contenu
// est reconstruit à chaque rendu (renderTopFilmsPicker() ci-dessus) — la
// délégation d'événements (closest() sur la poignée/la ligne, jamais un
// listener posé sur un .top-film-chip précis) retrouve les bons éléments
// à chaque geste sans avoir besoin d'être reposée.
function wireTopFilmsDrag(wrap){
  let draggedEl = null;
  let ghost = null;
  let startX = 0, startY = 0;

  wrap.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('.top-film-grip');
    if(!grip) return;
    const chip = grip.closest('.top-film-chip');
    if(!chip) return;
    draggedEl = chip;
    chip.classList.add('dragging');
    chip.setPointerCapture(e.pointerId);

    const rect = chip.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    ghost = chip.cloneNode(true);
    ghost.removeAttribute('data-tmdb-id');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.classList.add('top-film-drag-ghost');
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    ghost.style.width = rect.width + 'px';
    ghost.style.margin = '0';
    document.body.appendChild(ghost);
  });

  wrap.addEventListener('pointermove', (e) => {
    if(!draggedEl) return;
    if(ghost) ghost.style.transform = `translate(${e.clientX - startX}px, ${e.clientY - startY}px)`;
    const siblings = Array.from(wrap.querySelectorAll('.top-film-chip:not(.dragging)'));
    const after = siblings.find(sib => {
      const rect = sib.getBoundingClientRect();
      return e.clientY < rect.top + rect.height / 2;
    });
    if(after) wrap.insertBefore(draggedEl, after);
    else wrap.appendChild(draggedEl);
  });

  function endDrag(){
    if(!draggedEl) return;
    draggedEl.classList.remove('dragging');
    draggedEl = null;
    if(ghost){ ghost.remove(); ghost = null; }
    topFilmsSelection = Array.from(wrap.querySelectorAll('.top-film-chip')).map(chip => parseInt(chip.dataset.tmdbId, 10));
  }
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);
}

function renderTopFilmsResults(query){
  const wrap = document.getElementById('topFilmsResults');
  if(topFilmsSelection.length >= 4){ wrap.innerHTML = ''; return; }
  const q = normalizeSearch(query.trim());
  // tmdbId requis (pas juste une affiche, contrairement au choix d'avatar
  // ci-dessus) : top_films (migrations/032) ne stocke que des tmdb_id, un
  // film ajouté à la main sans recherche TMDB n'a rien à stocker.
  const candidates = films.filter(f => f.tmdbId && !topFilmsSelection.includes(f.tmdbId) && (!q || getSearchTerms(f).some(t => t.includes(q))));

  if(candidates.length === 0){
    wrap.innerHTML = q ? `<div class="tmdb-empty">Aucun film ne correspond.</div>` : '';
    return;
  }

  wrap.innerHTML = '';
  candidates.slice(0, 20).forEach(f => {
    const item = document.createElement('div');
    item.className = 'tmdb-result';
    item.innerHTML = `
      ${f.posterUrl ? `<img src="${f.posterUrl}" alt="">` : `<div class="tmdb-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="tmdb-result-info">
        <div class="tmdb-result-title">${escapeHtml(f.title)}</div>
        ${f.releaseYear ? `<div class="tmdb-result-year">${f.releaseYear}</div>` : ''}
      </div>
    `;
    item.addEventListener('click', () => {
      if(topFilmsSelection.length >= 4) return;
      topFilmsSelection.push(f.tmdbId);
      document.getElementById('topFilmsSearch').value = '';
      wrap.innerHTML = '';
      renderTopFilmsPicker();
    });
    wrap.appendChild(item);
  });
}

document.getElementById('topFilmsSearch').addEventListener('input', (e) => {
  renderTopFilmsResults(e.target.value);
});
wireTopFilmsDrag(document.getElementById('topFilmsPicker'));

function closeProfileModal(){
  closeOverlay('profileOverlay');
}

async function handleSaveProfile(){
  const display_name = document.getElementById('displayNameInput').value.trim() || null;
  const avatar_url = document.getElementById('avatarUrlInput').value.trim() || null;
  const public_profile = document.getElementById('publicProfileToggle').checked;
  // Ne garde que les tmdb_id qui ont effectivement un film derrière (voir le
  // commentaire dans renderTopFilmsPicker()) — jamais de trou côté base.
  const top_films = topFilmsSelection.filter(tmdbId => films.some(f => f.tmdbId === tmdbId));

  const { data, error } = await supabaseClient
    .from('profiles')
    .update({ display_name, avatar_url, public_profile, top_films })
    .eq('user_id', currentUser.id)
    .select()
    .single();

  if(error){
    showToast('Erreur de sauvegarde du profil');
    console.error(error);
    return;
  }
  currentProfile = data;
  renderUserBar();
  closeProfileModal();
  showToast('Profil mis à jour');
}

document.getElementById('userAvatarBtn').addEventListener('click', openProfileModal);
document.getElementById('closeProfile').addEventListener('click', closeProfileModal);
document.getElementById('cancelProfileBtn').addEventListener('click', closeProfileModal);
document.getElementById('saveProfileBtn').addEventListener('click', handleSaveProfile);
document.getElementById('profileOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'profileOverlay') closeProfileModal();
});
