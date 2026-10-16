// --- Amis ---
// Demande / acceptation, et profil en lecture seule (catalogue + stats) d'un
// ami une fois la demande acceptée. Table `friendships` (voir
// supabase/migrations/009) : une ligne par relation, statut pending/accepted/
// declined, symétrique (peu importe qui a demandé une fois accepted).
// La visibilité croisée du catalogue (`films`) est gérée entièrement par
// RLS côté base — ce module ne fait que lire/écrire `friendships`+`profiles`.
//
// Écran à part entière (#/amis), pas une modal — voir js/router.js, même
// principe que Groupes/Watchlist. Un groupe se fait avec des amis : le
// titre de la page sert d'interrupteur Amis · Groupes · Listes (draft Amis
// du 15/10, [data-social] tout en bas de ce fichier).

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
    ? `<img loading="lazy" decoding="async" class="friend-avatar" src="${escapeHtml(url)}" alt="${escapeHtml(displayName)}">`
    : `<div class="friend-avatar friend-avatar-placeholder">${uiIcon('user')}</div>`;
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
// Comparaison avec un ami : les films que nous avons TOUS LES DEUX notés, avec
// nos deux notes et l'écart. La règle d'accès (migration 009, plus 054 pour les
// films privés) ne laisse lire que les films visibles par un ami : on ne lit
// donc rien d'autre. Calcul fait dans le navigateur, rien n'est enregistré.
async function compareWithFriend(friendId, rowEl){
  if(blockIfOffline()) return;
  const existant = document.getElementById('friendComparePanel');
  if(existant && existant.dataset.friend === friendId){ existant.remove(); return; }
  if(existant) existant.remove();

  const { data, error } = await supabaseClient
    .from('films')
    .select('title, tmdb_id, manual_note, crit')
    .eq('user_id', friendId);
  if(error){ showToast('Comparaison indisponible, réessaie'); console.error(error); return; }

  const parTmdb = new Map((data || []).filter(f => f.tmdb_id).map(f => [f.tmdb_id, f]));
  const communs = films
    .filter(f => f.tmdbId && parTmdb.has(f.tmdbId))
    .map(f => {
      const amie = parTmdb.get(f.tmdbId);
      const note = (n) => (Number.isFinite(n) ? n : null);
      const maNote = note(getDisplayNote(f));
      const sienne = note(getDisplayNote({ manualNote: amie.manual_note != null ? parseFloat(amie.manual_note) : null, crit: amie.crit || {} }));
      return { titre: f.title, maNote, sienne, ecart: maNote != null && sienne != null ? maNote - sienne : null };
    })
    .sort((a, b) => Math.abs(b.ecart ?? 0) - Math.abs(a.ecart ?? 0));

  const panel = document.createElement('div');
  panel.id = 'friendComparePanel';
  panel.dataset.friend = friendId;
  panel.className = 'stats-section reveal';
  const ami = friendDisplayName(friendId);
  panel.innerHTML = `
    <div class="stats-section-title">Comparaison avec ${escapeHtml(ami)}</div>
    ${communs.length === 0
      ? `<div class="empty-state">Vous n'avez encore aucun film noté en commun.</div>`
      : `<div class="wl-note">${communs.length} film${communs.length > 1 ? 's' : ''} noté${communs.length > 1 ? 's' : ''} en commun, les plus grands écarts d'abord.</div>
         ${communs.map(c => `<div class="wl-row"><div class="wl-main"><div class="wl-title">${escapeHtml(c.titre)}</div><div class="wl-note">Toi ${c.maNote != null ? c.maNote.toFixed(1) : '—'} · ${escapeHtml(ami)} ${c.sienne != null ? c.sienne.toFixed(1) : '—'}${c.ecart != null ? ` · écart ${c.ecart > 0 ? '+' : ''}${c.ecart.toFixed(1)}` : ''}</div></div></div>`).join('')}`}`;
  rowEl.insertAdjacentElement('afterend', panel);
}

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

// --- Lignes d'amis : en phase ou pas (draft Amis du 15/10, lignes de la
// piste B) --- friendStats : userId -> { compat, common, last }, chargé à
// l'ouverture de la page : compatibilité (get_friend_compatibility,
// migrations/022, films notés en commun) et dernier film noté, lu dans son
// catalogue (accessible tant que l'amitié est acceptée, migrations/009).
// Le pourcentage ne s'affiche qu'à partir de 5 films en commun.
let friendStats = {};
const FRIEND_COMPAT_MIN_COMMON = 5;

function friendFilmNote(row){
  const n = getDisplayNote({ manualNote: row.manual_note != null ? parseFloat(row.manual_note) : null, crit: row.crit || {} });
  return Number.isFinite(n) ? n : null;
}

async function loadFriendStats(userIds){
  const entries = await Promise.all(userIds.map(async id => {
    const [compatRes, lastRes] = await Promise.all([
      supabaseClient.rpc('get_friend_compatibility', { p_friend_id: id }),
      supabaseClient.from('films').select('title, tmdb_id, poster_url, manual_note, crit')
        .eq('user_id', id).order('added', { ascending: false }).limit(1)
    ]);
    if(compatRes.error) console.error(compatRes.error);
    if(lastRes.error) console.error(lastRes.error);
    const row = compatRes.data && compatRes.data[0];
    const lastFilm = lastRes.data && lastRes.data[0];
    return [id, {
      compat: row && row.compatibility != null ? Number(row.compatibility) : null,
      common: row ? (row.common_count || 0) : 0,
      last: lastFilm ? { title: lastFilm.title, tmdbId: lastFilm.tmdb_id, posterUrl: lastFilm.poster_url, note: friendFilmNote(lastFilm) } : null
    }];
  }));
  friendStats = Object.fromEntries(entries);
}

function friendCompatHtml(stats){
  if(!stats) return '<div class="fr-compat"></div>';
  if(stats.compat != null && stats.common >= FRIEND_COMPAT_MIN_COMMON){
    return `<div class="fr-compat"><b>${Math.round(stats.compat)} %</b><span>en phase</span></div>`;
  }
  return '<div class="fr-compat is-low"><span>pas assez en commun</span></div>';
}

function friendRichRowHtml(f){
  const userId = otherUserId(f);
  const name = friendDisplayName(userId);
  const stats = friendStats[userId];
  const sub = !stats ? '' : [
    stats.common ? `${stats.common} film${stats.common > 1 ? 's' : ''} en commun` : 'Aucun film en commun',
    stats.last ? `dernier : ${escapeHtml(stats.last.title)}` : ''
  ].filter(Boolean).join(' · ');
  const last = stats && stats.last && stats.last.posterUrl
    ? `<div class="fr-last"><img src="${escapeHtml(stats.last.posterUrl)}" alt="" loading="lazy">${stats.last.note != null ? `<span class="fr-note ${noteColorClass(stats.last.note)}">${stats.last.note.toFixed(1)}</span>` : ''}</div>`
    : '';
  return `
    <div class="fr-row" data-user-id="${userId}">
      ${friendAvatarHtml(userId, name)}
      <div class="fr-main">
        <div class="fr-name">${escapeHtml(name)}</div>
        ${sub ? `<div class="fr-sub">${sub}</div>` : ''}
      </div>
      ${last}
      ${friendCompatHtml(stats)}
      <div class="wl-actions">${rowMoreButtonHtml(`Actions pour ${name}`)}</div>
    </div>
  `;
}

// Les plus en phase d'abord, puis ceux sans pourcentage, par pseudo.
function sortFriendsByCompat(accepted){
  const score = (f) => {
    const st = friendStats[otherUserId(f)];
    return st && st.compat != null && st.common >= FRIEND_COMPAT_MIN_COMMON ? st.compat : -1;
  };
  return accepted.slice().sort((a, b) => (score(b) - score(a))
    || friendDisplayName(otherUserId(a)).localeCompare(friendDisplayName(otherUserId(b)), 'fr'));
}

// La ligne ouvre le vrai profil en lecture seule ; le menu « ⋯ » garde
// comparer, échanger des cartes, retirer (audit C1).
function wireFriendRows(el, accepted){
  el.querySelectorAll('.fr-row[data-user-id]').forEach(row => {
    const friendId = row.dataset.userId;
    const friendship = accepted.find(f => otherUserId(f) === friendId);
    makeRowClickable(row, (e) => {
      if(e.target.closest('.wl-actions')) return;
      openFriendProfile(friendId);
    });
    const moreBtn = row.querySelector('.row-more-btn');
    if(!moreBtn || !friendship) return;
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openRowMenu(moreBtn, [
        { label: 'Comparer nos notes', onSelect: () => compareWithFriend(friendId, row) },
        // Ouvre directement la fenêtre cartes sur l'onglet échange, avec
        // cet ami déjà sélectionné (voir openTcgTradeWith()).
        { label: 'Échanger des cartes', onSelect: () => openTcgTradeWith(friendId) },
        { label: 'Retirer de mes amis', danger: true, onSelect: () => handleFriendAction('remove', friendship.id) }
      ]);
    });
  });
}

// Son de notification : une demande d'ami entrante de plus depuis le dernier
// affichage joue un tintement (même réglage Son que le reste de l'app).
// Premier affichage silencieux : on ne sonne pas pour ce qui était déjà là.
let demandesVues = null;

function renderFriendsPage(){
  const incoming = friendships.filter(f => f.status === 'pending' && f.addresseeId === currentUser.id);
  if(demandesVues !== null && incoming.length > demandesVues) playPopChime();
  demandesVues = incoming.length;
  const outgoing = friendships.filter(f => f.status === 'pending' && f.requesterId === currentUser.id);
  const accepted = friendships.filter(f => f.status === 'accepted');

  // Demandes reçues : en tête de page, la chose la plus urgente (audit A7),
  // masquées quand il n'y en a pas.
  document.getElementById('friendRequestsInSection').style.display = incoming.length === 0 ? 'none' : '';
  const inEl = document.getElementById('friendRequestsIn');
  inEl.innerHTML = incoming.map(f => {
    const id = otherUserId(f);
    const name = friendDisplayName(id);
    return `
      <div class="wl-row fr-request" data-user-id="${id}">
        ${friendAvatarHtml(id, name)}
        <div class="wl-main"><div class="wl-title"><b>${escapeHtml(name)}</b> veut t’ajouter en ami</div></div>
        <div class="wl-actions">
          <button class="fr-text-btn" data-action="decline" data-id="${f.id}" type="button">Refuser</button>
          <button class="btn" data-action="accept" data-id="${f.id}" type="button">Accepter</button>
        </div>
      </div>`;
  }).join('');
  wireRequestActions(inEl);

  // Demandes envoyées : dans « + Ajouter un ami », plus en pleine page.
  document.getElementById('friendRequestsOutSection').style.display = outgoing.length === 0 ? 'none' : '';
  renderCollapsible(
    document.getElementById('friendRequestsOut'), outgoing,
    f => friendRowHtml(otherUserId(f), `<button class="fr-line-btn" data-action="cancel" data-id="${f.id}" type="button">Annuler</button>`, 'En attente'),
    { previewCount: 4, wire: wireRequestActions }
  );

  // Tes amis : les plus en phase d'abord, 4 visibles (audit A4).
  document.getElementById('friendsCount').textContent = accepted.length ? String(accepted.length) : '';
  renderCollapsible(
    document.getElementById('friendsList'), sortFriendsByCompat(accepted), friendRichRowHtml,
    {
      previewCount: 4,
      emptyHtml: '<div class="empty-state">Pas encore d’amis. Ouvre « + Ajouter un ami » plus bas.</div>',
      wire: (el) => wireFriendRows(el, accepted)
    }
  );
}

async function handleFriendAction(action, friendshipId){
  const f = friendships.find(x => x.id === friendshipId);
  if(!f) return;
  if(action === 'accept') await respondToRequest(friendshipId, true);
  else if(action === 'decline') await respondToRequest(friendshipId, false);
  else if(action === 'cancel') await removeFriendship(friendshipId);
  // 'remove' = retirer un ami déjà accepté (pas juste annuler sa propre
  // demande en attente, geste bien plus léger) — audit confirmations : la
  // seule action destructrice de cette page sans aucune confirmation,
  // alors que retirer un membre de groupe (moins définitif, on peut le
  // réinviter) en a déjà une.
  else if(action === 'remove'){
    if(!confirm(`Retirer ${friendDisplayName(otherUserId(f))} de tes amis ?`)) return;
    await removeFriendship(friendshipId);
  }
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
    else action = `<button class="fr-line-btn" data-add="${p.user_id}" type="button">Ajouter</button>`;
    return friendRowHtml(p.user_id, action);
  }).join('');
  wrap.querySelectorAll('button[data-add]').forEach(btn => {
    btn.addEventListener('click', withSubmitGuard(btn, () => sendFriendRequest(btn.dataset.add)));
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
    wrap.innerHTML = `<div class="empty-state">Pas de suggestion pour l'instant.</div>`;
    return;
  }
  wrap.innerHTML = suggestions.map(s => friendRowHtml(
    s.user_id,
    `<button class="fr-line-btn" data-add="${s.user_id}" type="button">Ajouter</button>`,
    s.mutual_count > 0 ? `${s.mutual_count} ami${s.mutual_count > 1 ? 's' : ''} en commun` : null
  )).join('');
  wrap.querySelectorAll('button[data-add]').forEach(btn => {
    btn.addEventListener('click', withSubmitGuard(btn, async () => {
      await sendFriendRequest(btn.dataset.add);
      openFriendsSideSections();
    }));
  });
  wireFriendRowClicks(wrap);
}

