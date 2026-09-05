// --- Happenings : easter eggs par film, façon Letterboxd ---
// (ex. la page Tenet qui se lit à l'envers une fois arrivé en bas). Un
// badge thématique apparaît à côté du titre d'un film qui en a un, dans le
// catalogue — cliquer dessus déclenche l'expérience, même emplacement que
// les badges manuel/💬/↻ déjà là (voir render() dans js/app.js). Certains se
// déclenchent plutôt en restant longtemps sur la fiche du film (le
// formulaire d'édition, seule "page" par film qu'a l'app) sans badge —
// l'effet de surprise fait partie du jeu, voir startDwellWatch() plus bas.
//
// Purement client, aucune table dédiée — même philosophie que Succès
// (js/achievements.js) : rien à débloquer/suivre en base, juste du code qui
// réagit au tmdb_id du film ouvert. Identifié par tmdb_id (pas le titre) :
// fiable même si le titre est retapé différemment.

const HAPPENINGS = [
  {
    tmdbId: 550, // Fight Club (1999)
    trigger: 'click',
    icon: '🥊',
    run: runFightClubHappening
  },
  {
    tmdbId: 670, // Old Boy (2003)
    trigger: 'click',
    icon: '🔨',
    run: runOldBoyHappening
  },
  {
    tmdbId: 785084, // The Whale (2022)
    trigger: 'dwell',
    dwellMs: 20000, // rester 20s sur la fiche du film pour le déclencher
    run: runWhaleHappening
  },
  {
    tmdbId: 1368337, // The Odyssey (2026)
    trigger: 'click',
    icon: '🪓',
    run: runOdysseyHappening
  },
  {
    tmdbId: 598, // La Cité de Dieu / City of God (2002)
    trigger: 'click',
    icon: '🔫',
    run: runCityOfGodHappening
  },
  {
    tmdbId: 807, // Se7en (1995)
    trigger: 'click',
    icon: '📦',
    run: runSevenHappening
  },
  {
    tmdbId: 244786, // Whiplash (2014)
    trigger: 'click',
    icon: '🥁',
    run: runWhiplashHappening
  },
  {
    tmdbId: 4977, // Paprika (2006)
    trigger: 'click',
    icon: '🎪',
    run: runPaprikaHappening
  },
  {
    tmdbId: 954, // Mission : Impossible (1996)
    trigger: 'click',
    icon: '💣',
    run: runMissionImpossibleHappening
  },
  {
    tmdbId: 155, // The Dark Knight : Le Chevalier noir (2008)
    trigger: 'click',
    icon: '🪙',
    run: runDarkKnightHappening
  }
];

// --- Écarts admin (js/admin.js) : happenings désactivés + happenings
// "génériques" (juste un message) créés depuis l'interface, sans coder.
// `typeof` en garde, même raison que dans js/achievements.js : doit marcher
// pour un compte non admin, qui n'a jamais de config chargée.
function getEffectiveHappenings(){
  const overrides = (typeof getAdminHappeningOverrides === 'function') ? getAdminHappeningOverrides() : {};
  const custom = (typeof getAdminCustomHappenings === 'function') ? getAdminCustomHappenings() : [];

  const builtIn = HAPPENINGS.filter(h => !(overrides[h.tmdbId] && overrides[h.tmdbId].enabled === false));

  const customEntries = custom
    .filter(c => c.enabled !== false)
    .map(c => ({
      tmdbId: c.tmdbId,
      trigger: c.trigger,
      dwellMs: c.dwellMs,
      icon: c.icon || '✨',
      run: (film) => runCustomHappening(c, film)
    }));

  // Un happening codé en dur gagne toujours face à un générique sur le même
  // film (le générique n'a de sens que sur un film qui n'en a pas encore).
  return [...builtIn, ...customEntries];
}

function getHappeningForFilm(film){
  return (film && film.tmdbId) ? (getEffectiveHappenings().find(h => h.tmdbId === film.tmdbId) || null) : null;
}

