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

module.exports = run('tcg.test.js');
