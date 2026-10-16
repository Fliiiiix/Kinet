// --- Tests des listes thématiques partageables (js/lists.js) ---
// Retour utilisateur (étude comparative Letterboxd : "Movies everyone
// should watch at least once", collections likeables) — le plus gros
// écart structurel identifié : watchlist est privée, Top films est
// algorithmique, Groupes est un cercle fermé, rien ne permettait de
// composer et partager une collection thématique. Adapté à l'esprit fermé
// de Kinet : visible entre amis seulement (RLS are_friends(), migrations/058).
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(overrides = {}){
  const elements = {
    myListsList: stubElement(),
    friendsListsList: stubElement(),
    listTitleInput: stubElement({ value: '' }),
    listDescInput: stubElement({ value: '' }),
    listDetailTitle: stubElement(),
    listDetailDesc: stubElement(),
    listDeleteBtn: stubElement(),
    listAddItemSection: stubElement(),
    listLikeBtn: stubElement(),
    listLikesSummary: stubElement(),
    listItemsList: stubElement(),
    listItemTitleInput: stubElement({ value: '' }),
    listItemTmdbResults: stubElement(),
  };
  Object.assign(elements, overrides.elements || {});
  const toasts = [];
  const ctx = createContext(Object.assign({
    document: stubDocument(elements),
    goHome(){}, goToLists(){},
    escapeHtml(s){ return s; },
    blockIfOffline(){ return false; },
    showToast(msg){ toasts.push(msg); },
    makeRowClickable(){},
    skeletonRows(){ return ''; },
    withSubmitGuard(btn, handler){ return handler; },
    currentUser: { id: 'me' },
    friendProfiles: {},
    friendDisplayName(id){ return (overrides.friendProfiles && overrides.friendProfiles[id] && overrides.friendProfiles[id].displayName) || 'Utilisateur'; },
    cacheProfile(){},
    FILM_PLACEHOLDER_SVG: '', TMDB_IMG_BASE: 'https://img/',
    goToFilmDetail(){},
    friendAvatarHtml(){ return '<i class="av"></i>'; },
    films: [],
    getDisplayNote(f){ return f.note; },
    noteColorClass(n){ return n >= 4 ? 'rate-high' : 'rate-mid'; },
    openOverlay(){}, closeOverlay(){},
  }, overrides));
  loadFiles(ctx, ['js/lists.js']);
  return { ctx, elements, toasts };
}

// --- rowToList / rowToListItem ---
// Objets construits DANS le contexte vm (autre realm) : comparaison via
// JSON pour éviter le faux-négatif deepStrictEqual sur des prototypes
// Object différents entre deux realms — même repli qu'ailleurs dans cette
// suite (ex. tests/annual-goal.test.js, tests/comment-reactions.test.js).
test('rowToList() : mappe les colonnes snake_case en camelCase', () => {
  const { ctx } = buildContext();
  const list = ctx.rowToList({ id: 1, user_id: 'me', title: 'Mes comédies', description: 'desc', created_at: '2026-01-01' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(list)), { id: 1, userId: 'me', title: 'Mes comédies', description: 'desc', createdAt: '2026-01-01' });
});

test('rowToListItem() : mappe les colonnes snake_case en camelCase', () => {
  const { ctx } = buildContext();
  const item = ctx.rowToListItem({ id: 9, tmdb_id: 550, title: 'Fight Club', poster_url: 'x.jpg', release_year: 1999, position: 0 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(item)), { id: 9, tmdbId: 550, title: 'Fight Club', posterUrl: 'x.jpg', releaseYear: 1999, position: 0 });
});

// --- renderMyLists() ---
test('renderMyLists() : aucune liste -> message d\'état vide', () => {
  const { ctx, elements } = buildContext();
  setState(ctx, { myLists: [] });
  ctx.renderMyLists();
  assert.ok(elements.myListsList.innerHTML.includes('Pas encore de liste'));
});

