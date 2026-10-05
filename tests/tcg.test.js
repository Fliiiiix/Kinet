// --- Tests des cartes à collectionner (js/tcg.js) ---
// Le tirage réel (open_booster(), pondération + pools personnel/global)
// vit entièrement côté serveur (supabase/migrations/041_add_tcg_cards.sql,
// PL/pgSQL, hors de portée de ce harnais JS pur) — ce fichier couvre la
// partie client : libellés de rareté, mise en forme/tri de la collection
// chargée, et l'affichage de la barre de boosters disponibles.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(overrides = {}){
  const elements = overrides.elements || {};
  delete overrides.elements;
  const friendProfilesStub = {};
  const ctx = createContext(Object.assign({
    document: stubDocument(elements),
    escapeHtml(s){ return s; },
    openOverlay(){}, closeOverlay(){}, closeProfileModal(){}, openProfileModal(){},
    skeletonRows(){ return ''; },
    motionReduced(){ return false; },
    FILM_PLACEHOLDER_SVG: '<svg></svg>',
    currentUser: { id: 'me' },
    fetchMovieDetails(){ throw new Error('non utilisé par ce test'); },
    supabaseClient: { rpc(){ throw new Error('non utilisé par ce test'); } },
    otherUserId(f){ return f.requesterId === 'me' ? f.addresseeId : f.requesterId; },
    friendDisplayName(userId){ return (friendProfilesStub[userId] && friendProfilesStub[userId].displayName) || 'Utilisateur'; },
    cacheProfile(userId, displayName){ friendProfilesStub[userId] = { displayName }; },
    friendProfiles: friendProfilesStub,
  }, overrides));
  loadFiles(ctx, ['js/tcg.js']);
  return ctx;
}

test('rarityLabel() : un nom de palier cinéma par rareté', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.rarityLabel('commun'), 'Figurant');
  assert.strictEqual(ctx.rarityLabel('rare'), 'Second rôle');
  assert.strictEqual(ctx.rarityLabel('epique'), 'Tête d\'affiche');
  assert.strictEqual(ctx.rarityLabel('legendaire'), 'Légende du 7e art');
});

test('rarityLabel() : rareté inconnue -> repli sur la valeur brute (jamais undefined)', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.rarityLabel('mystere'), 'mystere');
});

test('renderBoosterBar() : aucun booster -> invite à regarder des films, bouton désactivé', () => {
  const countEl = stubElement();
  const btn = stubElement({ disabled: false });
  const ctx = buildContext({ elements: { tcgBoosterCount: countEl, tcgOpenBoosterBtn: btn } });
  setState(ctx, { tcgAvailableBoosters: 0 });
  ctx.renderBoosterBar();
  assert.strictEqual(countEl.textContent, 'Regarde 2 films pour débloquer un booster');
  assert.strictEqual(btn.disabled, true);
});

test('renderBoosterBar() : singulier à 1, pluriel au-delà, bouton activé', () => {
  const countEl = stubElement();
  const btn = stubElement({ disabled: true });
  const ctx = buildContext({ elements: { tcgBoosterCount: countEl, tcgOpenBoosterBtn: btn } });

  setState(ctx, { tcgAvailableBoosters: 1 });
  ctx.renderBoosterBar();
  assert.strictEqual(countEl.textContent, '1 booster disponible');
  assert.strictEqual(btn.disabled, false);

  setState(ctx, { tcgAvailableBoosters: 3 });
  ctx.renderBoosterBar();
  assert.strictEqual(countEl.textContent, '3 boosters disponibles');
});

test('loadTcgCollection() : mappe et trie des plus rares aux plus communes', async () => {
  const rows = [
    { quantity: 2, card: { id: 1, card_type: 'film', name: 'Commun A', image_url: null, rarity: 'commun' } },
    { quantity: 1, card: { id: 2, card_type: 'actor', name: 'Légende B', image_url: null, rarity: 'legendaire' } },
    { quantity: 1, card: { id: 3, card_type: 'director', name: 'Rare C', image_url: null, rarity: 'rare' } },
  ];
  const ctx = buildContext({
    supabaseClient: {
      from(table){
        assert.strictEqual(table, 'tcg_user_cards');
        return {
          select(){ return this; },
          eq(col, val){ assert.strictEqual(col, 'user_id'); assert.strictEqual(val, 'me'); return this; },
          order(){ return Promise.resolve({ data: rows, error: null }); },
        };
      },
    },
  });
  await ctx.loadTcgCollection();
  const collection = JSON.parse(JSON.stringify(getState(ctx, 'tcgCollection')));
  assert.strictEqual(collection.length, 3);
  assert.deepStrictEqual(collection.map(c => c.rarity), ['legendaire', 'rare', 'commun']);
  assert.strictEqual(collection[0].name, 'Légende B');
});

