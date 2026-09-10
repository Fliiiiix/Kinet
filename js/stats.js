// --- Statistiques ---
// Tout calculé côté client à partir de `films` déjà chargé — pas de requête
// dédiée. Un seul hue (amber, celui de l'app) pour les barres : ce sont des
// séries uniques (magnitude), pas des comparaisons catégorielles.

// list : par défaut le catalogue de l'utilisateur connecté, mais peut être
// n'importe quelle liste de films au même format (ex. le catalogue d'un ami
// en lecture seule, voir openFriendProfile() dans js/friends.js).
function computeStats(list = films){
  const rated = list.filter(f => getDisplayNote(f) !== null);
  const notes = rated.map(getDisplayNote);
  const avg = notes.length ? notes.reduce((a, b) => a + b, 0) / notes.length : null;
  const favCount = list.filter(f => f.fav).length;
  const manualCount = list.filter(f => f.manualNote != null).length;
  const gridCount = list.length - manualCount;

  const buckets = [];
  for(let v = 0; v <= 5; v += 0.5) buckets.push(Math.round(v * 10) / 10);
  const distribution = buckets.map(b => ({
    value: b,
    count: notes.filter(n => n === b).length
  }));

  const monthMap = {};
  // Statistiques enrichies (retour utilisateur) : évolution de la note
  // moyenne et genre dominant, mois par mois — mêmes clés "AAAA-MM" que
  // `activity` ci-dessous, calculées dans la même boucle plutôt qu'une
  // deuxième passe sur `list`.
  const monthNoteMap = {}; // "AAAA-MM" -> { sum, count }
  const monthGenreMap = {}; // "AAAA-MM" -> { genreId: count }
  list.forEach(f => {
    const d = new Date(f.added);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthMap[key] = (monthMap[key] || 0) + 1;

    const note = getDisplayNote(f);
    if(note !== null){
      if(!monthNoteMap[key]) monthNoteMap[key] = { sum: 0, count: 0 };
      monthNoteMap[key].sum += note;
      monthNoteMap[key].count++;
    }
    (f.genreIds || []).forEach(gid => {
      if(!monthGenreMap[key]) monthGenreMap[key] = {};
      monthGenreMap[key][gid] = (monthGenreMap[key][gid] || 0) + 1;
    });
  });
  const months = Object.keys(monthMap).sort();
  const activity = months.map(m => ({ month: m, count: monthMap[m] }));

  const noteEvolution = Object.keys(monthNoteMap).sort().map(m => ({
    month: m,
    avg: monthNoteMap[m].sum / monthNoteMap[m].count
  }));

  // Genre "dominant" = le plus fréquent CE mois-là (pas le plus fréquent au
  // global) : deux films de comédie en janvier suffisent à en faire le
  // genre du mois si rien d'autre n'a été noté plus d'une fois ce mois-ci.
  // En cas d'égalité, garde le premier rencontré (ordre de GENRE_MAP,
  // js/data.js) — arbitraire mais stable, pas la peine d'un critère de
  // départage plus élaboré pour une simple curiosité mensuelle.
  const genreByMonth = Object.keys(monthGenreMap).sort().map(m => {
    const counts = monthGenreMap[m];
    let topId = null, topCount = 0;
    Object.keys(counts).forEach(gid => {
      if(counts[gid] > topCount){ topCount = counts[gid]; topId = parseInt(gid, 10); }
    });
    return { month: m, genreId: topId, count: topCount };
  });

  let best = null, worst = null;
  rated.forEach(f => {
    const n = getDisplayNote(f);
    if(!best || n > getDisplayNote(best)) best = f;
    if(!worst || n < getDisplayNote(worst)) worst = f;
  });

  return { total: list.length, avg, favCount, manualCount, gridCount, distribution, activity, noteEvolution, genreByMonth, best, worst };
}

function monthLabel(key){
  const [y, m] = key.split('-');
  const noms = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
  return `${noms[parseInt(m, 10) - 1]} ${y.slice(2)}`;
}

