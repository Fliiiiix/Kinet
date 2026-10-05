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

test('genre précis -> compte les films de ce genre et leur moyenne (pas le classement générique)', () => {
  const ctx = buildContext();
  const r = ctx.answerChatbotQuestion('Combien de films thriller ai-je ?', donnees(FILMS, WATCHLIST));
  assert.ok(r.includes('3 films thriller'), r);
  // (4.8 + 4.2 + 4.5) étant dans les 3 films, Thriller = 53 : moyenne 4.50
  assert.ok(r.includes('4.50'), r);
});

test('genre précis sans aucun film -> le dit explicitement', () => {
  const ctx = buildContext();
  const r = ctx.answerChatbotQuestion('mes films comédie', donnees([{ title: 'Dune', note: 4, genreIds: [53] }], []));
  assert.ok(r.includes('Aucun film comédie'), r);
});

test('répartition -> compte les notes par tranche (4–5 pour 4,2 / 4,5 / 4,8)', () => {
  const ctx = buildContext();
  const r = ctx.answerChatbotQuestion('Ma répartition des notes', donnees(FILMS, WATCHLIST));
  assert.ok(r.includes('4–5 : 3'), r);
});

test('coups de cœur -> films notés 4,5 et plus, avec ou sans accent sur le œ', () => {
  const ctx = buildContext();
  const avec = ctx.answerChatbotQuestion('Mes coups de cœur', donnees(FILMS, WATCHLIST));
  const sans = ctx.answerChatbotQuestion('mes coups de coeur', donnees(FILMS, WATCHLIST));
  assert.ok(avec.includes('2 coups de cœur'), avec);
  assert.ok(sans.includes('Parasite') && sans.includes('Inception'), sans);
});

test('moins bien notés -> tri croissant, Dune (4,2) en tête', () => {
  const ctx = buildContext();
  const r = ctx.answerChatbotQuestion('Quels sont mes moins bien notés ?', donnees(FILMS, WATCHLIST));
  assert.ok(r.split('\n')[1].includes('Dune'), r);
});

test('merci et qui es-tu -> réponses courtes, sans confusion avec une autre intention', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.answerChatbotQuestion('merci !', donnees(FILMS, WATCHLIST)), 'Avec plaisir !');
  assert.ok(ctx.answerChatbotQuestion('Qui es-tu ?', donnees(FILMS, WATCHLIST)).includes('assistant de Kinet'));
});

test('boosters -> compte ceux à ouvrir, ou dit comment en débloquer un', () => {
  const ctx = buildContext();
  const avec = ctx.answerChatbotQuestion('Combien de boosters ai-je ?', { ...donnees(FILMS, WATCHLIST), boosters: 2 });
  assert.ok(avec.includes('2 boosters'), avec);
  const sans = ctx.answerChatbotQuestion('Combien de boosters ai-je ?', { ...donnees(FILMS, WATCHLIST), boosters: 0 });
  assert.ok(sans.includes('Aucun booster'), sans);
});

module.exports = run('chatbot.test.js');
