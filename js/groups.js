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

// Liste des groupes (piste A) : une rangée par groupe, avec ses membres et
// sa prochaine séance ou ses propositions en cours (loadGroupsOverview()).
let groupOverview = {}; // groupId -> { members: [userId], open: n, chosen: { title, watchDate } | null }
function gpDateLabel(iso){
  if(!iso) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}
function gpCapitalize(s){ return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function groupAvatarStackHtml(userIds, max){
  const ids = (userIds || []).slice().sort((a, b) => (a === currentUser.id ? -1 : b === currentUser.id ? 1 : 0));
  const shown = ids.slice(0, max || 4);
  const rest = ids.length - shown.length;
  return `<span class="gp-avs">${shown.map(uid => friendAvatarHtml(uid, uid === currentUser.id ? 'Toi' : friendDisplayName(uid))).join('')}${rest > 0 ? `<span class="gp-av-more">+${rest}</span>` : ''}</span>`;
}
async function loadGroupsOverview(){
  groupOverview = {};
  const ids = groups.map(g => g.id);
  ids.forEach(id => { groupOverview[id] = { members: [], open: 0, chosen: null }; });
  if(!ids.length) return;
  const [mem, props] = await Promise.all([
    supabaseClient.from('group_members').select('group_id, user_id').in('group_id', ids),
    supabaseClient.from('group_proposals').select('*').in('group_id', ids),
  ]);
  if(mem.error) console.error(mem.error);
  else (mem.data || []).forEach(r => { if(groupOverview[r.group_id]) groupOverview[r.group_id].members.push(r.user_id); });
  if(props.error) console.error(props.error);
  else (props.data || []).forEach(p => {
    const o = groupOverview[p.group_id];
    if(!o) return;
    if(p.chosen) o.chosen = { title: p.title, watchDate: p.watch_date || null };
    else if(!p.seen_at) o.open++;
  });
  const everyone = [].concat(...Object.values(groupOverview).map(o => o.members));
  if(typeof ensureProfilesCached === 'function') await ensureProfilesCached(everyone).catch(e => console.error(e));
}
function renderGroupsList(){
  const list = document.getElementById('groupsList');
  if(groups.length === 0){
    list.innerHTML = `<div class="tmdb-empty">Pas encore de groupe. Crée le premier pour proposer des films à tes amis et voter.</div>`;
    return;
  }
  list.innerHTML = groups.map(g => {
    const o = groupOverview[g.id] || { members: [], open: 0, chosen: null };
    const n = Math.max(1, o.members.length);
    let sub;
    if(o.chosen) sub = `prochaine séance : ${o.chosen.title}${o.chosen.watchDate ? `, ${gpDateLabel(o.chosen.watchDate)}` : ''}`;
    else if(o.open) sub = `${o.open} proposition${o.open > 1 ? 's' : ''} en cours`;
    else if(n <= 1) sub = 'invite quelqu’un pour proposer des films';
    else sub = 'aucune proposition en cours';
    return `<div class="gp-row" data-group-id="${g.id}">
      ${groupAvatarStackHtml(o.members.length ? o.members : [currentUser.id])}
      <div class="gp-row-main"><b>${escapeHtml(g.name)}</b><span>${n <= 1 ? 'Toi seul' : `${n} membres`} · ${escapeHtml(sub)}</span></div>
      <span class="gp-chev" aria-hidden="true">›</span>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-group-id]').forEach(row => {
    makeRowClickable(row, () => goToGroup(parseInt(row.dataset.groupId, 10)));
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
  document.getElementById('groupsList').innerHTML = skeletonRows();
  document.getElementById('groupNameInput').value = '';
  document.getElementById('groupDescInput').value = '';
  await loadGroups();
  renderGroupsList();
  await loadGroupsOverview();
  renderGroupsList();
  markSeen('groupes'); // pas attendu : n'a pas à retarder l'affichage de la page
}

// Pas d'icône Groupes dans l'entête : on y arrive depuis la page Amis
// (interrupteur Amis · Groupes · Listes, voir js/friends.js) — un groupe se fait avec des amis.
{
  const createGroupBtn = document.getElementById('createGroupBtn');
  createGroupBtn.addEventListener('click', withSubmitGuard(createGroupBtn, handleCreateGroup));
}

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
// Prochaine séance (piste A) : le film choisi et sa date, ou le film en tête
// des votes, que le créateur choisit en donnant une date sur place.
let gpPickingId = null;       // proposition en cours de choix (créateur)
let gpPickingOtherDate = false;
function gpNextDates(){
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const add = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };
  const sat = add((6 - today.getDay() + 7) % 7 || 7);
  const sun = add((7 - today.getDay()) % 7 || 7);
  return [
    ['Ce soir', iso(today)],
    [`Samedi ${sat.getDate()}`, iso(sat)],
    [`Dimanche ${sun.getDate()}`, iso(sun)],
  ];
}
function renderChosenBanner(groupId){
  const el = document.getElementById('chosenBanner');
  if(!el) return;
  const group = groups.find(g => g.id === groupId);
  const isOwner = !!(group && group.ownerId === currentUser.id);
  const chosen = (typeof chosenProposal === 'function') ? chosenProposal(groupId) : null;
  const poster = (p) => p.posterUrl ? `<img src="${escapeHtml(p.posterUrl)}" alt="" loading="lazy">` : `<div class="film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`;
  if(chosen){
    const n = typeof proposalScore === 'function' ? proposalScore(chosen.id) : 0;
    el.innerHTML = `<div class="gp-next">${poster(chosen)}<div class="gp-next-main">
      <small>Prochaine séance</small>
      <div class="gp-nt">${escapeHtml(chosen.title)}</div>
      <div class="gp-nd">${chosen.watchDate ? gpCapitalize(gpDateLabel(chosen.watchDate)) : 'Date à fixer'}${n ? ` · ${n} partant${n > 1 ? 's' : ''}` : ''}</div>
      <div class="ff-actions">
        ${chosen.tmdbId ? `<button type="button" class="ff-btn-line" data-gp-fiche="${chosen.tmdbId}">Fiche du film</button>` : ''}
        ${chosen.hasSeenColumn ? `<button type="button" class="ff-btn-text" data-gp-seen="${chosen.id}">On l'a vu</button>` : ''}
        ${isOwner ? `<button type="button" class="ff-btn-text" data-gp-change>Changer</button>` : ''}
      </div></div></div>`;
    el.style.display = '';
    return;
  }
  const open = typeof openProposalsFor === 'function' ? openProposalsFor(groupId) : [];
  const lead = open[0];
  if(!lead){
    el.innerHTML = `<div class="gp-empty"><b>Rien à l'affiche</b><span>Propose un film pour lancer le vote.</span></div>`;
    el.style.display = '';
    return;
  }
  const n = proposalScore(lead.id);
  const picking = isOwner && gpPickingId === lead.id;
  el.innerHTML = `<div class="gp-empty">
    <div class="gp-empty-row">
      <div><b>Pas encore de film choisi</b><span>${escapeHtml(lead.title)} est en tête${n ? ` avec ${n} partant${n > 1 ? 's' : ''}` : ''}.</span></div>
      ${isOwner && !picking ? `<button type="button" class="ff-btn-main" data-gp-pick="${lead.id}">Choisir ${escapeHtml(lead.title)}</button>` : ''}
      ${picking ? '<span class="gp-when">Quand ?</span>' : ''}
    </div>
    ${picking ? `<div class="filter-row gp-dates">${gpNextDates().map(([l, iso]) => `<button type="button" class="filter-chip" data-gp-date="${iso}">${l}</button>`).join('')}<button type="button" class="filter-chip" data-gp-other>Autre date</button>${gpPickingOtherDate ? `<input type="date" class="gp-date-input" id="gpOtherDate" min="${new Date().toISOString().slice(0, 10)}" aria-label="Date de la séance">` : ''}<button type="button" class="filter-clear" data-gp-cancel>Annuler</button></div>` : ''}
  </div>`;
  el.style.display = '';
}

function renderGroupDetail(group, members){
  const isOwner = group.ownerId === currentUser.id;
  document.getElementById('groupDetailTitle').textContent = group.name;
  const descEl = document.getElementById('groupDetailDesc');
  descEl.textContent = group.description || '';
  descEl.style.display = group.description ? '' : 'none';
  const memberIds = members.map(m => m.userId);
  document.getElementById('groupDetailMeta').innerHTML = `${groupAvatarStackHtml(memberIds, 5)}<span>${members.length <= 1 ? 'Toi seul pour l’instant' : `${members.length} membres, dont toi`}</span>`;
  renderChosenBanner(group.id);

  // Menu ⋯ : membres, ajout d'amis et invitation (créateur), quitter ou supprimer.
  document.getElementById('groupInviteBtn').hidden = !isOwner;
  document.getElementById('groupMenuAdd').hidden = !isOwner;
  document.getElementById('groupMenuInvite').hidden = !isOwner;
  document.getElementById('groupMenuMembers').textContent = `Membres (${members.length})`;
  document.getElementById('groupMenuDanger').textContent = isOwner ? 'Supprimer le groupe' : 'Quitter le groupe';

  const inviteSection = document.getElementById('groupInviteSection');
  inviteSection.style.display = 'none';
  if(isOwner) renderInviteBox(group.id);

  const membersEl = document.getElementById('groupMembersList');
  membersEl.innerHTML = members.map(m => {
    const isMemberOwner = m.userId === group.ownerId;
    let actions = '';
    if(isMemberOwner) actions = `<span class="wl-note">Créateur</span>`;
    else if(isOwner) actions = `<button class="ff-btn-text" data-user="${m.userId}" type="button">Retirer du groupe</button>`;
    return friendRowHtml(m.userId, actions);
  }).join('');
  membersEl.querySelectorAll('button[data-user]').forEach(btn => {
    btn.addEventListener('click', () => removeMemberFromGroup(group.id, btn.dataset.user));
  });

  const addList = document.getElementById('groupAddFriendList');
  if(isOwner){
    const candidates = friendships
      .filter(f => f.status === 'accepted')
      .map(otherUserId)
      .filter(uid => !memberIds.includes(uid));
    addList.innerHTML = candidates.length === 0
      ? `<div class="tmdb-empty">${friendships.some(f => f.status === 'accepted') ? 'Tous tes amis sont déjà dans ce groupe.' : 'Ajoute d’abord des amis depuis la page Amis.'}</div>`
      : candidates.map(uid => friendRowHtml(uid, `<button class="ff-btn-line" data-add="${uid}" type="button">Ajouter</button>`)).join('');
    addList.querySelectorAll('button[data-add]').forEach(btn => {
      btn.addEventListener('click', withSubmitGuard(btn, () => addMemberToGroup(group.id, btn.dataset.add)));
    });
  }else{
    addList.innerHTML = '';
  }
  document.getElementById('groupDetailFooter').innerHTML = '';
}

// Panneau ouvert depuis le menu ⋯ : 'members' | 'add' | 'invite'.
function openGroupManage(kind){
  const panel = document.getElementById('groupManagePanel');
  const titles = { members: 'Membres', add: 'Ajouter un ami', invite: 'Inviter' };
  document.getElementById('groupManageTitle').textContent = titles[kind] || 'Membres';
  document.getElementById('groupMembersSection').style.display = kind === 'members' ? '' : 'none';
  document.getElementById('groupAddFriendSection').style.display = kind === 'add' ? '' : 'none';
  document.getElementById('groupInviteSection').style.display = kind === 'invite' ? '' : 'none';
  panel.hidden = false;
}
function closeGroupManage(){ document.getElementById('groupManagePanel').hidden = true; }
function closeGroupMenu(){
  const menu = document.getElementById('groupMenu');
  if(menu) menu.hidden = true;
  const btn = document.getElementById('groupMoreBtn');
  if(btn) btn.setAttribute('aria-expanded', 'false');
}

// Déjà vus ensemble : les propositions marquées « On l'a vu » (migration 065),
// sinon l'historique des élections, sans doublon.
function renderGroupSeenHistory(groupId, electionEvents){
  const section = document.getElementById('groupElectionHistorySection');
  const list = document.getElementById('groupElectionHistoryList');
  if(!section || !list) return;
  const withColumn = proposals.some(p => p.groupId === groupId && p.hasSeenColumn);
  let rows;
  if(withColumn){
    rows = proposals.filter(p => p.groupId === groupId && p.seenAt)
      .sort((a, b) => new Date(b.seenAt) - new Date(a.seenAt))
      .map(p => ({ title: p.title, poster: p.posterUrl, tmdbId: p.tmdbId, when: `vu le ${new Date(p.seenAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}` }));
  }else{
    const seen = new Set();
    rows = (electionEvents || []).filter(e => { const k = e.targetLabel; if(!k || seen.has(k)) return false; seen.add(k); return true; })
      .map(e => ({ title: e.targetLabel, poster: e.targetPosterUrl || null, tmdbId: null, when: `choisi le ${new Date(e.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}` }));
  }
  section.style.display = rows.length ? '' : 'none';
  list.innerHTML = rows.map(r => {
    const mine = r.tmdbId ? films.find(f => f.tmdbId === r.tmdbId) : null;
    const note = mine ? getDisplayNote(mine) : null;
    return `<div class="gp-taste">${r.poster ? `<img src="${escapeHtml(r.poster)}" alt="" loading="lazy">` : `<div class="film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="gp-taste-main"><b>${escapeHtml(r.title)}</b><span class="gp-notes">${escapeHtml(r.when)}</span></div>
      ${note !== null ? `<span class="gp-avg num ${noteColorClass(note)}">${note.toFixed(1)}</span>` : (r.tmdbId ? `<button type="button" class="ff-link" data-gp-rate="${r.tmdbId}">Noter</button>` : '')}
    </div>`;
  }).join('');
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
  gpPickingId = null;
  gpPickingOtherDate = false;
  closeGroupManage();
  closeGroupMenu();
  document.getElementById('groupDetailTitle').textContent = group.name;
  document.getElementById('groupDetailMeta').innerHTML = '';
  document.getElementById('groupMembersList').innerHTML = skeletonRows(3);
  document.getElementById('chosenBanner').style.display = 'none';
  document.getElementById('groupDetailFooter').innerHTML = '';
  document.getElementById('groupProposalsList').innerHTML = skeletonRows(3);
  document.getElementById('groupProposeRow').hidden = true;
  document.getElementById('proposalTitleInput').value = '';
  clearProposalTmdbSelection();
  document.getElementById('groupTasteComparisonList').innerHTML = skeletonRows(2);
  document.getElementById('groupElectionHistorySection').style.display = 'none';
  document.getElementById('groupOverlapSection').style.display = 'none';

  // Audit G2 (16/10) : en arrivant ici sans passer par Amis ou Profil (lien,
  // rechargement, suggestion de la recherche), la liste d'amis n'était pas
  // chargée et « Ajouter un ami » disait « Tous tes amis sont déjà dans ce
  // groupe ». On la charge avant de dessiner la page.
  const [members] = await Promise.all([
    loadGroupMembers(groupId),
    (typeof loadFriendships === 'function' && friendships.length === 0) ? loadFriendships().catch(e => console.error(e)) : Promise.resolve()
  ]);
  groupMembersCache[groupId] = members;
  renderGroupDetail(group, members);

  await loadProposals(groupId);
  renderGroupProposals();
  // Audit G1 (16/10) : le bandeau de la séance élue était dessiné par
  // renderGroupDetail(), avant le chargement des propositions, donc jamais.
  renderChosenBanner(groupId);

  // Goûts du groupe et comparaison ne font plus qu'une section (G6) ; l'ancien
  // fil d'activité disparaît de la page.
  const [tasteComparison, electionHistory, overlap] = await Promise.all([
    loadGroupTasteComparison(groupId),
    loadActivity({ scope: 'group', groupId, eventType: 'proposal_chosen', limit: 30 }),
    loadGroupWatchlistOverlap(groupId)
  ]);
  renderGroupTasteComparison(tasteComparison);
  renderGroupSeenHistory(groupId, electionHistory);
  groupOverlapRows = overlap || [];
  renderGroupWatchlistOverlap(groupId);
}

// --- À voir en commun (idée 5 du 28/10) --- Les films présents dans les À
// voir d'au moins deux membres, via get_group_watchlist_overlap() (migration
// 069, qui ne répond qu'à un membre et ne montre jamais la liste entière de
// quelqu'un). « Proposer » passe par handleProposeFilm() (js/proposals.js),
// avec sa vérification de doublon. Sans la migration : section cachée.
let groupOverlapRows = [];

async function loadGroupWatchlistOverlap(groupId){
  const { data, error } = await supabaseClient.rpc('get_group_watchlist_overlap', { p_group_id: groupId });
  if(error){ console.error(error); return []; }
  return data || [];
}

// « Sam, Navy et toi »
function groupOverlapNames(ids){
  const me = currentUser && currentUser.id;
  const names = ids.filter(id => id !== me).map(id => friendDisplayName(id));
  if(ids.includes(me)) names.push('toi');
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}` : (names[0] || '');
}

function renderGroupWatchlistOverlap(groupId){
  const section = document.getElementById('groupOverlapSection');
  const list = document.getElementById('groupOverlapList');
  if(!section || !list) return;
  const rows = groupOverlapRows;
  section.style.display = rows.length ? '' : 'none';
  list.innerHTML = rows.map(r => {
    const proposed = proposals.some(p => p.groupId === groupId && p.tmdbId === r.tmdb_id && !p.seenAt);
    return `<div class="gp-taste">
      <button type="button" class="gp-overlap-open" data-overlap-open="${r.tmdb_id}" aria-label="Voir la fiche de ${escapeHtml(r.title)}">${r.poster_url ? `<img src="${escapeHtml(r.poster_url)}" alt="" loading="lazy">` : `<span class="film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</span>`}</button>
      <div class="gp-taste-main"><b>${escapeHtml(r.title)}</b><span class="gp-notes">dans les À voir de ${escapeHtml(groupOverlapNames(r.member_ids || []))}</span></div>
      ${proposed ? `<span class="gp-notes">Déjà proposé</span>` : `<button type="button" class="ff-link" data-overlap-propose="${r.tmdb_id}">Proposer</button>`}
    </div>`;
  }).join('');
}

async function proposeOverlapFilm(groupId, tmdbId){
  const r = groupOverlapRows.find(x => x.tmdb_id === tmdbId);
  if(!r) return;
  proposalTmdbSelected = { tmdb_id: r.tmdb_id, poster_url: r.poster_url || null, overview: null, release_year: r.release_year || null, original_title: null, title: r.title };
  document.getElementById('proposalTitleInput').value = r.title;
  await handleProposeFilm(groupId); // js/proposals.js
  renderGroupWatchlistOverlap(groupId);
}

document.getElementById('groupOverlapList').addEventListener('click', (e) => {
  const propose = e.target.closest('[data-overlap-propose]');
  if(propose){
    if(propose.disabled) return;
    propose.disabled = true;
    proposeOverlapFilm(currentGroupId, Number(propose.dataset.overlapPropose)).finally(() => { propose.disabled = false; });
    return;
  }
  const open = e.target.closest('[data-overlap-open]');
  if(open) goToFilmDetail(Number(open.dataset.overlapOpen));
});

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
            ? `<img class="film-poster" src="${escapeHtml(f.poster_url)}" alt="" loading="lazy">`
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
  const navList = films.map(f => ({ tmdbId: f.tmdb_id, title: f.title }));
  wrap.querySelectorAll('[data-tmdb-id]').forEach(row => {
    makeRowClickable(row, () => goToFilmDetail(parseInt(row.dataset.tmdbId, 10), navList));
  });
}

// --- Comparaison de goûts élargie (groupe entier), retour utilisateur ---
// Complète "Goûts du groupe" ci-dessus (qui n'affiche que la moyenne) et
// la compatibilité ciné à deux (js/friends.js, get_friend_compatibility) :
// pour les mêmes films (notés par ≥2 membres), montre QUI a mis quelle
// note plutôt que le seul agrégat — voir get_group_taste_comparison(),
// migrations/038.
async function loadGroupTasteComparison(groupId){
  const { data, error } = await supabaseClient.rpc('get_group_taste_comparison', { p_group_id: groupId, p_limit: 15 });
  if(error){ console.error(error); return []; }
  return data || [];
}

function renderGroupTasteComparison(rows){
  const wrap = document.getElementById('groupTasteComparisonList');
  if(rows.length === 0){
    wrap.innerHTML = `<div class="tmdb-empty">Pas encore de film noté par au moins 2 membres du groupe.</div>`;
    return;
  }
  // Une rangée par film : la note de chacun, puis la moyenne à droite (G6).
  wrap.innerHTML = rows.map(f => {
    const notes = f.notes || [];
    const avg = f.avg_note != null ? Number(f.avg_note) : (notes.length ? notes.reduce((a, n) => a + Number(n.note), 0) / notes.length : null);
    return `
    <div class="gp-taste" data-tmdb-id="${f.tmdb_id}">
      ${f.poster_url
        ? `<img src="${escapeHtml(f.poster_url)}" alt="" loading="lazy">`
        : `<div class="film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="gp-taste-main">
        <b>${escapeHtml(f.title)}</b>
        <span class="gp-notes">${notes.map(n => `<span class="taste-note-pill ${noteColorClass(Number(n.note))}">${escapeHtml(typeof currentUser !== 'undefined' && currentUser && n.user_id === currentUser.id ? 'Toi' : friendDisplayName(n.user_id))} ${Number(n.note).toFixed(1)}</span>`).join('')}</span>
      </div>
      ${avg != null ? `<span class="gp-avg num ${noteColorClass(avg)}">${avg.toFixed(1)}</span>` : ''}
    </div>`;
  }).join('');
  const navList = rows.map(f => ({ tmdbId: f.tmdb_id, title: f.title }));
  wrap.querySelectorAll('[data-tmdb-id]').forEach(row => {
    makeRowClickable(row, () => goToFilmDetail(parseInt(row.dataset.tmdbId, 10), navList));
  });
}

document.getElementById('groupDetailBack').addEventListener('click', goToGroups);
// --- Piste A (audit des six écrans) : création, menu ⋯, prochaine séance ---
document.getElementById('groupCreateToggle').addEventListener('click', (e) => {
  const row = document.getElementById('groupCreateRow');
  row.hidden = !row.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!row.hidden));
  if(!row.hidden) document.getElementById('groupNameInput').focus();
});
document.getElementById('groupNameInput').addEventListener('keydown', (e) => {
  if(e.key === 'Enter') document.getElementById('createGroupBtn').click();
});
{
  const moreBtn = document.getElementById('groupMoreBtn');
  moreBtn.innerHTML = uiIcon('dots');
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('groupMenu');
    menu.hidden = !menu.hidden;
    moreBtn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', (e) => { if(!e.target.closest || !e.target.closest('#groupDetailPage .ff-more')) closeGroupMenu(); });
  document.getElementById('groupMenuMembers').addEventListener('click', () => { closeGroupMenu(); openGroupManage('members'); });
  document.getElementById('groupMenuAdd').addEventListener('click', () => { closeGroupMenu(); openGroupManage('add'); });
  document.getElementById('groupMenuInvite').addEventListener('click', () => { closeGroupMenu(); openGroupManage('invite'); });
  document.getElementById('groupInviteBtn').addEventListener('click', () => openGroupManage('invite'));
  document.getElementById('groupManageClose').addEventListener('click', closeGroupManage);
  document.getElementById('groupMenuDanger').addEventListener('click', () => {
    closeGroupMenu();
    const group = groups.find(g => g.id === currentGroupId);
    if(!group) return;
    if(group.ownerId === currentUser.id) deleteGroup(group.id);
    else leaveGroup(group.id);
  });
}
document.getElementById('chosenBanner').addEventListener('click', async (e) => {
  const t = e.target;
  const fiche = t.closest('[data-gp-fiche]');
  if(fiche){ goToFilmDetail(parseInt(fiche.dataset.gpFiche, 10)); return; }
  const seen = t.closest('[data-gp-seen]');
  if(seen){ await markProposalSeen(currentGroupId, parseInt(seen.dataset.gpSeen, 10)); return; }
  if(t.closest('[data-gp-change]')){ await unmarkChosen(currentGroupId); return; }
  const pick = t.closest('[data-gp-pick]');
  if(pick){ gpPickingId = parseInt(pick.dataset.gpPick, 10); gpPickingOtherDate = false; renderChosenBanner(currentGroupId); return; }
  if(t.closest('[data-gp-cancel]')){ gpPickingId = null; gpPickingOtherDate = false; renderChosenBanner(currentGroupId); return; }
  if(t.closest('[data-gp-other]')){
    gpPickingOtherDate = true;
    renderChosenBanner(currentGroupId);
    const input = document.getElementById('gpOtherDate');
    if(input){ input.focus(); if(input.showPicker){ try{ input.showPicker(); }catch(err){} } }
    return;
  }
  const date = t.closest('[data-gp-date]');
  if(date && gpPickingId){
    const id = gpPickingId;
    gpPickingId = null;
    gpPickingOtherDate = false;
    await markAsChosen(currentGroupId, id, date.dataset.gpDate);
  }
});
document.getElementById('chosenBanner').addEventListener('change', async (e) => {
  if(e.target.id !== 'gpOtherDate' || !e.target.value || !gpPickingId) return;
  const id = gpPickingId;
  gpPickingId = null;
  gpPickingOtherDate = false;
  await markAsChosen(currentGroupId, id, e.target.value);
});
document.getElementById('groupElectionHistoryList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-gp-rate]');
  if(!btn) return;
  try{
    const d = normalizeMovieDetails(await fetchMovieDetails(parseInt(btn.dataset.gpRate, 10)));
    openModal(null, d);
  }catch(err){ console.error(err); showToast('Film introuvable sur TMDB'); }
});

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
  // Audit confirmations : quitter un groupe n'avait aucune confirmation,
  // alors que retirer un AUTRE membre (juste au-dessus) en a une —
  // pourtant symétrique (il faudrait être réinvité pour revenir).
  if(!confirm('Quitter ce groupe ? Il faudra être réinvité pour en refaire partie.')) return;
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
