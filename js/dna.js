// --- Ton ADN ciné (idée 7 du 28/10) ---
// Dans les Statistiques : tes genres préférés (et celui qui te plaît le
// moins), tes décennies, les critères où tu es généreux ou exigeant, tes
// réalisateurs les plus présents. Et la même chose en image à partager, dans
// la fenêtre de « Ton année » (#recapOverlay, js/recap.js).
// Genres et décennies viennent de ton catalogue ; les réalisateurs, des fiches
// TMDB gardées sur l'appareil (fetchFilmFactsMany(), js/tmdb.js), chargées la
// première fois en arrière-plan.

const DNA_MIN_FILMS = 5;
const DNA_MIN_PER_GENRE = 3;
const DNA_MIN_PER_DIRECTOR = 2;

const dnaAvg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const dnaFr = (x) => x.toFixed(1).replace('.', ',');
// « années 2010 », « années 90 »
const dnaDecadeLabel = (d) => d >= 2000 ? `années ${d}` : `années ${String(d).slice(2)}`;

// factsOf(tmdbId) : fiche TMDB connue ou null.
function computeDna(list, factsOf = () => null){
  const rated = list.filter(f => getDisplayNote(f) !== null);
  if(rated.length < DNA_MIN_FILMS) return null;
  const mean = dnaAvg(rated.map(getDisplayNote));

  const byGenre = new Map();
  rated.forEach(f => (f.genreIds || []).forEach(g => {
    if(!GENRE_MAP[g]) return;
    const e = byGenre.get(g) || { name: GENRE_MAP[g], notes: [] };
    e.notes.push(getDisplayNote(f));
    byGenre.set(g, e);
  }));
  const genres = Array.from(byGenre.values())
    .filter(e => e.notes.length >= DNA_MIN_PER_GENRE)
    .map(e => ({ name: e.name, n: e.notes.length, avg: dnaAvg(e.notes) }))
    .sort((a, b) => b.avg - a.avg || b.n - a.n || a.name.localeCompare(b.name, 'fr'));

  const byDecade = new Map();
  list.forEach(f => {
    if(!f.releaseYear) return;
    const d = Math.floor(f.releaseYear / 10) * 10;
    byDecade.set(d, (byDecade.get(d) || 0) + 1);
  });
  const decades = Array.from(byDecade.entries()).map(([d, n]) => ({ label: dnaDecadeLabel(d), n }))
    .sort((a, b) => b.n - a.n).slice(0, 3);

  const withCrit = rated.filter(f => f.crit && CRITERIA.some(c => typeof f.crit[c.key] === 'number'));
  const crit = CRITERIA.map(c => {
    const vals = withCrit.map(f => f.crit[c.key]).filter(v => typeof v === 'number');
    return { label: c.label, n: vals.length, avg: vals.length ? dnaAvg(vals) * 5 : null };
  }).filter(c => c.n >= DNA_MIN_FILMS).sort((a, b) => b.avg - a.avg);

  const byDirector = new Map();
  rated.forEach(f => {
    const facts = f.tmdbId ? factsOf(f.tmdbId) : null;
    (facts && facts.directors || []).forEach(d => {
      const e = byDirector.get(d.id) || { name: d.name, notes: [] };
      e.notes.push(getDisplayNote(f));
      byDirector.set(d.id, e);
    });
  });
  const directors = Array.from(byDirector.values())
    .filter(e => e.notes.length >= DNA_MIN_PER_DIRECTOR)
    .map(e => ({ name: e.name, n: e.notes.length, avg: dnaAvg(e.notes) }))
    .sort((a, b) => b.n - a.n || b.avg - a.avg).slice(0, 3);

  const best = genres.slice(0, 3);
  const worst = genres.length > 3 && genres[genres.length - 1].avg < mean - 0.3 ? genres[genres.length - 1] : null;
  return { count: rated.length, mean, best, worst, decades, crit, directors };
}

// Les lignes de l'ADN, en texte : partagées par la page et par l'image.
function dnaLines(dna){
  const lines = [];
  if(dna.best.length) lines.push({ label: 'Tes genres', value: dna.best.map(g => `${g.name} ${dnaFr(g.avg)}`).join(' · ') });
  if(dna.worst) lines.push({ label: 'Moins ton truc', value: `${dna.worst.name} ${dnaFr(dna.worst.avg)}` });
  if(dna.decades.length) lines.push({ label: 'Tes décennies', value: dna.decades.map(d => `${d.label} (${d.n})`).join(' · ') });
  if(dna.crit.length >= 2){
    const hi = dna.crit[0], lo = dna.crit[dna.crit.length - 1];
    if(hi.avg - lo.avg >= 0.2) lines.push({ label: 'Tes critères', value: `généreux sur ${hi.label} (${dnaFr(hi.avg)}), exigeant sur ${lo.label} (${dnaFr(lo.avg)})` });
  }
  if(dna.directors.length) lines.push({ label: 'Tes réalisateurs', value: dna.directors.map(d => `${d.name} (${d.n} films, ${dnaFr(d.avg)})`).join(' · ') });
  return lines;
}

