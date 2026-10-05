// --- Son (retour utilisateur : "rajoute du sound design, à commencer par
// la roulette") --- Entièrement synthétisé en Web Audio (oscillateurs +
// enveloppes de gain), aucun fichier audio à charger ni héberger : cohérent
// avec le reste de l'app (100% vanilla, zéro dépendance, voir README →
// Structure). Préférence PAR APPAREIL (localStorage, jamais synchronisée à
// Supabase) — même principe que getReduceMotion()/setReduceMotion()
// (js/ui.js), réglage dans Paramètres → Son (#soundToggle, index.html).

// Un seul AudioContext partagé, créé au premier VRAI appel (jamais au
// chargement de la page) : la plupart des navigateurs suspendent ou
// refusent un AudioContext créé hors d'un geste utilisateur (politique
// anti-autoplay) — playTone() n'est de toute façon jamais appelée que
// depuis un clic (voir js/watchlist.js, playRouletteTick()/
// playRouletteWin()), donc toujours dans la fenêtre valide. .resume() à
// chaque appel plutôt qu'une fois : couvre aussi le cas où l'onglet a
// suspendu le contexte entre-temps (changement d'onglet, veille…).
let audioCtx = null;
function getAudioCtx(){
  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if(audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function getSoundEnabled(){
  try{ return localStorage.getItem('kinetSoundEnabled') !== '0'; } // activé par défaut
  catch(e){ return true; }
}

function setSoundEnabled(on){
  try{ localStorage.setItem('kinetSoundEnabled', on ? '1' : '0'); }catch(e){}
  const toggle = document.getElementById('soundToggle');
  if(toggle) toggle.checked = on;
}

document.getElementById('soundToggle').addEventListener('change', (e) => {
  setSoundEnabled(e.target.checked);
  // Réactivé : un tick d'essai, pour confirmer que le son marche (et que
  // l'appareil n'est pas en sourdine).
  if(e.target.checked) playRouletteTick();
});

// Une seule note, enveloppe exponentielle (attaque quasi instantanée,
// chute rapide) — jamais bloquant : un son qui échoue (navigateur sans Web
// Audio, contexte refusé...) ne doit jamais casser l'action réelle qui
// l'accompagne, d'où le try/catch qui avale l'erreur plutôt que la laisser
// remonter aux appelants.
function playTone(freq, startGain, durationMs, type){
  if(!getSoundEnabled()) return;
  try{
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(startGain, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000);
  }catch(e){ console.error(e); }
}

// --- Roulette "Surprends-moi" (js/watchlist.js, retour utilisateur :
// "un dring dring dring façon ouverture de caisse CS2") ---
// playRouletteTick() : un tick bref à chaque case qui franchit le repère
// pendant le défilement — appelée à chaque franchissement RÉEL (voir
// spinSurpriseRoulette()), jamais sur un minuteur séparé : le tempo (rafale
// au début, tick isolés à la fin) suit alors tout seul la décélération
// visuelle, sans avoir à le recalculer ici.
function playRouletteTick(){
  playTone(1400, 0.12, 70, 'square');
}

// playRouletteWin() : un petit arpège montant (3 notes), distinct du tick —
// le "gagné" qu'on entend une fois la bande arrêtée pour de bon.
function playRouletteWin(){
  if(!getSoundEnabled()) return;
  [880, 1108, 1318].forEach((freq, i) => {
    setTimeout(() => playTone(freq, 0.14, 220, 'triangle'), i * 90);
  });
}

// --- Son des boosters et de l'assistant (retour utilisateur : "de la
// fluidité et du son si besoin, comme pour l'opening de booster") ---
// playCardFlip() : un "whoosh" court quand une carte se retourne.
function playCardFlip(){
  playTone(520, 0.05, 110, 'sine');
}

// Accord par rareté : plus il y a de notes, plus la carte est rare. Le
// Légendaire ajoute une octave aiguë, à peine audible mais perceptible.
const ACCORDS_RARETE = {
  commun: [392],
  rare: [440, 554],
  epique: [523, 659, 784],
  legendaire: [523, 659, 784, 1047],
};

function playRarityReveal(rarete){
  if(!getSoundEnabled()) return;
  const notes = ACCORDS_RARETE[rarete] || ACCORDS_RARETE.commun;
  const legendaire = rarete === 'legendaire';
  notes.forEach((freq, i) => {
    setTimeout(() => playTone(freq, legendaire ? 0.14 : 0.1, 420, 'triangle'), i * 70);
  });
  if(legendaire){
    setTimeout(() => playTone(2093, 0.05, 600, 'sine'), notes.length * 70);
  }
}

// playChatbotBlip() : un bip très doux quand l'assistant répond.
function playChatbotBlip(){
  playTone(880, 0.05, 90, 'sine');
}

// playSuccessChime() : petit arpège ascendant (deux notes) pour une action
// réussie qui n'est pas une révélation : fabrication, échange conclu.
function playSuccessChime(){
  if(!getSoundEnabled()) return;
  [659, 988].forEach((freq, i) => {
    setTimeout(() => playTone(freq, 0.1, 260, 'triangle'), i * 110);
  });
}

// playDustChime() : un tintement grave et bref pour un désenchantement
// (la carte se transforme en poussière) — volontairement plus discret.
function playDustChime(){
  playTone(330, 0.07, 240, 'sine');
  setTimeout(() => playTone(440, 0.05, 180, 'sine'), 70);
}

// playPopChime() : un "pop" aigu et très court, pour un ajout (watchlist).
function playPopChime(){
  playTone(1046, 0.08, 120, 'sine');
}

// playDeleteTone() : une descente discrète, pour une suppression. Pas un
// son d'erreur : l'action a bien eu lieu, on le signale juste.
function playDeleteTone(){
  if(!getSoundEnabled()) return;
  playTone(440, 0.06, 140, 'sine');
  setTimeout(() => playTone(294, 0.05, 160, 'sine'), 90);
}

// playRatingTone(note) : une note enregistrée se « chante » selon sa valeur.
// Gamme pentatonique de 330 Hz (note 0) à 1046 Hz (5/5), qui reste agréable
// quelle que soit la note tirée : deux notes entre 4 et 5 ne sonnent jamais faux.
const GAMME_NOTES = [330, 370, 415, 494, 587, 659, 784, 880, 1046];
function playRatingTone(note){
  if(!getSoundEnabled()) return;
  const n = Math.max(0, Math.min(5, Number(note) || 0));
  const index = Math.round((n / 5) * (GAMME_NOTES.length - 1));
  playTone(GAMME_NOTES[index], 0.1, 300, 'triangle');
}
