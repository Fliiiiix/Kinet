// --- Ressort physique vanilla (sans dépendance) ---
// Retour utilisateur, lors de l'audit design (skills emil-design-eng +
// apple-design) : les techniques les plus "fluides" d'Apple (glisser
// interruptible, relâcher qui garde la vélocité du doigt, rebond
// élastique) demandent de vrais ressorts physiques, pas de simples
// transitions CSS à durée fixe — une transition CSS redémarre de zéro si
// on l'interrompt, jamais un ressort. Décision explicite de l'utilisateur
// pour y arriver SANS casser le 100% vanilla du projet (aucune librairie,
// même légère) : un petit modèle de ressort codé à la main.
//
// Paramétrage en damping/response (pas masse/raideur/amortissement bruts)
// — même vocabulaire que SwiftUI/le skill apple-design, pensé pour rester
// lisible sans faire de physique : damping (ratio d'amortissement) = 1
// ne rebondit jamais (le réglage par défaut Apple pour la plupart des cas,
// voir le skill), < 1 rebondit (réservé aux gestes qui avaient déjà de la
// vélocité au relâchement — jamais sur quelque chose qui vient d'apparaître
// sans geste). response (secondes) = vitesse à laquelle la valeur approche
// sa cible — PAS une durée fixe, un ressort n'en a pas, il se stabilise de
// lui-même selon ses paramètres physiques.

function springStep(x, v, target, dampingRatio, response, dt){
  // ω0 = pulsation propre du système non amorti ; k/c = raideur/amortissement
  // dérivés de (dampingRatio, response) pour une masse unitaire — conversion
  // standard utilisée par SwiftUI (.spring(response:dampingFraction:)).
  const w0 = (2 * Math.PI) / response;
  const k = w0 * w0;
  const c = 2 * dampingRatio * w0;
  const a = -k * (x - target) - c * v;
  const nv = v + a * dt;
  const nx = x + nv * dt;
  return { x: nx, v: nv };
}

// animateSpring({ from, to, velocity, dampingRatio, response, onUpdate, onComplete })
// -> { cancel(), retarget(newTarget, newVelocity), getValue() }
//
// retarget() ne redémarre JAMAIS de zéro : il repart de la valeur COURANTE
// (x, v) du ressort en cours, change seulement la cible — c'est très
// exactement ce qui rend un geste "attrapable" en plein mouvement (skill
// apple-design, §3 : "always animate from the presentation value, never
// the target value"). Sans ça, interrompre une animation pour en relancer
// une autre crée un saut visible.
//
// Respecte prefers-reduced-motion (+ le réglage interne, voir
// motionReduced(), js/ui.js) : saute directement à la cible, sans
// physique — un ressort EST un mouvement, la vignette "réduire les
// animations" doit pouvoir l'éteindre entièrement, pas juste le ralentir.
function animateSpring(opts){
  const { from, to, onUpdate, onComplete, precision = 0.005 } = opts;
  let { velocity = 0, dampingRatio = 1, response = 0.35 } = opts;

  if(typeof motionReduced === 'function' && motionReduced()){
    onUpdate(to, 0);
    if(onComplete) onComplete();
    return { cancel(){}, retarget(newTarget){ onUpdate(newTarget, 0); }, getValue(){ return to; } };
  }

  let x = from, v = velocity, target = to;
  let rafId = null;
  let cancelled = false;
  let steps = 0;
  // Pas fixe (1/60s) plutôt qu'un dt mesuré entre deux timestamps réels :
  // mesurer suppose un requestAnimationFrame() qui fournit un VRAI
  // timestamp croissant à chaque appel — vrai dans tout navigateur, mais
  // pas garanti par un repli de test minimal (voir
  // tests/helpers/vm-harness.js, `(cb) => cb()`, sans timestamp ni vrai
  // différé), où un dt mesuré resterait bloqué à 0 et ne ferait jamais
  // converger le ressort. Un pas fixe est une simplification assumée (pas
  // de vrai découplage du taux de rafraîchissement de l'écran) mais
  // largement suffisante pour une animation d'interface de quelques
  // centaines de millisecondes. MAX_STEPS est un filet de sécurité pur
  // (jamais atteint en pratique) : garantit l'arrêt même si un mauvais
  // réglage (dampingRatio/response) empêchait la convergence.
  const dt = 1 / 60;
  const MAX_STEPS = 600; // 10s à 60fps — très au-delà de toute animation d'interface réelle

  function frame(){
    if(cancelled) return;
    steps++;
    const stepped = springStep(x, v, target, dampingRatio, response, dt);
    x = stepped.x; v = stepped.v;
    onUpdate(x, v);
    const settled = (Math.abs(x - target) < precision && Math.abs(v) < precision) || steps >= MAX_STEPS;
    if(settled){
      onUpdate(target, 0);
      if(onComplete) onComplete();
      return;
    }
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  return {
    cancel(){ cancelled = true; if(rafId != null) cancelAnimationFrame(rafId); },
    retarget(newTarget, newVelocity){
      target = newTarget;
      if(newVelocity != null) v = newVelocity;
    },
    getValue(){ return x; }
  };
}

// Résistance progressive en butée (skill apple-design, §9 "rubber-banding") :
// au lieu de s'arrêter net au bord, l'élément continue de suivre le doigt
// mais de moins en moins — jamais un mur, toujours un ralentissement.
// overshoot = distance au-delà de la limite ; dimension = portée typique du
// geste (sert à calibrer la résistance, pas une limite dure).
function rubberband(overshoot, dimension, constant = 0.55){
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
