// --- Propositions de films au sein d'un groupe ---
// "Reddit de films" : un membre propose un film (recherche TMDB, comme le
// formulaire principal — voir js/tmdb.js et searchTmdb()), les autres votent
// (haut/bas, un vote par personne) et discutent en commentaires. Tables
// group_proposals / group_proposal_votes / group_proposal_comments, voir
// supabase/migrations/012. Scope entièrement géré par RLS (membres du
// groupe uniquement) — ce module ne fait que lire/écrire ces trois tables.
// Réutilise cacheProfile/friendDisplayName/friendAvatarHtml (js/friends.js).

let proposals = []; // propositions du groupe actuellement ouvert (groupDetail)
let proposalVotes = {}; // proposalId -> [{ userId, value }]
let proposalCommentCounts = {}; // proposalId -> nombre de commentaires
let proposalTmdbSelected = null; // { tmdb_id, poster_url, overview, release_year, title, original_title }
let proposalTmdbSearchTimer = null;
let currentProposal = null; // proposition actuellement affichée sur proposalDetailPage
let proposalComments = []; // commentaires de currentProposal

function rowToProposal(row){
  return {
    id: row.id,
    groupId: row.group_id,
    proposedBy: row.proposed_by,
    title: row.title,
    originalTitle: row.original_title || null,
    tmdbId: row.tmdb_id || null,
    posterUrl: row.poster_url || null,
    overview: row.overview || null,
    releaseYear: row.release_year || null,
    createdAt: row.created_at,
    chosen: !!row.chosen,
    chosenAt: row.chosen_at || null,
    watchDate: row.watch_date || null,
    // « On l'a vu » (migration 065) : colonne absente tant qu'elle n'est pas lancée.
    hasSeenColumn: Object.prototype.hasOwnProperty.call(row, 'seen_at'),
    seenAt: row.seen_at || null
  };
}

// --- Séance élue (voir supabase/migrations/020) : le créateur du groupe
// marque une proposition comme le prochain film à voir, avec une date
// optionnelle. Owner-only côté RPC (vérifié en dur dans la fonction) — le
// bouton n'est de toute façon affiché qu'au créateur, voir renderGroupProposals().
function chosenProposal(groupId){
  return proposals.find(p => p.groupId === groupId && p.chosen) || null;
}

async function markAsChosen(groupId, proposalId, watchDate){
  const { error } = await supabaseClient.rpc('set_chosen_proposal', {
    p_group_id: groupId, p_proposal_id: proposalId, p_watch_date: watchDate || null
  });
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  proposals.forEach(p => {
    if(p.groupId !== groupId) return;
    const isTarget = p.id === proposalId;
    p.chosen = isTarget;
    p.chosenAt = isTarget ? new Date().toISOString() : null;
    p.watchDate = isTarget ? (watchDate || null) : null;
  });
  renderGroupProposals();
  if(typeof renderChosenBanner === 'function') renderChosenBanner(groupId);
  showToast('Séance élue');
}

async function unmarkChosen(groupId){
  const { error } = await supabaseClient.rpc('unset_chosen_proposal', { p_group_id: groupId });
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  proposals.forEach(p => {
    if(p.groupId === groupId){ p.chosen = false; p.chosenAt = null; p.watchDate = null; }
  });
  renderGroupProposals();
  if(typeof renderChosenBanner === 'function') renderChosenBanner(groupId);
}

// Un seul geste, « Partant » (audit des six écrans, piste A) : on compte les
// partants. Les anciens votes « contre » ne comptent plus.
function proposalScore(proposalId){
  return (proposalVotes[proposalId] || []).filter(v => v.value > 0).length;
}
function proposalVoters(proposalId){
  return (proposalVotes[proposalId] || []).filter(v => v.value > 0).map(v => v.userId);
}
function isPartant(proposalId){ return myVoteOn(proposalId) > 0; }
// Propositions en cours d'un groupe (ni choisie, ni déjà vue), par partants.
function openProposalsFor(groupId){
  return proposals
    .filter(p => p.groupId === groupId && !p.chosen && !p.seenAt)
    .sort((a, b) => proposalScore(b.id) - proposalScore(a.id) || new Date(b.createdAt) - new Date(a.createdAt));
}

