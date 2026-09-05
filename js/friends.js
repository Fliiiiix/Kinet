// --- Amis ---
// Demande / acceptation, et profil en lecture seule (catalogue + stats) d'un
// ami une fois la demande acceptée. Table `friendships` (voir
// supabase/migrations/009) : une ligne par relation, statut pending/accepted/
// declined, symétrique (peu importe qui a demandé une fois accepted).
// La visibilité croisée du catalogue (`films`) est gérée entièrement par
// RLS côté base — ce module ne fait que lire/écrire `friendships`+`profiles`.
//
// Écran à part entière (#/amis), pas une modal — voir js/router.js, même
// principe que Groupes/Watchlist. Un groupe se fait avec des amis, donc
// l'accès à Groupes vit en bas de cette page plutôt que d'avoir sa propre
// icône dans l'entête (#amisGroupsLink, tout en bas de ce fichier).

let friendships = [];
let friendProfiles = {}; // user_id -> { displayName, avatarUrl }
let friendSearchTimer = null;
let friendSearchResults = []; // dernier lot de résultats affichés

function rowToFriendship(row){
  return {
    id: row.id,
    requesterId: row.requester_id,
    addresseeId: row.addressee_id,
    status: row.status,
    createdAt: row.created_at
  };
}

function otherUserId(f){
  return f.requesterId === currentUser.id ? f.addresseeId : f.requesterId;
}

function friendDisplayName(userId){
  return (friendProfiles[userId] && friendProfiles[userId].displayName) || 'Utilisateur';
}

function friendAvatarUrl(userId){
  return friendProfiles[userId] && friendProfiles[userId].avatarUrl;
}

function cacheProfile(userId, displayName, avatarUrl){
  friendProfiles[userId] = { displayName: displayName || null, avatarUrl: avatarUrl || null };
}

async function loadFriendships(){
  const { data, error } = await supabaseClient
    .from('friendships')
    .select('*')
    .or(`requester_id.eq.${currentUser.id},addressee_id.eq.${currentUser.id}`);
  if(error){
    showToast('Erreur de chargement des amis');
    console.error(error);
    friendships = [];
    return;
  }
  friendships = data.map(rowToFriendship);

  const ids = [...new Set(friendships.map(otherUserId))];
  if(ids.length === 0) return;
  const { data: profs, error: profErr } = await supabaseClient
    .from('profiles')
    .select('user_id, display_name, avatar_url')
    .in('user_id', ids);
  if(profErr){
    console.error(profErr);
    return;
  }
  profs.forEach(p => cacheProfile(p.user_id, p.display_name, p.avatar_url));
}

// --- Avatar rond avec repli emoji, réutilisé pour requêtes/amis/résultats ---
function friendAvatarHtml(userId, displayName){
  const url = friendAvatarUrl(userId);
  return url
    ? `<img class="friend-avatar" src="${url}" alt="${escapeHtml(displayName)}">`
    : `<div class="friend-avatar friend-avatar-placeholder">👤</div>`;
}

function friendRowHtml(userId, actionsHtml, subLabel){
  const name = friendDisplayName(userId);
  return `
    <div class="wl-row" data-user-id="${userId}">
      ${friendAvatarHtml(userId, name)}
      <div class="wl-main">
        <div class="wl-title">${escapeHtml(name)}</div>
        ${subLabel ? `<div class="wl-note">${subLabel}</div>` : ''}
      </div>
      <div class="wl-actions">${actionsHtml}</div>
    </div>
  `;
}