test('loadTcgCollection() : ignore les lignes à quantité 0 ou sans carte (désenchantées/orpheline)', async () => {
  const rows = [
    { quantity: 0, card: { id: 1, card_type: 'film', name: 'Vidée', image_url: null, rarity: 'commun' } },
    { quantity: 2, card: null },
    { quantity: 1, card: { id: 2, card_type: 'film', name: 'Valide', image_url: null, rarity: 'rare' } },
  ];
  const ctx = buildContext({
    supabaseClient: { from(){ return { select(){ return this; }, eq(){ return this; }, order(){ return Promise.resolve({ data: rows, error: null }); } }; } },
  });
  await ctx.loadTcgCollection();
  const collection = JSON.parse(JSON.stringify(getState(ctx, 'tcgCollection')));
  assert.strictEqual(collection.length, 1);
  assert.strictEqual(collection[0].name, 'Valide');
});

test('loadTcgCollection() : erreur réseau -> collection vidée, pas d\'exception', async () => {
  const ctx = buildContext({
    supabaseClient: { from(){ return { select(){ return this; }, eq(){ return this; }, order(){ return Promise.resolve({ data: null, error: { message: 'boom' } }); } }; } },
  });
  setState(ctx, { tcgCollection: [{ cardId: 1, cardType: 'film', name: 'A', imageUrl: null, rarity: 'commun', quantity: 1 }] });
  await ctx.loadTcgCollection();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(getState(ctx, 'tcgCollection'))), []);
});

test('backfillTcgCards() : un appel par tmdb_id UNIQUE du catalogue noté + watchlist', async () => {
  const calls = [];
  const ctx = buildContext();
  ctx.generateTcgCardsForFilm = (tmdbId) => { calls.push(tmdbId); return Promise.resolve(); };
  setState(ctx, {
    films: [{ tmdbId: 1 }, { tmdbId: 2 }, { tmdbId: null }], // sans fiche TMDB -> jamais appelé
    watchlist: [{ tmdbId: 2 }, { tmdbId: 3 }], // 2 déjà vu côté films -> pas un 2e appel
  });
  await ctx.backfillTcgCards();
  assert.deepStrictEqual(calls.sort(), [1, 2, 3]);
});

test('backfillTcgCards() : marque le rattrapage fait (localStorage) une fois le lot terminé', async () => {
  const ctx = buildContext();
  ctx.generateTcgCardsForFilm = () => Promise.resolve();
  setState(ctx, { films: [{ tmdbId: 1 }], watchlist: [] });
  assert.strictEqual(ctx.getTcgBackfillDone(), false);
  await ctx.backfillTcgCards();
  assert.strictEqual(ctx.getTcgBackfillDone(), true);
});

test('backfillTcgCards() : un 2e appel pendant que le 1er tourne encore ne fait rien (anti doublon)', async () => {
  const calls = [];
  let resolveFirst;
  const ctx = buildContext();
  ctx.generateTcgCardsForFilm = () => new Promise((resolve) => { resolveFirst = resolve; calls.push('called'); });
  setState(ctx, { films: [{ tmdbId: 1 }], watchlist: [] });
  const first = ctx.backfillTcgCards();
  const second = ctx.backfillTcgCards(); // tcgBackfillRunning déjà vrai -> no-op immédiat
  await second;
  assert.strictEqual(calls.length, 1, 'le 2e appel ne doit pas relancer generateTcgCardsForFilm');
  resolveFirst();
  await first;
});

test('tcgCardNamesFromItems() : résout les noms depuis le cache, "?" si une carte est inconnue', () => {
  const ctx = buildContext();
  setState(ctx, { tcgCardNameCache: { 1: { name: 'Parasite', rarity: 'commun' }, 2: { name: 'Dune', rarity: 'epique' } } });
  assert.strictEqual(ctx.tcgCardNamesFromItems([{ card_id: 1, quantity: 1 }, { card_id: 2, quantity: 1 }]), 'Parasite, Dune');
  assert.strictEqual(ctx.tcgCardNamesFromItems([{ card_id: 99, quantity: 1 }]), '?');
  assert.strictEqual(ctx.tcgCardNamesFromItems(undefined), '');
});