function myVoteOn(proposalId){
  const votes = proposalVotes[proposalId] || [];
  const mine = votes.find(v => v.userId === currentUser.id);
  return mine ? mine.value : 0;
}

async function loadProposals(groupId){
  const { data, error } = await supabaseClient
    .from('group_proposals')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });
  if(error){
    showToast('Erreur de chargement des propositions');
    console.error(error);
    proposals = [];
    return;
  }
  proposals = data.map(rowToProposal);
  proposalVotes = {};
  proposalCommentCounts = {};
  if(proposals.length === 0) return;

  const ids = proposals.map(p => p.id);
  const [{ data: votes, error: voteErr }, { data: comments, error: commentErr }] = await Promise.all([
    supabaseClient.from('group_proposal_votes').select('proposal_id, user_id, value').in('proposal_id', ids),
    supabaseClient.from('group_proposal_comments').select('proposal_id').in('proposal_id', ids)
  ]);
  if(voteErr) console.error(voteErr);
  else votes.forEach(v => {
    if(!proposalVotes[v.proposal_id]) proposalVotes[v.proposal_id] = [];
    proposalVotes[v.proposal_id].push({ userId: v.user_id, value: v.value });
  });
  if(commentErr) console.error(commentErr);
  else comments.forEach(c => {
    proposalCommentCounts[c.proposal_id] = (proposalCommentCounts[c.proposal_id] || 0) + 1;
  });
}

function renderGroupProposals(){
  const list = document.getElementById('groupProposalsList');
  const open = openProposalsFor(currentGroupId);
  if(open.length === 0){
    list.innerHTML = `<div class="tmdb-empty">Aucune proposition en cours. Propose un film pour lancer le vote.</div>`;
  }else{
    list.innerHTML = open.map(p => {
      const n = proposalScore(p.id);
      const on = isPartant(p.id);
      const voters = proposalVoters(p.id);
      const com = proposalCommentCounts[p.id] || 0;
      const who = p.proposedBy === currentUser.id ? 'toi' : friendDisplayName(p.proposedBy);
      return `
      <div class="gp-prop">
        <button type="button" class="gp-prop-poster" data-open="${p.id}" aria-label="Ouvrir la proposition ${escapeHtml(p.title)}">${p.posterUrl
          ? `<img src="${p.posterUrl}" alt="" loading="lazy">`
          : `<div class="film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}</button>
        <div class="gp-prop-main">
          <button type="button" class="gp-prop-title" data-open="${p.id}">${escapeHtml(p.title)}${p.releaseYear ? ` <span>${p.releaseYear}</span>` : ''}</button>
          <span class="gp-prop-sub">Proposé par ${escapeHtml(who)}${com ? ` · ${com} message${com > 1 ? 's' : ''}` : ''}</span>
          ${voters.length ? `<span class="gp-voters">${typeof groupAvatarStackHtml === 'function' ? groupAvatarStackHtml(voters, 5) : ''}</span>` : ''}
        </div>
        <button type="button" class="gp-vote${on ? ' is-on' : ''}" data-vote-id="${p.id}" aria-pressed="${on}">${on ? uiIcon('check') : ''}Partant <b>${n}</b></button>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-open]').forEach(btn => {
      btn.addEventListener('click', () => goToProposal(currentGroupId, parseInt(btn.dataset.open, 10)));
    });
    list.querySelectorAll('[data-vote-id]').forEach(btn => {
      btn.addEventListener('click', () => castVote(parseInt(btn.dataset.voteId, 10), 1));
    });
  }
  if(typeof renderChosenBanner === 'function' && document.getElementById('groupDetailPage').style.display !== 'none') renderChosenBanner(currentGroupId);
}

