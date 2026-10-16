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
// (interrupteur Amis · Groupes · Listes, js/friends.js), pas d'icône dédiée dans l'entête : une
// liste se partage avec des amis, comme un groupe.
//
// Piste A de l'audit des six écrans (choisie par Flix le 16/10) : la même
// couverture de 4 affiches pour tes listes et celles de tes amis, une liste
// en grille d'affiches avec ta note ou « pas vu », « Modifier » pour
// renommer, réordonner, retirer et numéroter, et « Ajouter à une liste »
// dans le menu ⋯ de la fiche d'un film. L'ordre et « Numérotée » ont
// besoin de la migration 066 ; sans elle le reste marche et un message le dit.

let myLists = [];              // mes propres listes (lists.user_id = moi)
let friendsListsData = [];     // listes de mes amis (get_friends_lists())
let currentListId = null;      // liste affichée sur #listDetailPage
let currentListMeta = null;    // { id, userId, title, description, numbered }
let currentListItems = [];     // [{ id, tmdbId, title, posterUrl, releaseYear, position }]
let currentListLikes = [];     // [{ id, userId }]
let listItemTmdbSearchTimer = null;
let myListCovers = {};         // listId -> { posters: [], count, tmdbIds: [] }
let listEditing = false;       // mode « Modifier » de ta propre liste
let listOrderDirty = false;    // ordre changé en glissant, enregistré à « Terminé »

function rowToList(row){
  return { id: row.id, userId: row.user_id, title: row.title, description: row.description, createdAt: row.created_at };
}

function rowToListItem(row){
  return {
    id: row.id, tmdbId: row.tmdb_id, title: row.title,
    posterUrl: row.poster_url, releaseYear: row.release_year, position: row.position
  };
}

// Combien de ces films sont dans ton catalogue (vus et notés).
function seenCountIn(tmdbIds){
  return (tmdbIds || []).filter(id => films.some(f => f.tmdbId === id)).length;
}