// Clic sur une ligne (recherche, suggestions, demandes reçues/envoyées) →
// aperçu du profil public (js/publicProfile.js), sans attendre d'être ami
// (retour utilisateur : impossible jusqu'ici de voir qui on ajoute avant
// d'envoyer/accepter une demande). onOpen personnalisable (voir
// renderFriendsPage() ci-dessous) : une fois AMI accepté, cliquer la ligne
// doit rouvrir le vrai profil en lecture seule (openFriendProfile(), qui lit
// son catalogue directement — accès garanti par la policy RLS "amis"), pas
// l'aperçu public qui dépend d'un opt-in séparé et arrive sans raison sur
// "ce profil n'est pas public" pour quelqu'un déjà ajouté (signalé par
// l'utilisateur). Reste silencieux si le profil visé n'est pas public
// (cas non-ami) — renderPublicProfilePage() l'affiche déjà clairement.
// Les boutons d'action (Ajouter/Accepter/Voir...) gardent leur propre clic,
// jamais volé par la ligne — voir le garde-fou .wl-actions ci-dessous.
function wireFriendRowClicks(container, onOpen = goToPublicProfile){
  container.querySelectorAll('.wl-row[data-user-id]').forEach(row => {
    makeRowClickable(row, (e) => {
      if(e.target.closest('.wl-actions')) return;
      onOpen(row.dataset.userId);
    });
  });
}

// Câble les boutons Accepter/Refuser/Annuler d'une ligne de demande, plus
// le clic-ligne vers l'aperçu public (onOpen par défaut de
// wireFriendRowClicks — pas encore ami, jamais openFriendProfile ici).
function wireRequestActions(el){
  el.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => handleFriendAction(btn.dataset.action, parseInt(btn.dataset.id, 10)));
  });
  wireFriendRowClicks(el);
}

function renderFriendsPage(){
  const incoming = friendships.filter(f => f.status === 'pending' && f.addresseeId === currentUser.id);
  const outgoing = friendships.filter(f => f.status === 'pending' && f.requesterId === currentUser.id);
  const accepted = friendships.filter(f => f.status === 'accepted');

  // Sections "Demandes" masquées entièrement quand vides (v2.1.x, retour
  // utilisateur : "on défile beaucoup trop") plutôt qu'un "Aucune demande
  // en attente." qui prenait de la place en permanence même sans rien à
  // signaler.
  document.getElementById('friendRequestsInSection').style.display = incoming.length === 0 ? 'none' : '';
  document.getElementById('friendRequestsOutSection').style.display = outgoing.length === 0 ? 'none' : '';

  renderCollapsible(
    document.getElementById('friendRequestsIn'), incoming,
    f => friendRowHtml(otherUserId(f), `
      <button class="btn" data-action="accept" data-id="${f.id}" type="button">Accepter</button>
      <button class="btn secondary" data-action="decline" data-id="${f.id}" type="button">Refuser</button>
    `),
    { previewCount: 4, wire: wireRequestActions }
  );

  renderCollapsible(
    document.getElementById('friendRequestsOut'), outgoing,
    f => friendRowHtml(otherUserId(f), `
      <button class="btn secondary" data-action="cancel" data-id="${f.id}" type="button">Annuler</button>
    `, 'En attente'),
    { previewCount: 4, wire: wireRequestActions }
  );

  // "Mes amis" (v2.1.x) : repliée au-delà de 6, même retour utilisateur —
  // une grande liste d'amis ne doit plus, à elle seule, repousser
  // Suggestions/Recommandé hors champ. La ligne ouvre le vrai profil en
  // lecture seule, pas l'aperçu public — voir le commentaire de
  // wireFriendRowClicks().
  renderCollapsible(
    document.getElementById('friendsList'), accepted,
    f => friendRowHtml(otherUserId(f), `
      <button class="btn secondary" data-action="view" data-id="${f.id}" type="button">Voir</button>
      <button class="btn danger" data-action="remove" data-id="${f.id}" type="button">Retirer</button>
    `),
    {
      previewCount: 6,
      emptyHtml: `<div class="tmdb-empty">Pas encore d'amis. Cherche un pseudo ou un email ci-dessus.</div>`,
      wire: (el) => {
        el.querySelectorAll('button[data-action]').forEach(btn => {
          btn.addEventListener('click', () => handleFriendAction(btn.dataset.action, parseInt(btn.dataset.id, 10)));
        });
        wireFriendRowClicks(el, openFriendProfile);
      }
    }
  );
}

