// --- Listes thématiques partageables (retour utilisateur, étude
// comparative Letterboxd : "Movies everyone should watch at least once",
// collections créées par les utilisateurs, likeables) ---
// Le plus gros écart structurel identifié face à Letterboxd : watchlist
// est privée, Top films est algorithmique, Groupes est un cercle fermé —
// rien ne permettait de composer et partager une collection thématique.
// Adapté à l'esprit fermé de Kinet (pas un vrai public internet comme
// Letterboxd) : visible entre amis seulement (RLS are_friends(), voir
// migrations/058), jamais un lien public anonyme.
//
// Écran à part entière (#/listes, #/listes/:id), pas une modal — même
// principe que Groupes (js/groups.js). Accès depuis la page Amis
// (#amisListsLink, js/friends.js), pas d'icône dédiée dans l'entête : une
// liste se partage avec des amis, comme un groupe.

let myLists = [];              // mes propres listes (lists.user_id = moi)
let friendsListsData = [];     // listes de mes amis (get_friends_lists())
let currentListId = null;      // liste affichée sur #listDetailPage
let currentListMeta = null;    // { id, user_id, title, description }
let currentListItems = [];     // [{ id, tmdbId, title, posterUrl, releaseYear, position }]
let currentListLikes = [];     // [{ id, userId }]
let listItemTmdbSearchTimer = null;

function rowToList(row){
  return { id: row.id, userId: row.user_id, title: row.title, description: row.description, createdAt: row.created_at };
}

function rowToListItem(row){
  return {
    id: row.id, tmdbId: row.tmdb_id, title: row.title,
    posterUrl: row.poster_url, releaseYear: row.release_year, position: row.position
  };
}

// --- Page liste des listes (#/listes) ---

async function loadMyLists(){
  const { data, error } = await supabaseClient
    .from('lists')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });
  if(error){ console.error(error); myLists = []; return; }
  myLists = data.map(rowToList);
}

async function loadFriendsLists(){
  const { data, error } = await supabaseClient.rpc('get_friends_lists');
  if(error){ console.error(error); friendsListsData = []; return; }
  friendsListsData = data || [];
}

function renderMyLists(){
  const list = document.getElementById('myListsList');
  if(myLists.length === 0){
    list.innerHTML = `<div class="tmdb-empty">Pas encore de liste. Crée la première ci-dessus.</div>`;
    return;
  }
  list.innerHTML = myLists.map(l => `
    <div class="wl-row" data-id="${l.id}">
      <div class="friend-avatar friend-avatar-placeholder">${uiIcon('list')}</div>
      <div class="wl-main">
        <div class="wl-title">${escapeHtml(l.title)}</div>
        ${l.description ? `<div class="wl-note">${escapeHtml(l.description)}</div>` : ''}
      </div>
      <div class="wl-actions">
        <button class="btn secondary" data-id="${l.id}" type="button">Ouvrir</button>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => goToListDetail(parseInt(btn.dataset.id, 10)));
  });
}

// Mosaïque de jusqu'à 4 affiches en couverture (même esprit que le mur de
// posters du profil public, migrations/016) — une liste vide côté ami
// (aucune affiche connue, ex. tous ses films sans fiche TMDB) retombe sur
// un simple pictogramme plutôt qu'une mosaïque à moitié remplie.
function friendListCardHtml(l){
  const posters = l.poster_urls || [];
  const postersHtml = posters.length > 0
    ? `<div class="list-cover-posters">${posters.slice(0, 4).map(url => `<img src="${url}" alt="" loading="lazy">`).join('')}</div>`
    : `<div class="list-cover-posters-empty">${uiIcon('list')}</div>`;
  return `
    <div class="list-cover-card" data-id="${l.id}">
      ${postersHtml}
      <div class="list-cover-info">
        <div class="list-cover-title">${escapeHtml(l.title)}</div>
        <div class="list-cover-meta">${friendDisplayName(l.user_id)} · ${l.item_count} film${l.item_count > 1 ? 's' : ''}${l.like_count > 0 ? ` · ${l.like_count} j'aime` : ''}</div>
      </div>
    </div>
  `;
}

async function renderFriendsListsSection(){
  const wrap = document.getElementById('friendsListsList');
  if(friendsListsData.length === 0){
    wrap.innerHTML = `<div class="tmdb-empty">Aucun ami n'a encore créé de liste.</div>`;
    return;
  }
  await ensureProfilesCached(friendsListsData.map(l => l.user_id));
  wrap.innerHTML = friendsListsData.map(friendListCardHtml).join('');
  wrap.querySelectorAll('.list-cover-card[data-id]').forEach(card => {
    card.addEventListener('click', () => goToListDetail(parseInt(card.dataset.id, 10)));
  });
}