// Piste A de l'audit des six écrans (16/10) : une carte avec la couverture,
// le titre et « N films · tu en as vu X », puis la tuile « + Nouvelle liste ».
test('renderMyLists() : une liste -> carte avec son titre, son compte et « + Nouvelle liste »', () => {
  const { ctx, elements } = buildContext();
  setState(ctx, {
    myLists: [{ id: 1, userId: 'me', title: 'Mes comédies', description: 'Pour rire', createdAt: '2026-01-01' }],
    myListCovers: { 1: { posters: ['a.jpg'], count: 2, tmdbIds: [10, 11] } },
    films: [{ tmdbId: 10 }],
  });
  ctx.renderMyLists();
  const html = elements.myListsList.innerHTML;
  assert.ok(html.includes('Mes comédies'));
  assert.ok(html.includes('2 films · tu en as vu 1'), html);
  assert.ok(html.includes('a.jpg'));
  assert.ok(html.includes('+ Nouvelle liste'));
  assert.ok(!html.includes('Pas encore de liste'));
});

test('myListSubLabel() : vide, tout vu, un seul film vu', () => {
  const { ctx } = buildContext();
  setState(ctx, {
    myListCovers: { 1: { posters: [], count: 0, tmdbIds: [] }, 2: { posters: [], count: 2, tmdbIds: [10, 11] }, 3: { posters: [], count: 1, tmdbIds: [10] } },
    films: [{ tmdbId: 10 }, { tmdbId: 11 }],
  });
  assert.strictEqual(ctx.myListSubLabel(1), 'vide pour l’instant');
  assert.strictEqual(ctx.myListSubLabel(2), '2 films · tu les as tous vus');
  assert.strictEqual(ctx.myListSubLabel(3), '1 film · tu l’as vu');
  assert.strictEqual(ctx.myListSubLabel(99), 'vide pour l’instant');
  setState(ctx, { films: [] });
  assert.strictEqual(ctx.myListSubLabel(2), '2 films · tu n’en as vu aucun');
  assert.strictEqual(ctx.myListSubLabel(3), '1 film · pas encore vu');
});

// --- handleCreateList() ---
test('handleCreateList() : titre vide -> toast, aucun appel réseau', async () => {
  const { ctx, toasts } = buildContext({
    supabaseClient: { from(){ throw new Error('ne doit jamais être appelé sans titre'); } },
  });
  elementsValue(ctx, 'listTitleInput', '   ');
  await ctx.handleCreateList();
  assert.strictEqual(toasts.length, 1);
});

test('handleCreateList() : succès -> ajoutée en tête de myLists, champs vidés, toast de confirmation', async () => {
  const insertCalls = [];
  const { ctx, elements, toasts } = buildContext({
    supabaseClient: {
      from(table){
        assert.strictEqual(table, 'lists');
        return {
          insert(payload){
            insertCalls.push(payload);
            return {
              select(){ return this; },
              single(){ return Promise.resolve({ data: { id: 5, user_id: 'me', title: payload.title, description: payload.description, created_at: '2026-01-01' }, error: null }); },
            };
          },
        };
      },
    },
  });
  setState(ctx, { myLists: [{ id: 1, userId: 'me', title: 'Ancienne', description: null, createdAt: '2025-01-01' }] });
  elementsValue(ctx, 'listTitleInput', 'Nouvelle liste');
  elementsValue(ctx, 'listDescInput', 'Une description');
  await ctx.handleCreateList();
  const lists = getState(ctx, 'myLists');
  assert.strictEqual(lists.length, 2);
  assert.strictEqual(lists[0].title, 'Nouvelle liste');
  assert.strictEqual(elements.listTitleInput.value, '');
  assert.strictEqual(toasts[toasts.length - 1], 'Liste créée');
});

function elementsValue(ctx, id, value){
  const doc = getState(ctx, 'document');
  doc.getElementById(id).value = value;
}

// --- friendListCardHtml() / renderFriendsListsSection() ---
test('friendListCardHtml() : affiches connues -> mosaïque ; aucune -> pictogramme de repli', () => {
  const { ctx } = buildContext({ friendProfiles: { ami1: { displayName: 'Sam' } } });
  const withPosters = ctx.friendListCardHtml({ id: 1, user_id: 'ami1', title: 'Liste A', item_count: 3, like_count: 2, poster_urls: ['a.jpg', 'b.jpg'] });
  assert.ok(withPosters.includes('list-cover-posters"'), withPosters);
  assert.ok(withPosters.includes('a.jpg') && withPosters.includes('b.jpg'));
  assert.ok(withPosters.includes('Sam'));
  assert.ok(withPosters.includes("2 j'aime"));

  const noPosters = ctx.friendListCardHtml({ id: 2, user_id: 'ami1', title: 'Liste B', item_count: 0, like_count: 0, poster_urls: null });
  assert.ok(noPosters.includes('list-cover-posters-empty'), noPosters);
  assert.ok(!noPosters.includes("j'aime"), 'pas de compteur de likes à zéro');
});