// Couverture : jusqu'à 4 affiches (même esprit que le mur de posters du
// profil public, migrations/016) ; une seule affiche la remplit en entier,
// aucune retombe sur un pictogramme.
function listCoverHtml(posters){
  const p = (posters || []).filter(Boolean).slice(0, 4);
  return p.length
    ? `<div class="ls-cover${p.length === 1 ? ' is-one' : ''} list-cover-posters">${p.map(url => `<img src="${url}" alt="" loading="lazy">`).join('')}</div>`
    : `<div class="ls-cover list-cover-posters-empty">${uiIcon('list')}</div>`;
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

// Affiches et nombre de films de tes listes, en une requête.
async function loadMyListCovers(){
  myListCovers = {};
  const ids = myLists.map(l => l.id);
  if(!ids.length) return;
  const { data, error } = await supabaseClient
    .from('list_items')
    .select('list_id, tmdb_id, poster_url, position')
    .in('list_id', ids)
    .order('position', { ascending: true });
  if(error){ console.error(error); return; }
  (data || []).forEach(r => {
    const c = myListCovers[r.list_id] || (myListCovers[r.list_id] = { posters: [], count: 0, tmdbIds: [] });
    c.count++;
    c.tmdbIds.push(r.tmdb_id);
    if(r.poster_url && c.posters.length < 4) c.posters.push(r.poster_url);
  });
}

function myListSubLabel(listId){
  const c = myListCovers[listId] || { count: 0, tmdbIds: [] };
  if(!c.count) return 'vide pour l’instant';
  const seen = seenCountIn(c.tmdbIds);
  const count = `${c.count} film${c.count > 1 ? 's' : ''}`;
  if(seen === c.count) return `${count} · ${c.count > 1 ? 'tu les as tous vus' : 'tu l’as vu'}`;
  if(seen === 0) return `${count} · ${c.count > 1 ? 'tu n’en as vu aucun' : 'pas encore vu'}`;
  return `${count} · tu en as vu ${seen}`;
}

function renderMyLists(){
  const list = document.getElementById('myListsList');
  const cards = myLists.map(l => `
    <div class="ls-card" data-id="${l.id}">
      ${listCoverHtml((myListCovers[l.id] || {}).posters)}
      <b>${escapeHtml(l.title)}</b>
      <span>${escapeHtml(myListSubLabel(l.id))}</span>
    </div>
  `).join('');
  list.innerHTML = (myLists.length === 0 ? `<p class="tmdb-empty ls-empty">Pas encore de liste. Un top, un thème, une soirée : crée la première.</p>` : '')
    + cards
    + `<button type="button" class="ls-card ls-new-card" id="listNewTile" aria-controls="listCreateRow" aria-expanded="false"><span class="ls-new">+ Nouvelle liste</span></button>`;
  list.querySelectorAll('.ls-card[data-id]').forEach(card => {
    makeRowClickable(card, () => goToListDetail(parseInt(card.dataset.id, 10)));
  });
  const tile = document.getElementById('listNewTile');
  if(tile) tile.addEventListener('click', () => {
    const row = document.getElementById('listCreateRow');
    row.hidden = !row.hidden;
    tile.setAttribute('aria-expanded', String(!row.hidden));
    if(!row.hidden) document.getElementById('listTitleInput').focus();
  });
}

function friendListCardHtml(l){
  const n = l.item_count || 0;
  return `
    <div class="ls-card list-cover-card" data-id="${l.id}">
      ${listCoverHtml(l.poster_urls)}
      <b>${escapeHtml(l.title)}</b>
      <span>${escapeHtml(friendDisplayName(l.user_id))} · ${n} film${n > 1 ? 's' : ''}${l.like_count > 0 ? ` · ${l.like_count} j'aime` : ''}</span>
    </div>
  `;
}

async function renderFriendsListsSection(){
  const wrap = document.getElementById('friendsListsList');
  if(friendsListsData.length === 0){
    wrap.innerHTML = `<p class="tmdb-empty ls-empty">Aucun de tes amis n’a encore fait de liste. Les leurs apparaîtront ici.</p>`;
    return;
  }
  await ensureProfilesCached(friendsListsData.map(l => l.user_id));
  wrap.innerHTML = friendsListsData.map(friendListCardHtml).join('');
  wrap.querySelectorAll('.list-cover-card[data-id]').forEach(card => {
    makeRowClickable(card, () => goToListDetail(parseInt(card.dataset.id, 10)));
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
  const row = document.getElementById('listCreateRow');
  if(row) row.hidden = true;
  renderMyLists();
  showToast('Liste créée');
}

// Appelée par le routeur (#/listes).
async function openLists(){
  document.getElementById('myListsList').innerHTML = skeletonRows();
  document.getElementById('friendsListsList').innerHTML = skeletonRows();
  document.getElementById('listTitleInput').value = '';
  document.getElementById('listDescInput').value = '';
  document.getElementById('listCreateRow').hidden = true;
  await Promise.all([loadMyLists(), loadFriendsLists()]);
  await loadMyListCovers();
  renderMyLists();
  await renderFriendsListsSection();
}

document.getElementById('listsPageBack').addEventListener('click', goHome);
{
  const createListBtn = document.getElementById('createListBtn');
  createListBtn.addEventListener('click', withSubmitGuard(createListBtn, handleCreateList));
  document.getElementById('listTitleInput').addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){ e.preventDefault(); createListBtn.click(); }
  });
}

// --- Détail d'une liste (#/listes/:id) ---

function isOwnList(){
  return currentListMeta && currentListMeta.userId === currentUser.id;
}

// Ta liste : « Modifier » et le menu ⋯ (qui la voit, supprimer). Celle
// d'un ami : « Aimer ». Plus de « J'aime » sur ta propre liste.
function renderListDetailHeader(){
  const own = isOwnList();
  const editing = own && listEditing;
  const m = currentListMeta;
  document.getElementById('listDetailTitle').textContent = m.title;
  const descEl = document.getElementById('listDetailDesc');
  descEl.textContent = m.description || '';
  descEl.style.display = m.description ? '' : 'none';
  const meta = document.getElementById('listDetailMeta');
  if(meta){
    const n = currentListItems.length;
    const who = own ? 'toi' : friendDisplayName(m.userId);
    meta.innerHTML = `${friendAvatarHtml(m.userId, who)}<span>Par ${escapeHtml(who)} · ${n} film${n > 1 ? 's' : ''}${m.numbered ? ' · numérotée' : ''}</span>`;
  }
  document.getElementById('listLikeBtn').hidden = own;
  document.getElementById('listEditBtn').hidden = !own || editing;
  document.getElementById('listDoneBtn').hidden = !editing;
  document.getElementById('listMoreWrap').hidden = !own;
  document.getElementById('listDeleteBtn').style.display = own ? '' : 'none';
  document.getElementById('listAddItemSection').style.display = own ? '' : 'none';
  document.getElementById('listEditBar').hidden = !editing;
  document.getElementById('listHeadView').hidden = editing;
  document.getElementById('listHeadEdit').hidden = !editing;
  document.getElementById('listNumbered').checked = !!m.numbered;
}

function updateListLikeButtonUI(){
  const btn = document.getElementById('listLikeBtn');
  const liked = currentListLikes.some(l => l.userId === currentUser.id);
  btn.classList.toggle('active', liked);
  btn.setAttribute('aria-pressed', String(liked));
  btn.innerHTML = `${uiIcon('heart', liked)} ${liked ? 'Aimée' : 'Aimer'}`;
}

function renderListLikesSummary(){
  const others = currentListLikes.filter(l => l.userId !== currentUser.id);
  const summaryEl = document.getElementById('listLikesSummary');
  summaryEl.textContent = others.length === 0
    ? ''
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

// Une affiche : ta note en coin (ou « pas vu » dessous), le rang si la
// liste est numérotée. En mode « Modifier » : poignée et ✕ à la place.
function listItemTileHtml(item, index){
  const mine = films.find(f => f.tmdbId === item.tmdbId);
  const note = mine ? getDisplayNote(mine) : null;
  const editing = isOwnList() && listEditing;
  const poster = item.posterUrl
    ? `<img src="${item.posterUrl}" alt="" loading="lazy">`
    : `<div class="film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`;
  const overlays = editing
    ? `<button type="button" class="ls-drag" data-drag-id="${item.id}" aria-label="Déplacer ${escapeHtml(item.title)}">${uiIcon('grip')}</button>`
      + `<button type="button" class="ls-x" data-item-id="${item.id}" aria-label="Retirer ${escapeHtml(item.title)}">×</button>`
    : `${currentListMeta && currentListMeta.numbered ? `<span class="ls-rank">${index + 1}</span>` : ''}`
      + `${note !== null && note !== undefined ? `<span class="fr-poster-note ${noteColorClass(note)}">${note.toFixed(1)}</span>` : ''}`;
  const sub = [item.releaseYear, mine ? '' : 'pas vu'].filter(Boolean).join(' · ');
  return `
    <div class="ls-tile${editing ? ' is-editing' : ''}" data-item-id="${item.id}">
      <div class="ls-tile-img">${poster}${overlays}</div>
      <div class="ls-tile-t">${escapeHtml(item.title)}</div>
      ${sub ? `<div class="ls-tile-s">${escapeHtml(String(sub))}</div>` : ''}
    </div>
  `;
}

function renderListProgress(){
  const prog = document.getElementById('listProgress');
  if(!prog) return;
  const n = currentListItems.length;
  if(!n){ prog.innerHTML = ''; return; }
  const seen = seenCountIn(currentListItems.map(i => i.tmdbId));
  prog.innerHTML = `<i><b style="width:${Math.round(seen / n * 100)}%"></b></i><span>Tu en as vu ${seen} sur ${n}</span>`;
}

function renderListItems(){
  const wrap = document.getElementById('listItemsList');
  const editing = isOwnList() && listEditing;
  if(currentListMeta) renderListDetailHeader();
  renderListProgress();
  if(currentListItems.length === 0){
    wrap.innerHTML = `<div class="tmdb-empty">Aucun film pour l’instant.${isOwnList() && !editing ? ' « Modifier » pour en ajouter, ou « Ajouter à une liste » depuis la fiche d’un film.' : ''}</div>`;
    return;
  }
  const navList = currentListItems.map(item => ({ tmdbId: item.tmdbId, title: item.title }));
  wrap.innerHTML = currentListItems.map(listItemTileHtml).join('');
  if(editing){
    wrap.querySelectorAll('button.ls-x[data-item-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleRemoveListItem(parseInt(btn.dataset.itemId, 10));
      });
    });
    wireListDrag(wrap);
    return;
  }
  wrap.querySelectorAll('.ls-tile[data-item-id]').forEach(tile => {
    const item = currentListItems.find(i => i.id === parseInt(tile.dataset.itemId, 10));
    makeRowClickable(tile, () => goToFilmDetail(item.tmdbId, navList));
  });
}

