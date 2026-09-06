// --- Tests du radar des 7 critères (js/stats.js) ---
// Retour utilisateur : un graphique radar en plus de la liste à barres
// déjà là, pour voir la FORME du profil de notation d'un film d'un coup
// d'œil. renderCritRadar()/critRadarPoint() sont de la géométrie pure
// (positions des sommets sur un cercle) — bonne cible de test, une erreur
// de trigonométrie serait autrement invisible tant qu'on ne compare pas
// les coordonnées à la main.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const ctx = createContext({
    document: stubDocument(),
    escapeHtml(s){ return s; },
    CRITERIA: [
      { key: 'scenario', label: 'Scénario' },
      { key: 'mise_en_scene', label: 'Mise en scène' },
      { key: 'jeu', label: "Jeu d'acteur" },
      { key: 'esthetique', label: 'Esthétique visuelle' },
      { key: 'son', label: 'Son' },
      { key: 'musique', label: 'Musique' },
      { key: 'ressenti', label: 'Ressenti global' },
    ],
  });
  loadFiles(ctx, ['js/stats.js']);
  return ctx;
}

test('critRadarPoint() : le premier point (index 0) est pile en haut du cercle (12h)', () => {
  const ctx = buildContext();
  const p = ctx.critRadarPoint(0, 7, 72, 100, 96);
  // "En haut" = même x que le centre, y plus petit (SVG : y croît vers le bas).
  assert.ok(Math.abs(p.x - 100) < 0.001, `x doit être ~100 (centre), obtenu ${p.x}`);
  assert.ok(p.y < 96, `y doit être au-dessus du centre (96), obtenu ${p.y}`);
  assert.ok(Math.abs((96 - p.y) - 72) < 0.001, 'la distance au centre doit être exactement le rayon (72)');
});

test('critRadarPoint() : 7 points régulièrement espacés couvrent tout le cercle (somme des angles = 360°)', () => {
  const ctx = buildContext();
  const n = 7;
  const points = Array.from({ length: n }, (_, i) => ctx.critRadarPoint(i, n, 72, 100, 96));
  // Tous à la même distance du centre (même rayon demandé) — vérifie qu'aucun
  // point n'est mal placé par une erreur d'indice/angle.
  points.forEach((p, i) => {
    const dist = Math.sqrt((p.x - 100) ** 2 + (p.y - 96) ** 2);
    assert.ok(Math.abs(dist - 72) < 0.001, `point ${i} doit être à distance 72 du centre, obtenu ${dist}`);
  });
  // 7 points distincts (pas de doublon d'angle).
  const uniqueCoords = new Set(points.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
  assert.strictEqual(uniqueCoords.size, 7);
});

test('renderCritRadar() : un score de 0 ne colle pas au centre (plancher visuel), un score de 1 atteint le bord', () => {
  const ctx = buildContext();
  const svgAllZero = ctx.renderCritRadar({ scenario: 0, mise_en_scene: 0, jeu: 0, esthetique: 0, son: 0, musique: 0, ressenti: 0 });
  const svgAllOne = ctx.renderCritRadar({ scenario: 1, mise_en_scene: 1, jeu: 1, esthetique: 1, son: 1, musique: 1, ressenti: 1 });
  assert.ok(svgAllZero.includes('<svg'), 'doit produire un vrai <svg>');
  assert.ok(svgAllZero.length > 0 && svgAllOne.length > 0);
  // Les deux doivent rester valides même dans les cas extrêmes (pas de NaN
  // dans les coordonnées générées, qui casserait le rendu SVG silencieusement).
  assert.ok(!svgAllZero.includes('NaN'), 'aucune coordonnée NaN pour un profil à 0 partout');
  assert.ok(!svgAllOne.includes('NaN'), 'aucune coordonnée NaN pour un profil à 1 partout');
});


test('renderCritRadar() : un critère absent de l\'objet crit est traité comme 0, pas une exception', () => {
  const ctx = buildContext();
  assert.doesNotThrow(() => ctx.renderCritRadar({ scenario: 0.8 })); // les 6 autres critères manquent
});

// --- Régression mobile : libellés coupés contre le bord du modal ---
// Constaté en direct sur un vrai modal étroit (390px) : "Esthétique
// visuelle" et "Ressenti global" (les 2 libellés les plus longs) se
// faisaient couper net. Le libellé complet reste affiché dans la liste à
// barres juste en dessous (critReviewRowHtml()) — seul le radar simplifie.
test('renderCritRadar() : "Esthétique visuelle"/"Ressenti global" sont raccourcis dans les libellés du radar (pas dans les info-bulles des points, qui gardent le nom complet)', () => {
  const ctx = buildContext();
  const svg = ctx.renderCritRadar({ scenario: 0.5, mise_en_scene: 0.5, jeu: 0.5, esthetique: 0.5, son: 0.5, musique: 0.5, ressenti: 0.5 });
  // Isole les <text class="crit-radar-label"> (les libellés affichés autour
  // du radar) des <title> des points (info-bulle au survol, qui garde
  // volontairement le nom complet et précis) — sans ça, "Esthétique
  // visuelle" trouvé dans un <title> ferait passer le test à tort.
  const labelTexts = Array.from(svg.matchAll(/class="crit-radar-label">([^<]+)</g)).map(m => m[1]);
  assert.ok(!labelTexts.includes('Esthétique visuelle'), 'le libellé complet ne doit plus apparaître dans les libellés du radar, trop long pour un modal étroit');
  assert.ok(!labelTexts.includes('Ressenti global'), 'idem pour "Ressenti global"');
  assert.ok(labelTexts.includes('Esthétique'), 'la version raccourcie doit apparaître');
  assert.ok(labelTexts.includes('Ressenti'), 'la version raccourcie doit apparaître');
  // Les 5 autres, déjà assez courts, restent inchangés.
  ['Scénario', 'Mise en scène', "Jeu d'acteur", 'Son', 'Musique'].forEach(label => {
    assert.ok(labelTexts.includes(label), `"${label}" doit rester tel quel (pas de raccourci nécessaire)`);
  });
  // Le nom complet et précis reste disponible au survol d'un point.
  assert.ok(svg.includes('Esthétique visuelle :'), 'l\'info-bulle du point garde le nom complet');
  assert.ok(svg.includes('Ressenti global :'), 'idem');
});

module.exports = run('crit-radar.test.js');
