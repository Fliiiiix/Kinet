// --- Page Profil (#/profil) ---
// Draft navigation, option B (validée le 15/10, audit M1) : la grande
// fenêtre « Ton profil » devient une vraie page. Elle ne réimplémente rien :
// chaque rangée [data-proxy] relaie le clic au bouton d'origine, resté dans
// #profileOverlay (masqué par .pf-hub), pour que stats.js, achievements.js,
// tcg.js, journal.js, settings.js, app.js... restent branchés sur les mêmes
// ids. « Modifier le profil » ouvre #profileOverlay, réduit à la photo, au
// pseudo et aux films préférés.

// Rubriques affichées en page plutôt qu'en fenêtre (.overlay.as-page,
// index.html) : Statistiques, Succès, Cartes, Journal. L'entête et la barre
// du bas restent visibles au-dessus d'elles (css/style.css, bloc
// « OPTION B ») ; changer de page doit donc aussi les refermer.
function closeAsPageOverlays(){
  document.querySelectorAll('.overlay.as-page.open').forEach(el => closeOverlay(el.id));
}
window.addEventListener('hashchange', closeAsPageOverlays);

// Hauteur réelle de l'entête, pour que ces rubriques commencent juste
// dessous (elle change entre PC et téléphone, et avec la taille du texte).
function syncAppHeaderHeight(){
  const header = document.querySelector('header');
  if(!header) return;
  document.documentElement.style.setProperty('--app-header-h', `${Math.round(header.getBoundingClientRect().height)}px`);
}
if(typeof ResizeObserver === 'function'){
  const headerEl = document.querySelector('header');
  if(headerEl) new ResizeObserver(syncAppHeaderHeight).observe(headerEl);
}
syncAppHeaderHeight();

function profilePageFriendCount(){
  return (typeof friendships !== 'undefined' && Array.isArray(friendships))
    ? friendships.filter(f => f.status === 'accepted').length
    : 0;
}

function ppPlural(n, word){
  return `${n} ${word}${n > 1 ? 's' : ''}`;
}

function renderProfilePageHead(){
  const name = (currentProfile && currentProfile.display_name) || (currentUser && currentUser.email) || '';
  document.getElementById('ppName').textContent = name;
  const shows = (typeof trackedShows !== 'undefined' && Array.isArray(trackedShows)) ? trackedShows.length : 0;
  document.getElementById('ppSub').textContent = [
    ppPlural(films.length, 'film'),
    ppPlural(shows, 'série'),
    ppPlural(profilePageFriendCount(), 'ami')
  ].join(' · ');

  const img = document.getElementById('ppAvatarImg');
  const fallback = document.getElementById('ppAvatarFallback');
  const avatarUrl = currentProfile && currentProfile.avatar_url;
  if(avatarUrl){
    img.src = avatarUrl;
    img.style.display = '';
    fallback.style.display = 'none';
  }else{
    img.style.display = 'none';
    fallback.style.display = '';
  }
}

function renderProfilePageFigures(){
  const s = computeStats(films);
  const figures = [
    [String(s.total), 'Films notés'],
    [s.avg !== null ? s.avg.toFixed(1) : '—', 'Note moyenne'],
    [String(s.favCount), 'Favoris'],
    [rythmeAnnuel(s), 'Films par mois']
  ];
  document.getElementById('ppFigures').innerHTML = figures.map(([value, label]) => `
    <div class="pp-figure"><b>${escapeHtml(value)}</b><span>${label}</span></div>
  `).join('');
}