// items: [{label, count}] — une seule barre porte sa valeur en direct (le max),
// les autres se lisent au survol (title natif) pour éviter le bruit visuel.
// opts.clickable (v2.2, retour utilisateur : voir la liste des films
// derrière une barre, ex. "notés 4") — seules les barres non vides le
// deviennent, cliquer une barre vide n'aurait rien à montrer.
function renderBarChart(items, opts = {}){
  const max = Math.max(1, ...items.map(i => i.count));
  const clickable = !!opts.clickable;
  return `
    <div class="bar-chart">
      ${items.map((i, idx) => {
        const active = clickable && i.count > 0;
        return `
        <div class="bar-col${active ? ' bar-col-clickable' : ''}" data-index="${idx}" title="${escapeHtml(i.label)} : ${i.count}"${active ? ' role="button" tabindex="0"' : ''}>
          <div class="bar-track">
            <div class="bar-fill" style="height:${(i.count / max * 100).toFixed(1)}%">${i.count > 0 && i.count === max ? `<span class="bar-value">${i.count}</span>` : ''}</div>
          </div>
          <div class="bar-label">${escapeHtml(i.label)}</div>
        </div>
      `;
      }).join('')}
    </div>
  `;
}

// Évolution de la note moyenne, mois par mois — un SVG à la main, même
// règle que renderCritRadar() plus bas (aucune lib de graphiques dans ce
// projet). Repasse (retour utilisateur : "pas assez clair", "pas toujours
// bien proportionné") sur deux défauts réels de la 1re version :
//
// 1. preserveAspectRatio="none" (comme un vieux renderLineChart() ici
//    même) étirait x et y par des facteurs DIFFÉRENTS et non fixes (la
//    hauteur du conteneur était fixe en CSS, pas sa largeur) — la COURBE
//    changeait donc de forme selon la largeur d'écran, et les points
//    (des cercles) devenaient des ellipses plus ou moins aplaties. Repris
//    en viewBox fixe + preserveAspectRatio par défaut (comme
//    renderCritRadar()), .line-chart-svg passe à aspect-ratio CSS plutôt
//    qu'une hauteur fixe (voir css/style.css) : la mise à l'échelle reste
//    UNIFORME quelle que soit la largeur réelle, la forme ne bouge plus.
// 2. L'échelle Y calée sur le min/max des SEULES valeurs affichées (jamais
//    montrée) exagérait visuellement de petites variations (ex. 3.8 à 4.2
//    remplissait tout le graphique) — trompeur. L'échelle est maintenant
//    fixe sur 0-5 (la vraie plage d'une note), avec des repères 0/2,5/5
//    affichés : la courbe garde un sens réel d'un mois à l'autre, pas
//    juste "monte ou descend".
//
// Remplit aussi les autres manques signalés indirectement par "pas assez
// clair" : aire sous la courbe (donne un vrai poids visuel à la
// tendance), dernier point mis en avant avec un halo (cohérent avec la
// "Halation" déjà utilisée ailleurs dans l'app), et une vraie infobulle
// au survol/tactile (wireLineChart() plus bas) plutôt que le <title>
// natif du navigateur (lent à apparaître, minuscule, jamais tactile).
const LINE_CHART_W = 300, LINE_CHART_H = 150;
const LINE_CHART_PLOT = { left: 34, right: 292, top: 14, bottom: 120 };
function renderLineChart(items){
  const plot = LINE_CHART_PLOT;
  const plotW = plot.right - plot.left, plotH = plot.bottom - plot.top;
  const stepX = items.length > 1 ? plotW / (items.length - 1) : 0;
  // Une seule note peut dépasser 5 seulement en théorie (jamais en
  // pratique, la grille plafonne déjà à 5) — Math.min ici est un filet,
  // pas une vraie borne attendue.
  const points = items.map((it, idx) => {
    const x = plot.left + idx * stepX;
    const y = plot.bottom - (Math.min(Math.max(it.value, 0), 5) / 5) * plotH;
    return { x: +x.toFixed(1), y: +y.toFixed(1), label: it.label, value: it.value };
  });
  const yTicks = [0, 2.5, 5];
  const gridLines = yTicks.map(v => {
    const y = plot.bottom - (v / 5) * plotH;
    return `
      <line x1="${plot.left}" y1="${y}" x2="${plot.right}" y2="${y}" class="line-chart-grid" vector-effect="non-scaling-stroke"/>
      <text x="${plot.left - 8}" y="${y}" class="line-chart-axis-label" text-anchor="end" dominant-baseline="middle">${v}</text>
    `;
  }).join('');
  const linePoints = points.map(p => `${p.x},${p.y}`).join(' ');
  const areaPoints = `${plot.left},${plot.bottom} ${linePoints} ${plot.right},${plot.bottom}`;
  const lastIdx = points.length - 1;
  const dots = points.map((p, idx) => {
    const isLast = idx === lastIdx;
    // data-label/data-value plutôt qu'un blob JSON dans un attribut (une
    // 1re version le faisait sur le <rect> de capture — escapeHtml()
    // n'échappe jamais les guillemets, voir son commentaire dans js/app.js,
    // donc un JSON.stringify() imbriqué aurait pu casser le HTML) : deux
    // attributs plats, même convention que le title="..." de
    // renderBarChart() juste au-dessus.
    return `
      ${isLast ? `<circle cx="${p.x}" cy="${p.y}" r="9" class="line-chart-halo"/>` : ''}
      <circle cx="${p.x}" cy="${p.y}" r="${isLast ? 4.5 : 3.5}" class="line-chart-dot${isLast ? ' line-chart-dot-last' : ''}" data-label="${escapeHtml(p.label)}" data-value="${p.value}"/>
    `;
  }).join('');
  return `
    <div class="line-chart">
      <svg viewBox="0 0 ${LINE_CHART_W} ${LINE_CHART_H}" class="line-chart-svg" role="img" aria-label="Évolution de la note moyenne, ${escapeHtml(items[0].label)} à ${escapeHtml(items[lastIdx].label)}, de ${items[0].value.toFixed(1)} à ${items[lastIdx].value.toFixed(1)}">
        <defs>
          <linearGradient id="lineChartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style="stop-color:var(--gold); stop-opacity:0.28"/>
            <stop offset="100%" style="stop-color:var(--gold); stop-opacity:0"/>
          </linearGradient>
        </defs>
        ${gridLines}
        <polygon points="${areaPoints}" fill="url(#lineChartFill)" stroke="none"/>
        <polyline points="${linePoints}" fill="none" stroke="var(--gold)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
        ${dots}
        <line x1="0" y1="${plot.top}" x2="0" y2="${plot.bottom}" class="line-chart-crosshair" hidden/>
        <rect x="${plot.left}" y="0" width="${plot.right - plot.left}" height="${LINE_CHART_H}" fill="transparent" class="line-chart-capture"/>
      </svg>
      <div class="line-chart-tooltip" hidden></div>
      <div class="line-chart-labels">${items.map(i => `<span>${escapeHtml(i.label)}</span>`).join('')}</div>
    </div>
  `;
}

