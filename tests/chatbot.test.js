// --- Tests de l'assistant (js/chatbot.js) ---
// La vraie conversation avec Claude vit entièrement dans la Supabase Edge
// Function (supabase/functions/chat/index.ts, Deno, hors de portée de ce
// harnais JS pur) — ce fichier couvre uniquement l'orchestration côté
// client : état de la conversation, affichage des bulles, et surtout le
// repli en cas d'erreur (fonction pas déployée/configurée, le cas le plus
// probable tant que ce n'est pas encore mis en place).
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
    supabaseClient: { functions: { invoke(){ throw new Error('non utilisé par ce test'); } } },
  }, overrides));
  loadFiles(ctx, ['js/chatbot.js']);
  return ctx;
}

test('renderChatbotMessages() : toujours le message d\'accueil en premier, puis l\'historique dans l\'ordre', () => {
  const wrap = stubElement();
  const ctx = buildContext({ elements: { chatbotMessages: wrap } });
  setState(ctx, { chatbotMessages: [{ role: 'user', content: 'Salut' }, { role: 'assistant', content: 'Hello !' }] });
  ctx.renderChatbotMessages();
  const order = [...wrap.innerHTML.matchAll(/chatbot-msg-(\w+)"[^>]*>([^<]*)</g)].map(m => [m[1], m[2]]);
  assert.deepStrictEqual(order, [
    ['bot', getState(ctx, 'CHATBOT_GREETING')],
    ['user', 'Salut'],
    ['bot', 'Hello !'],
  ]);
});

test('renderChatbotMessages() : indicateur "en train d\'écrire" affiché seulement pendant un envoi', () => {
  const wrap = stubElement();
  const ctx = buildContext({ elements: { chatbotMessages: wrap } });
  setState(ctx, { chatbotMessages: [], chatbotSending: false });
  ctx.renderChatbotMessages();
  assert.ok(!wrap.innerHTML.includes('chatbot-typing'));

  setState(ctx, { chatbotSending: true });
  ctx.renderChatbotMessages();
  assert.ok(wrap.innerHTML.includes('chatbot-typing'));
});

test('handleChatbotSend() : message vide (espaces) -> n\'envoie rien, n\'ajoute rien à l\'historique', async () => {
  const input = stubElement({ value: '   ' });
  const sendBtn = stubElement();
  const wrap = stubElement();
  let invoked = false;
  const ctx = buildContext({
    elements: { chatbotInput: input, chatbotSendBtn: sendBtn, chatbotMessages: wrap },
    supabaseClient: { functions: { invoke(){ invoked = true; return Promise.resolve({ data: { reply: 'x' }, error: null }); } } },
  });
  await ctx.handleChatbotSend();
  assert.strictEqual(invoked, false);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(getState(ctx, 'chatbotMessages'))), []);
});

test('handleChatbotSend() : succès -> message utilisateur puis réponse ajoutés dans l\'ordre, champ vidé', async () => {
  const input = stubElement({ value: 'Un film triste ?' });
  const sendBtn = stubElement();
  const wrap = stubElement();
  let sentBody = null;
  const ctx = buildContext({
    elements: { chatbotInput: input, chatbotSendBtn: sendBtn, chatbotMessages: wrap },
    supabaseClient: {
      functions: {
        invoke(name, opts){
          assert.strictEqual(name, 'chat');
          // Clone immédiat — un vrai fetch() sérialise le corps de la
          // requête à CET instant, avant qu'une mutation ultérieure de
          // chatbotMessages (la réponse poussée juste après l'await) ne
          // puisse l'affecter ; ce mock doit refléter la même chose,
          // sinon il capture une référence vivante plutôt qu'un instantané.
          sentBody = JSON.parse(JSON.stringify(opts.body));
          return Promise.resolve({ data: { reply: 'Essaie Manchester by the Sea.' }, error: null });
        },
      },
    },
  });
  await ctx.handleChatbotSend();
  const msgs = JSON.parse(JSON.stringify(getState(ctx, 'chatbotMessages')));
  assert.deepStrictEqual(msgs, [
    { role: 'user', content: 'Un film triste ?' },
    { role: 'assistant', content: 'Essaie Manchester by the Sea.' },
  ]);
  assert.strictEqual(input.value, '');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sentBody.messages)), [{ role: 'user', content: 'Un film triste ?' }], 'envoie bien l\'historique à la fonction');
});

test('handleChatbotSend() : fonction pas déployée (erreur réseau) -> message de repli clair, jamais un échec muet', async () => {
  const input = stubElement({ value: 'Salut' });
  const sendBtn = stubElement();
  const wrap = stubElement();
  const ctx = buildContext({
    elements: { chatbotInput: input, chatbotSendBtn: sendBtn, chatbotMessages: wrap },
    supabaseClient: { functions: { invoke(){ return Promise.resolve({ data: null, error: { message: 'Function not found' } }); } } },
  });
  await ctx.handleChatbotSend();
  const msgs = getState(ctx, 'chatbotMessages');
  assert.strictEqual(msgs.length, 2);
  assert.strictEqual(msgs[1].role, 'assistant');
  assert.ok(msgs[1].content.includes('pas déployée') || msgs[1].content.includes('ne répond pas'));
});

test('handleChatbotSend() : erreur renvoyée PAR la fonction (ex. clé API absente) -> message affiché tel quel', async () => {
  const input = stubElement({ value: 'Salut' });
  const sendBtn = stubElement();
  const wrap = stubElement();
  const ctx = buildContext({
    elements: { chatbotInput: input, chatbotSendBtn: sendBtn, chatbotMessages: wrap },
    supabaseClient: { functions: { invoke(){ return Promise.resolve({ data: { error: 'ANTHROPIC_API_KEY non configurée côté serveur.' }, error: null }); } } },
  });
  await ctx.handleChatbotSend();
  const msgs = getState(ctx, 'chatbotMessages');
  assert.ok(msgs[1].content.includes('ANTHROPIC_API_KEY'));
});

module.exports = run('chatbot.test.js');