function dnaSectionHtml(dna, loadingDirectors){
  const lines = dnaLines(dna);
  return `
    <div class="dna-head"><span class="stats-section-title">Ton ADN ciné</span><button type="button" class="year-link dna-share" id="dnaShareBtn">Partager en image ›</button></div>
    <div class="dna-rows">
      ${lines.map(l => `<div class="dna-row"><span class="dna-label">${escapeHtml(l.label)}</span><span class="dna-val">${escapeHtml(l.value)}</span></div>`).join('')}
      ${loadingDirectors && !dna.directors.length ? `<div class="dna-row"><span class="dna-label">Tes réalisateurs</span><span class="dna-val dna-wait">Chargement…</span></div>` : ''}
    </div>`;
}

let dnaCurrent = null;

// Appelée par renderStatsInto() (js/stats.js) pour tes propres statistiques.
async function renderDnaSection(){
  const el = document.getElementById('dnaSection');
  if(!el) return;
  const draw = (loading) => {
    dnaCurrent = computeDna(films, cachedFilmFacts);
    if(!dnaCurrent){ el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = dnaSectionHtml(dnaCurrent, loading);
    el.querySelector('#dnaShareBtn').addEventListener('click', openDnaImage);
  };
  const ids = films.filter(f => f.tmdbId && getDisplayNote(f) !== null).map(f => f.tmdbId);
  const missing = ids.some(id => !cachedFilmFacts(id));
  draw(missing);
  if(!missing) return;
  try{
    await fetchFilmFactsMany(ids);
  }catch(e){ console.error(e); }
  if(document.getElementById('dnaSection') === el) draw(false);
}

// --- L'image à partager --- Même format et même fenêtre que « Ton année ».
function dnaWrap(ctx, text, maxWidth){
  const words = text.split(' ');
  const out = [];
  let line = '';
  words.forEach(w => {
    const next = line ? `${line} ${w}` : w;
    if(ctx.measureText(next).width > maxWidth && line){ out.push(line); line = w; }
    else line = next;
  });
  if(line) out.push(line);
  return out;
}

async function drawDnaCanvas(canvas, dna){
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const ink = cssVar('--ink') || '#0f0e16';
  const text = cssVar('--text-1') || cssVar('--text') || '#f2eee6';
  const muted = cssVar('--text-2') || '#9a93a8';
  const accent = cssVar('--accent') || '#4fcfff';
  try{
    await Promise.all([
      document.fonts.load("700 64px 'Bricolage Grotesque'"),
      document.fonts.load("400 30px 'Instrument Sans'"),
      document.fonts.load("700 26px 'Instrument Sans'"),
    ]);
  }catch(e){ console.error(e); }
  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, H * 0.08, 0, W * 0.85, H * 0.08, W * 0.9);
  glow.addColorStop(0, 'rgba(79,207,255,0.18)');
  glow.addColorStop(1, 'rgba(79,207,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  let y = 110;
  ctx.textAlign = 'left';
  ctx.fillStyle = accent;
  ctx.font = "700 26px 'Instrument Sans', sans-serif";
  ctx.fillText('KINET · MON ADN CINÉ', 80, y);
  y += 80;
  ctx.fillStyle = text;
  ctx.font = "700 68px 'Bricolage Grotesque', sans-serif";
  const name = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.display_name) || 'Cinéphile';
  ctx.fillText(name.length > 22 ? name.slice(0, 21) + '…' : name, 80, y);
  y += 56;
  ctx.fillStyle = muted;
  ctx.font = "400 30px 'Instrument Sans', sans-serif";
  ctx.fillText(`${dna.count} films notés, ${dnaFr(dna.mean)} de moyenne`, 80, y);
  y += 90;

  dnaLines(dna).forEach(l => {
    ctx.fillStyle = muted;
    ctx.font = "700 24px 'Instrument Sans', sans-serif";
    ctx.fillText(l.label.toUpperCase(), 80, y);
    y += 46;
    ctx.fillStyle = text;
    ctx.font = "400 34px 'Instrument Sans', sans-serif";
    dnaWrap(ctx, l.value, W - 160).slice(0, 3).forEach(line => { ctx.fillText(line, 80, y); y += 46; });
    y += 34;
  });

  ctx.fillStyle = muted;
  ctx.font = "400 24px 'Instrument Sans', sans-serif";
  ctx.textAlign = 'center';
  ctx.fillText('kinet · fliiiiix.github.io/Kinet', W / 2, H - 60);
  ctx.textAlign = 'left';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Mon ADN ciné : ${dnaLines(dna).map(l => `${l.label}, ${l.value}`).join('. ')}`);
}

async function openDnaImage(){
  if(!dnaCurrent) return;
  const canvas = document.getElementById('recapCanvas');
  canvas.dataset.fileBase = 'kinet-adn-cine';
  canvas.dataset.shareTitle = 'Mon ADN ciné';
  document.querySelector('#recapOverlay h2').textContent = 'Ton ADN ciné en image';
  document.getElementById('downloadRecapBtn').style.display = '';
  document.getElementById('downloadRecapPdfBtn').style.display = '';
  document.getElementById('shareRecapBtn').style.display = (await canShareFiles()) ? '' : 'none';
  closeOverlay('statsOverlay');
  openOverlay('recapOverlay');
  await drawDnaCanvas(canvas, dnaCurrent);
}