async function handleFriendAction(action, friendshipId){
  const f = friendships.find(x => x.id === friendshipId);
  if(!f) return;
  if(action === 'accept') await respondToRequest(friendshipId, true);
  else if(action === 'decline') await respondToRequest(friendshipId, false);
  else if(action === 'cancel' || action === 'remove') await removeFriendship(friendshipId);
  else if(action === 'view') await openFriendProfile(otherUserId(f));
  // Accepter/refuser change le nombre de demandes en attente (voir
  // hasPendingIncomingFriendRequest(), js/activityState.js) — le badge 👥
  // doit s'éteindre immédiatement si c'était la dernière, pas seulement au
  // prochain login/reload.
  if(action === 'accept' || action === 'decline') refreshActivityBadge();
}

async function respondToRequest(id, accept){
  const { error } = await supabaseClient
    .from('friendships')
    .update({ status: accept ? 'accepted' : 'declined', responded_at: new Date().toISOString() })
    .eq('id', id);
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  if(accept){
    const f = friendships.find(x => x.id === id);
    if(f) f.status = 'accepted';
    renderFriendsPage();
    showToast('Ami ajouté');
  }else{
    // Un refus retire directement la ligne plutôt que de la garder en
    // 'declined' — évite d'encombrer les listes et permet de renvoyer une
    // demande plus tard sans butter sur la contrainte unique.
    await removeFriendship(id, false);
    showToast('Demande refusée');
  }
}

async function removeFriendship(id, notify = true){
  const { error } = await supabaseClient.from('friendships').delete().eq('id', id);
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  friendships = friendships.filter(f => f.id !== id);
  renderFriendsPage();
  if(notify) showToast('Fait');
}

// --- Ajouter un ami (recherche par email exact ou pseudo) ---

function friendshipWith(userId){
  return friendships.find(f => otherUserId(f) === userId);
}

function renderFriendSearchResults(){
  const wrap = document.getElementById('friendSearchResults');
  if(friendSearchResults.length === 0){
    wrap.innerHTML = `<div class="tmdb-empty">Aucun résultat.</div>`;
    return;
  }
  wrap.innerHTML = friendSearchResults.map(p => {
    const existing = friendshipWith(p.user_id);
    let action;
    if(existing && existing.status === 'accepted') action = `<span class="wl-note">Déjà ami</span>`;
    else if(existing && existing.status === 'pending') action = `<span class="wl-note">En attente</span>`;
    else action = `<button class="btn" data-add="${p.user_id}" type="button">Ajouter</button>`;
    return friendRowHtml(p.user_id, action);
  }).join('');
  wrap.querySelectorAll('button[data-add]').forEach(btn => {
    btn.addEventListener('click', () => sendFriendRequest(btn.dataset.add));
  });
  wireFriendRowClicks(wrap);
}

async function handleFriendSearch(query){
  const wrap = document.getElementById('friendSearchResults');
  wrap.innerHTML = `<div class="tmdb-empty">Recherche…</div>`;
  try{
    let results;
    if(query.includes('@')){
      const { data, error } = await supabaseClient.rpc('find_user_by_email', { search_email: query });
      if(error) throw error;
      results = data || [];
    }else{
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('user_id, display_name, avatar_url')
        .ilike('display_name', `%${query}%`)
        .neq('user_id', currentUser.id)
        .limit(8);
      if(error) throw error;
      results = data || [];
    }
    results.forEach(p => cacheProfile(p.user_id, p.display_name, p.avatar_url));
    friendSearchResults = results;
    renderFriendSearchResults();
  }catch(e){
    wrap.innerHTML = `<div class="tmdb-empty">Erreur de recherche.</div>`;
    console.error(e);
  }
}