// Infobulle + repère vertical au survol/tactile — appelée juste après avoir
// posé le innerHTML de renderLineChart() (voir renderStatsInto()), même
// convention que wireStatsDistribution() juste au-dessus. root : élément
// contenant potentiellement PLUSIEURS .line-chart (aucun cas actuel, mais
// coûte rien de ne pas supposer qu'il n'y en a qu'un). Les points sont relus
// directement sur les <circle> déjà posés par renderLineChart() (cx +
// data-label/data-value) plutôt que retransmis à part — une seule source de
// vérité, jamais deux structures à garder synchronisées.
function wireLineChart(root){
  root.querySelectorAll('.line-chart').forEach(chart => {
    const svg = chart.querySelector('.line-chart-svg');
    const capture = chart.querySelector('.line-chart-capture');
    const crosshair = chart.querySelector('.line-chart-crosshair');
    const tooltip = chart.querySelector('.line-chart-tooltip');
    if(!svg || !capture) return;
    const points = Array.from(chart.querySelectorAll('.line-chart-dot')).map(dot => ({
      x: parseFloat(dot.getAttribute('cx')),
      label: dot.dataset.label,
      value: parseFloat(dot.dataset.value)
    }));
    if(points.length === 0) return;

    function nearestPoint(clientX){
      const rect = svg.getBoundingClientRect();
      const scale = LINE_CHART_W / rect.width;
      const svgX = (clientX - rect.left) * scale;
      return points.reduce((best, p) => Math.abs(p.x - svgX) < Math.abs(best.x - svgX) ? p : best, points[0]);
    }

    function showAt(clientX){
      const p = nearestPoint(clientX);
      const rect = svg.getBoundingClientRect();
      const scale = rect.width / LINE_CHART_W; // uniforme (x et y), voir le commentaire sur aspect-ratio
      crosshair.setAttribute('x1', p.x); crosshair.setAttribute('x2', p.x);
      crosshair.hidden = false;
      tooltip.textContent = `${p.label} · ${p.value.toFixed(1)} / 5`;
      tooltip.hidden = false;
      // Positionné en pixels réels (pas en unités viewBox) : .line-chart-tooltip
      // vit en HTML, pas dans le SVG, .line-chart a position:relative (voir
      // css/style.css) pour que ces left/top soient relatifs à lui. Hauteur
      // TOUJOURS au même niveau (haut du tracé) plutôt qu'à celle du point
      // visé : évite une infobulle qui saute verticalement d'un mois à
      // l'autre, jamais coupée en haut même sur le point culminant.
      tooltip.style.left = (p.x * scale) + 'px';
      tooltip.style.top = (LINE_CHART_PLOT.top * scale) + 'px';
    }
    function hide(){
      crosshair.hidden = true;
      tooltip.hidden = true;
    }

    capture.addEventListener('pointermove', (e) => showAt(e.clientX));
    capture.addEventListener('pointerdown', (e) => showAt(e.clientX));
    capture.addEventListener('pointerleave', hide);
  });
}