// Réordonner en glissant la poignée, à la souris comme au doigt : la tuile
// suit le pointeur parmi les autres, l'ordre s'enregistre à « Terminé ».
function wireListDrag(wrap){
  wrap.querySelectorAll('.ls-drag').forEach(handle => {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const tile = handle.closest('.ls-tile');
      tile.classList.add('is-dragging');
      // Écouté sur la page entière : le pointeur quitte vite la poignée.
      const move = (ev) => {
        if(ev.pointerId !== e.pointerId) return;
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const target = under && under.closest ? under.closest('.ls-tile') : null;
        if(!target || target === tile || target.parentNode !== wrap) return;
        const r = target.getBoundingClientRect();
        const after = ev.clientY > r.bottom ? true : (ev.clientY < r.top ? false : ev.clientX > r.left + r.width / 2);
        wrap.insertBefore(tile, after ? target.nextSibling : target);
      };
      const up = (ev) => {
        if(ev.pointerId !== e.pointerId) return;
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        tile.classList.remove('is-dragging');
        const order = Array.from(wrap.querySelectorAll('.ls-tile[data-item-id]')).map(t => parseInt(t.dataset.itemId, 10));
        applyListOrder(order);
        renderListItems();
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    });
    // Au clavier : flèches gauche/droite pour reculer ou avancer d'une place.
    handle.addEventListener('keydown', (e) => {
      if(e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const id = parseInt(handle.dataset.dragId, 10);
      const ids = currentListItems.map(i => i.id);
      const i = ids.indexOf(id);
      const j = e.key === 'ArrowLeft' ? i - 1 : i + 1;
      if(j < 0 || j >= ids.length) return;
      ids.splice(i, 1);
      ids.splice(j, 0, id);
      applyListOrder(ids);
      renderListItems();
      const again = document.querySelector(`#listItemsList .ls-drag[data-drag-id="${id}"]`);
      if(again) again.focus();
    });
  });
}

