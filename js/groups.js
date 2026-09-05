// --- Groupes (famille/amis) ---
// Le créateur devient automatiquement membre (trigger DB, voir
// supabase/migrations/011). Ajouter un membre se fait uniquement parmi ses
// propres amis acceptés (js/friends.js) — pas de flux invitation séparé pour
// ce premier jet, la relation d'amitié fait déjà office de consentement.
// Réutilise les briques d'affichage de js/friends.js (cacheProfile,
// friendRowHtml, otherUserId...) plutôt que de les dupliquer.
//
// Groupes/détail groupe/détail proposition sont de vraies pages routées par
// URL (js/router.js), pas des modals — la visibilité des conteneurs est
// gérée par showOnlyPage(), ce fichier ne fait que charger/rendre les
// données une fois la page choisie.

let groups = [];
let groupMembersCache = {}; // groupId -> [{ userId, joinedAt }]
let currentGroupId = null; // groupe actuellement affiché sur groupDetailPage, lu par js/proposals.js

function rowToGroup(row){
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    ownerId: row.owner_id,
    createdAt: row.created_at
  };
}

async function loadGroups(){
  const { data, error } = await supabaseClient
    .from('groups')
    .select('*')
    .order('created_at', { ascending: false });
  if(error){
    showToast('Erreur de chargement des groupes');
    console.error(error);
    groups = [];
    return;
  }
  groups = data.map(rowToGroup);
}