// Genre dominant par mois (retour utilisateur) — liste plutôt qu'un
// troisième type de graphique : plus direct à lire pour une info qui est
// déjà elle-même un résumé ("comédie" plutôt qu'un nombre). Plus récent
// d'abord, repliée au-delà de quelques mois (renderCollapsible(), js/ui.js
// — même pattern que le fil d'activité).
function genreMonthRowHtml(g){
  return `
    <div class="genre-month-row">
      <span class="genre-month-label">${monthLabel(g.month)}</span>
      <span class="genre-month-genre">${escapeHtml(GENRE_MAP[g.genreId] || 'Genre inconnu')}</span>
      <span class="genre-month-count">${g.count} film${g.count > 1 ? 's' : ''}</span>
    </div>
  `;
}

// Ligne d'un film dans le détail derrière une barre — même gabarit que la
// liste du profil d'ami (openFriendProfile(), js/friends.js), dupliqué ici
// plutôt que factorisé : les deux endroits divergent légèrement (celui-ci
// n'a jamais de sous-titre année manquant à gérer différemment) et ce n'est
// que quelques lignes, cohérent avec la duplication déjà assumée ailleurs
// dans ce fichier (recherche TMDB, voir js/tmdb.js). data-film-id (pas
// data-tmdb-id) : la ligne s'ouvre maintenant sur le détail de la critique
// (voir openFilmReviewDetail() plus bas), qui existe même pour un film
// ajouté à la main, sans fiche TMDB.
function statsFilmRowHtml(f){
  const note = getDisplayNote(f);
  return `
    <div class="film-row friend-film-row" data-film-id="${f.id}">
      ${f.posterUrl
        ? `<img class="film-poster" src="${f.posterUrl}" alt="" loading="lazy">`
        : `<div class="film-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="film-main">
        <div class="film-title">${escapeHtml(f.title)}</div>
        <div class="film-sub">${f.releaseYear || ''}</div>
      </div>
      <div class="counter ${noteColorClass(note)}">${note !== null ? note.toFixed(1) : '—'}</div>
    </div>
  `;
}

function wireStatsDistribution(content, list, distribution){
  const section = content.querySelector('.stats-section-dist');
  if(!section) return;
  const drilldown = section.querySelector('.stats-drilldown');
  let openValue = null;

  section.querySelectorAll('.bar-col-clickable').forEach(col => {
    const activate = () => {
      const value = distribution[parseInt(col.dataset.index, 10)].value;
      section.querySelectorAll('.bar-col').forEach(c => c.classList.remove('bar-col-active'));
      if(openValue === value){
        openValue = null;
        drilldown.hidden = true;
        drilldown.innerHTML = '';
        return;
      }
      openValue = value;
      col.classList.add('bar-col-active');
      const matches = list.filter(f => getDisplayNote(f) === value);
      drilldown.innerHTML = `
        <div class="stats-drilldown-title">Notés ${value.toFixed(1)} (${matches.length})</div>
        ${matches.map(statsFilmRowHtml).join('')}
      `;
      drilldown.hidden = false;
      drilldown.querySelectorAll('.friend-film-row[data-film-id]').forEach(row => {
        makeRowClickable(row, () => {
          const film = matches.find(f => f.id === Number(row.dataset.filmId));
          if(film) openFilmReviewDetail(film);
        });
      });
    };
    col.addEventListener('click', activate);
    col.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); activate(); }
    });
  });
}

// --- Détail d'une critique (v2.1.x, retour utilisateur : "pouvoir voir la
// critique plus précisément, comment ça a été noté par critère et le
// commentaire") — popup en lecture seule, ouverte PAR-DESSUS la modale
// courante (stats propres ou profil d'un ami, jamais refermée pour ça, voir
// le commentaire sur #filmReviewOverlay dans index.html), pour n'importe
// quelle ligne de film munie de crit/review, qu'elle ait une fiche TMDB ou
// non. `film` est déjà l'objet complet (rowToFilm(), js/app.js) — jamais
// une nouvelle requête réseau ici, la liste qui a produit la ligne cliquée
// l'a déjà.
// Graphique radar des 7 critères (retour utilisateur) — un SVG à la main,
// même règle que renderLineChart() (aucune lib de graphiques dans ce
// projet). Complète la liste à barres déjà là (critReviewRowHtml()) plutôt
// que de la remplacer : le radar donne la FORME du profil d'un coup d'œil
// (un film équilibré vs un film "un seul point fort"), les barres gardent
// la valeur précise par critère — les deux se lisent bien ensemble sans
// se faire concurrence.
//
// 7 axes espacés régulièrement (2π/7), en partant du haut (12h) et dans le
// sens horaire — ordre de CRITERIA (js/data.js) tel quel. viewBox fixe
// (200x200) plutôt que preserveAspectRatio="none" comme renderLineChart() :
// un radar déformé (axes étirés différemment en x/y) perd tout son sens,
// contrairement à une simple courbe.
function critRadarPoint(index, total, radius, cx, cy){
  const angle = -Math.PI / 2 + index * (2 * Math.PI / total);
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

// Libellés raccourcis pour les 2 critères aux noms les plus longs — vérifié
// en direct sur mobile (modal étroit) : "Esthétique visuelle" et "Ressenti
// global" se faisaient couper net contre les bords du modal (débordaient
// bien plus loin que les 5 autres labels). Le libellé complet reste
// affiché juste en dessous dans la liste à barres (critReviewRowHtml()) —
// rien n'est perdu, seul le radar (contraint en largeur) simplifie.
const CRIT_RADAR_SHORT_LABEL = { esthetique: 'Esthétique', ressenti: 'Ressenti' };

function renderCritRadar(critObj){
  const cx = 100, cy = 96, maxRadius = 72;
  const n = CRITERIA.length;
  const values = CRITERIA.map(c => (critObj && typeof critObj[c.key] === 'number') ? critObj[c.key] : 0);

  // Grille de fond : 3 heptagones concentriques (repères 1/3, 2/3, 1) +
  // les axes eux-mêmes, du centre à chaque sommet à valeur max.
  const gridRings = [1 / 3, 2 / 3, 1].map(frac => {
    const pts = Array.from({ length: n }, (_, i) => critRadarPoint(i, n, maxRadius * frac, cx, cy));
    return `<polygon points="${pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="var(--line)" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  }).join('');
  const axisLines = Array.from({ length: n }, (_, i) => {
    const p = critRadarPoint(i, n, maxRadius, cx, cy);
    return `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="var(--line)" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  }).join('');

  // Polygone de données : un sommet par critère, à son propre rayon
  // (valeur 0-1 × maxRadius) — jamais à 0 pile (un score à 0 collapse sur
  // le centre, indiscernable d'un point manquant) : léger plancher visuel
  // pour rester lisible sans fausser la lecture des autres valeurs.
  const dataPoints = values.map((v, i) => critRadarPoint(i, n, Math.max(v, 0.03) * maxRadius, cx, cy));
  const dataPolygon = `<polygon points="${dataPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="var(--violet)" fill-opacity="0.25" stroke="var(--violet)" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  const dataDots = dataPoints.map((p, i) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="var(--violet)"><title>${escapeHtml(CRITERIA[i].label)} : ${values[i].toFixed(2)}</title></circle>`).join('');

  // Libellés autour du radar, à un rayon légèrement plus grand que les
  // données (maxRadius + marge) — ancrage horizontal (start/middle/end)
  // choisi selon la position x par rapport au centre, sans quoi un
  // libellé à droite du centre s'étalerait vers l'extérieur du viewBox.
  const labels = Array.from({ length: n }, (_, i) => {
    const p = critRadarPoint(i, n, maxRadius + 16, cx, cy);
    const anchor = Math.abs(p.x - cx) < 8 ? 'middle' : (p.x > cx ? 'start' : 'end');
    const label = CRIT_RADAR_SHORT_LABEL[CRITERIA[i].key] || CRITERIA[i].label;
    return `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" class="crit-radar-label">${escapeHtml(label)}</text>`;
  }).join('');

  return `
    <svg viewBox="0 0 200 192" class="crit-radar-svg">
      ${gridRings}
      ${axisLines}
      ${dataPolygon}
      ${dataDots}
      ${labels}
    </svg>
  `;
}

function critReviewRowHtml(label, val){
  const pct = Math.round(Math.max(0, Math.min(1, val)) * 100);
  return `
    <div class="crit-review-row">
      <div class="crit-review-label">${escapeHtml(label)}</div>
      <div class="crit-review-bar"><div class="crit-review-fill" style="width:${pct}%"></div></div>
    </div>
  `;
}

function openFilmReviewDetail(film){
  const content = document.getElementById('filmReviewContent');
  const note = getDisplayNote(film);
  const isManual = film.manualNote != null;

  const critHtml = isManual
    ? `<div class="wl-note">Note manuelle — pas de détail par critère.</div>`
    : `${renderCritRadar(film.crit)}<div class="crit-review-list">${CRITERIA.map(c => critReviewRowHtml(c.label, (film.crit && typeof film.crit[c.key] === 'number') ? film.crit[c.key] : 0)).join('')}</div>`;

  content.innerHTML = `
    <div class="film-review-head">
      ${film.posterUrl
        ? `<img class="film-poster" src="${film.posterUrl}" alt="" loading="lazy">`
        : `<div class="film-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="film-main">
        <div class="film-title">${escapeHtml(film.title)}</div>
        <div class="film-sub">${film.releaseYear || ''}</div>
      </div>
      <div class="counter ${noteColorClass(note)}">${note !== null ? note.toFixed(1) : '—'}</div>
    </div>
    ${critHtml}
    <div class="stats-section-title">Commentaire</div>
    ${film.review ? `<div class="crit-review-comment">${escapeHtml(film.review)}</div>` : `<div class="tmdb-empty">Pas de commentaire.</div>`}
    ${film.tmdbId ? `<button class="btn secondary film-review-open-detail" type="button" data-tmdb-id="${film.tmdbId}">Voir la fiche du film</button>` : ''}
  `;

  const detailBtn = content.querySelector('.film-review-open-detail');
  if(detailBtn){
    detailBtn.addEventListener('click', () => {
      closeFilmReview();
      goToFilmDetail(parseInt(detailBtn.dataset.tmdbId, 10));
    });
  }

  openOverlay('filmReviewOverlay');
}

function closeFilmReview(){
  closeOverlay('filmReviewOverlay');
}

document.getElementById('closeFilmReview').addEventListener('click', closeFilmReview);
document.getElementById('filmReviewOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'filmReviewOverlay') closeFilmReview();
});

// Factorisée pour être réutilisée par le profil (lecture seule) d'un ami —
// voir openFriendProfile() dans js/friends.js — avec un autre conteneur et
// la liste de films de cet ami plutôt que la sienne.
// Comparaison année sur année (retour utilisateur) — réutilise
// computeRecap() (js/recap.js) plutôt que de dupliquer sa logique : cette
// fonction lit déjà "vu cette année" au sens propre (au moins un
// visionnage `viewings` cette année-là, pas juste `films.added`), calcule
// déjà total/note moyenne/genre dominant pour une année donnée — tout ce
// dont cette comparaison a besoin, pour les DEUX années demandées.
//
// UNIQUEMENT pour son propre catalogue (voir l'appel dans
// renderStatsInto() : `list === films`) — computeRecap() lit les
// variables globales `films`/`viewings`, jamais celles d'un ami
// (openFriendProfile() charge le catalogue d'un ami dans un tableau à
// part, sans ses visionnages, qui ne sont d'ailleurs pas exposés côté
// RLS). Comparer les années d'un ami donnerait donc TOUJOURS les
// chiffres du compte connecté, silencieusement faux.
function renderYearComparison(){
  const thisYear = new Date().getFullYear();
  const lastYear = thisYear - 1;
  const curr = computeRecap(thisYear);
  const prev = computeRecap(lastYear);
  if(!curr && !prev) return ''; // rien à comparer, ni cette année ni l'an dernier

  const yearColHtml = (recap, year) => recap ? `
    <div class="year-compare-col">
      <div class="year-compare-year">${year}</div>
      <div class="year-compare-total">${recap.total}</div>
      <div class="year-compare-sub">${recap.total > 1 ? 'films vus' : 'film vu'}</div>
      <div class="year-compare-avg">${recap.avgNote != null ? recap.avgNote.toFixed(1) : '—'}<span class="year-compare-avg-unit"> / 5</span></div>
      ${recap.topGenreLabel ? `<div class="year-compare-genre">${escapeHtml(recap.topGenreLabel)}</div>` : ''}
    </div>
  ` : `
    <div class="year-compare-col year-compare-col-empty">
      <div class="year-compare-year">${year}</div>
      <div class="tmdb-empty">Rien de vu cette année-là.</div>
    </div>
  `;

  // Delta affiché seulement quand les deux années ont des données — une
  // comparaison contre zéro n'a pas de sens à afficher comme "progrès".
  const delta = (curr && prev) ? curr.total - prev.total : null;
  const deltaHtml = delta !== null && delta !== 0 ? `
    <div class="year-compare-delta ${delta > 0 ? 'is-up' : 'is-down'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)} film${Math.abs(delta) > 1 ? 's' : ''} ${delta > 0 ? 'de plus' : 'de moins'} qu'en ${lastYear}</div>
  ` : '';

  return `
    <div class="stats-section reveal">
      <div class="stats-section-title">Cette année vs l'année dernière</div>
      <div class="year-compare-grid">
        ${yearColHtml(curr, thisYear)}
        ${yearColHtml(prev, lastYear)}
      </div>
      ${deltaHtml}
    </div>
  `;
}

function renderStatsInto(content, list = films){
  const s = computeStats(list);

  if(s.total === 0){
    content.innerHTML = `<div class="empty-state">Aucun film noté pour l'instant.</div>`;
    return;
  }

  const distItems = s.distribution.map(d => ({ label: d.value.toFixed(1), count: d.count }));
  const activityItems = s.activity.map(a => ({ label: monthLabel(a.month), count: a.count }));

  // .reveal-stagger/.reveal (v2.1.x) : chaque bloc apparaît en cascade au
  // scroll plutôt que tout d'un coup — voir observeReveal(), js/ui.js.
  // Appelé par le SITE qui a rendu ce contenu (renderStats() ou
  // openFriendProfile()), jamais ici : `content` peut encore être un
  // <div> détaché (profil d'ami, construit avant d'être inséré), observer
  // un élément qui n'est pas encore dans le document serait fragile.
  content.classList.add('reveal-stagger');
  content.innerHTML = `
    <div class="stat-tiles reveal">
      <div class="stat-tile accent-violet"><div class="stat-value">${s.total}</div><div class="stat-label">Films notés</div></div>
      <div class="stat-tile accent-gradient"><div class="stat-value">${s.avg !== null ? s.avg.toFixed(2) : '—'}</div><div class="stat-label">Note moyenne</div></div>
      <div class="stat-tile accent-bronze"><div class="stat-value">${s.favCount}</div><div class="stat-label">Favoris</div></div>
      <div class="stat-tile accent-violet"><div class="stat-value">${s.gridCount}</div><div class="stat-label">Grille 7 critères</div></div>
      <div class="stat-tile accent-gold"><div class="stat-value">${s.manualCount}</div><div class="stat-label">Note manuelle</div></div>
    </div>

    ${list === films ? renderYearComparison() : ''}

    <div class="stats-section stats-section-dist reveal">
      <div class="stats-section-title">Distribution des notes</div>
      ${renderBarChart(distItems, { clickable: true })}
      <div class="stats-drilldown" hidden></div>
    </div>

    ${activityItems.length > 1 ? `
    <div class="stats-section reveal">
      <div class="stats-section-title">Films ajoutés par mois</div>
      ${renderBarChart(activityItems)}
    </div>` : ''}

    ${s.noteEvolution.length > 1 ? `
    <div class="stats-section reveal">
      <div class="stats-section-title">Évolution de la note moyenne</div>
      ${renderLineChart(s.noteEvolution.map(n => ({ label: monthLabel(n.month), value: n.avg })))}
    </div>` : ''}

    ${s.genreByMonth.length > 0 ? `
    <div class="stats-section reveal">
      <div class="stats-section-title">Genre dominant par mois</div>
      <div id="genreByMonthList"></div>
    </div>` : ''}

    <div class="stats-section stats-extremes reveal">
      ${s.best ? `
      <div class="stats-extreme stats-extreme-best">
        ${s.best.posterUrl
          ? `<img class="stats-extreme-poster" src="${s.best.posterUrl}" alt="" loading="lazy">`
          : `<div class="stats-extreme-poster stats-extreme-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
        <div class="stats-extreme-info">
          <div class="stats-extreme-label">Mieux noté</div>
          <div class="stats-extreme-title">${escapeHtml(s.best.title)}</div>
          <div class="stats-extreme-note">${getDisplayNote(s.best).toFixed(1)} / 5</div>
        </div>
      </div>` : ''}
      ${s.worst && s.worst !== s.best ? `
      <div class="stats-extreme">
        ${s.worst.posterUrl
          ? `<img class="stats-extreme-poster" src="${s.worst.posterUrl}" alt="" loading="lazy">`
          : `<div class="stats-extreme-poster stats-extreme-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
        <div class="stats-extreme-info">
          <div class="stats-extreme-label">Moins bien noté</div>
          <div class="stats-extreme-title">${escapeHtml(s.worst.title)}</div>
          <div class="stats-extreme-note">${getDisplayNote(s.worst).toFixed(1)} / 5</div>
        </div>
      </div>` : ''}
    </div>
  `;

  wireStatsDistribution(content, list, s.distribution);
  wireLineChart(content);

  const genreByMonthEl = content.querySelector('#genreByMonthList');
  if(genreByMonthEl){
    // Plus récent d'abord (s.genreByMonth est trié chronologique croissant).
    renderCollapsible(genreByMonthEl, s.genreByMonth.slice().reverse(), genreMonthRowHtml, { previewCount: 6 });
  }
}

function renderStats(){
  const content = document.getElementById('statsContent');
  renderStatsInto(content, films);
  observeReveal(content);
}

function openStats(){
  // Accessible depuis la modale profil ("Mon activité") — la refermer
  // d'abord évite deux modales de tailles différentes superposées.
  closeProfileModal();
  renderStats();
  openOverlay('statsOverlay');
}

// Rouvre la modale profil (pas juste closeOverlay simple) : Statistiques
// n'est accessible QUE depuis "Mon activité" dans le profil (voir
// #statsBtn, index.html) — en ressortir doit ramener là où on était, pas
// sortir entièrement du profil comme si on abandonnait toute la modale.
function closeStats(){
  closeOverlay('statsOverlay', () => openProfileModal());
}

document.getElementById('statsBtn').addEventListener('click', openStats);
document.getElementById('closeStats').addEventListener('click', closeStats);
document.getElementById('statsOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'statsOverlay') closeStats();
});