// Range currentListItems dans l'ordre des id donnés et renumérote.
function applyListOrder(orderIds){
  const before = currentListItems.map(i => i.id).join(',');
  currentListItems.sort((a, b) => orderIds.indexOf(a.id) - orderIds.indexOf(b.id));
  currentListItems.forEach((it, i) => { it.position = i; });
  if(currentListItems.map(i => i.id).join(',') !== before) listOrderDirty = true;
}

function startListEdit(){
  if(!isOwnList()) return;
  listEditing = true;
  listOrderDirty = false;
  document.getElementById('listEditTitle').value = currentListMeta.title;
  document.getElementById('listEditDesc').value = currentListMeta.description || '';
  closeListAddSearch();
  renderListItems();
  document.getElementById('listEditTitle').focus();
}

// « Terminé » : titre et description, puis « Numérotée » et l'ordre
// (migration 066) à part, pour que l'un n'empêche pas l'autre.
async function saveListEdits(){
  if(blockIfOffline()) return;
  const m = currentListMeta;
  const title = document.getElementById('listEditTitle').value.trim() || m.title;
  const description = document.getElementById('listEditDesc').value.trim() || null;
  const numbered = document.getElementById('listNumbered').checked;
  let failed = false;
  let needs066 = false;
  if(title !== m.title || description !== (m.description || null)){
    const { error } = await supabaseClient.from('lists').update({ title, description }).eq('id', m.id);
    if(error){ console.error(error); failed = true; }
    else{ m.title = title; m.description = description; }
  }
  if(numbered !== !!m.numbered){
    const { error } = await supabaseClient.from('lists').update({ numbered }).eq('id', m.id);
    if(error){ console.error(error); needs066 = true; }
    else m.numbered = numbered;
  }
  if(listOrderDirty){
    const results = await Promise.all(currentListItems.map((it, i) =>
      supabaseClient.from('list_items').update({ position: i }).eq('id', it.id).select('id')));
    // Sans la migration 066, la mise à jour ne renvoie aucune ligne (RLS).
    if(results.some(r => r.error || !r.data || !r.data.length)){
      results.filter(r => r.error).forEach(r => console.error(r.error));
      needs066 = true;
    }else listOrderDirty = false;
  }
  const own = myLists.find(l => l.id === m.id);
  if(own){ own.title = m.title; own.description = m.description; }
  listEditing = false;
  closeListAddSearch();
  renderListItems();
  if(failed) showToast('Titre pas enregistré, réessaie');
  else if(needs066) showToast('Ordre et numérotation pas encore enregistrés : la mise à jour de la base (066) reste à faire');
  else showToast('Liste enregistrée');
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
  const item = currentListItems.find(i => i.id === itemId);
  const { error } = await supabaseClient.from('list_items').delete().eq('id', itemId);
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  currentListItems = currentListItems.filter(i => i.id !== itemId);
  renderListItems();
  if(item) showToast(`${item.title} retiré de la liste`);
}

