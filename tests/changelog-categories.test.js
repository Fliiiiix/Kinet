// --- Tests des Nouveautés classées par catégorie (js/changelog.js) ---
// Demande de Flix (24/10) : la fenêtre des nouveautés range chaque note par
// catégorie. Les lignes en MAJUSCULES de la note (« NOTER UN FILM »,
// « FICHE SÉRIE ET BIENTÔT »…) deviennent des catégories repliables avec
// leur nombre de nouveautés ; une note d'une ligne reste un paragraphe.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const ctx = createContext({
    document: stubDocument({ changelogList: stubElement() }),
    escapeHtml(s){ return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
    loadActivityState(){ return Promise.resolve(); },
    activityState: null,
    supabaseClient: { from(){ throw new Error('non utilisé par ce test'); } },
  });
  loadFiles(ctx, ['js/changelog.js']);
  return ctx;
}

const plain = (v) => JSON.parse(JSON.stringify(v));

// Extrait du vrai texte de la 4.1.
const NOTE_41 = `NOTER UN FILM
• Un critère à la fois, en grand, avec ses repères.
• Tes 7 critères ne s'effacent plus quand tu réenregistres un film.

À VOIR
• Un film que tu notes quitte À voir tout seul, d'où que tu le notes.

FICHE SÉRIE ET BIENTÔT
• « À suivre » : le prochain épisode, avec son titre et sa date.
• Bientôt : « À rattraper » montre les séries où tu as du retard.

ET AUSSI
• L'appli s'ouvre bien plus vite à partir de la deuxième visite.`;

test('titres : une ligne en majuscules, jamais une puce ni une phrase', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.isChangelogHeading('À VOIR'), true);
  assert.strictEqual(ctx.isChangelogHeading('FICHE SÉRIE ET BIENTÔT'), true);
  assert.strictEqual(ctx.isChangelogHeading('FILMS & SÉRIES'), true);
  assert.strictEqual(ctx.isChangelogHeading('• OK POUR TOUT'), false, 'une puce reste une nouveauté');
  assert.strictEqual(ctx.isChangelogHeading('Un film que tu notes quitte À voir.'), false);
  assert.strictEqual(ctx.isChangelogHeading('4.1'), false, 'pas de lettre : pas un titre');
});

test('découpage : une catégorie par titre, les puces dans l\'ordre, sans le « • »', () => {
  const ctx = buildContext();
  const sections = plain(ctx.parseChangelogBody(NOTE_41));
  assert.deepStrictEqual(sections.map(s => [s.heading, s.items.length]), [
    ['NOTER UN FILM', 2], ['À VOIR', 1], ['FICHE SÉRIE ET BIENTÔT', 2], ['ET AUSSI', 1],
  ]);
  assert.strictEqual(sections[0].items[0], 'Un critère à la fois, en grand, avec ses repères.');
});

test('rendu : une catégorie repliable par titre, avec son nombre de nouveautés', () => {
  const ctx = buildContext();
  const html = ctx.changelogBodyHtml(NOTE_41);
  assert.strictEqual((html.match(/<details class="cl-cat">/g) || []).length, 4);
  assert.ok(html.includes('<span class="cl-cat-name">FICHE SÉRIE ET BIENTÔT</span><span class="cl-cat-n">2</span>'));
  assert.ok(html.includes('aria-label="À VOIR, 1 nouveauté"'));
  assert.strictEqual((html.match(/<li>/g) || []).length, 6);
  assert.ok(!html.includes('•'), 'les puces deviennent une vraie liste');
});

test('note d\'une ligne (2.7 à 3.4) : un paragraphe, sans catégorie', () => {
  const ctx = buildContext();
  const html = ctx.changelogBodyHtml('Les cartes se retournent au toucher.');
  assert.strictEqual(html, '<p class="cl-text">Les cartes se retournent au toucher.</p>');
});

test('lignes avant le premier titre : une liste simple en tête', () => {
  const ctx = buildContext();
  const html = ctx.changelogBodyHtml('• Une intro\n\nSÉRIES\n• Un détail');
  assert.ok(html.indexOf('<ul class="cl-items"><li>Une intro</li></ul>') < html.indexOf('<details'));
  assert.strictEqual((html.match(/<details/g) || []).length, 1);
});

test('rendu échappé : le texte d\'une note ne devient jamais du HTML', () => {
  const ctx = buildContext();
  const html = ctx.changelogBodyHtml('CARTES\n• <img src=x onerror=alert(1)> & co');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; co'));
});

module.exports = run('changelog-categories.test.js');