// « On l'a vu » : le film choisi part dans « Déjà vus ensemble » (migration 065).
async function markProposalSeen(groupId, proposalId){
  if(blockIfOffline()) return;
  const { error } = await supabaseClient.rpc('mark_proposal_seen', { p_group_id: groupId, p_proposal_id: proposalId });
  if(error){
    showToast('Impossible pour l’instant (migration 065 à lancer ?)');
    console.error(error);
    return;
  }
  const p = proposals.find(x => x.id === proposalId);
  if(p){ p.seenAt = new Date().toISOString(); p.chosen = false; }
  renderGroupProposals();
  if(typeof renderChosenBanner === 'function') renderChosenBanner(groupId);
  if(typeof renderGroupSeenHistory === 'function') renderGroupSeenHistory(groupId, []);
  showToast(p ? `« ${p.title} » rangé dans Déjà vus ensemble. Pense à le noter.` : 'Rangé dans Déjà vus ensemble');
}

// Vote haut/bas façon Reddit : recliquer sur son propre vote le retire,
// cliquer sur l'autre sens le remplace (une seule ligne par personne, voir
// la contrainte unique group_proposal_votes_unique).
async function castVote(proposalId, value){
  const current = myVoteOn(proposalId);
  if(current === value){
    const { error } = await supabaseClient.from('group_proposal_votes')
      .delete().eq('proposal_id', proposalId).eq('user_id', currentUser.id);
    if(error){ showToast('Erreur, réessaie'); console.error(error); return; }
    proposalVotes[proposalId] = (proposalVotes[proposalId] || []).filter(v => v.userId !== currentUser.id);
  }else{
    const { error } = await supabaseClient.from('group_proposal_votes')
      .upsert({ proposal_id: proposalId, user_id: currentUser.id, value }, { onConflict: 'proposal_id,user_id' });
    if(error){ showToast('Erreur, réessaie'); console.error(error); return; }
    const votes = (proposalVotes[proposalId] || []).filter(v => v.userId !== currentUser.id);
    votes.push({ userId: currentUser.id, value });
    proposalVotes[proposalId] = votes;
  }
  renderGroupProposals();
  if(currentProposal && currentProposal.id === proposalId) renderProposalDetailVotes();
}

async function handleProposeFilm(groupId){
  const title = document.getElementById('proposalTitleInput').value.trim();
  if(!title){
    showToast('Ajoute un titre avant de proposer');
    return;
  }
  // Doublon (retour utilisateur, audit) : seulement via tmdb_id, jamais un
  // rapprochement de titre flou — même principe que le dédoublonnage de
  // l'import Letterboxd/Trakt (js/importExternal.js, js/traktImport.js).
  // Une proposition sans fiche TMDB (titre libre) n'est jamais comparée,
  // faute d'identifiant fiable.
  if(proposalTmdbSelected){
    const existing = proposals.find(p => p.groupId === groupId && p.tmdbId === proposalTmdbSelected.tmdb_id);
    if(existing){
      const who = existing.proposedBy === currentUser.id ? 'toi' : friendDisplayName(existing.proposedBy);
      showToast(`Déjà proposé par ${who}. Vote plutôt pour son film.`);
      return;
    }
  }
  const tmdbFields = proposalTmdbSelected
    ? {
        tmdb_id: proposalTmdbSelected.tmdb_id, poster_url: proposalTmdbSelected.poster_url,
        overview: proposalTmdbSelected.overview, release_year: proposalTmdbSelected.release_year,
        original_title: proposalTmdbSelected.original_title
      }
    : { tmdb_id: null, poster_url: null, overview: null, release_year: null, original_title: null };

  const { data, error } = await supabaseClient
    .from('group_proposals')
    .insert({ group_id: groupId, proposed_by: currentUser.id, title, ...tmdbFields })
    .select()
    .single();
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  proposals.unshift(rowToProposal(data));
  document.getElementById('proposalTitleInput').value = '';
  clearProposalTmdbSelection();
  renderGroupProposals();
  showToast('Film proposé au groupe');
}

// --- Recherche TMDB pour le formulaire de proposition (même pattern que
// js/tmdb.js et js/watchlist.js) ---