async function handleDeleteList(){
  closeListMenu();
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

// --- Ajout d'un film en mode « Modifier » : même gabarit de recherche
// TMDB que la watchlist (js/watchlist.js) ou les propositions de groupe
// (js/proposals.js) ; choisir un résultat l'ajoute tout de suite.
function closeListAddSearch(){
  const search = document.getElementById('listAddSearch');
  if(search) search.hidden = true;
  const toggle = document.getElementById('listAddToggle');
  if(toggle){ toggle.hidden = false; toggle.setAttribute('aria-expanded', 'false'); }
  document.getElementById('listItemTitleInput').value = '';
  document.getElementById('listItemTmdbResults').innerHTML = '';
}

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
    const mine = films.find(f => f.tmdbId === r.id);
    const note = mine ? getDisplayNote(mine) : null;
    const already = currentListItems.some(i => i.tmdbId === r.id);
    const item = document.createElement('div');
    item.className = 'tmdb-result';
    item.innerHTML = `
      ${poster ? `<img loading="lazy" decoding="async" src="${poster}" alt="">` : `<div class="tmdb-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="tmdb-result-info">
        <div class="tmdb-result-title">${escapeHtml(r.title)}</div>
        <div class="tmdb-result-year">${year}${note !== null && note !== undefined ? ` · ta note ${note.toFixed(1)}` : ''}</div>
      </div>
      <span class="tmdb-result-action">${already ? 'Déjà dedans' : 'Ajouter'}</span>
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
  showToast(`${r.title} ajouté à la liste`);
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
  listEditing = false;
  listOrderDirty = false;
  closeListMenu();
  document.getElementById('listDetailTitle').textContent = 'Chargement…';
  document.getElementById('listDetailDesc').style.display = 'none';
  document.getElementById('listDetailMeta').innerHTML = '';
  document.getElementById('listProgress').innerHTML = '';
  document.getElementById('listItemsList').innerHTML = skeletonRows();
  document.getElementById('listLikesSummary').textContent = '';
  document.getElementById('listEditBar').hidden = true;
  document.getElementById('listHeadEdit').hidden = true;
  document.getElementById('listHeadView').hidden = false;
  closeListAddSearch();

  const { data, error } = await supabaseClient.from('lists').select('*').eq('id', listId).maybeSingle();
  if(error || !data){
    showToast('Liste introuvable');
    goToLists();
    return;
  }
  currentListMeta = { id: data.id, userId: data.user_id, title: data.title, description: data.description, numbered: !!data.numbered };
  currentListItems = [];
  renderListDetailHeader();

  await Promise.all([loadListItems(listId), loadListLikes(listId)]);
  renderListItems();
}

