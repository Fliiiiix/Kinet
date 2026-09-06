// --- Tests des réactions rapides sur une critique d'ami (js/filmDetail.js) ---
// Retour utilisateur : "Réactions rapides sur une critique d'ami" — un
// emoji posé sur le commentaire (film_comments) d'un ami, table dédiée
// comment_reactions (migrations/037). Palette fixe (COMMENT_REACTION_EMOJIS),
// toggle sans confirm() (aussi léger/réversible qu'un like ou un vote).
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(overrides = {}){
  const deleteCalls = [];
  const insertCalls = [];
  function makeReactionsQuery(){
    const call = { insert: null };
    const chain = {
      insert(payload){ call.insert = payload; insertCalls.push(call); return chain; },
      delete(){ return { eq(col, id){ deleteCalls.push(id); return Promise.resolve({ error: null }); } }; },
      select(){ return chain; },
      single(){ return Promise.resolve({ data: { id: 900, ...call.insert }, error: null }); },
    };
    return chain;
  }
  const ctx = createContext(Object.assign({
    document: stubDocument(),
    goHome(){},
    escapeHtml(s){ return s; },
    blockIfOffline(){ return false; },
    showToast(){},
    currentUser: { id: 'me' },
    friendProfiles: {},
    friendDisplayName(id){ return id; },
    friendAvatarHtml(){ return ''; },
    cacheProfile(){},
    films: [], watchlist: [],
    getDisplayNote(){ return null; },
    noteColorClass(){ return ''; },
    supabaseClient: {
      from(table){
        if(table === 'comment_reactions') return makeReactionsQuery();
        throw new Error(`table inattendue dans ce test : ${table}`);
      },
    },
  }, overrides));
  loadFiles(ctx, ['js/filmDetail.js']);
  return { ctx, deleteCalls, insertCalls };
}

test('commentReactionsHtml() : affiche les 5 emojis de la palette, un compteur seulement s\'il y a au moins une réaction', () => {
  const { ctx } = buildContext();
  setState(ctx, { commentReactions: { 1: [{ id: 10, userId: 'ami', emoji: '👍' }] } });
  const html = ctx.commentReactionsHtml(1);
  // COMMENT_REACTION_EMOJIS est un `const` top-level : pas une propriété
  // du contexte (contrairement à une fonction déclarée avec `function`),
  // voir tests/README.md — getState() retrouve la vraie liaison lexicale.
  getState(ctx, 'COMMENT_REACTION_EMOJIS').forEach(e => assert.ok(html.includes(e), `doit contenir ${e}`));
  assert.ok(html.includes('<span class="reaction-count">1</span>'), 'compteur pour 👍 (1 réaction)');
  assert.strictEqual((html.match(/reaction-count/g) || []).length, 1, 'un seul compteur affiché, les 4 autres emojis n\'ont aucune réaction');
});

test('commentReactionsHtml() : marque .active seulement la réaction posée par currentUser, pas celle des autres', () => {
  const { ctx } = buildContext();
  setState(ctx, {
    commentReactions: { 1: [{ id: 10, userId: 'ami', emoji: '👍' }, { id: 11, userId: 'me', emoji: '❤️' }] },
  });
  const html = ctx.commentReactionsHtml(1);
  assert.ok(/data-emoji="👍"[^>]*>/.test(html) && !html.match(/data-emoji="👍"[^>]*active/), '👍 posé par un ami, pas actif pour moi');
  assert.ok(html.includes('reaction-btn active" data-emoji="❤️"'), '❤️ posé par moi -> actif');
});

test('commentReactionsHtml() : aucune réaction sur ce commentaire -> les 5 pastilles sans aucun compteur', () => {
  const { ctx } = buildContext();
  setState(ctx, { commentReactions: {} });
  const html = ctx.commentReactionsHtml(42);
  assert.strictEqual((html.match(/reaction-count/g) || []).length, 0);
});

test('toggleCommentReaction() : pas encore réagi -> insère et ajoute localement', async () => {
  const { ctx, insertCalls } = buildContext();
  setState(ctx, { commentReactions: {} });
  await ctx.toggleCommentReaction(5, '👏');
  const reactions = getState(ctx, 'commentReactions');
  assert.strictEqual(reactions[5].length, 1);
  assert.strictEqual(reactions[5][0].userId, 'me');
  assert.strictEqual(reactions[5][0].emoji, '👏');
  assert.strictEqual(insertCalls.length, 1);
  assert.strictEqual(JSON.parse(JSON.stringify(insertCalls[0].insert)).emoji, '👏');
});

test('toggleCommentReaction() : déjà réagi avec cet emoji -> supprime (toggle off), jamais un second insert', async () => {
  const { ctx, deleteCalls, insertCalls } = buildContext();
  setState(ctx, { commentReactions: { 5: [{ id: 77, userId: 'me', emoji: '👏' }] } });
  await ctx.toggleCommentReaction(5, '👏');
  const reactions = getState(ctx, 'commentReactions');
  assert.strictEqual(reactions[5].length, 0);
  assert.deepStrictEqual(deleteCalls, [77]);
  assert.strictEqual(insertCalls.length, 0);
});

test('toggleCommentReaction() : réagir avec un DEUXIÈME emoji différent sur le même commentaire n\'efface pas le premier', async () => {
  const { ctx } = buildContext();
  setState(ctx, { commentReactions: { 5: [{ id: 77, userId: 'me', emoji: '👏' }] } });
  await ctx.toggleCommentReaction(5, '😂');
  const reactions = getState(ctx, 'commentReactions');
  assert.strictEqual(reactions[5].length, 2);
  assert.ok(reactions[5].some(r => r.emoji === '👏'));
  assert.ok(reactions[5].some(r => r.emoji === '😂'));
});

test('loadCommentReactions() : groupe les lignes par comment_id', async () => {
  const rows = [
    { id: 1, comment_id: 10, user_id: 'a', emoji: '👍' },
    { id: 2, comment_id: 10, user_id: 'b', emoji: '❤️' },
    { id: 3, comment_id: 11, user_id: 'a', emoji: '😮' },
  ];
  const ctx = buildContext({
    supabaseClient: {
      from(table){
        if(table !== 'comment_reactions') throw new Error('table inattendue');
        return { select(){ return this; }, in(){ return Promise.resolve({ data: rows, error: null }); } };
      },
    },
  }).ctx;
  await ctx.loadCommentReactions([10, 11]);
  const reactions = getState(ctx, 'commentReactions');
  assert.strictEqual(reactions[10].length, 2);
  assert.strictEqual(reactions[11].length, 1);
});

test('loadCommentReactions() : liste vide -> pas d\'appel réseau, état vidé', async () => {
  const ctx = buildContext({
    supabaseClient: { from(){ throw new Error('ne doit jamais être appelé sans commentaire'); } },
  }).ctx;
  setState(ctx, { commentReactions: { 1: [{ id: 1, userId: 'x', emoji: '👍' }] } });
  await ctx.loadCommentReactions([]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(getState(ctx, 'commentReactions'))), {});
});

module.exports = run('comment-reactions.test.js');