// --- isOwnList() / renderListDetailHeader() ---
test('renderListDetailHeader() : propriétaire -> bouton Supprimer et section Ajouter visibles', () => {
  const { ctx, elements } = buildContext();
  setState(ctx, { currentListMeta: { id: 1, userId: 'me', title: 'Ma liste', description: null } });
  ctx.renderListDetailHeader();
  assert.strictEqual(elements.listDeleteBtn.style.display, '');
  assert.strictEqual(elements.listAddItemSection.style.display, '');
});

test('renderListDetailHeader() : liste d\'un ami -> bouton Supprimer et section Ajouter masqués', () => {
  const { ctx, elements } = buildContext();
  setState(ctx, { currentListMeta: { id: 1, userId: 'ami1', title: 'Sa liste', description: 'Vue sur sa liste' } });
  ctx.renderListDetailHeader();
  assert.strictEqual(elements.listDeleteBtn.style.display, 'none');
  assert.strictEqual(elements.listAddItemSection.style.display, 'none');
  assert.strictEqual(elements.listDetailDesc.style.display, '');
});

// --- toggleListLike() ---
test('toggleListLike() : pas encore aimée -> insère et bascule le texte du bouton', async () => {
  const { ctx, elements } = buildContext({
    supabaseClient: {
      from(table){
        assert.strictEqual(table, 'list_likes');
        return {
          insert(){ return { select(){ return this; }, single(){ return Promise.resolve({ data: { id: 11 }, error: null }); } }; },
        };
      },
    },
  });
  setState(ctx, { currentListId: 1, currentListLikes: [] });
  await ctx.toggleListLike();
  assert.ok(elements.listLikeBtn.innerHTML.includes('Aimé'));
  assert.strictEqual(getState(ctx, 'currentListLikes').length, 1);
});

test('toggleListLike() : déjà aimée -> supprime (toggle off)', async () => {
  const deleteCalls = [];
  const { ctx, elements } = buildContext({
    supabaseClient: {
      from(table){
        assert.strictEqual(table, 'list_likes');
        return { delete(){ return { eq(col, id){ deleteCalls.push(id); return Promise.resolve({ error: null }); } }; } };
      },
    },
  });
  setState(ctx, { currentListId: 1, currentListLikes: [{ id: 77, userId: 'me' }] });
  await ctx.toggleListLike();
  assert.deepStrictEqual(deleteCalls, [77]);
  assert.ok(elements.listLikeBtn.innerHTML.includes('Aimer'));
  assert.strictEqual(getState(ctx, 'currentListLikes').length, 0);
});

// --- handleAddListItem() ---
test('handleAddListItem() : film déjà présent dans la liste -> toast, aucun appel réseau', async () => {
  const { ctx, toasts } = buildContext({
    supabaseClient: { from(){ throw new Error('ne doit jamais être appelé : doublon détecté avant tout réseau'); } },
  });
  setState(ctx, { currentListItems: [{ id: 1, tmdbId: 550, title: 'Fight Club', posterUrl: null, releaseYear: 1999, position: 0 }] });
  await ctx.handleAddListItem({ id: 550, title: 'Fight Club', poster_path: null, release_date: '1999-10-15' });
  assert.ok(toasts[0].includes('Déjà dans cette liste'));
});

test('handleAddListItem() : nouveau film -> inséré avec la bonne position (fin de liste) et ajouté localement', async () => {
  const insertCalls = [];
  const { ctx } = buildContext({
    supabaseClient: {
      from(table){
        assert.strictEqual(table, 'list_items');
        return {
          insert(payload){
            insertCalls.push(payload);
            return { select(){ return this; }, single(){ return Promise.resolve({ data: { id: 2, tmdb_id: payload.tmdb_id, title: payload.title, poster_url: payload.poster_url, release_year: payload.release_year, position: payload.position }, error: null }); } };
          },
        };
      },
    },
  });
  setState(ctx, { currentListId: 1, currentListItems: [{ id: 1, tmdbId: 550, title: 'Fight Club', posterUrl: null, releaseYear: 1999, position: 0 }] });
  await ctx.handleAddListItem({ id: 603, title: 'Matrix', poster_path: '/m.jpg', release_date: '1999-03-31' });
  assert.strictEqual(JSON.parse(JSON.stringify(insertCalls[0])).position, 1, 'ajouté en fin de liste, pas écrasé en position 0');
  const items = getState(ctx, 'currentListItems');
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[1].tmdbId, 603);
});