// Les 4 films préférés (currentProfile.top_films, choisis dans « Modifier le
// profil »). Sans choix : une invitation à les choisir, jamais une case vide.
function renderProfilePageFavs(){
  const wrap = document.getElementById('ppFavs');
  const ids = (currentProfile && Array.isArray(currentProfile.top_films)) ? currentProfile.top_films : [];
  const picked = ids.map(id => films.find(f => f.tmdbId === id)).filter(Boolean);
  if(picked.length === 0){
    wrap.innerHTML = `<button type="button" class="pp-favs-empty" id="ppFavsPickBtn">Choisis tes 4 films préférés</button>`;
    document.getElementById('ppFavsPickBtn').addEventListener('click', openProfileModal);
    return;
  }
  const navList = picked.map(f => ({ tmdbId: f.tmdbId, title: f.title }));
  wrap.innerHTML = picked.map(f => `
    <button type="button" class="pp-fav" data-tmdb-id="${f.tmdbId}" aria-label="${escapeHtml(f.title)}">
      ${f.posterUrl
        ? `<img class="pp-fav-poster" src="${f.posterUrl}" alt="" loading="lazy" decoding="async">`
        : `<span class="pp-fav-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</span>`}
      <span class="pp-fav-title">${escapeHtml(f.title)}</span>
    </button>
  `).join('');
  wrap.querySelectorAll('.pp-fav').forEach(btn => {
    btn.addEventListener('click', () => goToFilmDetail(parseInt(btn.dataset.tmdbId, 10), navList));
  });
}

function renderProfilePageRows(){
  document.getElementById('ppRecapLabel').textContent = `Bilan ${new Date().getFullYear()}`;

  const a = computeAchievements();
  document.getElementById('ppAchVal').textContent =
    `${a.tiersUnlocked + a.hiddenUnlocked} / ${a.tiersTotal + a.hiddenTotal}`;

  // Reflets des boutons d'origine (badge d'échanges, Nouveautés, Admin) :
  // leur JS reste seul juge de ce qui doit apparaître.
  const tradeBadge = document.getElementById('tcgTradeBadge');
  const ppBadge = document.getElementById('ppTcgBadge');
  ppBadge.hidden = !tradeBadge || tradeBadge.hidden;
  ppBadge.textContent = tradeBadge ? tradeBadge.textContent : '';
  const changelogLink = document.getElementById('profileChangelogLinkBtn');
  document.getElementById('ppChangelogRow').hidden = !changelogLink || changelogLink.style.display === 'none';
  document.getElementById('ppAdminRow').hidden = !(typeof isAdmin === 'function' && isAdmin());

  const isPublic = !!(currentProfile && currentProfile.public_profile);
  document.getElementById('ppPublicToggle').checked = isPublic;
  document.getElementById('ppCopyLinkBtn').hidden = !isPublic;
}

function renderProfilePage(){
  if(!currentUser) return;
  renderProfilePageHead();
  renderProfilePageFigures();
  renderProfilePageFavs();
  renderProfilePageRows();
}

// Cartes possédées / cartes du catalogue, comme l'en-tête de la collection
// (js/tcg.js) : deux comptages légers, sans charger la collection entière.
async function refreshProfilePageCards(){
  const el = document.getElementById('ppTcgVal');
  try{
    const [{ count, error }] = await Promise.all([
      supabaseClient.from('tcg_user_cards').select('card_id', { count: 'exact', head: true }).eq('user_id', currentUser.id),
      (typeof refreshCatalogTotal === 'function') ? refreshCatalogTotal() : Promise.resolve()
    ]);
    if(error || typeof tcgCatalogTotal === 'undefined' || !tcgCatalogTotal){ el.textContent = ''; return; }
    el.textContent = `${count || 0} / ${tcgCatalogTotal}`;
  }catch(e){
    el.textContent = '';
  }
}

// Appelée par renderRoute() (js/router.js). Affiche tout de suite avec ce
// qui est déjà en mémoire, puis recharge séries, amis et badge d'échanges
// (normalement chargés seulement sur leur propre page) pour des chiffres
// justes : même préchargement qu'openAchievements() (js/achievements.js).
async function openProfilePage(){
  renderProfilePage();
  await Promise.all([
    (typeof loadTrackedShows === 'function') ? loadTrackedShows() : Promise.resolve(),
    (typeof loadFriendships === 'function') ? loadFriendships() : Promise.resolve(),
    (typeof refreshTradeBadge === 'function') ? refreshTradeBadge() : Promise.resolve()
  ]).catch(e => console.error(e));
  if(parseRoute().name !== 'profil') return;
  renderProfilePage();
  refreshProfilePageCards();
  // Pastilles : réponse à un avis (js/feedback.js), choses à traiter (admin).
  if(typeof refreshAvisBadge === 'function') refreshAvisBadge().catch(e => console.error(e));
  if(typeof refreshAdminCounts === 'function') refreshAdminCounts().catch(e => console.error(e));
}

// Rangées relais : un clic = un clic sur le bouton d'origine. Le geste reste
// celui de l'utilisateur (l'ouverture du sélecteur de fichier d'« Importer »
// passe donc toujours).
document.getElementById('profilePage').addEventListener('click', (e) => {
  const row = e.target.closest('[data-proxy]');
  if(!row) return;
  const target = document.getElementById(row.dataset.proxy);
  if(target) target.click();
});

document.getElementById('ppEditBtn').addEventListener('click', openProfileModal);
document.getElementById('ppRecapBtn').addEventListener('click', openYearRecap);

// Profil public : enregistré tout de suite (plus de bouton « Enregistrer »
// ici, contrairement à l'ancienne fenêtre). La case de #profileOverlay est
// recalée sur currentProfile à sa prochaine ouverture (openProfileModal()).
// Partagée avec Paramètres → Confidentialité (js/settings.js). Vrai si
// c'est enregistré.
async function savePublicProfile(on){
  if(blockIfOffline()) return false;
  const { data, error } = await supabaseClient
    .from('profiles')
    .update({ public_profile: on })
    .eq('user_id', currentUser.id)
    .select()
    .single();
  if(error){
    showToast('Erreur de sauvegarde, réessaie');
    console.error(error);
    return false;
  }
  currentProfile = data;
  document.getElementById('ppPublicToggle').checked = on;
  document.getElementById('ppCopyLinkBtn').hidden = !on;
  showToast(on ? 'Profil partagé' : 'Profil plus partagé');
  return true;
}

document.getElementById('ppPublicToggle').addEventListener('change', async (e) => {
  const on = e.target.checked;
  if(!(await savePublicProfile(on))) e.target.checked = !on;
});

document.getElementById('ppCopyLinkBtn').addEventListener('click', () => {
  document.getElementById('copyPublicProfileLink').click();
});