async function sendFriendRequest(targetUserId){
  // Demande croisée déjà en attente dans l'autre sens : on accepte
  // directement plutôt que de créer un doublon (bloqué de toute façon par
  // la contrainte unique sur (requester_id, addressee_id)).
  const reverse = friendships.find(f => f.requesterId === targetUserId && f.addresseeId === currentUser.id && f.status === 'pending');
  if(reverse){
    await respondToRequest(reverse.id, true);
    renderFriendSearchResults();
    return;
  }

  const { data, error } = await supabaseClient
    .from('friendships')
    .insert({ requester_id: currentUser.id, addressee_id: targetUserId, status: 'pending' })
    .select()
    .single();
  if(error){
    showToast(error.code === '23505' ? 'Demande déjà envoyée' : 'Erreur, réessaie');
    console.error(error);
    return;
  }
  friendships.push(rowToFriendship(data));
  renderFriendsPage();
  renderFriendSearchResults();
  showToast('Demande envoyée');
}

document.getElementById('friendSearchInput').addEventListener('input', () => {
  clearTimeout(friendSearchTimer);
  const query = document.getElementById('friendSearchInput').value.trim();
  if(query.length < 2){
    friendSearchResults = [];
    document.getElementById('friendSearchResults').innerHTML = '';
    return;
  }
  friendSearchTimer = setTimeout(() => handleFriendSearch(query), 350);
});

// --- Fil d'activité, suggestions, recommandations (v1.6, phase 3) ---
// Trois sections pensées pour donner une raison de revenir sur cette page
// même sans demande en attente : voir qui a noté quoi (loadActivity(),
// js/activity.js), à qui envoyer une demande (get_friend_suggestions,
// migrations/021), quoi regarder ensuite (get_friend_recommendations).

async function loadFriendSuggestions(){
  const { data, error } = await supabaseClient.rpc('get_friend_suggestions', { p_limit: 8 });
  if(error){ console.error(error); return []; }
  let suggestions = data || [];
  // Complète avec des profils "au hasard" pas encore ajoutés quand les amis
  // d'amis ne suffisent pas (ex. compte tout neuf, aucun ami commun) — pas
  // besoin de SQL dédié, profiles est déjà lisible par tout compte connecté
  // (migrations/009).
  if(suggestions.length < 5){
    const exclude = new Set([currentUser.id, ...suggestions.map(s => s.user_id), ...friendships.map(otherUserId)]);
    const { data: extra, error: extraErr } = await supabaseClient
      .from('profiles')
      .select('user_id, display_name, avatar_url')
      .order('created_at', { ascending: false })
      .limit(30); // marge large : on filtre ensuite côté client (exclusions)
    if(extraErr) console.error(extraErr);
    else{
      extra.filter(p => !exclude.has(p.user_id)).slice(0, 5 - suggestions.length).forEach(p => {
        suggestions.push({ user_id: p.user_id, display_name: p.display_name, avatar_url: p.avatar_url, mutual_count: 0 });
      });
    }
  }
  suggestions.forEach(s => cacheProfile(s.user_id, s.display_name, s.avatar_url));
  return suggestions;
}

function renderFriendSuggestions(suggestions){
  const wrap = document.getElementById('friendSuggestionsList');
  if(suggestions.length === 0){
    wrap.innerHTML = `<div class="tmdb-empty">Pas de suggestion pour l'instant.</div>`;
    return;
  }
  wrap.innerHTML = suggestions.map(s => friendRowHtml(
    s.user_id,
    `<button class="btn" data-add="${s.user_id}" type="button">Ajouter</button>`,
    s.mutual_count > 0 ? `${s.mutual_count} ami${s.mutual_count > 1 ? 's' : ''} en commun` : null
  )).join('');
  wrap.querySelectorAll('button[data-add]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await sendFriendRequest(btn.dataset.add);
      openFriendsSideSections();
    });
  });
  wireFriendRowClicks(wrap);
}