async function handleCreateList(){
  const title = document.getElementById('listTitleInput').value.trim();
  if(!title){
    showToast('Ajoute un titre avant de créer la liste');
    return;
  }
  const description = document.getElementById('listDescInput').value.trim() || null;
  const { data, error } = await supabaseClient
    .from('lists')
    .insert({ title, description, user_id: currentUser.id })
    .select()
    .single();
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  myLists.unshift(rowToList(data));
  document.getElementById('listTitleInput').value = '';
  document.getElementById('listDescInput').value = '';
  renderMyLists();
  showToast('Liste créée');
}

// Appelée par le routeur (#/listes).
async function openLists(){
  document.getElementById('myListsList').innerHTML = skeletonRows();
  document.getElementById('friendsListsList').innerHTML = skeletonRows();
  document.getElementById('listTitleInput').value = '';
  document.getElementById('listDescInput').value = '';
  await Promise.all([loadMyLists(), loadFriendsLists()]);
  renderMyLists();
  await renderFriendsListsSection();
}

document.getElementById('listsPageBack').addEventListener('click', goHome);
{
  const createListBtn = document.getElementById('createListBtn');
  createListBtn.addEventListener('click', withSubmitGuard(createListBtn, handleCreateList));
}

// --- Détail d'une liste (#/listes/:id) ---

function isOwnList(){
  return currentListMeta && currentListMeta.userId === currentUser.id;
}

function renderListDetailHeader(){
  document.getElementById('listDetailTitle').textContent = currentListMeta.title;
  const descEl = document.getElementById('listDetailDesc');
  descEl.textContent = currentListMeta.description || '';
  descEl.style.display = currentListMeta.description ? '' : 'none';
  document.getElementById('listDeleteBtn').style.display = isOwnList() ? '' : 'none';
  document.getElementById('listAddItemSection').style.display = isOwnList() ? '' : 'none';
}

function updateListLikeButtonUI(){
  const btn = document.getElementById('listLikeBtn');
  const liked = currentListLikes.some(l => l.userId === currentUser.id);
  btn.classList.toggle('active', liked);
  btn.innerHTML = `${uiIcon('heart', liked)} ${liked ? 'Aimé' : 'Aimer'}`;
}

function renderListLikesSummary(){
  const others = currentListLikes.filter(l => l.userId !== currentUser.id);
  const summaryEl = document.getElementById('listLikesSummary');
  summaryEl.textContent = others.length === 0
    ? 'Aucun ami ne l\'a encore aimée.'
    : `Aimée par ${others.map(l => friendDisplayName(l.userId)).join(', ')}.`;
  updateListLikeButtonUI();
}

async function loadListLikes(listId){
  const { data, error } = await supabaseClient
    .from('list_likes')
    .select('id, user_id')
    .eq('list_id', listId);
  if(error){ console.error(error); currentListLikes = []; return; }
  currentListLikes = data.map(row => ({ id: row.id, userId: row.user_id }));
  await ensureProfilesCached(currentListLikes.map(l => l.userId));
  renderListLikesSummary();
}

async function toggleListLike(){
  if(blockIfOffline()) return;
  const mine = currentListLikes.find(l => l.userId === currentUser.id);
  if(mine){
    const { error } = await supabaseClient.from('list_likes').delete().eq('id', mine.id);
    if(error){ console.error(error); return; }
    currentListLikes = currentListLikes.filter(l => l.id !== mine.id);
  }else{
    const { data, error } = await supabaseClient
      .from('list_likes')
      .insert({ list_id: currentListId, user_id: currentUser.id })
      .select()
      .single();
    if(error){ console.error(error); return; }
    currentListLikes.push({ id: data.id, userId: currentUser.id });
  }
  renderListLikesSummary();
}

function listItemRowHtml(item){
  return `
    <div class="wl-row" data-item-id="${item.id}">
      ${item.posterUrl
        ? `<img class="film-poster" src="${item.posterUrl}" alt="" loading="lazy">`
        : `<div class="film-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="wl-main">
        <div class="wl-title">${escapeHtml(item.title)}${item.releaseYear ? ` <span class="wl-year">(${item.releaseYear})</span>` : ''}</div>
      </div>
      ${isOwnList() ? `<div class="wl-actions"><button class="btn danger" data-item-id="${item.id}" type="button">Retirer</button></div>` : ''}
    </div>
  `;
}

function renderListItems(){
  const wrap = document.getElementById('listItemsList');
  if(currentListItems.length === 0){
    wrap.innerHTML = `<div class="tmdb-empty">Aucun film pour l'instant.</div>`;
    return;
  }
  const navList = currentListItems.map(item => ({ tmdbId: item.tmdbId, title: item.title }));
  wrap.innerHTML = currentListItems.map(listItemRowHtml).join('');
  wrap.querySelectorAll('.wl-row[data-item-id]').forEach(row => {
    const item = currentListItems.find(i => i.id === parseInt(row.dataset.itemId, 10));
    makeRowClickable(row, (e) => {
      if(e.target.closest('.wl-actions')) return;
      goToFilmDetail(item.tmdbId, navList);
    });
  });
  if(isOwnList()){
    wrap.querySelectorAll('button[data-item-id]').forEach(btn => {
      btn.addEventListener('click', () => handleRemoveListItem(parseInt(btn.dataset.itemId, 10)));
    });
  }
}