function renderProposalTmdbResults(results){
  const wrap = document.getElementById('proposalTmdbResults');
  if(!results.length){
    wrap.innerHTML = `<div class="tmdb-empty">Aucun résultat.</div>`;
    return;
  }
  wrap.innerHTML = '';
  // Un tap sur un film le propose tout de suite (piste A), plus de bouton à part.
  results.slice(0, 6).forEach(r => {
    const year = r.release_date ? r.release_date.slice(0, 4) : '';
    const poster = r.poster_path ? TMDB_IMG_BASE + r.poster_path : null;
    const already = proposals.some(p => p.groupId === currentGroupId && p.tmdbId === r.id && !p.seenAt);
    const item = document.createElement('div');
    item.className = 'tmdb-result';
    item.innerHTML = `
      ${poster ? `<img loading="lazy" decoding="async" src="${poster}" alt="">` : `<div class="tmdb-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="tmdb-result-info">
        <div class="tmdb-result-title">${escapeHtml(r.title)}</div>
        <div class="tmdb-result-year">${year}</div>
      </div>
      <span class="tmdb-result-action">${already ? 'Déjà proposé' : 'Proposer'}</span>
    `;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectProposalTmdbResult(r);
      if(currentGroupId) handleProposeFilm(currentGroupId).then(() => {
        document.getElementById('groupProposeRow').hidden = true;
        document.getElementById('groupProposeToggle').setAttribute('aria-expanded', 'false');
        document.getElementById('groupProposeToggle').textContent = '+ Proposer un film';
      });
    });
    wrap.appendChild(item);
  });
}

function selectProposalTmdbResult(r){
  proposalTmdbSelected = {
    tmdb_id: r.id,
    poster_url: r.poster_path ? TMDB_IMG_BASE + r.poster_path : null,
    overview: r.overview || null,
    release_year: r.release_date ? parseInt(r.release_date.slice(0, 4), 10) : null,
    title: r.title,
    original_title: r.original_title && r.original_title !== r.title ? r.original_title : null
  };
  document.getElementById('proposalTitleInput').value = r.title;
  document.getElementById('proposalTmdbResults').innerHTML = '';
  updateProposalTmdbSelectedUI();
}

function clearProposalTmdbSelection(){
  proposalTmdbSelected = null;
  updateProposalTmdbSelectedUI();
}

function updateProposalTmdbSelectedUI(){
  const box = document.getElementById('proposalTmdbSelected');
  const img = document.getElementById('proposalTmdbSelectedPoster');
  if(!proposalTmdbSelected){
    box.style.display = 'none';
    return;
  }
  box.style.display = '';
  img.src = proposalTmdbSelected.poster_url || '';
  img.style.display = proposalTmdbSelected.poster_url ? '' : 'none';
  document.getElementById('proposalTmdbSelectedTitle').textContent =
    proposalTmdbSelected.title + (proposalTmdbSelected.release_year ? ` (${proposalTmdbSelected.release_year})` : '');
}

async function handleProposalTmdbSearch(query){
  const wrap = document.getElementById('proposalTmdbResults');
  wrap.innerHTML = `<div class="tmdb-empty">Recherche…</div>`;
  try{
    const results = await searchTmdb(query);
    renderProposalTmdbResults(results);
  }catch(e){
    wrap.innerHTML = `<div class="tmdb-empty">${escapeHtml(e.message)}</div>`;
    console.error(e);
  }
}

document.getElementById('proposalTitleInput').addEventListener('input', () => {
  clearTimeout(proposalTmdbSearchTimer);
  const query = document.getElementById('proposalTitleInput').value.trim();
  if(query.length < 2){
    document.getElementById('proposalTmdbResults').innerHTML = '';
    return;
  }
  proposalTmdbSearchTimer = setTimeout(() => handleProposalTmdbSearch(query), 350);
});
document.getElementById('proposalTitleInput').addEventListener('blur', () => {
  setTimeout(() => { document.getElementById('proposalTmdbResults').innerHTML = ''; }, 150);
});
document.getElementById('proposalTmdbClearBtn').addEventListener('click', clearProposalTmdbSelection);
// « + Proposer un film » (piste A) : ouvre la recherche sur place.
document.getElementById('groupProposeToggle').addEventListener('click', (e) => {
  const row = document.getElementById('groupProposeRow');
  row.hidden = !row.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!row.hidden));
  e.currentTarget.textContent = row.hidden ? '+ Proposer un film' : 'Fermer';
  if(!row.hidden) document.getElementById('proposalTitleInput').focus();
});
{
  const proposeFilmBtn = document.getElementById('proposeFilmBtn');
  proposeFilmBtn.addEventListener('click', withSubmitGuard(proposeFilmBtn, () => {
    if(currentGroupId) return handleProposeFilm(currentGroupId);
  }));
}

// --- Détail d'une proposition : page à part entière (#/groupes/:id/propositions/:id) ---

function renderProposalDetailVotes(){
  if(!currentProposal) return;
  const voters = proposalVoters(currentProposal.id);
  document.getElementById('proposalVotersCount').textContent = voters.length ? String(voters.length) : '';
  document.getElementById('proposalDetailVotes').innerHTML = voters.length
    ? voters.map(uid => `<span class="gp-voter">${friendAvatarHtml(uid, uid === currentUser.id ? 'Toi' : friendDisplayName(uid))}${escapeHtml(uid === currentUser.id ? 'Toi' : friendDisplayName(uid))}</span>`).join('')
    : `<div class="tmdb-empty">Personne pour l'instant. Sois le premier partant.</div>`;
  renderProposalDetailFilm();
}

function renderProposalDetailFilm(){
  const p = currentProposal;
  const who = p.proposedBy === currentUser.id ? 'toi' : friendDisplayName(p.proposedBy);
  const group = typeof groups !== 'undefined' ? groups.find(g => g.id === p.groupId) : null;
  const on = isPartant(p.id);
  const n = proposalScore(p.id);
  const date = p.createdAt ? `, le ${new Date(p.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}` : '';
  document.getElementById('proposalDetailFilm').innerHTML = `
    ${p.posterUrl
      ? `<img src="${p.posterUrl}" alt="" loading="lazy">`
      : `<div class="film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
    <div class="gp-next-main">
      <small>Proposition${group ? ` · ${escapeHtml(group.name)}` : ''}</small>
      <div class="gp-nt">${escapeHtml(p.title)}</div>
      <div class="gp-nd">${p.releaseYear ? `${p.releaseYear} · ` : ''}proposé par ${escapeHtml(who)}${date}</div>
      <div class="ff-actions">
        <button type="button" class="gp-vote${on ? ' is-on' : ''}" id="proposalPartantBtn" aria-pressed="${on}">${on ? uiIcon('check') : ''}Partant <b>${n}</b></button>
        ${p.tmdbId ? `<button type="button" class="ff-btn-line" id="proposalFicheBtn">Fiche du film</button>` : ''}
      </div>
      ${p.overview ? `<p class="gp-syn">${escapeHtml(p.overview)}</p>` : ''}
    </div>
  `;
  document.getElementById('proposalPartantBtn').addEventListener('click', () => castVote(p.id, 1));
  const fiche = document.getElementById('proposalFicheBtn');
  if(fiche) fiche.addEventListener('click', () => goToFilmDetail(p.tmdbId));
}

function renderProposalComments(){
  const list = document.getElementById('proposalCommentsList');
  if(proposalComments.length === 0){
    list.innerHTML = `<div class="tmdb-empty">Pas encore de message. Lance la discussion.</div>`;
    return;
  }
  list.innerHTML = proposalComments.map(c => `
    <div class="comment-item">
      ${friendAvatarHtml(c.userId, friendDisplayName(c.userId))}
      <div class="comment-body-wrap">
        <div class="comment-author">${escapeHtml(friendDisplayName(c.userId))}${c.createdAt && typeof friendFeedWhen === 'function' ? `<span class="comment-when">${escapeHtml(friendFeedWhen(c.createdAt))}</span>` : ''}</div>
        <div class="comment-body">${escapeHtml(c.body)}</div>
      </div>
      ${c.userId === currentUser.id ? `<button class="comment-delete" data-id="${c.id}" type="button" title="Supprimer" aria-label="Supprimer ce commentaire">✕</button>` : ''}
    </div>
  `).join('');
  list.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => deleteComment(parseInt(btn.dataset.id, 10)));
  });
}

async function loadProposalComments(proposalId){
  const { data, error } = await supabaseClient
    .from('group_proposal_comments')
    .select('*')
    .eq('proposal_id', proposalId)
    .order('created_at', { ascending: true });
  if(error){
    showToast('Erreur de chargement des commentaires');
    console.error(error);
    proposalComments = [];
    return;
  }
  proposalComments = data.map(row => ({ id: row.id, proposalId: row.proposal_id, userId: row.user_id, body: row.body, createdAt: row.created_at }));
}

async function openProposalDetail(proposalId){
  const p = proposals.find(pr => pr.id === proposalId);
  if(!p) return;
  currentProposal = p;
  document.getElementById('proposalCommentsList').innerHTML = `${skeletonRows(3)}`;
  document.getElementById('proposalCommentInput').value = '';
  renderProposalDetailFilm();
  renderProposalDetailVotes();

  const isOwnerOrAuthor = p.proposedBy === currentUser.id
    || (typeof groups !== 'undefined' && groups.some(g => g.id === p.groupId && g.ownerId === currentUser.id));
  document.getElementById('proposalDetailFooter').innerHTML = isOwnerOrAuthor
    ? `<button class="back-link" id="deleteProposalBtn" type="button">Retirer cette proposition</button>`
    : '';
  if(isOwnerOrAuthor){
    document.getElementById('deleteProposalBtn').addEventListener('click', () => deleteProposal(proposalId));
  }

  await loadProposalComments(proposalId);
  renderProposalComments();
}

// Appelée par le routeur (#/groupes/:groupId/propositions/:proposalId) —
// doit fonctionner même en arrivant directement sur cette URL (lien direct,
// F5, retour navigateur), donc recharge groupe + propositions si besoin
// plutôt que de supposer qu'on est passé par la page du groupe avant.
async function openProposalDetailRoute(groupId, proposalId){
  currentGroupId = groupId;
  if(proposals.length === 0 || proposals[0].groupId !== groupId) await loadProposals(groupId);
  const p = proposals.find(pr => pr.id === proposalId);
  if(!p){
    showToast('Proposition introuvable');
    goToGroup(groupId);
    return;
  }
  await openProposalDetail(proposalId);
}

document.getElementById('proposalDetailBack').addEventListener('click', () => goToGroup(currentGroupId));

async function addProposalComment(){
  const body = document.getElementById('proposalCommentInput').value.trim();
  if(!body || !currentProposal) return;
  const { data, error } = await supabaseClient
    .from('group_proposal_comments')
    .insert({ proposal_id: currentProposal.id, user_id: currentUser.id, body })
    .select()
    .single();
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  proposalComments.push({ id: data.id, proposalId: data.proposal_id, userId: data.user_id, body: data.body, createdAt: data.created_at });
  proposalCommentCounts[currentProposal.id] = (proposalCommentCounts[currentProposal.id] || 0) + 1;
  document.getElementById('proposalCommentInput').value = '';
  renderProposalComments();
  renderGroupProposals();
}

{
  const proposalCommentBtn = document.getElementById('proposalCommentBtn');
  proposalCommentBtn.addEventListener('click', withSubmitGuard(proposalCommentBtn, addProposalComment));
}

async function deleteComment(commentId){
  if(!confirm('Supprimer ce commentaire ?')) return;
  const { error } = await supabaseClient.from('group_proposal_comments').delete().eq('id', commentId);
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  proposalComments = proposalComments.filter(c => c.id !== commentId);
  if(currentProposal) proposalCommentCounts[currentProposal.id] = Math.max(0, (proposalCommentCounts[currentProposal.id] || 1) - 1);
  renderProposalComments();
  renderGroupProposals();
}

async function deleteProposal(proposalId){
  if(!confirm('Supprimer cette proposition et toute sa discussion ?')) return;
  const { error } = await supabaseClient.from('group_proposals').delete().eq('id', proposalId);
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  proposals = proposals.filter(p => p.id !== proposalId);
  showToast('Proposition supprimée');
  goToGroup(currentGroupId);
}