// --- Happening générique (message simple) : créé depuis l'admin sans
// écrire de code, même modale que Old Boy (titre + texte + fermer). Pas
// d'animation propre à un film — pour ça, il faut un vrai happening codé en
// dur comme les autres ci-dessous.
function runCustomHappening(entry){
  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.innerHTML = `
    <div class="modal happening-modal">
      <div class="modal-head">
        <h2>${escapeHtml(entry.icon || '✨')} ${escapeHtml(entry.title || 'Un petit quelque chose')}</h2>
        <button class="close-x" data-close aria-label="Fermer">✕</button>
      </div>
      <p class="happening-caption">${escapeHtml(entry.message || '')}</p>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if(e.target === overlay || e.target.closest('[data-close]')) overlay.remove();
  });
}

function getClickHappeningForFilm(film){
  const h = getHappeningForFilm(film);
  return (h && h.trigger === 'click') ? h : null;
}

function prefersReducedMotion(){
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// --- Fight Club : un flash qu'on n'est pas censé voir ---
// Même procédé que le film (des photogrammes de Tyler Durden insérés avant
// sa "révélation") plutôt qu'une simple référence visuelle : un seul flash
// bref, pas de répétition ni de clignotement rythmé (voir la note sur
// l'épilepsie photosensible ci-dessous).
function runFightClubHappening(){
  if(prefersReducedMotion()){
    showToast('« La première règle du Fight Club... »');
    return;
  }
  const el = document.createElement('div');
  el.className = 'happening-flash';
  el.innerHTML = `<span>TU NE DEVRAIS PAS ÊTRE LÀ</span>`;
  document.body.appendChild(el);
  // Un seul flash, jamais répété — un vrai clignotement (plusieurs flashs
  // par seconde) est un déclencheur classique de crise chez les personnes
  // photosensibles, à éviter absolument même pour un easter egg.
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => el.remove(), 260);
}

// --- Old Boy : le couloir, en un seul plan ---
function runOldBoyHappening(){
  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.innerHTML = `
    <div class="modal happening-modal">
      <div class="modal-head">
        <h2>Un seul plan.</h2>
        <button class="close-x" data-close aria-label="Fermer">✕</button>
      </div>
      <div class="oldboy-corridor">
        <div class="oldboy-corridor-track${prefersReducedMotion() ? ' static' : ''}">
          <span>🚪</span><span>🔨</span><span>🚪</span><span>🔨</span><span>🚪</span><span>🔨</span><span>🚪</span>
        </div>
      </div>
      <p class="happening-caption">Un couloir. Un marteau. Une seule prise, du début à la fin.</p>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if(e.target === overlay || e.target.closest('[data-close]')) overlay.remove();
  });
}

// --- The Whale : reste un peu trop longtemps... ---
let whaleDwellTimer = null;

// Appelé par openModal() (js/app.js) à chaque ouverture d'un film — ne fait
// quelque chose que si ce film a un happening "dwell".
function startDwellWatch(film){
  clearDwellWatch();
  const h = getHappeningForFilm(film);
  if(!h || h.trigger !== 'dwell') return;
  whaleDwellTimer = setTimeout(h.run, h.dwellMs);
}

// Appelé par closeModal() — sinon un happening "dwell" pourrait se
// déclencher après coup, sur un tout autre film ou écran.
function clearDwellWatch(){
  if(whaleDwellTimer){
    clearTimeout(whaleDwellTimer);
    whaleDwellTimer = null;
  }
}

function runWhaleHappening(){
  // Fermé entre-temps (ou le minuteur d'un autre film) : rien à faire.
  if(!document.getElementById('overlay').classList.contains('open')) return;
  showToast('« NON ! Pas l\'ordinateur ! »');
  if(prefersReducedMotion()) return;
  const el = document.createElement('div');
  el.className = 'happening-fly';
  el.textContent = '💻';
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('fly'));
  setTimeout(() => el.remove(), 1300);
}