async function loadListItems(listId){
  const { data, error } = await supabaseClient
    .from('list_items')
    .select('*')
    .eq('list_id', listId)
    .order('position', { ascending: true });
  if(error){ console.error(error); currentListItems = []; return; }
  currentListItems = data.map(rowToListItem);
}

async function handleRemoveListItem(itemId){
  const { error } = await supabaseClient.from('list_items').delete().eq('id', itemId);
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  currentListItems = currentListItems.filter(i => i.id !== itemId);
  renderListItems();
}

async function handleDeleteList(){
  if(!confirm(`Supprimer définitivement la liste « ${currentListMeta.title} » ?`)) return;
  const { error } = await supabaseClient.from('lists').delete().eq('id', currentListId);
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  myLists = myLists.filter(l => l.id !== currentListId);
  showToast('Liste supprimée');
  goToLists();
}

// --- Ajout d'un film (propriétaire seulement) : même gabarit de recherche
// TMDB que la watchlist (js/watchlist.js) ou les propositions de groupe
// (js/proposals.js), mais sans étape de "sélection en attente" : choisir
// un résultat l'ajoute immédiatement à la liste, une liste n'a pas de
// formulaire plus large à compléter autour. -->
function renderListItemTmdbResults(results){
  const wrap = document.getElementById('listItemTmdbResults');
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
      ${poster ? `<img loading="lazy" decoding="async" src="${poster}" alt="">` : `<div class="tmdb-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="tmdb-result-info">
        <div class="tmdb-result-title">${escapeHtml(r.title)}</div>
        <div class="tmdb-result-year">${year}</div>
      </div>
    `;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); handleAddListItem(r); });
    wrap.appendChild(item);
  });
}

async function handleAddListItem(r){
  if(currentListItems.some(i => i.tmdbId === r.id)){
    showToast('Déjà dans cette liste');
    document.getElementById('listItemTitleInput').value = '';
    document.getElementById('listItemTmdbResults').innerHTML = '';
    return;
  }
  const payload = {
    list_id: currentListId,
    user_id: currentUser.id,
    tmdb_id: r.id,
    title: r.title,
    poster_url: r.poster_path ? TMDB_IMG_BASE + r.poster_path : null,
    release_year: r.release_date ? parseInt(r.release_date.slice(0, 4), 10) : null,
    position: currentListItems.length
  };
  const { data, error } = await supabaseClient.from('list_items').insert(payload).select().single();
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  currentListItems.push(rowToListItem(data));
  document.getElementById('listItemTitleInput').value = '';
  document.getElementById('listItemTmdbResults').innerHTML = '';
  renderListItems();
}

async function handleListItemTmdbSearch(query){
  const wrap = document.getElementById('listItemTmdbResults');
  wrap.innerHTML = `<div class="tmdb-empty">Recherche…</div>`;
  try{
    const results = await searchTmdb(query);
    renderListItemTmdbResults(results);
  }catch(e){
    wrap.innerHTML = `<div class="tmdb-empty">${escapeHtml(e.message)}</div>`;
    console.error(e);
  }
}

// Appelée par le routeur (#/listes/:id). Robuste à un lien direct (F5) :
// relit la liste elle-même depuis Supabase (RLS la masque si ni soi-même
// ni ami, exactement le même repli que openGroupDetail(), js/groups.js).
async function openListDetail(listId){
  currentListId = listId;
  document.getElementById('listDetailTitle').textContent = 'Chargement…';
  document.getElementById('listDetailDesc').style.display = 'none';
  document.getElementById('listItemsList').innerHTML = skeletonRows();
  document.getElementById('listLikesSummary').textContent = '';
  document.getElementById('listItemTitleInput').value = '';
  document.getElementById('listItemTmdbResults').innerHTML = '';

  const { data, error } = await supabaseClient.from('lists').select('*').eq('id', listId).maybeSingle();
  if(error || !data){
    showToast('Liste introuvable');
    goToLists();
    return;
  }
  currentListMeta = { id: data.id, userId: data.user_id, title: data.title, description: data.description };
  renderListDetailHeader();

  await Promise.all([loadListItems(listId), loadListLikes(listId)]);
  renderListItems();
}

document.getElementById('listDetailBack').addEventListener('click', goToLists);
document.getElementById('listLikeBtn').addEventListener('click', toggleListLike);
document.getElementById('listDeleteBtn').addEventListener('click', handleDeleteList);
document.getElementById('listItemTitleInput').addEventListener('input', () => {
  clearTimeout(listItemTmdbSearchTimer);
  const query = document.getElementById('listItemTitleInput').value.trim();
  if(query.length < 2){
    document.getElementById('listItemTmdbResults').innerHTML = '';
    return;
  }
  listItemTmdbSearchTimer = setTimeout(() => handleListItemTmdbSearch(query), 350);
});
document.getElementById('listItemTitleInput').addEventListener('blur', () => {
  setTimeout(() => { document.getElementById('listItemTmdbResults').innerHTML = ''; }, 150);
});