test('populateTradePartnerSelect() : un ami par amitié ACCEPTÉE, triés par nom, ni en attente ni refusée', () => {
  const sel = stubElement();
  const ctx = buildContext({ elements: { tcgTradePartnerSelect: sel } });
  setState(ctx, {
    friendships: [
      { requesterId: 'me', addresseeId: 'bob', status: 'accepted' },
      { requesterId: 'alice', addresseeId: 'me', status: 'accepted' },
      { requesterId: 'me', addresseeId: 'carol', status: 'pending' }, // pas encore accepté -> absent
    ],
  });
  ctx.cacheProfile('bob', 'Bob');
  ctx.cacheProfile('alice', 'Alice');
  ctx.populateTradePartnerSelect();
  const order = [...sel.innerHTML.matchAll(/value="(\w+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(order, ['alice', 'bob'], 'alphabétique, carol (amitié en attente) absente');
});

test('renderPendingTrades() : échange ENTRANT -> "tu donnes" = ce qui est demandé, "tu reçois" = ce qui est offert', () => {
  const section = stubElement();
  const list = stubElement();
  const ctx = buildContext({ elements: { tcgTradesSection: section, tcgTradesList: list } });
  ctx.cacheProfile('alice', 'Alice');
  setState(ctx, {
    tcgCardNameCache: { 1: { name: 'Parasite', rarity: 'commun' }, 2: { name: 'Dune', rarity: 'epique' } },
    tcgPendingTrades: [{
      id: 10, from_user: 'alice', to_user: 'me', status: 'pending',
      offered: [{ card_id: 1, quantity: 1 }],   // ce qu'Alice donne -> ce que JE reçois
      requested: [{ card_id: 2, quantity: 1 }], // ce qu'Alice demande -> ce que JE donne
    }],
  });
  ctx.renderPendingTrades();
  assert.strictEqual(section.style.display, '');
  assert.ok(list.innerHTML.includes('Proposé par Alice'));
  assert.ok(list.innerHTML.includes('Tu donnes : Dune'), 'ce qu\'Alice DEMANDE est ce que JE donnerais en acceptant');
  assert.ok(list.innerHTML.includes('Tu reçois : Parasite'), 'ce qu\'Alice OFFRE est ce que JE recevrais en acceptant');
  assert.ok(list.innerHTML.includes('data-accept-trade="10"'));
});

test('renderPendingTrades() : échange SORTANT (proposé par moi) -> "tu donnes" = offered, "tu reçois" = requested, pas de bouton Accepter', () => {
  const section = stubElement();
  const list = stubElement();
  const ctx = buildContext({ elements: { tcgTradesSection: section, tcgTradesList: list } });
  ctx.cacheProfile('alice', 'Alice');
  setState(ctx, {
    tcgCardNameCache: { 1: { name: 'Parasite', rarity: 'commun' }, 2: { name: 'Dune', rarity: 'epique' } },
    tcgPendingTrades: [{
      id: 11, from_user: 'me', to_user: 'alice', status: 'pending',
      offered: [{ card_id: 1, quantity: 1 }],
      requested: [{ card_id: 2, quantity: 1 }],
    }],
  });
  ctx.renderPendingTrades();
  assert.ok(list.innerHTML.includes('Proposé à Alice'));
  assert.ok(list.innerHTML.includes('Tu donnes : Parasite'));
  assert.ok(list.innerHTML.includes('Tu reçois : Dune'));
  assert.ok(!list.innerHTML.includes('data-accept-trade'), 'on ne peut pas accepter sa propre proposition');
  assert.ok(list.innerHTML.includes('data-resolve-status="cancelled"'));
});

test('renderPendingTrades() : aucun échange en attente -> section masquée', () => {
  const section = stubElement();
  const list = stubElement();
  const ctx = buildContext({ elements: { tcgTradesSection: section, tcgTradesList: list } });
  setState(ctx, { tcgPendingTrades: [] });
  ctx.renderPendingTrades();
  assert.strictEqual(section.style.display, 'none');
});

test('openBoosterReveal() : « Ouvrir un autre booster » seulement s\'il reste des boosters', async () => {
  const nextBtn = stubElement();
  const doneBtn = stubElement();
  const ctx = buildContext({ elements: { tcgBoosterPack: stubElement(), tcgBoosterDoneBtn: doneBtn, tcgBoosterNextBtn: nextBtn, tcgBoosterOverlay: stubElement() } });
  // Mouvement réduit : pas de délais entre les cartes, donc test immédiat.
  ctx.motionReduced = () => true;
  // Sons non testés ici (sound.js n'est pas chargé dans ce contexte).
  ctx.playCardFlip = () => {};
  ctx.playRarityReveal = () => {};
  const cartes = [1, 2, 3, 4, 5].map(i => ({ id: i, name: 'C' + i, rarity: 'commun', card_type: 'film' }));

  setState(ctx, { tcgAvailableBoosters: 1 });
  ctx.openBoosterReveal(cartes);
  await new Promise(r => setTimeout(r, 30));
  assert.strictEqual(doneBtn.style.display, '');
  assert.strictEqual(nextBtn.style.display, '', 'un booster restant -> bouton visible');

  setState(ctx, { tcgAvailableBoosters: 0 });
  nextBtn.style.display = 'none';
  doneBtn.style.display = 'none';
  ctx.openBoosterReveal(cartes);
  await new Promise(r => setTimeout(r, 30));
  assert.strictEqual(nextBtn.style.display, 'none', 'plus de booster -> bouton caché');
  assert.strictEqual(doneBtn.style.display, '');
});

module.exports = run('tcg.test.js');