// Menu ⋯ de ta liste.
function closeListMenu(){
  const menu = document.getElementById('listMenu');
  if(menu) menu.hidden = true;
  const btn = document.getElementById('listMoreBtn');
  if(btn) btn.setAttribute('aria-expanded', 'false');
}

document.getElementById('listDetailBack').addEventListener('click', goToLists);
document.getElementById('listLikeBtn').addEventListener('click', toggleListLike);
document.getElementById('listDeleteBtn').addEventListener('click', handleDeleteList);
document.getElementById('listEditBtn').addEventListener('click', startListEdit);
{
  const listDoneBtn = document.getElementById('listDoneBtn');
  listDoneBtn.addEventListener('click', withSubmitGuard(listDoneBtn, saveListEdits));
  const moreBtn = document.getElementById('listMoreBtn');
  moreBtn.innerHTML = uiIcon('dots');
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('listMenu');
    menu.hidden = !menu.hidden;
    moreBtn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', (e) => {
    if(!e.target.closest || !e.target.closest('#listMoreWrap')) closeListMenu();
  });
  document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeListMenu(); });
  document.getElementById('listMenuShare').addEventListener('click', () => {
    closeListMenu();
    showToast('Tes listes sont visibles par tes amis, jamais en public');
  });
}
document.getElementById('listAddToggle').addEventListener('click', () => {
  document.getElementById('listAddSearch').hidden = false;
  const toggle = document.getElementById('listAddToggle');
  toggle.hidden = true;
  toggle.setAttribute('aria-expanded', 'true');
  document.getElementById('listItemTitleInput').focus();
});
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

// --- « Ajouter à une liste » depuis la fiche d'un film (menu ⋯) ---
// Coche ou décoche chaque liste : l'ajout et le retrait sont enregistrés
// tout de suite, « Terminé » referme et résume.
let addToListFilm = null;      // { tmdbId, title, posterUrl, releaseYear }
let addToListMembership = {};  // listId -> id de la ligne list_items du film

async function openAddToListSheet(film){
  if(!film || blockIfOffline()) return;
  addToListFilm = film;
  addToListMembership = {};
  document.getElementById('addToListTitle').textContent = `Ajouter ${film.title} à une liste`;
  document.getElementById('addToListRows').innerHTML = `<div class="tmdb-empty">Chargement…</div>`;
  const input = document.getElementById('addToListNewTitle');
  input.value = '';
  input.hidden = true;
  openOverlay('addToListOverlay');
  await loadMyLists();
  if(myLists.length){
    await loadMyListCovers();
    const { data, error } = await supabaseClient
      .from('list_items')
      .select('id, list_id')
      .eq('tmdb_id', film.tmdbId)
      .in('list_id', myLists.map(l => l.id));
    if(error) console.error(error);
    else (data || []).forEach(r => { addToListMembership[r.list_id] = r.id; });
  }
  renderAddToListRows();
}

function renderAddToListRows(){
  const wrap = document.getElementById('addToListRows');
  if(!myLists.length){
    wrap.innerHTML = `<p class="tmdb-empty">Pas encore de liste. Crée la première juste en dessous.</p>`;
    return;
  }
  wrap.innerHTML = myLists.map(l => {
    const c = myListCovers[l.id];
    const n = c ? c.count : 0;
    return `<label class="ls-check"><input type="checkbox" data-list-id="${l.id}" ${addToListMembership[l.id] ? 'checked' : ''}><span class="ls-check-main">${escapeHtml(l.title)}<small>${n} film${n > 1 ? 's' : ''}</small></span></label>`;
  }).join('');
  wrap.querySelectorAll('input[data-list-id]').forEach(box => {
    box.addEventListener('change', async () => {
      box.disabled = true;
      await toggleFilmInList(parseInt(box.dataset.listId, 10), box.checked);
    });
  });
}