// --- The Odyssey : l'épreuve de l'arc ---
// La vraie épreuve d'Ulysse (Odyssée, chant XXI) n'est PAS de tirer une
// flèche : c'est de réussir à PLIER l'arc et à accrocher la corde à l'autre
// extrémité (le "bander"), là où tous les prétendants échouent. Corrigé le
// 25/08/2026 : la première version montrait une flèche qu'on tire en
// arrière (un tir), contresens par rapport à l'épreuve elle-même — voir
// updateOdysseyBow() plus bas pour la nouvelle animation (arc qui se plie +
// bout libre de la corde qui remonte vers l'encoche du sommet).
//
// Cliquer/taper très vite et SANS S'ARRÊTER — la tension retombe dès qu'on
// relâche le rythme, comme un arc qu'on n'arrive pas à plier d'un coup sec.
// Pas d'état d'échec : on peut réessayer autant qu'on veut, l'effort suffit
// à faire le jeu.
//
// Réglage : +5% par clic, -2.8% toutes les 100ms (soit -28%/s de décroissance
// en continu) — il faut donc largement plus de 5 clics/s SOUTENUS pour
// progresser net (5 × 5 = 25 < 28). Vécu en prod le 25/08/2026 : la première
// version (+6%/clic, -2.5% / 150ms, ≈3 clics/s requis) se laissait bander
// trop facilement, sans vraie sensation d'effort.
const ODYSSEY_GAIN = 5;
const ODYSSEY_DECAY = 2.8;
const ODYSSEY_TICK_MS = 100;

// Coordonnées de l'arc SVG (repos → plié/bandé), voir updateOdysseyBow().
// Le bout libre de la corde (déjà noué en bas) part d'une position lâche,
// à l'écart de l'arc — comme tenu à la main avant l'effort — et remonte
// vers l'encoche du sommet à mesure que la tension augmente, jusqu'à s'y
// accrocher à 100% (arc bandé).
const ODYSSEY_BOW_TOP = { x: 110, y: 20 };
const ODYSSEY_BOW_BOTTOM = { x: 110, y: 180 };
const ODYSSEY_STRING_LOOSE = { x: 168, y: 148 };
const ODYSSEY_BOW_MID_X_REST = 68;
const ODYSSEY_BOW_MID_X_FULL = 18;
const ODYSSEY_STRING_SAG_MAX = 26;

function updateOdysseyBow(tensionPct){
  const t = tensionPct / 100;
  const bowMidX = ODYSSEY_BOW_MID_X_REST + (ODYSSEY_BOW_MID_X_FULL - ODYSSEY_BOW_MID_X_REST) * t;
  const endX = ODYSSEY_STRING_LOOSE.x + (ODYSSEY_BOW_TOP.x - ODYSSEY_STRING_LOOSE.x) * t;
  const endY = ODYSSEY_STRING_LOOSE.y + (ODYSSEY_BOW_TOP.y - ODYSSEY_STRING_LOOSE.y) * t;
  const bowPath = document.getElementById('odysseyBowPath');
  const stringPath = document.getElementById('odysseyStringPath');
  const stringEnd = document.getElementById('odysseyStringEnd');
  if(!bowPath) return; // modale déjà fermée entre-temps

  bowPath.setAttribute('d', `M${ODYSSEY_BOW_TOP.x},${ODYSSEY_BOW_TOP.y} Q${bowMidX},100 ${ODYSSEY_BOW_BOTTOM.x},${ODYSSEY_BOW_BOTTOM.y}`);

  // La corde pend lâche, à l'écart de l'arc (courbe bombée vers la droite)
  // tant qu'elle n'est pas accrochée — le bombé se résorbe avec la tension,
  // jusqu'à une ligne droite et tendue (accrochée) à 100%.
  const sag = ODYSSEY_STRING_SAG_MAX * (1 - t);
  const midX = (ODYSSEY_BOW_BOTTOM.x + endX) / 2 + sag;
  const midY = (ODYSSEY_BOW_BOTTOM.y + endY) / 2;
  stringPath.setAttribute('d', `M${ODYSSEY_BOW_BOTTOM.x},${ODYSSEY_BOW_BOTTOM.y} Q${midX},${midY} ${endX},${endY}`);

  stringEnd.setAttribute('cx', endX);
  stringEnd.setAttribute('cy', endY);
  stringEnd.setAttribute('r', t >= 1 ? 5.5 : 4);
}

