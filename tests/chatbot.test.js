// --- Tests de l'assistant local (js/chatbot.js) ---
// Logique pure : answerChatbotQuestion() répond à partir de données
// fournies, sans réseau ni API. On teste les réponses, pas le DOM.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const ctx = createContext({
    document: stubDocument({ chatbotMessages: stubElement(), chatbotInput: stubElement(), chatbotSendBtn: stubElement() }),
    escapeHtml(s){ return s; },
    openOverlay(){}, closeOverlay(){}, closeProfileModal(){}, openProfileModal(){},
    getDisplayNote(f){ return f.note; },
    GENRE_MAP: { 18: 'Drame', 53: 'Thriller', 35: 'Comédie' },
  });
  loadFiles(ctx, ['js/chatbot.js']);
  return ctx;
}

function donnees(films, watchlist){
  return {
    films,
    watchlist,
    getNote(f){ return f.note; },
    genreMap: { 18: 'Drame', 53: 'Thriller', 35: 'Comédie' },
  };
}

const FILMS = [
  { title: 'Parasite', note: 4.8, genreIds: [53, 18] },
  { title: 'Dune', note: 4.2, genreIds: [53] },
  { title: 'Inception', note: 4.5, genreIds: [53] },
  { title: 'Film non noté', note: null, genreIds: [35] },
];
const WATCHLIST = [{ title: 'Oppenheimer' }, { title: 'Past Lives' }];

test('réponse vide -> invitation à écrire (pas de réponse fabriquée)', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.answerChatbotQuestion('   ', donnees(FILMS, WATCHLIST)), 'Dis-moi quelque chose, je t\'écoute.');
});

test('moyenne -> calcule sur les films NOTÉS seulement, 2 décimales', () => {
  const ctx = buildContext();
  const r = ctx.answerChatbotQuestion('Quelle est ma note moyenne ?', donnees(FILMS, WATCHLIST));
  // (4.8 + 4.2 + 4.5) / 3 = 4.5
  assert.ok(r.includes('4.50'), r);
  assert.ok(r.includes('3 films'), r);
});

test('moyenne -> aucun film noté : le dit, sans diviser par zéro', () => {
  const ctx = buildContext();
  const r = ctx.answerChatbotQuestion('ma moyenne', donnees([{ title: 'X', note: null, genreIds: [] }], []));
  assert.ok(r.includes('aucun film noté'), r);
});

test('meilleurs films -> triés par note décroissante, films non notés exclus', () => {
  const ctx = buildContext();
  const r = ctx.answerChatbotQuestion('Quels sont mes meilleurs films ?', donnees(FILMS, WATCHLIST));
  const lignes = r.split('\n');
  assert.ok(lignes[1].includes('Parasite'), r);
  assert.ok(lignes[2].includes('Inception'), r);
  assert.ok(!r.includes('Film non noté'), r);
});

test('nombre de films -> compte le catalogue et précise les notés', () => {
  const ctx = buildContext();
  const r = ctx.answerChatbotQuestion('combien de films ai-je notés ?', donnees(FILMS, WATCHLIST));
  assert.ok(r.includes('4 films'), r);
  assert.ok(r.includes('3 avec une note'), r);
});

test('genres -> les plus présents, sans accents dans la question', () => {
  const ctx = buildContext();
  const r = ctx.answerChatbotQuestion('quels genres je regarde le plus', donnees(FILMS, WATCHLIST));
  assert.ok(r.startsWith('Tes genres les plus présents : Thriller (3)'), r);
});

test('"un film au hasard" -> prend un titre de la watchlist', () => {
  const ctx = buildContext();
  const r = ctx.answerChatbotQuestion('un film au hasard ?', donnees(FILMS, WATCHLIST));
  assert.ok(WATCHLIST.some(w => r.includes(w.title)), r);
});

test('"au hasard" avec watchlist vide -> dit qu\'elle est vide, ne propose rien', () => {
  const ctx = buildContext();
  const r = ctx.answerChatbotQuestion('surprends-moi', donnees(FILMS, []));
  assert.ok(r.includes('vide'), r);
});

test('question sur l\'app (cartes) -> réponse d\'aide prévue, sans accents requis', () => {
  const ctx = buildContext();
  const r = ctx.answerChatbotQuestion('comment avoir des boosters', donnees(FILMS, WATCHLIST));
  assert.ok(r.includes('Mon activité > Cartes'), r);
});

test('question hors sujet -> réponse de repli honnête, jamais une invention', () => {
  const ctx = buildContext();
  const r = ctx.answerChatbotQuestion('quelle est la capitale du Pérou', donnees(FILMS, WATCHLIST));
  assert.ok(r.includes('Je ne suis pas sûr'), r);
});

test('salutation -> réponse courte, sans fausse info', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.answerChatbotQuestion('Salut !', donnees(FILMS, WATCHLIST)), 'Salut ! Que veux-tu savoir ?');
});

module.exports = run('chatbot.test.js');
