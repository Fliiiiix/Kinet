// --- Tests du cadrage automatique des banderoles (js/tmdb.js) --- Retour
// utilisateur : "tu prends le centre de la fiche... pour plein de films ça
// n'a pas de sens, ce n'est pas le bon endroit où zoomer. Peut-on faire du
// machine learning sur ces affiches pour identifier la bonne partie ?"
//
// Pas un modèle entraîné (aucune donnée annotée/infra pour ça ici) : une
// détection classique du contenu "intéressant" par l'énergie (contraste)
// par ligne, puis le centre de gravité de cette énergie donne la position
// verticale à montrer. energieParLigneDepuisGris()/pourcentageFocusDepuisEnergie()
// sont les deux fonctions PURES (aucun DOM/canvas/image réelle) qui portent
// ce calcul — testées ici directement, le reste (applySmartBackdropFocus())
// n'est que de la plomberie canvas/DOM autour.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const ctx = createContext({
    document: stubDocument(),
    escapeHtml(s){ return s; },
    showToast(){},
    TMDB_IMG_BASE: '', TMDB_BACKDROP_IMG_BASE: '', TMDB_PROFILE_IMG_BASE: '',
    blockIfOffline(){ return false; },
  });
  loadFiles(ctx, ['js/tmdb.js']);
  return ctx;
}

test('energieParLigneDepuisGris() : une ligne uniforme a une énergie nulle, une ligne contrastée en a', () => {
  const ctx = buildContext();
  // 3 colonnes x 2 lignes : la ligne 0 est toute grise (0 partout), la
  // ligne 1 alterne 0/255/0 (du détail).
  const gris = new Float32Array([0, 0, 0, 0, 255, 0]);
  const energie = ctx.energieParLigneDepuisGris(gris, 3, 2);
  assert.strictEqual(energie.length, 2);
  assert.ok(energie[1] > energie[0], `ligne contrastée (${energie[1]}) doit dépasser la ligne plate (${energie[0]})`);
});

test('pourcentageFocusDepuisEnergie() : une image totalement plate retombe sur 50 % (le centre d\'avant)', () => {
  const ctx = buildContext();
  const energie = new Float32Array(10); // tout à zéro : rien à détecter
  assert.strictEqual(ctx.pourcentageFocusDepuisEnergie(energie), 50);
});

test('pourcentageFocusDepuisEnergie() : le détail en haut de l\'image donne un pourcentage sous 50 %', () => {
  const ctx = buildContext();
  const energie = new Float32Array(20);
  energie[1] = 100; // tout le détail près du haut
  const pct = ctx.pourcentageFocusDepuisEnergie(energie);
  assert.ok(pct < 50, `attendu < 50, obtenu ${pct}`);
  assert.ok(pct >= 15, `jamais sous le repli à 15 %, obtenu ${pct}`);
});

test('pourcentageFocusDepuisEnergie() : le détail en bas de l\'image donne un pourcentage au-dessus de 50 %', () => {
  const ctx = buildContext();
  const energie = new Float32Array(20);
  energie[18] = 100; // tout le détail près du bas
  const pct = ctx.pourcentageFocusDepuisEnergie(energie);
  assert.ok(pct > 50, `attendu > 50, obtenu ${pct}`);
  assert.ok(pct <= 85, `jamais au-dessus du repli à 85 %, obtenu ${pct}`);
});

test('pourcentageFocusDepuisEnergie() : le détail pile au centre donne 50 %', () => {
  const ctx = buildContext();
  const energie = new Float32Array(20);
  energie[10] = 100; // 10 / 20 = exactement la moitié
  assert.strictEqual(ctx.pourcentageFocusDepuisEnergie(energie), 50);
});

module.exports = run('backdrop-focus.test.js');