function runOdysseyHappening(){
  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.innerHTML = `
    <div class="modal happening-modal">
      <div class="modal-head">
        <h2>L'épreuve de l'arc</h2>
        <button class="close-x" data-close aria-label="Fermer">✕</button>
      </div>
      <p class="happening-caption" id="odysseyCaption">Douze anneaux de hache, un seul arc à bander : plie-le et accroche la corde à l'encoche du sommet, vite et sans t'arrêter, ou elle retombe.</p>
      <svg class="odyssey-bow" viewBox="0 0 220 200" aria-hidden="true">
        <line x1="15" y1="100" x2="205" y2="100" class="odyssey-bow-guide"/>
        <!-- Encoche du sommet : où le bout libre de la corde doit venir s'accrocher, voir updateOdysseyBow(). -->
        <line x1="98" y1="13" x2="122" y2="27" class="odyssey-notch"/>
        <path id="odysseyBowPath" class="odyssey-bow-path" d=""/>
        <path id="odysseyStringPath" class="odyssey-string-path" d=""/>
        <circle id="odysseyStringEnd" class="odyssey-string-end" cx="0" cy="0" r="4"/>
      </svg>
      <div class="odyssey-track"><div class="odyssey-fill" id="odysseyFill"></div></div>
      <button class="btn odyssey-bend-btn" id="odysseyBendBtn" type="button">BANDE-LE !</button>
    </div>
  `;
  document.body.appendChild(overlay);

  let tension = 0;
  let won = false;
  const fill = document.getElementById('odysseyFill');
  const caption = document.getElementById('odysseyCaption');
  const bendBtn = document.getElementById('odysseyBendBtn');
  updateOdysseyBow(0);

  // La tension retombe toute seule, vite — voir les constantes ODYSSEY_*
  // en haut du fichier pour le calcul du rythme minimum requis.
  const decay = setInterval(() => {
    if(won) return;
    tension = Math.max(0, tension - ODYSSEY_DECAY);
    fill.style.width = tension + '%';
    updateOdysseyBow(tension);
  }, ODYSSEY_TICK_MS);

  function stopWatching(){
    clearInterval(decay);
    overlay.remove();
  }
  overlay.addEventListener('click', (e) => {
    if(e.target === overlay || e.target.closest('[data-close]')) stopWatching();
  });

  function bend(){
    if(won) return;
    tension = Math.min(100, tension + ODYSSEY_GAIN);
    fill.style.width = tension + '%';
    updateOdysseyBow(tension);
    if(tension >= 100){
      won = true;
      clearInterval(decay);
      caption.textContent = '« Aucun de vous n\'était digne de bander cet arc. » Toi, si.';
      bendBtn.disabled = true;
      bendBtn.textContent = 'ÉPREUVE RÉUSSIE';
      showToast('Tu es digne d\'Ithaque 🏹');
    }
  }
  // click couvre souris ET clavier (Entrée/Espace sur le bouton focus) —
  // gardé comme seul déclencheur pour ces deux-là. En plus, touchstart
  // (avec preventDefault, qui supprime le click émulé qui suivrait sinon —
  // sinon double comptage) : latence plus faible et aucun tap perdu au
  // rythme très rapide qu'exige l'épreuve, voir ODYSSEY_GAIN/DECAY plus haut.
  bendBtn.addEventListener('click', bend);
  bendBtn.addEventListener('touchstart', (e) => { e.preventDefault(); bend(); }, { passive: false });
}

