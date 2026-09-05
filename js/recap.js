// --- Bilan cinéphile partageable (v2.43, retour utilisateur) ---
// Une image exportable façon "wrapped" résumant l'année en cours : nombre
// de films vus, note moyenne, genre préféré, top films — à partir de
// `films`/`viewings` déjà en mémoire (aucun appel réseau dédié, même
// principe que js/stats.js). Rendu en <canvas> à la main (pas de
// librairie, cohérent avec le reste du projet — voir renderLineChart()
// dans js/stats.js pour le même choix) puis exporté en PNG via
// canvas.toDataURL() + <a download> déclenché par script, entièrement
// côté client.
//
// Portée volontairement à l'ANNÉE EN COURS (pas "tout mon catalogue",
// déjà couvert par Statistiques) : c'est le sens même d'un "bilan" façon
// rétrospective annuelle. "Vu cette année" = au moins un visionnage
// (`viewings`, pas `films.added`) daté de cette année — un film ajouté
// il y a 3 ans mais REVU cette année compte, cohérent avec le sens de
// "vu" utilisé partout ailleurs dans l'app (journal des visionnages).

function computeRecap(year){
  const idsWatchedThisYear = new Set(
    viewings.filter(v => new Date(v.watchedAt).getFullYear() === year).map(v => v.filmId)
  );
  const filmsThisYear = films.filter(f => idsWatchedThisYear.has(f.id));
  if(filmsThisYear.length === 0) return null;

  const rated = filmsThisYear.filter(f => getDisplayNote(f) != null);
  const avgNote = rated.length
    ? Math.round((rated.reduce((sum, f) => sum + getDisplayNote(f), 0) / rated.length) * 10) / 10
    : null;
  const favCount = filmsThisYear.filter(f => f.fav).length;

  const topFilms = rated.slice().sort((a, b) => getDisplayNote(b) - getDisplayNote(a)).slice(0, 5);

  const genreCounts = {};
  filmsThisYear.forEach(f => (f.genreIds || []).forEach(gid => {
    genreCounts[gid] = (genreCounts[gid] || 0) + 1;
  }));
  let topGenreId = null, topGenreCount = 0;
  Object.keys(genreCounts).forEach(gid => {
    if(genreCounts[gid] > topGenreCount){ topGenreCount = genreCounts[gid]; topGenreId = parseInt(gid, 10); }
  });

  return {
    year,
    total: filmsThisYear.length,
    avgNote,
    favCount,
    topFilms,
    topGenreLabel: topGenreId != null ? GENRE_MAP[topGenreId] : null
  };
}

// Pas d'affiches TMDB dans le canvas — vérifié en direct : image.tmdb.org
// ne renvoie aucun en-tête CORS (une requête `fetch(url, {mode:'cors'})`
// échoue tout court, `{mode:'no-cors'}` ne renvoie qu'une réponse opaque).
// Un <img crossOrigin="anonymous"> pointé dessus échoue donc toujours
// (onerror), et SANS crossOrigin le dessin réussirait à l'écran mais
// tainterait le canvas — canvas.toDataURL() lèverait une SecurityError au
// moment précis de "Télécharger l'image", l'unique raison d'être de cette
// fonctionnalité. Un placeholder dessiné à la main (jamais d'image
// distante) est donc le seul choix qui garantit un export qui marche à
// tous les coups sur un site 100% statique, sans backend pour proxy-fier
// les images.
const RECAP_PLACEHOLDER_HUES = ['#8c7cff', '#e7b24c', '#d9aa67', '#6fcf97'];

function drawRoundedRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPosterPlaceholder(ctx, title, x, y, w, h, radius, index){
  const hue = RECAP_PLACEHOLDER_HUES[index % RECAP_PLACEHOLDER_HUES.length];
  drawRoundedRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fill();
  drawRoundedRect(ctx, x, y, w, h, radius);
  ctx.strokeStyle = hue;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = hue;
  ctx.font = `700 ${Math.round(w * 0.4)}px 'Bricolage Grotesque', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((title || '?').trim().charAt(0).toUpperCase(), x + w / 2, y + h / 2);
}

function cssVar(name){
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

async function renderRecapCanvas(recap){
  const canvas = document.getElementById('recapCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const ink = cssVar('--ink') || '#0f0e16';
  const surface = cssVar('--surface') || '#1b1826';
  const text = cssVar('--text') || '#f2eee6';
  const textMuted = cssVar('--text-muted') || '#9a93a8';
  const violet = cssVar('--violet') || '#8c7cff';
  const gold = cssVar('--gold') || '#e7b24c';

  // Polices déjà chargées par la page (@import Google Fonts, css/style.css)
  // mais un canvas ne les prend en compte que si document.fonts confirme
  // qu'elles sont prêtes — sans ce await, un premier rendu peut retomber sur
  // la police système par défaut.
  try{
    await Promise.all([
      document.fonts.load("700 64px 'Bricolage Grotesque'"),
      document.fonts.load("400 28px 'Space Mono'"),
      document.fonts.load("700 28px 'Space Mono'")
    ]);
  }catch(e){ console.error(e); }

  // Fond : dégradé radial subtil (violet en haut à gauche) sur l'encre de
  // base — même esprit que le halo déjà utilisé derrière l'en-tête (voir
  // .app-header::before dans css/style.css), rejoué ici en canvas.
  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.15, H * 0.05, 0, W * 0.15, H * 0.05, W * 0.9);
  glow.addColorStop(0, 'rgba(140,124,255,0.22)');
  glow.addColorStop(1, 'rgba(140,124,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  let y = 100;
  ctx.textAlign = 'left';
  ctx.fillStyle = gold;
  ctx.font = "700 26px 'Space Mono', monospace";
  ctx.fillText('KINET · BILAN ' + recap.year, 70, y);

  y += 70;
  const displayName = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.display_name) || 'Cinéphile';
  ctx.fillStyle = text;
  ctx.font = "700 58px 'Bricolage Grotesque', sans-serif";
  ctx.fillText(displayName, 70, y);

  // --- Grands chiffres ---
  y += 90;
  const stats = [
    { value: String(recap.total), label: recap.total > 1 ? 'films vus' : 'film vu' },
    { value: recap.avgNote != null ? recap.avgNote.toFixed(1) : '—', label: 'note moyenne / 5' },
    { value: String(recap.favCount), label: recap.favCount > 1 ? 'favoris' : 'favori' }
  ];
  const statColW = (W - 140) / 3;
  stats.forEach((s, i) => {
    const x = 70 + i * statColW;
    ctx.fillStyle = violet;
    ctx.font = "700 64px 'Bricolage Grotesque', sans-serif";
    ctx.textAlign = 'left';
    ctx.fillText(s.value, x, y);
    ctx.fillStyle = textMuted;
    ctx.font = "400 20px 'Space Mono', monospace";
    ctx.fillText(s.label, x, y + 32);
  });

  if(recap.topGenreLabel){
    y += 100;
    ctx.fillStyle = surface;
    drawRoundedRect(ctx, 70, y - 34, W - 140, 56, 14);
    ctx.fill();
    ctx.fillStyle = text;
    ctx.font = "400 24px 'Space Mono', monospace";
    ctx.fillText('Genre préféré : ', 92, y);
    const labelWidth = ctx.measureText('Genre préféré : ').width;
    ctx.fillStyle = gold;
    ctx.font = "700 24px 'Space Mono', monospace";
    ctx.fillText(recap.topGenreLabel, 92 + labelWidth, y);
  }

  // --- Top films ---
  y += 90;
  ctx.fillStyle = text;
  ctx.font = "700 30px 'Bricolage Grotesque', sans-serif";
  ctx.fillText(recap.topFilms.length > 1 ? 'Tes coups de cœur' : 'Ton coup de cœur', 70, y);

  y += 30;
  const posterW = (W - 140 - (recap.topFilms.length - 1) * 20) / Math.max(1, Math.min(recap.topFilms.length, 5));
  const posterH = posterW * 1.5;
  recap.topFilms.forEach((f, i) => {
    const x = 70 + i * (posterW + 20);
    drawPosterPlaceholder(ctx, f.title, x, y, posterW, posterH, 14, i);
    // Badge note, coin bas-droit de l'affiche — même esprit que .film-card
    // note badge en CSS, rejoué ici.
    const note = getDisplayNote(f);
    const badgeR = 22;
    ctx.beginPath();
    ctx.arc(x + posterW - badgeR - 8, y + posterH - badgeR - 8, badgeR, 0, Math.PI * 2);
    ctx.fillStyle = ink;
    ctx.fill();
    ctx.strokeStyle = gold;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = gold;
    ctx.font = "700 18px 'Space Mono', monospace";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(note.toFixed(1), x + posterW - badgeR - 8, y + posterH - badgeR - 8 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  });

  y += posterH + 40;
  if(recap.topFilms[0]){
    ctx.fillStyle = text;
    ctx.font = "700 26px 'Bricolage Grotesque', sans-serif";
    const title = recap.topFilms[0].title;
    ctx.fillText(title.length > 40 ? title.slice(0, 38) + '…' : title, 70, y);
  }

  // --- Pied de page ---
  ctx.fillStyle = textMuted;
  ctx.font = "400 20px 'Space Mono', monospace";
  ctx.textAlign = 'center';
  ctx.fillText('kinet · fliiiiix.github.io/Kinet', W / 2, H - 50);
  ctx.textAlign = 'left';
}

async function openRecap(){
  closeOverlay('statsOverlay');
  const recap = computeRecap(new Date().getFullYear());
  const canvas = document.getElementById('recapCanvas');
  const downloadBtn = document.getElementById('downloadRecapBtn');
  if(!recap){
    // Case limite (rien de vu cette année, ex. tout début janvier ou
    // catalogue neuf) : le canvas reste vide, message clair à la place
    // plutôt qu'une image blanche muette.
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = cssVar('--ink') || '#0f0e16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = cssVar('--text-muted') || '#9a93a8';
    ctx.font = "400 32px 'Space Mono', monospace";
    ctx.textAlign = 'center';
    ctx.fillText('Rien à résumer pour l\'instant.', canvas.width / 2, canvas.height / 2);
    ctx.textAlign = 'left';
    downloadBtn.style.display = 'none';
    openOverlay('recapOverlay');
    return;
  }
  downloadBtn.style.display = '';
  openOverlay('recapOverlay');
  await renderRecapCanvas(recap);
}

function closeRecap(){
  closeOverlay('recapOverlay');
}

document.getElementById('openRecapBtn').addEventListener('click', openRecap);
document.getElementById('closeRecap').addEventListener('click', closeRecap);
document.getElementById('recapOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'recapOverlay') closeRecap();
});
document.getElementById('downloadRecapBtn').addEventListener('click', () => {
  const canvas = document.getElementById('recapCanvas');
  const year = new Date().getFullYear();
  try{
    const link = document.createElement('a');
    link.download = `kinet-bilan-${year}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }catch(e){
    // toDataURL() peut lever SecurityError si une affiche a fini par tainter
    // le canvas malgré crossOrigin='anonymous' (CDN mal configuré) — au pire
    // un message clair plutôt qu'un clic silencieusement mort.
    showToast('Impossible de générer l\'image, réessaie');
    console.error(e);
  }
});