async function loadFriendRecommendations(){
  const { data, error } = await supabaseClient.rpc('get_friend_recommendations', { p_limit: 15 });
  if(error){ console.error(error); return []; }
  return data || [];
}

function renderFriendRecommendations(films){
  const wrap = document.getElementById('friendRecommendationsList');
  wrap.innerHTML = films.length === 0
    ? `<div class="tmdb-empty">Rien à recommander pour l'instant. Note plus de films en commun avec tes amis.</div>`
    : films.map(f => `
        <div class="wl-row" data-tmdb-id="${f.tmdb_id}">
          ${f.poster_url
            ? `<img class="film-poster" src="${f.poster_url}" alt="" loading="lazy">`
            : `<div class="film-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
          <div class="wl-main">
            <div class="wl-title">${escapeHtml(f.title)}${f.release_year ? ` <span class="wl-year">(${f.release_year})</span>` : ''}</div>
            <div class="wl-note">${f.rating_count} note${f.rating_count > 1 ? 's' : ''} dans ton cercle</div>
          </div>
          <div class="counter ${noteColorClass(Number(f.avg_note))}">${Number(f.avg_note).toFixed(1)}</div>
        </div>
      `).join('');
  // Fiche film (retour utilisateur, audit) — voir le même commentaire dans
  // renderGroupTopFilms(), js/groups.js.
  wrap.querySelectorAll('[data-tmdb-id]').forEach(row => {
    makeRowClickable(row, () => goToFilmDetail(parseInt(row.dataset.tmdbId, 10)));
  });
}

// --- Compatibilité ciné (v1.6, phase 4) — voir openFriendProfile() plus
// bas. get_friend_compatibility() (migrations/022) renvoie un résultat vide
// si la relation n'est pas (ou plus) une amitié acceptée : compat est alors
// null ici, la tuile ne s'affiche simplement pas.
async function loadFriendCompatibility(userId){
  const { data, error } = await supabaseClient.rpc('get_friend_compatibility', { p_friend_id: userId });
  if(error){ console.error(error); return null; }
  const row = data && data[0];
  return (row && row.common_count > 0) ? row : null;
}

// Rechargées après un ajout d'ami depuis les suggestions (le compteur
// d'amis en commun / la liste elle-même doivent refléter le changement),
// sans redemander la liste des demandes en cours.
async function openFriendsSideSections(){
  const [activity, suggestions, recommendations] = await Promise.all([
    loadActivity({ scope: 'friend', limit: 15 }),
    loadFriendSuggestions(),
    loadFriendRecommendations()
  ]);
  renderActivityListInto(document.getElementById('friendActivityList'), activity);
  renderFriendSuggestions(suggestions);
  renderFriendRecommendations(recommendations);
}

// --- Page amis (liste + demandes) — appelée par le routeur (#/amis). ---

async function openFriends(){
  document.getElementById('friendRequestsIn').innerHTML = `<div class="tmdb-empty">Chargement…</div>`;
  document.getElementById('friendRequestsOut').innerHTML = '';
  document.getElementById('friendsList').innerHTML = '';
  document.getElementById('friendSearchInput').value = '';
  document.getElementById('friendSearchResults').innerHTML = '';
  document.getElementById('friendActivityList').innerHTML = `<div class="tmdb-empty">Chargement…</div>`;
  document.getElementById('friendSuggestionsList').innerHTML = `<div class="tmdb-empty">Chargement…</div>`;
  document.getElementById('friendRecommendationsList').innerHTML = `<div class="tmdb-empty">Chargement…</div>`;
  await loadFriendships();
  renderFriendsPage();
  await openFriendsSideSections();
  markSeen('amis'); // pas attendu : n'a pas à retarder l'affichage de la page
}

document.getElementById('friendsBtn').addEventListener('click', goToAmis);
document.getElementById('amisPageBack').addEventListener('click', goHome);
document.getElementById('amisGroupsLink').addEventListener('click', goToGroups);

// --- Profil d'un ami (lecture seule : catalogue + stats) ---
// Les films sont lus directement depuis Supabase (pas depuis `films`, qui
// reste le catalogue de l'utilisateur connecté) — accessible grâce à la
// policy RLS "Friends can view shared films" tant que la relation est
// accepted, voir supabase/migrations/009.

async function openFriendProfile(userId){
  document.getElementById('friendProfileTitle').textContent = friendDisplayName(userId);
  const content = document.getElementById('friendProfileContent');
  content.innerHTML = `<div class="tmdb-empty">Chargement…</div>`;
  openOverlay('friendProfileOverlay');

  const [{ data, error }, compat] = await Promise.all([
    supabaseClient.from('films').select('*').eq('user_id', userId).order('added', { ascending: false }),
    loadFriendCompatibility(userId)
  ]);
  if(error){
    content.innerHTML = `<div class="empty-state">Impossible de charger ce catalogue.</div>`;
    console.error(error);
    return;
  }

  const friendFilms = data.map(rowToFilm);
  const statsEl = document.createElement('div');
  renderStatsInto(statsEl, friendFilms);

  // Trie affiché uniquement — statsFilmRowHtml() (js/stats.js) : même
  // gabarit que la liste derrière une barre de la distribution des notes,
  // réutilisé tel quel maintenant que les deux ouvrent la même popup au
  // clic (voir openFilmReviewDetail()) plutôt que de diverger.
  const sortedFriendFilms = friendFilms.slice().sort((a, b) => (getDisplayNote(b) || 0) - (getDisplayNote(a) || 0));
  const listHtml = friendFilms.length === 0
    ? `<div class="empty-state">Aucun film noté pour l'instant.</div>`
    : sortedFriendFilms.map(statsFilmRowHtml).join('');

  content.innerHTML = '';
  if(compat){
    const compatEl = document.createElement('div');
    compatEl.className = 'ach-summary reveal';
    compatEl.innerHTML = `
      <div class="ach-summary-count">${compat.compatibility}%</div>
      <div class="ach-summary-label">Compatibilité ciné · ${compat.common_count} film${compat.common_count > 1 ? 's' : ''} en commun</div>
      <div class="ach-summary-bar"><div class="ach-summary-fill" style="width:${Math.max(0, Math.min(100, compat.compatibility))}%"></div></div>
    `;
    content.appendChild(compatEl);
  }

  // Comparaison détaillée (retour utilisateur) : au-delà du % agrégé
  // ci-dessus (get_friend_compatibility, jamais de user_id ni de note
  // individuelle exposée pour un tiers quelconque), le catalogue complet
  // de CET ami précis est déjà chargé ici même (RLS "Friends can view
  // shared films") — recouper par tmdb_id avec mon propre `films` ne
  // demande donc aucune requête ni fonction SQL supplémentaire. Triés par
  // écart de note décroissant : les désaccords sont ce qu'une comparaison
  // a de plus intéressant à montrer, pas seulement les points communs.
  if(friendFilms.length > 0){
    const myFilmsByTmdbId = new Map(films.filter(f => f.tmdbId).map(f => [f.tmdbId, f]));
    const commonFilms = friendFilms
      .filter(f => f.tmdbId && myFilmsByTmdbId.has(f.tmdbId))
      .map(f => {
        const mine = myFilmsByTmdbId.get(f.tmdbId);
        const myNote = getDisplayNote(mine);
        const theirNote = getDisplayNote(f);
        const gap = (myNote != null && theirNote != null) ? Math.abs(myNote - theirNote) : -1;
        return { tmdbId: f.tmdbId, title: f.title, releaseYear: f.releaseYear, posterUrl: f.posterUrl, myNote, theirNote, gap };
      })
      .sort((a, b) => b.gap - a.gap);

    if(commonFilms.length > 0){
      const commonWrap = document.createElement('div');
      commonWrap.className = 'stats-section reveal';
      commonWrap.innerHTML = `<div class="stats-section-title">Films en commun (${commonFilms.length})</div><div id="friendCommonList"></div>`;
      content.appendChild(commonWrap);
      renderCollapsible(commonWrap.querySelector('#friendCommonList'), commonFilms, (f) => `
        <div class="wl-row" data-tmdb-id="${f.tmdbId}">
          ${f.posterUrl
            ? `<img class="film-poster" src="${f.posterUrl}" alt="" loading="lazy">`
            : `<div class="film-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
          <div class="wl-main">
            <div class="wl-title">${escapeHtml(f.title)}${f.releaseYear ? ` <span class="wl-year">(${f.releaseYear})</span>` : ''}</div>
            <div class="wl-note">Toi : ${f.myNote != null ? f.myNote.toFixed(1) : '—'} · ${escapeHtml(friendDisplayName(userId))} : ${f.theirNote != null ? f.theirNote.toFixed(1) : '—'}</div>
          </div>
        </div>
      `, { previewCount: 6 });
      commonWrap.querySelectorAll('[data-tmdb-id]').forEach(row => {
        makeRowClickable(row, () => goToFilmDetail(parseInt(row.dataset.tmdbId, 10)));
      });
    }
  }

  content.appendChild(statsEl);

  // Catalogue complet replié par défaut (v2.5, retour utilisateur : les
  // stats suffisent d'un coup d'œil — leur barre de distribution cliquable
  // (voir wireStatsDistribution(), js/stats.js) montre déjà les films
  // derrière une note précise ; défiler la liste ENTIÈRE en plus était de
  // trop). Bouton dédié pour qui veut vraiment tout voir.
  if(friendFilms.length > 0){
    const listWrap = document.createElement('div');
    listWrap.className = 'stats-section reveal';
    listWrap.hidden = true;
    listWrap.innerHTML = `<div class="stats-section-title">Catalogue (${friendFilms.length})</div>${listHtml}`;
    // Ouvre le détail de la critique par-dessus le profil (voir le
    // commentaire sur #filmReviewOverlay, index.html) — plus besoin de
    // fermer ce profil avant, contrairement à l'ancien lien direct vers la
    // fiche TMDB.
    listWrap.querySelectorAll('[data-film-id]').forEach(row => {
      makeRowClickable(row, () => {
        const film = sortedFriendFilms.find(f => f.id === Number(row.dataset.filmId));
        if(film) openFilmReviewDetail(film);
      });
    });

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'btn secondary list-toggle-btn';
    toggleBtn.textContent = `Voir tous les films notés (${friendFilms.length})`;
    toggleBtn.addEventListener('click', () => {
      listWrap.hidden = !listWrap.hidden;
      toggleBtn.textContent = listWrap.hidden
        ? `Voir tous les films notés (${friendFilms.length})`
        : 'Masquer la liste';
    });

    content.appendChild(toggleBtn);
    content.appendChild(listWrap);
  }

  // Après coup, jamais depuis renderStatsInto() : statsEl était encore
  // détaché du document au moment où elle l'a peuplée (voir son
  // commentaire) — observer maintenant couvre à la fois son propre
  // contenu et compatEl/listWrap ci-dessus.
  observeReveal(content);
}

// Amis est une page (pas une modal, voir plus haut) : la refermer suffit,
// elle revient naturellement sur la page Amis en dessous — plus besoin de
// fermer quoi que ce soit d'autre.
function closeFriendProfile(){
  closeOverlay('friendProfileOverlay');
}

document.getElementById('closeFriendProfile').addEventListener('click', closeFriendProfile);
document.getElementById('friendProfileOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'friendProfileOverlay') closeFriendProfile();
});