// --- La Cité de Dieu : le défi photo ---
// Version corrigée le 25/08/2026 : la V1 générait une carte à partir de la
// note/du commentaire (rien à "prendre" soi-même), pas fidèle à l'idée
// d'origine. Ici le vrai défi est de prendre une photo maintenant (via
// l'appareil photo sur mobile, ou un fichier existant sur PC) — l'app
// l'habille ensuite façon pellicule Cidade de Deus (désaturée, contrastée,
// grain, vignette). Bénéfice inattendu : la photo vient d'un <input
// type="file"> local (blob: URL), jamais de TMDB — le <canvas> qui la
// dessine n'est donc PAS "tainted" (voir le souci CORS rencontré sur la V1
// affiche) : le bouton Télécharger fonctionne pour de vrai, avec l'image
// réelle cette fois.
function runCityOfGodHappening(film){
  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.innerHTML = `
    <div class="modal happening-modal cog-modal">
      <div class="modal-head">
        <h2>Le défi photo, façon favela</h2>
        <button class="close-x" data-close aria-label="Fermer">✕</button>
      </div>
      <p class="happening-caption" id="cogCaption">Prends une photo, une vraie : qui raconte quelque chose, comme un plan de Cidade de Deus. On s'occupe de l'ambiance.</p>
      <div id="cogIntro">
        <input type="file" accept="image/*" capture="environment" id="cogPhotoInput">
      </div>
      <div id="cogResult" style="display:none;">
        <canvas class="cog-canvas" id="cogCanvas"></canvas>
        <div class="modal-footer">
          <div><button class="btn secondary" id="cogRetakeBtn" type="button">Reprendre</button></div>
          <div class="right"><button class="btn" id="cogDownloadBtn" type="button">Télécharger</button></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if(e.target === overlay || e.target.closest('[data-close]')) overlay.remove();
  });

  const photoInput = document.getElementById('cogPhotoInput');
  const intro = document.getElementById('cogIntro');
  const result = document.getElementById('cogResult');
  const caption = document.getElementById('cogCaption');
  const canvas = document.getElementById('cogCanvas');

  photoInput.addEventListener('change', () => {
    const file = photoInput.files && photoInput.files[0];
    if(!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      renderCogPhoto(canvas, img, film);
      URL.revokeObjectURL(url);
      intro.style.display = 'none';
      result.style.display = '';
      caption.textContent = 'Défi relevé. Télécharge-la, ou reprends-en une autre.';
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      showToast('Photo illisible, réessaie.');
    };
    img.src = url;
  });

  document.getElementById('cogRetakeBtn').addEventListener('click', () => {
    photoInput.value = '';
    result.style.display = 'none';
    intro.style.display = '';
    caption.textContent = 'Prends une photo, une vraie : qui raconte quelque chose, comme un plan de Cidade de Deus. On s\'occupe de l\'ambiance.';
  });

  document.getElementById('cogDownloadBtn').addEventListener('click', () => {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `critique-films-defi-photo-${film.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');
  });
}

// Grade façon pellicule (désaturée/contrastée/chaude) + vignette + grain +
// bande façon Polaroid en bas avec le titre du film. photoWidth plafonné à
// 900 pour garder un fichier léger — l'aspect ratio d'origine est conservé.
function renderCogPhoto(canvas, img, film){
  const maxW = 900;
  const scale = Math.min(1, maxW / img.naturalWidth);
  const pw = Math.round(img.naturalWidth * scale);
  const ph = Math.round(img.naturalHeight * scale);
  const bandH = 130;
  canvas.width = pw;
  canvas.height = ph + bandH;
  const ctx = canvas.getContext('2d');

  ctx.filter = 'saturate(0.4) contrast(1.3) sepia(0.22) brightness(0.9)';
  ctx.drawImage(img, 0, 0, pw, ph);
  ctx.filter = 'none';

  // Vignette.
  const vign = ctx.createRadialGradient(pw / 2, ph / 2, ph * 0.35, pw / 2, ph / 2, ph * 0.75);
  vign.addColorStop(0, 'rgba(0,0,0,0)');
  vign.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vign;
  ctx.fillRect(0, 0, pw, ph);

  // Grain léger, façon pellicule — points semi-transparents plutôt qu'un
  // vrai bruit par pixel (beaucoup plus rapide).
  ctx.fillStyle = 'rgba(237,228,211,0.06)';
  for(let i = 0; i < Math.round((pw * ph) / 900); i++){
    ctx.fillRect(Math.random() * pw, Math.random() * ph, 1.4, 1.4);
  }

  // Bande basse façon Polaroid.
  ctx.fillStyle = '#17140f';
  ctx.fillRect(0, ph, pw, bandH);
  ctx.fillStyle = '#d1a13f';
  ctx.font = `italic 600 ${Math.max(22, Math.round(pw / 26))}px Georgia, serif`;
  ctx.textAlign = 'left';
  ctx.fillText(truncateCanvasTextOneLine(ctx, film.title, pw - 56), 28, ph + 48);
  ctx.fillStyle = '#948c78';
  ctx.font = '600 13px "IBM Plex Mono", monospace';
  ctx.fillText('DÉFI PHOTO RELEVÉ · CRITIQUE DE FILMS', 28, ph + bandH - 20);
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines){
  const words = text.split(' ');
  let line = '';
  let curY = y;
  let lines = 0;
  for(let i = 0; i < words.length; i++){
    const testLine = line + words[i] + ' ';
    if(ctx.measureText(testLine).width > maxWidth && line){
      ctx.fillText(line, x, curY);
      line = words[i] + ' ';
      curY += lineHeight;
      lines++;
      if(maxLines && lines >= maxLines - 1){
        // Dernière ligne autorisée : le reste, tronqué avec "…" si besoin.
        const rest = words.slice(i).join(' ');
        let truncated = rest;
        while(ctx.measureText(truncated + '…').width > maxWidth && truncated.length > 1){
          truncated = truncated.slice(0, -1);
        }
        ctx.fillText(truncated.length < rest.length ? truncated + '…' : truncated, x, curY);
        return;
      }
    }else{
      line = testLine;
    }
  }
  ctx.fillText(line, x, curY);
}

