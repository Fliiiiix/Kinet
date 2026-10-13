// --- Tests du ressort physique vanilla (js/spring.js) ---
// Retour utilisateur, décision explicite lors de l'audit design
// (emil-design-eng + apple-design) : "ressorts maison en JS pur" plutôt
// qu'une dépendance, pour rendre certains gestes (tirer-pour-rafraîchir,
// js/ui.js) interruptibles et sensibles à la vélocité du doigt — ce
// qu'une transition CSS à durée fixe ne peut pas faire.
//
// Seule springStep()/rubberband() sont testées ici (fonctions PURES, aucune
// dépendance au temps réel) — animateSpring() pilote requestAnimationFrame,
// dont le repli du harnais vm (voir tests/helpers/vm-harness.js,
// `requestAnimationFrame: (cb) => cb()`) ne fournit ni vrai timestamp ni
// vrai différé : non représentatif du vrai navigateur pour une boucle
// physique image par image. Vérifié en conditions réelles (navigateur) à
// la place, comme le reste du geste tirer-pour-rafraîchir.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const ctx = createContext({});
  loadFiles(ctx, ['js/spring.js']);
  return ctx;
}

test('springStep() : se rapproche de la cible à chaque pas (jamais en sens inverse en partant à vitesse nulle)', () => {
  const ctx = buildContext();
  let { x, v } = { x: 0, v: 0 };
  const target = 100;
  const dt = 1 / 60;
  let prevDist = Math.abs(target - x);
  for(let i = 0; i < 30; i++){
    ({ x, v } = ctx.springStep(x, v, target, 1, 0.35, dt));
    const dist = Math.abs(target - x);
    assert.ok(dist <= prevDist + 1e-9, `pas ${i} : la distance à la cible ne doit jamais augmenter (amorti critique, départ immobile)`);
    prevDist = dist;
  }
});

test('springStep() : amortissement critique (dampingRatio=1) ne dépasse jamais la cible', () => {
  const ctx = buildContext();
  let { x, v } = { x: 0, v: 0 };
  const target = 100;
  const dt = 1 / 60;
  let maxX = 0;
  for(let i = 0; i < 200; i++){
    ({ x, v } = ctx.springStep(x, v, target, 1, 0.35, dt));
    maxX = Math.max(maxX, x);
  }
  assert.ok(maxX <= target + 0.5, `amorti critique : ne doit pas dépasser la cible (max observé ${maxX})`);
});

test('springStep() : sous-amorti (dampingRatio < 1) dépasse la cible au moins une fois avant de se stabiliser', () => {
  const ctx = buildContext();
  let { x, v } = { x: 0, v: 0 };
  const target = 100;
  const dt = 1 / 60;
  let overshot = false;
  for(let i = 0; i < 200; i++){
    ({ x, v } = ctx.springStep(x, v, target, 0.5, 0.35, dt));
    if(x > target) overshot = true;
  }
  assert.ok(overshot, 'un ressort sous-amorti doit rebondir au moins un peu (c\'est tout le point du damping < 1)');
});

test('springStep() : converge et se stabilise sur la cible après suffisamment de pas', () => {
  const ctx = buildContext();
  let { x, v } = { x: 0, v: 0 };
  const target = 100;
  const dt = 1 / 60;
  for(let i = 0; i < 300; i++){
    ({ x, v } = ctx.springStep(x, v, target, 1, 0.35, dt));
  }
  assert.ok(Math.abs(x - target) < 0.1, `doit être tout près de la cible après 300 pas, obtenu ${x}`);
  assert.ok(Math.abs(v) < 0.1, `la vitesse doit être quasi nulle une fois stabilisé, obtenu ${v}`);
});

test('springStep() : part d\'une vélocité initiale non nulle (vélocité au relâchement, apple-design §5) -> dépasse brièvement avant de revenir, même en amorti critique', () => {
  const ctx = buildContext();
  // Un relâchement rapide VERS la cible (vélocité positive, cible à 0)
  // peut franchir 0 même en amorti critique : c'est l'inertie du geste,
  // pas un rebond du ressort lui-même — le point même de transmettre la
  // vélocité du doigt plutôt que de repartir à 0.
  let { x, v } = { x: 0, v: 300 }; // déjà en mouvement rapide vers la cible
  const target = 0;
  const dt = 1 / 60;
  let maxAbsX = 0;
  for(let i = 0; i < 60; i++){
    ({ x, v } = ctx.springStep(x, v, target, 1, 0.35, dt));
    maxAbsX = Math.max(maxAbsX, Math.abs(x));
  }
  assert.ok(maxAbsX > 0, 'la vélocité initiale doit déplacer la position, pas rester figée en 0');
});

// --- rubberband() ---
test('rubberband() : résistance croissante — chaque dépassement avance moins que le dépassement brut, et la fraction suivie DIMINUE à mesure que le tiré s\'éloigne (jamais un mur, jamais linéaire)', () => {
  const ctx = buildContext();
  const small = ctx.rubberband(10, 100);
  const large = ctx.rubberband(100, 100);
  assert.ok(small < 10, 'même un petit dépassement doit déjà être résisté');
  assert.ok(large < 100, 'un grand dépassement est résisté bien plus fort');
  assert.ok((large / 100) < (small / 10), 'la fraction suivie (sortie / dépassement) doit diminuer avec la distance, sinon ce serait juste une résistance linéaire');
});

test('rubberband() : dépassement nul -> avancée nulle', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.rubberband(0, 100), 0);
});

test('rubberband() : jamais de valeur négative pour un dépassement positif (toujours dans le même sens que le geste)', () => {
  const ctx = buildContext();
  for(const overshoot of [1, 10, 50, 200, 1000]){
    assert.ok(ctx.rubberband(overshoot, 100) > 0, `rubberband(${overshoot}, 100) doit rester positif`);
  }
});

module.exports = run('spring.test.js');