async function loadFriendRecommendations(){
  const { data, error } = await supabaseClient.rpc('get_friend_recommendations', { p_limit: 12 });
  if(error){ console.error(error); return []; }
  return data || [];
}

function renderFriendRecommendations(films){
  const wrap = document.getElementById('friendRecommendationsList');
  // En affiches, la moyenne de ton cercle dans le coin (audit A5).
  wrap.innerHTML = films.length === 0
    ? '<div class="empty-state">Rien à recommander pour l’instant. Note plus de films en commun avec tes amis.</div>'
    : films.map(f => `
        <div class="fr-poster" data-tmdb-id="${f.tmdb_id}">
          <div class="fr-poster-img">
            ${f.poster_url ? `<img src="${escapeHtml(f.poster_url)}" alt="" loading="lazy">` : FILM_PLACEHOLDER_SVG}
            <span class="fr-poster-note ${noteColorClass(Number(f.avg_note))}">${Number(f.avg_note).toFixed(1)}</span>
          </div>
          <div class="fr-poster-title">${escapeHtml(f.title)}</div>
          <div class="fr-poster-sub">${f.rating_count} note${f.rating_count > 1 ? 's' : ''} de tes amis</div>
        </div>
      `).join('');
  // Fiche film (retour utilisateur, audit) : voir le même commentaire dans
  // renderGroupTopFilms(), js/groups.js.
  const navList = films.map(f => ({ tmdbId: f.tmdb_id, title: f.title }));
  wrap.querySelectorAll('[data-tmdb-id]').forEach(row => {
    makeRowClickable(row, () => goToFilmDetail(parseInt(row.dataset.tmdbId, 10), navList));
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

// --- « Ce qu'ils regardent » (audit A3) --- Le fil d'activité des amis,
// avec l'affiche et la note en couleur. Une note ouvre la fiche du film :
// l'événement n'a pas d'identifiant TMDB, on le retrouve dans le catalogue de
// l'ami (lisible tant que l'amitié est acceptée). Le reste ouvre son profil.
const FRIEND_FEED_VERBS = {
  film_rated: 'a noté',
  watchlist_added: 'a ajouté à À voir',
  list_created: 'a créé la liste'
};

function friendFeedWhen(iso, now = Date.now()){
  const d = new Date(iso);
  const minutes = Math.round((now - d.getTime()) / 60000);
  if(minutes < 60) return minutes <= 1 ? 'à l’instant' : `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if(hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if(days === 1) return 'hier';
  if(days < 7) return `il y a ${days} jours`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function friendFeedRowHtml(e){
  const name = friendDisplayName(e.actorId);
  const verb = FRIEND_FEED_VERBS[e.eventType];
  const text = verb
    ? `<b>${escapeHtml(name)}</b> ${verb} <b class="fr-film">${escapeHtml(e.targetLabel || '')}</b>`
    : escapeHtml(activityEventLabel(e));
  const note = e.eventType === 'film_rated' && e.targetNote != null && Number.isFinite(Number(e.targetNote))
    ? `<span class="fr-note ${noteColorClass(Number(e.targetNote))}">${Number(e.targetNote).toFixed(1)}</span>` : '';
  return `
    <div class="fr-feed" data-feed-id="${e.id}">
      ${friendAvatarHtml(e.actorId, name)}
      <div class="fr-main">
        <div class="fr-feed-text">${text}</div>
        <div class="fr-sub">${friendFeedWhen(e.createdAt)}</div>
      </div>
      ${note}
      ${e.targetPosterUrl ? `<img class="fr-feed-poster" src="${escapeHtml(e.targetPosterUrl)}" alt="" loading="lazy">` : ''}
    </div>
  `;
}

// (ami, titre) -> tmdb_id, pour ouvrir la fiche du film noté.
async function lookupFeedFilms(events){
  const rated = events.filter(e => e.eventType === 'film_rated' && e.targetLabel);
  if(rated.length === 0) return {};
  const { data, error } = await supabaseClient
    .from('films')
    .select('user_id, title, tmdb_id')
    .in('user_id', [...new Set(rated.map(e => e.actorId))])
    .in('title', [...new Set(rated.map(e => e.targetLabel))]);
  if(error){ console.error(error); return {}; }
  const map = {};
  (data || []).forEach(r => { if(r.tmdb_id) map[`${r.user_id}|${r.title}`] = r.tmdb_id; });
  return map;
}

function renderFriendFeed(events, tmdbByFilm){
  const el = document.getElementById('friendActivityList');
  renderCollapsible(el, events, friendFeedRowHtml, {
    previewCount: 5,
    emptyHtml: '<div class="empty-state">Rien à signaler pour l’instant.</div>',
    wire: (container) => {
      container.querySelectorAll('.fr-feed[data-feed-id]').forEach(row => {
        const e = events.find(x => String(x.id) === row.dataset.feedId);
        if(!e) return;
        const tmdbId = tmdbByFilm[`${e.actorId}|${e.targetLabel}`];
        makeRowClickable(row, () => {
          if(tmdbId) goToFilmDetail(tmdbId);
          else openFriendProfile(e.actorId);
        });
      });
    }
  });
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
  renderFriendFeed(activity, await lookupFeedFilms(activity));
  renderFriendSuggestions(suggestions);
  renderFriendRecommendations(recommendations);
}

// --- Page amis (liste + demandes) — appelée par le routeur (#/amis). ---

async function openFriends(){
  document.getElementById('friendRequestsIn').innerHTML = '';
  document.getElementById('friendRequestsOut').innerHTML = '';
  document.getElementById('friendsList').innerHTML = skeletonRows(4);
  document.getElementById('friendSearchInput').value = '';
  document.getElementById('friendSearchResults').innerHTML = '';
  document.getElementById('friendActivityList').innerHTML = skeletonRows(3);
  document.getElementById('friendSuggestionsList').innerHTML = skeletonRows(3);
  document.getElementById('friendRecommendationsList').innerHTML = '';
  await loadFriendships();
  renderFriendsPage();
  // En phase ou pas : les lignes d'amis se complètent une fois chargé.
  const accepted = friendships.filter(f => f.status === 'accepted').map(otherUserId);
  loadFriendStats(accepted).then(renderFriendsPage).catch(e => console.error(e));
  await openFriendsSideSections();
  markSeen('amis'); // pas attendu : n'a pas à retarder l'affichage de la page
}

document.getElementById('friendsBtn').addEventListener('click', goToAmis);
document.getElementById('amisPageBack').addEventListener('click', goHome);
// Interrupteur Amis · Groupes · Listes dans le titre des trois pages (draft
// Amis du 15/10), comme Films · Séries dans le catalogue. Flèches gauche et
// droite comme un vrai groupe d'onglets.
const SOCIAL_ROUTES = { amis: goToAmis, groupes: goToGroups, listes: goToLists };
const SOCIAL_ORDER = ['amis', 'groupes', 'listes'];
document.querySelectorAll('.catalog-switch-btn[data-social]').forEach(btn => {
  btn.addEventListener('click', () => {
    if(!btn.classList.contains('is-active')) SOCIAL_ROUTES[btn.dataset.social]();
  });
  btn.addEventListener('keydown', (e) => {
    if(e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = SOCIAL_ORDER.indexOf(btn.dataset.social);
    const next = SOCIAL_ORDER[(i + (e.key === 'ArrowRight' ? 1 : SOCIAL_ORDER.length - 1)) % SOCIAL_ORDER.length];
    SOCIAL_ROUTES[next]();
  });
});

// --- Profil d'un ami (lecture seule : catalogue + stats) ---
// Les films sont lus directement depuis Supabase (pas depuis `films`, qui
// reste le catalogue de l'utilisateur connecté) — accessible grâce à la
// policy RLS "Friends can view shared films" tant que la relation est
// accepted, voir supabase/migrations/009.

async function openFriendProfile(userId){
  document.getElementById('friendProfileTitle').textContent = friendDisplayName(userId);
  const content = document.getElementById('friendProfileContent');
  content.innerHTML = skeletonRows(4);
  openOverlay('friendProfileOverlay');

  const [{ data, error }, compat, { data: friendProfile }] = await Promise.all([
    supabaseClient.from('films').select('*').eq('user_id', userId).order('added', { ascending: false }),
    loadFriendCompatibility(userId),
    // Top films d'un ami : montré ici quel que soit son réglage "Profil
    // public" (retour utilisateur : "avec un profil pas public, seul les
    // amis voient le top4") — cette modale n'est atteignable QUE depuis la
    // liste "Amis" pour une amitié acceptée, jamais publiquement, donc
    // aucune fuite au-delà de ce que RLS "Friends can view shared films"
    // permet déjà pour le reste de cette fonction.
    supabaseClient.from('profiles').select('top_films').eq('user_id', userId).maybeSingle()
  ]);
  if(error){
    content.innerHTML = `<div class="empty-state">Impossible de charger ce catalogue.</div>`;
    console.error(error);
    return;
  }

  const friendFilms = data.map(rowToFilm);
  // Résolu contre friendFilms (déjà chargé juste au-dessus) plutôt que via
  // get_public_profile() : même logique de résolution que cette fonction
  // SQL (matcher par tmdb_id, garder l'ordre choisi), mais sans dépendre de
  // public_profile côté ami — voir le commentaire sur la requête ci-dessus.
  const friendTopFilmIds = (friendProfile && Array.isArray(friendProfile.top_films)) ? friendProfile.top_films : [];
  const friendFilmsByTmdbId = new Map(friendFilms.filter(f => f.tmdbId).map(f => [f.tmdbId, f]));
  const friendTopFilms = friendTopFilmIds.map(id => friendFilmsByTmdbId.get(id)).filter(Boolean);
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

  // Placé en premier (retour utilisateur : le top4 doit être plus visible) —
  // mêmes classes .top-films-showcase que le profil public (js/publicProfile.js)
  // pour une présentation cohérente entre les deux endroits où un top4 peut
  // s'afficher.
  if(friendTopFilms.length > 0){
    const topWrap = document.createElement('div');
    topWrap.className = 'stats-section reveal';
    topWrap.innerHTML = `
      <div class="stats-section-title">Ses meilleurs films</div>
      <div class="top-films-showcase">
        ${friendTopFilms.map(f => `
          <div class="top-films-showcase-item" data-tmdb-id="${f.tmdbId}">
            ${f.posterUrl
              ? `<img loading="lazy" decoding="async" src="${escapeHtml(f.posterUrl)}" alt="">`
              : `<div class="film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
            <div class="top-films-showcase-title">${escapeHtml(f.title)}</div>
          </div>
        `).join('')}
      </div>
    `;
    content.appendChild(topWrap);
    const topNavList = friendTopFilms.map(f => ({ tmdbId: f.tmdbId, title: f.title }));
    topWrap.querySelectorAll('.top-films-showcase-item[data-tmdb-id]').forEach(item => {
      makeRowClickable(item, () => goToFilmDetail(parseInt(item.dataset.tmdbId, 10), topNavList));
    });
  }

  if(compat){
    // compat.compatibility peut être SQL null (donc JS null) même avec des
    // films en commun (common_count > 0) : ça arrive si, pour chacun de ces
    // films, l'un des deux n'a en réalité aucune note calculable (ex. un
    // film ajouté au catalogue mais jamais vraiment noté — voir le fix
    // équivalent sur Top films, migrations/033). Sans ce garde-fou,
    // `${compat.compatibility}%` affichait littéralement "null%" — trouvé
    // en testant la nouvelle section "Films en commun" juste en dessous.
    const compatEl = document.createElement('div');
    compatEl.className = 'ach-summary reveal';
    compatEl.innerHTML = compat.compatibility != null
      ? `
        <div class="ach-summary-count">${compat.compatibility}%</div>
        <div class="ach-summary-label">Compatibilité ciné · ${compat.common_count} film${compat.common_count > 1 ? 's' : ''} en commun</div>
        <div class="ach-summary-bar"><div class="ach-summary-fill" style="width:${Math.max(0, Math.min(100, compat.compatibility))}%"></div></div>
      `
      : `
        <div class="ach-summary-label">${compat.common_count} film${compat.common_count > 1 ? 's' : ''} en commun, pas encore assez noté${compat.common_count > 1 ? 's' : ''} des deux côtés pour calculer une compatibilité</div>
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
            ? `<img class="film-poster" src="${escapeHtml(f.posterUrl)}" alt="" loading="lazy">`
            : `<div class="film-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
          <div class="wl-main">
            <div class="wl-title">${escapeHtml(f.title)}${f.releaseYear ? ` <span class="wl-year">(${f.releaseYear})</span>` : ''}</div>
            <div class="wl-note">Toi : ${f.myNote != null ? f.myNote.toFixed(1) : '—'} · ${escapeHtml(friendDisplayName(userId))} : ${f.theirNote != null ? f.theirNote.toFixed(1) : '—'}</div>
          </div>
        </div>
      `, { previewCount: 6 });
      const commonNavList = commonFilms.map(f => ({ tmdbId: f.tmdbId, title: f.title }));
      commonWrap.querySelectorAll('[data-tmdb-id]').forEach(row => {
        makeRowClickable(row, () => goToFilmDetail(parseInt(row.dataset.tmdbId, 10), commonNavList));
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