// Une seule ligne, tronquée avec "…" si besoin — contrairement à
// wrapCanvasText() ci-dessus (pensée pour plusieurs lignes), utile quand la
// mise en page suivante (ex. la bande du défi photo) réserve une hauteur
// fixe pour une seule ligne de titre.
function truncateCanvasTextOneLine(ctx, text, maxWidth){
  if(ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while(t.length > 1 && ctx.measureText(t + '…').width > maxWidth){
    t = t.slice(0, -1);
  }
  return t + '…';
}

// --- Se7en : la boîte ---
// Le film ne montre jamais ce qu'il y a dedans, seulement la réaction de
// Mills — sa vraie force est justement de ne rien montrer. Même parti pris
// ici plutôt qu'un gadget qui "révélerait" quelque chose : ouvrir la boîte
// ne montre RIEN, juste un sursaut (secousse d'écran, jamais un flash de
// contenu comme Fight Club) et la réplique.
function runSevenHappening(){
  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.innerHTML = `
    <div class="modal happening-modal">
      <div class="modal-head">
        <h2>📦 Une boîte, dans le désert.</h2>
        <button class="close-x" data-close aria-label="Fermer">✕</button>
      </div>
      <p class="happening-caption" id="sevenCaption">John Doe a livré son dernier colis. Mills insiste pour l'ouvrir.</p>
      <button class="btn" id="sevenOpenBtn" type="button">Ouvrir la boîte</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if(e.target === overlay || e.target.closest('[data-close]')) overlay.remove();
  });
  document.getElementById('sevenOpenBtn').addEventListener('click', () => {
    document.getElementById('sevenOpenBtn').remove();
    document.getElementById('sevenCaption').textContent = '« Qu\'est-ce qu\'il y a dans la boîte ?! »';
    if(!prefersReducedMotion()){
      overlay.classList.add('seven-shake');
      setTimeout(() => overlay.classList.remove('seven-shake'), 400);
    }
  });
}

// --- Whiplash : le métronome de Fletcher — jamais assez vite, jamais assez
// bien. Un seul bouton, une seule réponse possible : peu importe où on
// clique dessus, le verdict est déjà écrit (l'obsession du tempo PARFAIT
// est tout le sujet du film, pas la peine de faire semblant de mesurer un
// vrai rythme au clic — ce serait de toute façon peu fiable au navigateur).
function runWhiplashHappening(){
  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.innerHTML = `
    <div class="modal happening-modal">
      <div class="modal-head">
        <h2>Pas tout à fait mon tempo.</h2>
        <button class="close-x" data-close aria-label="Fermer">✕</button>
      </div>
      <div class="whiplash-metronome">
        <div class="whiplash-metronome-arm${prefersReducedMotion() ? ' static' : ''}"></div>
      </div>
      <p class="happening-caption">Encore une fois. Depuis le début.</p>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if(e.target === overlay || e.target.closest('[data-close]')) overlay.remove();
  });
}

