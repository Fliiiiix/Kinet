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
    watchDate: row.watch_date || null
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

function proposalScore(proposalId){
  const votes = proposalVotes[proposalId] || [];
  return votes.reduce((sum, v) => sum + v.value, 0);
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
  if(proposals.length === 0){
    list.innerHTML = `<div class="tmdb-empty">Aucune proposition pour l'instant. Propose un film ci-dessus.</div>`;
    return;
  }
  const isOwner = typeof groups !== 'undefined' && groups.some(g => g.id === currentGroupId && g.ownerId === currentUser.id);

  list.innerHTML = proposals.map(p => {
    const score = proposalScore(p.id);
    const my = myVoteOn(p.id);
    const commentCount = proposalCommentCounts[p.id] || 0;
    const proposer = friendDisplayName(p.proposedBy);
    const chosenBadge = p.chosen ? ` <span class="review-badge" title="Séance élue">🎟️</span>` : '';
    let chosenAction = '';
    if(isOwner){
      chosenAction = p.chosen
        ? `<button class="btn secondary" data-unchoose="${p.id}" type="button">Retirer</button>`
        : `<button class="btn secondary" data-choose="${p.id}" type="button">Élire</button>`;
    }
    return `
    <div class="wl-row proposal-row">
      ${p.posterUrl
        ? `<img class="film-poster" src="${p.posterUrl}" alt="" loading="lazy">`
        : `<div class="film-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="wl-main">
        <div class="wl-title">${escapeHtml(p.title)}${p.releaseYear ? ` <span class="wl-year">(${p.releaseYear})</span>` : ''}${chosenBadge}</div>
        <div class="wl-note">Proposé par ${escapeHtml(proposer)}</div>
      </div>
      <div class="vote-controls-inline">
        <button class="vote-btn${my === 1 ? ' active' : ''}" data-vote="1" data-id="${p.id}" type="button" aria-label="Voter pour" aria-pressed="${my === 1}">▲</button>
        <span class="vote-count">${score}</span>
        <button class="vote-btn${my === -1 ? ' active' : ''}" data-vote="-1" data-id="${p.id}" type="button" aria-label="Voter contre" aria-pressed="${my === -1}">▼</button>
      </div>
      <div class="wl-actions">
        ${chosenAction}
        <button class="btn secondary" data-open="${p.id}" type="button">💬 ${commentCount}</button>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('button[data-vote]').forEach(btn => {
    btn.addEventListener('click', () => castVote(parseInt(btn.dataset.id, 10), parseInt(btn.dataset.vote, 10)));
  });
  list.querySelectorAll('button[data-open]').forEach(btn => {
    btn.addEventListener('click', () => goToProposal(currentGroupId, parseInt(btn.dataset.open, 10)));
  });
  list.querySelectorAll('button[data-choose]').forEach(btn => {
    btn.addEventListener('click', () => {
      let watchDate = prompt('Date de la séance (AAAA-MM-JJ), ou laisse vide :') || null;
      if(watchDate && !/^\d{4}-\d{2}-\d{2}$/.test(watchDate)){
        showToast('Date ignorée, format attendu AAAA-MM-JJ');
        watchDate = null;
      }
      markAsChosen(currentGroupId, parseInt(btn.dataset.choose, 10), watchDate);
    });
  });
  list.querySelectorAll('button[data-unchoose]').forEach(btn => {
    btn.addEventListener('click', () => unmarkChosen(currentGroupId));
  });
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
      showToast(`Déjà proposé par ${who} — vote plutôt pour son film`);
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
  results.forEach(r => {
    const year = r.release_date ? r.release_date.slice(0, 4) : '?';
    const poster = r.poster_path ? TMDB_IMG_BASE + r.poster_path : null;
    const item = document.createElement('div');
    item.className = 'tmdb-result';
    item.innerHTML = `
      ${poster ? `<img src="${poster}" alt="">` : `<div class="tmdb-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="tmdb-result-info">
        <div class="tmdb-result-title">${escapeHtml(r.title)}</div>
        <div class="tmdb-result-year">${year}</div>
      </div>
    `;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectProposalTmdbResult(r); });
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
document.getElementById('proposeFilmBtn').addEventListener('click', () => {
  if(currentGroupId) handleProposeFilm(currentGroupId);
});

// --- Détail d'une proposition : page à part entière (#/groupes/:id/propositions/:id) ---

function renderProposalDetailVotes(){
  if(!currentProposal) return;
  const score = proposalScore(currentProposal.id);
  const my = myVoteOn(currentProposal.id);
  document.getElementById('proposalDetailVotes').innerHTML = `
    <button class="vote-btn${my === 1 ? ' active' : ''}" id="proposalDetailUp" type="button" aria-label="Voter pour" aria-pressed="${my === 1}">▲</button>
    <span class="vote-count">${score}</span>
    <button class="vote-btn${my === -1 ? ' active' : ''}" id="proposalDetailDown" type="button" aria-label="Voter contre" aria-pressed="${my === -1}">▼</button>
  `;
  document.getElementById('proposalDetailUp').addEventListener('click', () => castVote(currentProposal.id, 1));
  document.getElementById('proposalDetailDown').addEventListener('click', () => castVote(currentProposal.id, -1));
}

function renderProposalDetailFilm(){
  const p = currentProposal;
  const proposer = friendDisplayName(p.proposedBy);
  document.getElementById('proposalDetailFilm').innerHTML = `
    ${p.posterUrl
      ? `<img class="film-poster" src="${p.posterUrl}" alt="" loading="lazy">`
      : `<div class="film-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
    <div class="wl-main">
      <div class="wl-title">${escapeHtml(p.title)}${p.releaseYear ? ` <span class="wl-year">(${p.releaseYear})</span>` : ''}</div>
      <div class="wl-note">Proposé par ${escapeHtml(proposer)}</div>
      ${p.overview ? `<div class="wl-note">${escapeHtml(p.overview)}</div>` : ''}
    </div>
  `;
}

function renderProposalComments(){
  const list = document.getElementById('proposalCommentsList');
  if(proposalComments.length === 0){
    list.innerHTML = `<div class="tmdb-empty">Aucun commentaire. Lance la discussion.</div>`;
    return;
  }
  list.innerHTML = proposalComments.map(c => `
    <div class="comment-item">
      ${friendAvatarHtml(c.userId, friendDisplayName(c.userId))}
      <div class="comment-body-wrap">
        <div class="comment-author">${escapeHtml(friendDisplayName(c.userId))}</div>
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
  document.getElementById('proposalCommentsList').innerHTML = `<div class="tmdb-empty">Chargement…</div>`;
  document.getElementById('proposalCommentInput').value = '';
  renderProposalDetailFilm();
  renderProposalDetailVotes();

  const isOwnerOrAuthor = p.proposedBy === currentUser.id
    || (typeof groups !== 'undefined' && groups.some(g => g.id === p.groupId && g.ownerId === currentUser.id));
  document.getElementById('proposalDetailFooter').innerHTML = isOwnerOrAuthor
    ? `<button class="btn danger" id="deleteProposalBtn" type="button">Supprimer la proposition</button>`
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

document.getElementById('proposalCommentBtn').addEventListener('click', addProposalComment);

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