function renderGroupsList(){
  const list = document.getElementById('groupsList');
  if(groups.length === 0){
    list.innerHTML = `<div class="tmdb-empty">Pas encore de groupe. Crée le premier ci-dessus.</div>`;
    return;
  }
  list.innerHTML = groups.map(g => `
    <div class="wl-row">
      <div class="friend-avatar friend-avatar-placeholder">🎭</div>
      <div class="wl-main">
        <div class="wl-title">${escapeHtml(g.name)}</div>
        ${g.description ? `<div class="wl-note">${escapeHtml(g.description)}</div>` : ''}
      </div>
      <div class="wl-actions">
        <button class="btn secondary" data-id="${g.id}" type="button">Ouvrir</button>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => goToGroup(parseInt(btn.dataset.id, 10)));
  });
}

async function handleCreateGroup(){
  const name = document.getElementById('groupNameInput').value.trim();
  if(!name){
    showToast('Ajoute un nom avant de créer le groupe');
    return;
  }
  const description = document.getElementById('groupDescInput').value.trim() || null;
  const { data, error } = await supabaseClient
    .from('groups')
    .insert({ name, description, owner_id: currentUser.id })
    .select()
    .single();
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  groups.unshift(rowToGroup(data));
  document.getElementById('groupNameInput').value = '';
  document.getElementById('groupDescInput').value = '';
  renderGroupsList();
  showToast('Groupe créé');
}

// Page liste des groupes — appelée par le routeur (#/groupes).
async function openGroups(){
  document.getElementById('groupsList').innerHTML = `<div class="tmdb-empty">Chargement…</div>`;
  document.getElementById('groupNameInput').value = '';
  document.getElementById('groupDescInput').value = '';
  await loadGroups();
  renderGroupsList();
  markSeen('groupes'); // pas attendu : n'a pas à retarder l'affichage de la page
}

// Pas d'icône Groupes dans l'entête : on y arrive depuis la page Amis
// (#amisGroupsLink, voir js/friends.js) — un groupe se fait avec des amis.
document.getElementById('groupsPageBack').addEventListener('click', goHome);
document.getElementById('createGroupBtn').addEventListener('click', handleCreateGroup);

// --- Détail d'un groupe : membres + ajout d'amis + quitter/supprimer ---
// (les propositions de ce groupe sont gérées par js/proposals.js, mais
// rendues dans la même page)

async function loadGroupMembers(groupId){
  const { data, error } = await supabaseClient
    .from('group_members')
    .select('user_id, joined_at')
    .eq('group_id', groupId);
  if(error){
    showToast('Erreur de chargement des membres');
    console.error(error);
    return [];
  }
  const ids = data.map(r => r.user_id);
  if(ids.length > 0){
    const { data: profs, error: profErr } = await supabaseClient
      .from('profiles')
      .select('user_id, display_name, avatar_url')
      .in('user_id', ids);
    if(profErr) console.error(profErr);
    else profs.forEach(p => cacheProfile(p.user_id, p.display_name, p.avatar_url));
  }
  return data.map(r => ({ userId: r.user_id, joinedAt: r.joined_at }));
}

// --- Bandeau "Séance élue" (voir js/proposals.js, migrations/020) ---
// Fonction à part (pas juste inline dans renderGroupDetail) : appelée aussi
// juste après markAsChosen()/unmarkChosen(), qui n'ont pas de raison de
// refaire tout le rendu du détail groupe pour un simple changement de
// bandeau.
function renderChosenBanner(groupId){
  const el = document.getElementById('chosenBanner');
  if(!el) return;
  const p = (typeof chosenProposal === 'function') ? chosenProposal(groupId) : null;
  if(!p){
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const dateLabel = p.watchDate
    ? new Date(p.watchDate + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  el.style.display = '';
  el.innerHTML = `
    🎟️ <b>Séance élue :</b> ${escapeHtml(p.title)}${dateLabel ? ` (${dateLabel})` : ''}
  `;
}

function renderGroupDetail(group, members){
  const isOwner = group.ownerId === currentUser.id;
  document.getElementById('groupDetailTitle').textContent = group.name;
  const descEl = document.getElementById('groupDetailDesc');
  descEl.textContent = group.description || '';
  descEl.style.display = group.description ? '' : 'none';
  renderChosenBanner(group.id);

  // Lien d'invitation (voir js/invites.js) : owner seul, même gabarit que
  // "Ajouter un ami" ci-dessous.
  const inviteSection = document.getElementById('groupInviteSection');
  if(isOwner){
    inviteSection.style.display = '';
    renderInviteBox(group.id);
  }else{
    inviteSection.style.display = 'none';
  }

  const memberIds = members.map(m => m.userId);

  const membersEl = document.getElementById('groupMembersList');
  membersEl.innerHTML = members.map(m => {
    const isSelf = m.userId === currentUser.id;
    const isMemberOwner = m.userId === group.ownerId;
    let actions = '';
    if(isMemberOwner) actions = `<span class="wl-note">Créateur</span>`;
    else if(isOwner) actions = `<button class="btn danger" data-user="${m.userId}" type="button">Retirer</button>`;
    else if(isSelf) actions = `<button class="btn secondary" data-leave type="button">Quitter</button>`;
    return friendRowHtml(m.userId, actions);
  }).join('');
  membersEl.querySelectorAll('button[data-user]').forEach(btn => {
    btn.addEventListener('click', () => removeMemberFromGroup(group.id, btn.dataset.user));
  });
  membersEl.querySelectorAll('button[data-leave]').forEach(btn => {
    btn.addEventListener('click', () => leaveGroup(group.id));
  });

  // Ajouter un ami au groupe : réservé au créateur, parmi ses amis acceptés
  // qui n'en font pas déjà partie.
  const addSection = document.getElementById('groupAddFriendSection');
  const addList = document.getElementById('groupAddFriendList');
  if(isOwner){
    addSection.style.display = '';
    const candidates = friendships
      .filter(f => f.status === 'accepted')
      .map(otherUserId)
      .filter(uid => !memberIds.includes(uid));
    addList.innerHTML = candidates.length === 0
      ? `<div class="tmdb-empty">Tous tes amis sont déjà dans ce groupe (ou tu n'as pas encore d'ami, voir 👥 Amis).</div>`
      : candidates.map(uid => friendRowHtml(uid, `<button class="btn" data-add="${uid}" type="button">Ajouter</button>`)).join('');
    addList.querySelectorAll('button[data-add]').forEach(btn => {
      btn.addEventListener('click', () => addMemberToGroup(group.id, btn.dataset.add));
    });
  }else{
    addSection.style.display = 'none';
  }

  const footer = document.getElementById('groupDetailFooter');
  footer.innerHTML = isOwner
    ? `<button class="btn danger" id="deleteGroupBtn" type="button">Supprimer le groupe</button>`
    : `<button class="btn danger" id="leaveGroupBtn" type="button">Quitter le groupe</button>`;
  if(isOwner) document.getElementById('deleteGroupBtn').addEventListener('click', () => deleteGroup(group.id));
  else document.getElementById('leaveGroupBtn').addEventListener('click', () => leaveGroup(group.id));
}

// Page détail d'un groupe — appelée par le routeur (#/groupes/:id). Robuste
// à un lien direct (F5, retour navigateur) : recharge la liste des groupes
// si besoin plutôt que de supposer qu'openGroups() est déjà passé par là.
async function openGroupDetail(groupId){
  if(groups.length === 0 || !groups.find(g => g.id === groupId)) await loadGroups();
  const group = groups.find(g => g.id === groupId);
  if(!group){
    showToast('Groupe introuvable');
    goToGroups();
    return;
  }
  currentGroupId = groupId;
  document.getElementById('groupDetailTitle').textContent = group.name;
  document.getElementById('groupMembersList').innerHTML = `<div class="tmdb-empty">Chargement…</div>`;
  document.getElementById('groupAddFriendSection').style.display = 'none';
  document.getElementById('groupInviteSection').style.display = 'none';
  document.getElementById('chosenBanner').style.display = 'none';
  document.getElementById('groupDetailFooter').innerHTML = '';
  document.getElementById('groupProposalsList').innerHTML = `<div class="tmdb-empty">Chargement…</div>`;
  document.getElementById('proposalTitleInput').value = '';
  clearProposalTmdbSelection();
  document.getElementById('groupTopFilmsList').innerHTML = `<div class="tmdb-empty">Chargement…</div>`;
  document.getElementById('groupActivityList').innerHTML = `<div class="tmdb-empty">Chargement…</div>`;

  const members = await loadGroupMembers(groupId);
  groupMembersCache[groupId] = members;
  renderGroupDetail(group, members);

  await loadProposals(groupId);
  renderGroupProposals();

  // Fil d'activité + goûts du groupe (js/activity.js, migrations/022) —
  // pour qu'un groupe revisité ne semble pas mort. Après les propositions
  // plutôt qu'en parallèle : loadActivity() hydrate friendProfiles au
  // besoin, autant laisser loadGroupMembers() (déjà groupé) faire le gros
  // du travail en premier.
  const [topFilms, events] = await Promise.all([
    loadGroupTopFilms(groupId),
    loadActivity({ scope: 'group', groupId })
  ]);
  renderGroupTopFilms(topFilms);
  renderActivityListInto(document.getElementById('groupActivityList'), events);
}

// --- Goûts du groupe (v1.6, phase 4) : films notés par au moins 2 membres
// (having count(*) >= 2 côté SQL, migrations/022) — jamais un seul, ça
// reviendrait à exposer sa note individuelle à tout le groupe. ---
async function loadGroupTopFilms(groupId){
  const { data, error } = await supabaseClient.rpc('get_group_top_films', { p_group_id: groupId, p_limit: 15 });
  if(error){ console.error(error); return []; }
  return data || [];
}

function renderGroupTopFilms(films){
  const wrap = document.getElementById('groupTopFilmsList');
  wrap.innerHTML = films.length === 0
    ? `<div class="tmdb-empty">Pas encore de film noté par au moins 2 membres du groupe.</div>`
    : films.map(f => `
        <div class="wl-row" data-tmdb-id="${f.tmdb_id}">
          ${f.poster_url
            ? `<img class="film-poster" src="${f.poster_url}" alt="" loading="lazy">`
            : `<div class="film-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
          <div class="wl-main">
            <div class="wl-title">${escapeHtml(f.title)}${f.release_year ? ` <span class="wl-year">(${f.release_year})</span>` : ''}</div>
            <div class="wl-note">${f.rating_count} membres l'ont noté</div>
          </div>
          <div class="counter ${noteColorClass(Number(f.avg_note))}">${Number(f.avg_note).toFixed(1)}</div>
        </div>
      `).join('');
  // Fiche film (retour utilisateur, audit) : ces lignes ne menaient nulle
  // part alors que Top films/le catalogue d'un ami le font — vers la fiche
  // communautaire (js/filmDetail.js), pas openFilmReviewDetail() : on n'a
  // ici qu'un agrégat (avg_note/rating_count), jamais le détail par
  // critère d'un film précis.
  wrap.querySelectorAll('[data-tmdb-id]').forEach(row => {
    makeRowClickable(row, () => goToFilmDetail(parseInt(row.dataset.tmdbId, 10)));
  });
}

document.getElementById('groupDetailBack').addEventListener('click', goToGroups);

async function addMemberToGroup(groupId, userId){
  const { error } = await supabaseClient.from('group_members').insert({ group_id: groupId, user_id: userId });
  if(error){
    showToast(error.code === '23505' ? 'Déjà membre' : 'Erreur, réessaie');
    console.error(error);
    return;
  }
  const members = await loadGroupMembers(groupId);
  groupMembersCache[groupId] = members;
  renderGroupDetail(groups.find(g => g.id === groupId), members);
  showToast('Ajouté au groupe');
}

async function removeMemberFromGroup(groupId, userId){
  if(!confirm('Retirer cette personne du groupe ?')) return;
  const { error } = await supabaseClient.from('group_members').delete().eq('group_id', groupId).eq('user_id', userId);
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  const members = (groupMembersCache[groupId] || []).filter(m => m.userId !== userId);
  groupMembersCache[groupId] = members;
  renderGroupDetail(groups.find(g => g.id === groupId), members);
  showToast('Retiré du groupe');
}

async function leaveGroup(groupId){
  const { error } = await supabaseClient.from('group_members').delete().eq('group_id', groupId).eq('user_id', currentUser.id);
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  groups = groups.filter(g => g.id !== groupId);
  showToast('Tu as quitté le groupe');
  goToGroups();
}

async function deleteGroup(groupId){
  if(!confirm('Supprimer définitivement ce groupe ? Tous les membres seront retirés.')) return;
  const { error } = await supabaseClient.from('groups').delete().eq('id', groupId);
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  groups = groups.filter(g => g.id !== groupId);
  showToast('Groupe supprimé');
  goToGroups();
}
