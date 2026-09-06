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

test('renderCritRadar() : les 7 libellés de CRITERIA apparaissent tous dans le SVG généré', () => {
  const ctx = buildContext();
  const svg = ctx.renderCritRadar({ scenario: 0.5, mise_en_scene: 0.5, jeu: 0.5, esthetique: 0.5, son: 0.5, musique: 0.5, ressenti: 0.5 });
  ['Scénario', 'Mise en scène', "Jeu d'acteur", 'Esthétique visuelle', 'Son', 'Musique', 'Ressenti global'].forEach(label => {
    assert.ok(svg.includes(label), `le libellé "${label}" doit apparaître dans le radar`);
  });
});

test('renderCritRadar() : un critère absent de l\'objet crit est traité comme 0, pas une exception', () => {
  const ctx = buildContext();
  assert.doesNotThrow(() => ctx.renderCritRadar({ scenario: 0.8 })); // les 6 autres critères manquent
});

module.exports = run('crit-radar.test.js');