// --- Paprika : la parade --- l'image la plus reconnaissable du film,
// façon couloir d'Old Boy (une bande d'éléments qui défile en boucle) mais
// dans l'autre sens et avec un tempo différent, pour ne pas juste réutiliser
// le même effet visuel sous un autre nom.
function runPaprikaHappening(){
  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.innerHTML = `
    <div class="modal happening-modal">
      <div class="modal-head">
        <h2>La Parade</h2>
        <button class="close-x" data-close aria-label="Fermer">✕</button>
      </div>
      <div class="paprika-parade">
        <div class="paprika-parade-track${prefersReducedMotion() ? ' static' : ''}">
          <span>🎺</span><span>🚪</span><span>🎎</span><span>📞</span><span>🐸</span><span>🎏</span><span>🕰️</span><span>🎻</span><span>🚪</span>
        </div>
      </div>
      <p class="happening-caption">Un défilé de rêve traverse la ville, frigos et jouets en fanfare — la police n'y peut rien.</p>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if(e.target === overlay || e.target.closest('[data-close]')) overlay.remove();
  });
}

// --- Mission : Impossible : le message qui s'autodétruit ---
function runMissionImpossibleHappening(){
  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.innerHTML = `
    <div class="modal happening-modal">
      <div class="modal-head">
        <h2>Votre mission, si vous l'acceptez...</h2>
        <button class="close-x" data-close aria-label="Fermer">✕</button>
      </div>
      <p class="happening-caption" id="mimMessage">Ce message s'autodétruira dans <span id="mimCountdown">5</span> secondes.</p>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if(e.target === overlay || e.target.closest('[data-close]')) overlay.remove();
  });
  if(prefersReducedMotion()){
    // Pas de décompte ni d'effet de combustion pour cette préférence : le
    // message final directement, sans jouer sur le suspense du compte à
    // rebours.
    document.getElementById('mimMessage').textContent = 'Ce message s\'est autodétruit.';
    return;
  }
  let n = 5;
  const countdownEl = document.getElementById('mimCountdown');
  const timer = setInterval(() => {
    if(!document.body.contains(overlay)){ clearInterval(timer); return; } // fermé avant la fin
    n--;
    if(n <= 0){
      clearInterval(timer);
      overlay.classList.add('mim-burn');
      setTimeout(() => overlay.remove(), 900);
      return;
    }
    countdownEl.textContent = n;
  }, 1000);
}

// --- The Dark Knight : la pièce, jamais vraiment laissée au hasard ---
function runDarkKnightHappening(){
  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.innerHTML = `
    <div class="modal happening-modal">
      <div class="modal-head">
        <h2>Pile ou face ?</h2>
        <button class="close-x" data-close aria-label="Fermer">✕</button>
      </div>
      <div class="dk-coin" id="dkCoin">🪙</div>
      <p class="happening-caption" id="dkCaption">« Tu fais ton propre destin. » Lance la pièce.</p>
      <button class="btn" id="dkFlipBtn" type="button">Lancer la pièce</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if(e.target === overlay || e.target.closest('[data-close]')) overlay.remove();
  });
  document.getElementById('dkFlipBtn').addEventListener('click', () => {
    document.getElementById('dkFlipBtn').remove();
    const coin = document.getElementById('dkCoin');
    const reduced = prefersReducedMotion();
    if(!reduced) coin.classList.add('flipping');
    setTimeout(() => {
      const caption = document.getElementById('dkCaption');
      if(caption) caption.textContent = 'Les deux côtés sont identiques. Il n\'a jamais vraiment laissé le hasard décider.';
    }, reduced ? 0 : 900);
  });
}