// --- handleRemoveListItem() ---
test('handleRemoveListItem() : succès -> retiré de currentListItems', async () => {
  const { ctx } = buildContext({
    supabaseClient: {
      from(table){
        assert.strictEqual(table, 'list_items');
        return { delete(){ return { eq(){ return Promise.resolve({ error: null }); } }; } };
      },
    },
  });
  setState(ctx, { currentListItems: [{ id: 1, tmdbId: 550, title: 'A' }, { id: 2, tmdbId: 603, title: 'B' }] });
  await ctx.handleRemoveListItem(1);
  const items = getState(ctx, 'currentListItems');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].id, 2);
});

// --- Piste A : une liste en grille, « Modifier », « Ajouter à une liste » ---
function headerElements(){
  return {
    listEditBtn: stubElement({ hidden: false }), listDoneBtn: stubElement({ hidden: false }),
    listMoreWrap: stubElement({ hidden: false }), listEditBar: stubElement({ hidden: false }),
    listHeadView: stubElement({ hidden: false }), listHeadEdit: stubElement({ hidden: false }),
    listNumbered: stubElement({ checked: false }), listDetailMeta: stubElement(),
  };
}

test('renderListDetailHeader() : ta liste -> « Modifier » et ⋯, pas de « Aimer »', () => {
  const { ctx, elements } = buildContext({ elements: headerElements() });
  setState(ctx, { currentListMeta: { id: 1, userId: 'me', title: 'Ma liste', description: null, numbered: true }, currentListItems: [{ id: 1 }, { id: 2 }] });
  ctx.renderListDetailHeader();
  assert.strictEqual(elements.listLikeBtn.hidden, true);
  assert.strictEqual(elements.listEditBtn.hidden, false);
  assert.strictEqual(elements.listMoreWrap.hidden, false);
  assert.strictEqual(elements.listEditBar.hidden, true, 'barre de modification cachée hors mode Modifier');
  assert.strictEqual(elements.listNumbered.checked, true);
  assert.ok(elements.listDetailMeta.innerHTML.includes('Par toi · 2 films · numérotée'), elements.listDetailMeta.innerHTML);
});

test('renderListDetailHeader() : liste d’un ami -> « Aimer », ni « Modifier » ni ⋯', () => {
  const { ctx, elements } = buildContext({ elements: headerElements(), friendProfiles: { ami1: { displayName: 'Sam' } } });
  setState(ctx, { currentListMeta: { id: 1, userId: 'ami1', title: 'Sa liste', description: null, numbered: false }, currentListItems: [] });
  ctx.renderListDetailHeader();
  assert.strictEqual(elements.listLikeBtn.hidden, false);
  assert.strictEqual(elements.listEditBtn.hidden, true);
  assert.strictEqual(elements.listMoreWrap.hidden, true);
  assert.ok(elements.listDetailMeta.innerHTML.includes('Par Sam · 0 film'));
});

test('listItemTileHtml() : rang si numérotée, ta note ou « pas vu »', () => {
  const { ctx } = buildContext();
  setState(ctx, {
    currentListMeta: { id: 1, userId: 'me', numbered: true },
    films: [{ tmdbId: 10, note: 4.5 }],
  });
  const seen = ctx.listItemTileHtml({ id: 1, tmdbId: 10, title: 'Arrival', posterUrl: 'a.jpg', releaseYear: 2016 }, 0);
  assert.ok(seen.includes('class="ls-rank">1<'), seen);
  assert.ok(seen.includes('rate-high">4.5<'), seen);
  assert.ok(!seen.includes('pas vu'));
  const unseen = ctx.listItemTileHtml({ id: 2, tmdbId: 11, title: 'Moon', posterUrl: null, releaseYear: 2009 }, 1);
  assert.ok(unseen.includes('class="ls-rank">2<'));
  assert.ok(unseen.includes('2009 · pas vu'), unseen);
});