async function toggleFilmInList(listId, on){
  const film = addToListFilm;
  if(!film) return;
  const cov = myListCovers[listId] || (myListCovers[listId] = { posters: [], count: 0, tmdbIds: [] });
  if(on){
    if(addToListMembership[listId]){ renderAddToListRows(); return; }
    const { data, error } = await supabaseClient.from('list_items').insert({
      list_id: listId, user_id: currentUser.id, tmdb_id: film.tmdbId, title: film.title,
      poster_url: film.posterUrl || null, release_year: film.releaseYear || null,
      position: cov.count
    }).select().single();
    if(error){ showToast('Erreur, réessaie'); console.error(error); renderAddToListRows(); return; }
    addToListMembership[listId] = data.id;
    cov.count++;
    cov.tmdbIds.push(film.tmdbId);
    if(film.posterUrl && cov.posters.length < 4) cov.posters.push(film.posterUrl);
  }else{
    const itemId = addToListMembership[listId];
    if(!itemId){ renderAddToListRows(); return; }
    const { error } = await supabaseClient.from('list_items').delete().eq('id', itemId);
    if(error){ showToast('Erreur, réessaie'); console.error(error); renderAddToListRows(); return; }
    delete addToListMembership[listId];
    cov.count = Math.max(0, cov.count - 1);
    cov.tmdbIds = cov.tmdbIds.filter(id => id !== film.tmdbId);
    if(film.posterUrl) cov.posters = cov.posters.filter(p => p !== film.posterUrl);
  }
  renderAddToListRows();
}

// « + Nouvelle liste » : affiche le champ, puis crée la liste et y coche le film.
async function createListFromSheet(){
  const input = document.getElementById('addToListNewTitle');
  if(input.hidden){
    input.hidden = false;
    input.focus();
    return;
  }
  const title = input.value.trim();
  if(!title){ input.focus(); return; }
  const { data, error } = await supabaseClient
    .from('lists')
    .insert({ title, description: null, user_id: currentUser.id })
    .select()
    .single();
  if(error){ showToast('Erreur, réessaie'); console.error(error); return; }
  myLists.unshift(rowToList(data));
  input.value = '';
  input.hidden = true;
  await toggleFilmInList(data.id, true);
}

function closeAddToListSheet(){
  const film = addToListFilm;
  closeOverlay('addToListOverlay');
  addToListFilm = null;
  if(!film) return;
  const n = Object.keys(addToListMembership).length;
  showToast(n ? `${film.title} est dans ${n} liste${n > 1 ? 's' : ''}` : `${film.title} n’est dans aucune liste`);
}

document.getElementById('addToListClose').addEventListener('click', closeAddToListSheet);
document.getElementById('addToListDone').addEventListener('click', closeAddToListSheet);
document.getElementById('addToListOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'addToListOverlay') closeAddToListSheet();
});
{
  const addToListNewBtn = document.getElementById('addToListNewBtn');
  addToListNewBtn.addEventListener('click', withSubmitGuard(addToListNewBtn, createListFromSheet));
  document.getElementById('addToListNewTitle').addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){ e.preventDefault(); addToListNewBtn.click(); }
  });
}
// Fiche film, menu ⋯ : le film affiché (currentFilmData, js/filmDetail.js).
document.getElementById('filmDetailAddToListBtn').addEventListener('click', () => {
  closeFilmDetailMenu();
  const d = currentFilmData;
  if(!d || d.tmdb_id !== currentFilmTmdbId) return;
  openAddToListSheet({
    tmdbId: d.tmdb_id, title: d.title, posterUrl: d.poster_url || null,
    releaseYear: d.release_year ? parseInt(d.release_year, 10) : null
  });
});