test('listItemTileHtml() : en mode Modifier -> poignée et ✕, sans rang ni note', () => {
  const { ctx } = buildContext();
  setState(ctx, {
    currentListMeta: { id: 1, userId: 'me', numbered: true },
    films: [{ tmdbId: 10, note: 4.5 }],
    listEditing: true,
  });
  const html = ctx.listItemTileHtml({ id: 1, tmdbId: 10, title: 'Arrival', posterUrl: 'a.jpg', releaseYear: 2016 }, 0);
  assert.ok(html.includes('ls-drag') && html.includes('ls-x'));
  assert.ok(!html.includes('ls-rank') && !html.includes('4.5'));
});

test('applyListOrder() : range, renumérote et marque l’ordre à enregistrer', () => {
  const { ctx } = buildContext();
  setState(ctx, { currentListItems: [{ id: 1, position: 0 }, { id: 2, position: 1 }, { id: 3, position: 2 }], listOrderDirty: false });
  ctx.applyListOrder([3, 1, 2]);
  const items = getState(ctx, 'currentListItems');
  assert.strictEqual(JSON.stringify(items.map(i => [i.id, i.position])), '[[3,0],[1,1],[2,2]]');
  assert.strictEqual(getState(ctx, 'listOrderDirty'), true);
  setState(ctx, { listOrderDirty: false });
  ctx.applyListOrder([3, 1, 2]);
  assert.strictEqual(getState(ctx, 'listOrderDirty'), false, 'même ordre : rien à enregistrer');
});

test('saveListEdits() : sans la migration 066, l’ordre ne passe pas et un message le dit', async () => {
  const updates = [];
  const elements = Object.assign(headerElements(), {
    listEditTitle: stubElement({ value: 'Ma liste' }), listEditDesc: stubElement({ value: '' }),
  });
  const { ctx, toasts } = buildContext({
    elements,
    supabaseClient: {
      from(table){
        return {
          update(payload){
            updates.push([table, payload]);
            const res = { data: [], error: null };
            return { eq(){ return { select(){ return Promise.resolve(res); }, then(r){ return Promise.resolve(res).then(r); } }; } };
          },
        };
      },
    },
  });
  setState(ctx, {
    currentListMeta: { id: 1, userId: 'me', title: 'Ma liste', description: null, numbered: false },
    currentListItems: [{ id: 2, position: 0 }, { id: 1, position: 1 }],
    listEditing: true, listOrderDirty: true,
  });
  await ctx.saveListEdits();
  assert.strictEqual(updates.filter(u => u[0] === 'list_items').length, 2);
  assert.strictEqual(updates.filter(u => u[0] === 'lists').length, 0, 'titre inchangé : pas de mise à jour');
  assert.ok(toasts[toasts.length - 1].includes('066'), toasts[toasts.length - 1]);
  assert.strictEqual(getState(ctx, 'listEditing'), false);
  assert.strictEqual(getState(ctx, 'listOrderDirty'), true, 'reste à enregistrer');
});

test('Ajouter à une liste : cocher ajoute, décocher retire, « Terminé » résume', async () => {
  const calls = [];
  const { ctx, toasts } = buildContext({
    supabaseClient: {
      from(table){
        return {
          insert(payload){ calls.push(['insert', payload]); return { select(){ return this; }, single(){ return Promise.resolve({ data: { id: 40 }, error: null }); } }; },
          delete(){ return { eq(col, id){ calls.push(['delete', id]); return Promise.resolve({ error: null }); } }; },
        };
      },
    },
  });
  setState(ctx, {
    myLists: [{ id: 7, userId: 'me', title: 'SF' }],
    myListCovers: { 7: { posters: ['x.jpg'], count: 3, tmdbIds: [1, 2, 3] } },
    addToListFilm: { tmdbId: 329865, title: 'Arrival', posterUrl: 'arr.jpg', releaseYear: 2016 },
    addToListMembership: {},
  });
  await ctx.toggleFilmInList(7, true);
  const ins = JSON.parse(JSON.stringify(calls[0][1]));
  assert.strictEqual(ins.position, 3, 'ajouté en fin de liste');
  assert.strictEqual(ins.tmdb_id, 329865);
  assert.strictEqual(getState(ctx, 'myListCovers')[7].count, 4);
  await ctx.toggleFilmInList(7, false);
  assert.strictEqual(JSON.stringify(calls[1]), '["delete",40]');
  assert.strictEqual(getState(ctx, 'myListCovers')[7].count, 3);
  await ctx.toggleFilmInList(7, true);
  ctx.closeAddToListSheet();
  assert.strictEqual(toasts[toasts.length - 1], 'Arrival est dans 1 liste');
});

module.exports = run('lists.test.js');
