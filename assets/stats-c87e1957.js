function computeStats(list=films){const rated=list.filter(f=>getDisplayNote(f)!==null);const notes=rated.map(getDisplayNote);const avg=notes.length?notes.reduce((a,b)=>a+b,0)/notes.length:null;const favCount=list.filter(f=>f.fav).length;const manualCount=list.filter(f=>f.manualNote!=null).length;const gridCount=list.length-manualCount;const buckets=[];for(let v=0;v<=5;v+=.5)buckets.push(Math.round(v*10)/10);const distribution=buckets.map(b=>({value:b,count:notes.filter(n=>n===b).length}));const monthMap={};const monthNoteMap={};const monthGenreMap={};list.forEach(f=>{const d=new Date(f.added);const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,`0`)}`;monthMap[key]=(monthMap[key]||0)+1;const note=getDisplayNote(f);if(note!==null){if(!monthNoteMap[key])monthNoteMap[key]={sum:0,count:0};monthNoteMap[key].sum+=note;monthNoteMap[key].count++}(f.genreIds||[]).forEach(gid=>{if(!monthGenreMap[key])monthGenreMap[key]={};monthGenreMap[key][gid]=(monthGenreMap[key][gid]||0)+1})});const months=Object.keys(monthMap).sort();const activity=months.map(m=>({month:m,count:monthMap[m]}));const noteEvolution=Object.keys(monthNoteMap).sort().map(m=>({month:m,avg:monthNoteMap[m].sum/monthNoteMap[m].count}));const genreByMonth=Object.keys(monthGenreMap).sort().map(m=>{const counts=monthGenreMap[m];let topId=null,topCount=0;Object.keys(counts).forEach(gid=>{if(counts[gid]>topCount){topCount=counts[gid];topId=parseInt(gid,10)}});return{month:m,genreId:topId,count:topCount}});let best=null,worst=null;rated.forEach(f=>{const n=getDisplayNote(f);if(!best||n>getDisplayNote(best))best=f;if(!worst||n<getDisplayNote(worst))worst=f});return{total:list.length,rated:rated.length,avg,favCount,manualCount,gridCount,distribution,activity,noteEvolution,genreByMonth,best,worst}}function monthLabel(key){const[y,m]=key.split(`-`);const noms=[`Jan`,`Fév`,`Mar`,`Avr`,`Mai`,`Juin`,`Juil`,`Août`,`Sep`,`Oct`,`Nov`,`Déc`];return`${noms[parseInt(m,10)-1]} ${y.slice(2)}`}function renderBarChart(items,opts={}){const max=Math.max(1,...items.map(i=>i.count));const clickable=!!opts.clickable;const maxLabels=opts.maxLabels||items.length;const lastIdx=items.length-1;const labelStep=Math.max(1,Math.ceil(lastIdx/Math.max(1,maxLabels-1))||1);const shownIdx=new Set;for(let i=0;i<lastIdx;i+=labelStep)shownIdx.add(i);let orderedBarIdx=[...shownIdx].sort((a,b)=>a-b);while(orderedBarIdx.length&&lastIdx-orderedBarIdx[orderedBarIdx.length-1]<labelStep){shownIdx.delete(orderedBarIdx.pop())}shownIdx.add(0);shownIdx.add(lastIdx);return`
    <div class="bar-chart">
      ${items.map((i,idx)=>{const active=clickable&&i.count>0;const showLabel=items.length<=maxLabels||shownIdx.has(idx);return`
        <div class="bar-col${active?` bar-col-clickable`:``}" data-index="${idx}" title="${escapeHtml(i.label)} : ${i.count}"${active?` role="button" tabindex="0"`:``}>
          <div class="bar-track">
            <div class="bar-fill" style="height:${(i.count/max*100).toFixed(1)}%">${i.count>0&&i.count===max?`<span class="bar-value">${i.count}</span>`:``}</div>
          </div>
          <div class="bar-label">${showLabel?escapeHtml(i.label):``}</div>
        </div>
      `}).join(``)}
    </div>
  `}const LINE_CHART_W=300,LINE_CHART_H=150;const LINE_CHART_PLOT={left:34,right:292,top:14,bottom:120};function renderLineChart(items){const plot=LINE_CHART_PLOT;const plotW=plot.right-plot.left,plotH=plot.bottom-plot.top;const stepX=items.length>1?plotW/(items.length-1):0;const points=items.map((it,idx)=>{const x=plot.left+idx*stepX;const y=plot.bottom-Math.min(Math.max(it.value,0),5)/5*plotH;return{x:+x.toFixed(1),y:+y.toFixed(1),label:it.label,value:it.value}});const yTicks=[0,2.5,5];const gridLines=yTicks.map(v=>{const y=plot.bottom-v/5*plotH;return`
      <line x1="${plot.left}" y1="${y}" x2="${plot.right}" y2="${y}" class="line-chart-grid" vector-effect="non-scaling-stroke"/>
      <text x="${plot.left-8}" y="${y}" class="line-chart-axis-label" text-anchor="end" dominant-baseline="middle">${v}</text>
    `}).join(``);const linePoints=points.map(p=>`${p.x},${p.y}`).join(` `);const areaPoints=`${plot.left},${plot.bottom} ${linePoints} ${plot.right},${plot.bottom}`;const lastIdx=points.length-1;const dots=points.map((p,idx)=>{const isLast=idx===lastIdx;return`
      ${isLast?`<circle cx="${p.x}" cy="${p.y}" r="9" class="line-chart-halo"/>`:``}
      <circle cx="${p.x}" cy="${p.y}" r="${isLast?4.5:3.5}" class="line-chart-dot${isLast?` line-chart-dot-last`:``}" data-label="${escapeHtml(p.label)}" data-value="${p.value}"/>
    `}).join(``);const maxLabels=6;const labelStep=Math.max(1,Math.ceil(lastIdx/(maxLabels-1))||1);const shownLabelIdx=new Set;for(let i=0;i<lastIdx;i+=labelStep)shownLabelIdx.add(i);let ordered=[...shownLabelIdx].sort((a,b)=>a-b);while(ordered.length&&lastIdx-ordered[ordered.length-1]<labelStep){shownLabelIdx.delete(ordered.pop())}shownLabelIdx.add(0);shownLabelIdx.add(lastIdx);const labelsHtml=points.map((p,idx)=>{if(!shownLabelIdx.has(idx))return``;const pct=(plotW===0?0:(p.x-plot.left)/plotW*100).toFixed(2);const edge=idx===0?`start`:idx===lastIdx?`end`:`mid`;return`<span class="line-chart-label" style="left:${pct}%" data-edge="${edge}">${escapeHtml(p.label)}</span>`}).join(``);return`
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
        <rect x="${plot.left}" y="0" width="${plot.right-plot.left}" height="${LINE_CHART_H}" fill="transparent" class="line-chart-capture"/>
      </svg>
      <div class="line-chart-tooltip" hidden></div>
      <div class="line-chart-labels">${labelsHtml}</div>
    </div>
  `}function wireLineChart(root){root.querySelectorAll(`.line-chart`).forEach(chart=>{const svg=chart.querySelector(`.line-chart-svg`);const capture=chart.querySelector(`.line-chart-capture`);const crosshair=chart.querySelector(`.line-chart-crosshair`);const tooltip=chart.querySelector(`.line-chart-tooltip`);if(!svg||!capture)return;const points=Array.from(chart.querySelectorAll(`.line-chart-dot`)).map(dot=>({x:parseFloat(dot.getAttribute(`cx`)),label:dot.dataset.label,value:parseFloat(dot.dataset.value)}));if(points.length===0)return;function nearestPoint(clientX){const rect=svg.getBoundingClientRect();const scale=LINE_CHART_W/rect.width;const svgX=(clientX-rect.left)*scale;return points.reduce((best,p)=>Math.abs(p.x-svgX)<Math.abs(best.x-svgX)?p:best,points[0])}function showAt(clientX){const p=nearestPoint(clientX);const rect=svg.getBoundingClientRect();const scale=rect.width/LINE_CHART_W;crosshair.setAttribute(`x1`,p.x);crosshair.setAttribute(`x2`,p.x);crosshair.hidden=false;tooltip.textContent=`${p.label} · ${p.value.toFixed(1)} / 5`;tooltip.hidden=false;tooltip.style.left=p.x*scale+`px`;tooltip.style.top=LINE_CHART_PLOT.top*scale+`px`}function hide(){crosshair.hidden=true;tooltip.hidden=true}capture.addEventListener(`pointermove`,e=>showAt(e.clientX));capture.addEventListener(`pointerdown`,e=>showAt(e.clientX));capture.addEventListener(`pointerleave`,hide)})}function genreMonthRowHtml(g){return`
    <div class="genre-month-row">
      <span class="genre-month-label">${monthLabel(g.month)}</span>
      <span class="genre-month-genre">${escapeHtml(GENRE_MAP[g.genreId]||`Genre inconnu`)}</span>
      <span class="genre-month-count">${g.count} film${g.count>1?`s`:``}</span>
    </div>
  `}function statsFilmRowHtml(f){const note=getDisplayNote(f);return`
    <div class="film-row friend-film-row" data-film-id="${f.id}">
      ${f.posterUrl?`<img class="film-poster" src="${escapeHtml(f.posterUrl)}" alt="" loading="lazy">`:`<div class="film-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="film-main">
        <div class="film-title">${escapeHtml(f.title)}</div>
        <div class="film-sub">${f.releaseYear||``}</div>
      </div>
      <div class="counter ${noteColorClass(note)}">${note!==null?note.toFixed(1):`—`}</div>
    </div>
  `}function wireStatsDistribution(content,list,distribution){const section=content.querySelector(`.stats-section-dist`);if(!section)return;const drilldown=section.querySelector(`.stats-drilldown`);let openValue=null;section.querySelectorAll(`.bar-col-clickable`).forEach(col=>{const activate=()=>{const value=distribution[parseInt(col.dataset.index,10)].value;section.querySelectorAll(`.bar-col`).forEach(c=>c.classList.remove(`bar-col-active`));if(openValue===value){openValue=null;drilldown.hidden=true;drilldown.innerHTML=``;return}openValue=value;col.classList.add(`bar-col-active`);const matches=list.filter(f=>getDisplayNote(f)===value);drilldown.innerHTML=`
        <div class="stats-drilldown-title">Notés ${value.toFixed(1)} (${matches.length})</div>
        ${matches.map(statsFilmRowHtml).join(``)}
      `;drilldown.hidden=false;drilldown.querySelectorAll(`.friend-film-row[data-film-id]`).forEach(row=>{makeRowClickable(row,()=>{const film=matches.find(f=>f.id===Number(row.dataset.filmId));if(film)openFilmReviewDetail(film)})})};col.addEventListener(`click`,activate);col.addEventListener(`keydown`,e=>{if(e.key===`Enter`||e.key===` `){e.preventDefault();activate()}})})}function critRadarPoint(index,total,radius,cx,cy){const angle=-Math.PI/2+index*(2*Math.PI/total);return{x:cx+radius*Math.cos(angle),y:cy+radius*Math.sin(angle)}}const CRIT_RADAR_SHORT_LABEL={esthetique:`Esthétique`,ressenti:`Ressenti`};function renderCritRadar(critObj){const cx=100,cy=96,maxRadius=72;const n=CRITERIA.length;const values=CRITERIA.map(c=>critObj&&typeof critObj[c.key]===`number`?critObj[c.key]:0);const gridRings=[1/3,2/3,1].map(frac=>{const pts=Array.from({length:n},(_,i)=>critRadarPoint(i,n,maxRadius*frac,cx,cy));return`<polygon points="${pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(` `)}" fill="none" stroke="var(--line)" stroke-width="1" vector-effect="non-scaling-stroke"/>`}).join(``);const axisLines=Array.from({length:n},(_,i)=>{const p=critRadarPoint(i,n,maxRadius,cx,cy);return`<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="var(--line)" stroke-width="1" vector-effect="non-scaling-stroke"/>`}).join(``);const dataPoints=values.map((v,i)=>critRadarPoint(i,n,Math.max(v,.03)*maxRadius,cx,cy));const dataPolygon=`<polygon points="${dataPoints.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(` `)}" fill="var(--violet)" fill-opacity="0.25" stroke="var(--violet)" stroke-width="2" vector-effect="non-scaling-stroke"/>`;const dataDots=dataPoints.map((p,i)=>`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="var(--violet)"><title>${escapeHtml(CRITERIA[i].label)} : ${values[i].toFixed(2)}</title></circle>`).join(``);const labels=Array.from({length:n},(_,i)=>{const p=critRadarPoint(i,n,maxRadius+16,cx,cy);const anchor=Math.abs(p.x-cx)<8?`middle`:p.x>cx?`start`:`end`;const label=CRIT_RADAR_SHORT_LABEL[CRITERIA[i].key]||CRITERIA[i].label;return`<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" class="crit-radar-label">${escapeHtml(label)}</text>`}).join(``);return`
    <svg viewBox="0 0 200 192" class="crit-radar-svg">
      ${gridRings}
      ${axisLines}
      ${dataPolygon}
      ${dataDots}
      ${labels}
    </svg>
  `}function critReviewRowHtml(label,val){const clamped=Math.max(0,Math.min(1,val));const pct=Math.round(clamped*100);return`
    <div class="crit-review-row">
      <div class="crit-review-row-top">
        <span class="crit-review-label">${escapeHtml(label)}</span>
        <span class="crit-review-value">${clamped.toFixed(2)}</span>
      </div>
      <div class="crit-review-bar"><div class="crit-review-fill" style="width:${pct}%"></div></div>
    </div>
  `}function openFilmReviewDetail(film){const content=document.getElementById(`filmReviewContent`);const note=getDisplayNote(film);const isManual=film.manualNote!=null;const posterHtml=film.posterUrl?`<img class="film-poster" src="${escapeHtml(film.posterUrl)}" alt="" loading="lazy">`:`<div class="film-poster film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`;const hasCrit=!!(film.crit&&Object.keys(film.crit).length>0);const critHtml=!hasCrit?`<div class="wl-note">Note manuelle : pas de détail par critère.</div>`:`<div class="crit-review-list">${CRITERIA.map(c=>critReviewRowHtml(c.label,film.crit&&typeof film.crit[c.key]===`number`?film.crit[c.key]:0)).join(``)}</div>`;content.innerHTML=`
    <div class="film-review-layout">
      <div class="film-review-poster-col">
        ${posterHtml}
        ${hasCrit?renderCritRadar(film.crit):``}
      </div>
      <div class="film-review-main-col">
        <div class="film-review-title">${escapeHtml(film.title)}</div>
        <div class="film-review-year">${film.releaseYear||``}</div>
        <div class="crit-dial-hero">
          <div class="counter crit-dial-hero-counter ${noteColorClass(note)}">${note!==null?note.toFixed(1):`—`}</div>
          <div class="crit-dial-hero-text">
            <div class="crit-dial-hero-label">Note globale</div>
            <div class="crit-dial-hero-hint">${note!==null?`${note.toFixed(1)} / 5`:`Pas encore notée`}</div>
          </div>
        </div>
        ${critHtml}
        <div class="stats-section-title">Commentaire</div>
        ${film.review?`<div class="crit-review-comment">${escapeHtml(film.review)}</div>`:`<div class="tmdb-empty">Pas de commentaire.</div>`}
        ${film.tmdbId?`<button class="btn secondary film-review-open-detail" type="button" data-tmdb-id="${film.tmdbId}">Voir la fiche du film</button>`:``}
      </div>
    </div>
  `;const detailBtn=content.querySelector(`.film-review-open-detail`);if(detailBtn){detailBtn.addEventListener(`click`,()=>{closeFilmReview();goToFilmDetail(parseInt(detailBtn.dataset.tmdbId,10))})}openOverlay(`filmReviewOverlay`)}function closeFilmReview(){closeOverlay(`filmReviewOverlay`)}document.getElementById(`closeFilmReview`).addEventListener(`click`,closeFilmReview);document.getElementById(`filmReviewOverlay`).addEventListener(`click`,e=>{if(e.target.id===`filmReviewOverlay`)closeFilmReview()});function renderYearComparison(){const thisYear=new Date().getFullYear();const lastYear=thisYear-1;const curr=computeRecap(thisYear);const prev=computeRecap(lastYear);if(!curr&&!prev)return``;const yearColHtml=(recap,year)=>recap?`
    <div class="year-compare-col">
      <div class="year-compare-year">${year}</div>
      <div class="year-compare-total">${recap.total}</div>
      <div class="year-compare-sub">${recap.total>1?`films vus`:`film vu`}</div>
      <div class="year-compare-avg">${recap.avgNote!=null?recap.avgNote.toFixed(1):`—`}<span class="year-compare-avg-unit"> / 5</span></div>
      ${recap.topGenreLabel?`<div class="year-compare-genre">${escapeHtml(recap.topGenreLabel)}</div>`:``}
    </div>
  `:`
    <div class="year-compare-col year-compare-col-empty">
      <div class="year-compare-year">${year}</div>
      <div class="tmdb-empty">Rien de vu cette année-là.</div>
    </div>
  `;const delta=curr&&prev?curr.total-prev.total:null;const deltaHtml=delta!==null&&delta!==0?`
    <div class="year-compare-delta ${delta>0?`is-up`:`is-down`}">${delta>0?`▲`:`▼`} ${Math.abs(delta)} film${Math.abs(delta)>1?`s`:``} ${delta>0?`de plus`:`de moins`} qu'en ${lastYear}</div>
  `:``;return`
    <div class="stats-section reveal">
      <div class="stats-section-title">Cette année vs l'année dernière</div>
      <div class="year-compare-grid">
        ${yearColHtml(curr,thisYear)}
        ${yearColHtml(prev,lastYear)}
      </div>
      ${deltaHtml}
    </div>
  `}function rythmeAnnuel(s){const annee=String(new Date().getFullYear());const mois=s.activity.filter(a=>a.month.startsWith(annee));if(mois.length===0)return`—`;const total=mois.reduce((acc,a)=>acc+a.count,0);return(total/mois.length).toFixed(1)}let recapTimer=null;function openYearRecap(){const annee=new Date().getFullYear();const cetteAnnee=films.filter(f=>new Date(f.added).getFullYear()===annee&&getDisplayNote(f)!=null);const notes=cetteAnnee.map(f=>getDisplayNote(f));const moyenne=notes.length?notes.reduce((a,b)=>a+b,0)/notes.length:null;const meilleur=cetteAnnee.slice().sort((a,b)=>getDisplayNote(b)-getDisplayNote(a))[0];const genres={};cetteAnnee.forEach(f=>(f.genreIds||[]).forEach(id=>{const nom=GENRE_MAP[id];if(nom)genres[nom]=(genres[nom]||0)+1}));const genreFavori=Object.entries(genres).sort((a,b)=>b[1]-a[1])[0];const ecrans=[`<div class="recap-big">${annee}</div><div class="recap-line">Tu as noté <b class="recap-count">${cetteAnnee.length}</b> film${cetteAnnee.length>1?`s`:``} cette année.</div>`,moyenne!==null?`<div class="recap-line">Ta note moyenne</div><div class="recap-big">${moyenne.toFixed(2)}<span class="recap-unit"> / 5</span></div>`:`<div class="recap-line">Pas encore de note cette année.</div>`,meilleur?`<div class="recap-line">Ton film le mieux noté</div><div class="recap-big recap-title">${escapeHtml(meilleur.title)}</div><div class="recap-line">${getDisplayNote(meilleur).toFixed(2)} / 5</div>`:`<div class="recap-line">Aucun film à mettre en avant pour l'instant.</div>`,genreFavori?`<div class="recap-line">Ton genre le plus présent</div><div class="recap-big recap-title">${escapeHtml(genreFavori[0])}</div><div class="recap-line">${genreFavori[1]} film${genreFavori[1]>1?`s`:``}</div>`:`<div class="recap-line">Merci d'avoir noté tes films cette année.</div>`,`<div class="recap-big recap-title">Ton année ${annee}</div><div class="recap-line">${cetteAnnee.length} film${cetteAnnee.length>1?`s`:``} noté${cetteAnnee.length>1?`s`:``}${moyenne!==null?`, ${moyenne.toFixed(1)} de moyenne`:``}</div><button class="btn recap-share" id="recapShareImageBtn" type="button">Partager en image</button>`];const slides=document.getElementById(`recapAnneeSlides`);const dots=document.getElementById(`recapAnneeDots`);slides.innerHTML=ecrans.map((html,i)=>`<div class="recap-slide${i===0?` active`:``}" data-i="${i}">${html}</div>`).join(``);dots.innerHTML=ecrans.map((_,i)=>`<span class="recap-dot${i===0?` active`:``}"></span>`).join(``);openOverlay(`recapAnneeOverlay`);slides.querySelector(`#recapShareImageBtn`).addEventListener(`click`,e=>{e.stopPropagation();clearInterval(recapTimer);closeOverlay(`recapAnneeOverlay`,()=>openRecap())});let courant=0;const montrer=i=>{courant=i%ecrans.length;slides.querySelectorAll(`.recap-slide`).forEach((el,k)=>el.classList.toggle(`active`,k===courant));dots.querySelectorAll(`.recap-dot`).forEach((el,k)=>el.classList.toggle(`active`,k===courant));if(courant===0)animateCounters(slides);if(courant===ecrans.length-1)clearInterval(recapTimer)};animateCounters(slides);clearInterval(recapTimer);recapTimer=setInterval(()=>montrer(courant+1),motionReduced()?6e3:3800);document.getElementById(`recapAnneeModal`).onclick=()=>{clearInterval(recapTimer);montrer(courant+1)}}document.getElementById(`recapAnneeClose`).addEventListener(`click`,()=>{clearInterval(recapTimer);closeOverlay(`recapAnneeOverlay`)});function renderCatalogueControle(content,list){const sansAffiche=list.filter(f=>!f.posterUrl);const parTmdb=new Map;list.forEach(f=>{if(f.tmdbId)parTmdb.set(f.tmdbId,(parTmdb.get(f.tmdbId)||0)+1)});const doublons=[...parTmdb.values()].filter(n=>n>1).length;if(sansAffiche.length===0&&doublons===0)return;const lignes=[];if(sansAffiche.length)lignes.push(`${sansAffiche.length} film${sansAffiche.length>1?`s`:``} sans affiche, par exemple : ${sansAffiche.slice(0,3).map(f=>`« ${escapeHtml(f.title)} »`).join(`, `)}.`);if(doublons)lignes.push(`${doublons} film${doublons>1?`s`:``} présent${doublons>1?`s`:``} deux fois dans ton catalogue (même film TMDB).`);const bloc=document.createElement(`div`);bloc.className=`stats-section reveal`;bloc.innerHTML=`<div class="stats-section-title">Contrôle du catalogue</div><div class="wl-note">${lignes.map(l=>`<div>${l}</div>`).join(``)}</div>`;content.appendChild(bloc)}function renderStatsInto(content,list=films){const s=computeStats(list);if(s.total===0){content.innerHTML=`<div class="empty-state">Aucun film noté pour l'instant.</div>`;return}const distItems=s.distribution.map(d=>({label:d.value.toFixed(1),count:d.count}));const activityItems=s.activity.map(a=>({label:monthLabel(a.month),count:a.count}));content.classList.add(`reveal-stagger`);content.innerHTML=`
    <!-- Audit M10 : quatre chiffres sur une ligne, en blanc. « Grille 7
         critères » et « Note manuelle » retirés (retour du 14/10 : le mode
         de notation n'intéresse pas). -->
    <div class="stat-tiles stat-tiles-4 reveal">
      <div class="stat-tile"><div class="stat-value">${s.rated}</div><div class="stat-label">Films notés</div></div>
      <div class="stat-tile"><div class="stat-value">${s.avg!==null?s.avg.toFixed(1):`—`}</div><div class="stat-label">Note moyenne</div></div>
      <div class="stat-tile"><div class="stat-value">${s.favCount}</div><div class="stat-label">Favoris</div></div>
      <div class="stat-tile"><div class="stat-value">${rythmeAnnuel(s)}</div><div class="stat-label">Films par mois actif (${new Date().getFullYear()})</div></div>
    </div>

    ${list===films?renderYearComparison():``}

    ${list===films?`<div class="stats-section reveal" id="dnaSection" hidden></div>`:``}

    <div class="stats-section stats-section-dist reveal">
      <div class="stats-section-title">Distribution des notes</div>
      ${renderBarChart(distItems,{clickable:true})}
      <div class="stats-drilldown" hidden></div>
    </div>

    ${activityItems.length>1?`
    <div class="stats-section reveal">
      <div class="stats-section-title">Films ajoutés par mois</div>
      ${renderBarChart(activityItems,{maxLabels:8})}
    </div>`:``}

    ${s.noteEvolution.length>1?`
    <div class="stats-section reveal">
      <div class="stats-section-title">Évolution de la note moyenne</div>
      ${renderLineChart(s.noteEvolution.map(n=>({label:monthLabel(n.month),value:n.avg})))}
    </div>`:``}

    ${s.genreByMonth.length>0?`
    <div class="stats-section reveal">
      <div class="stats-section-title">Genre dominant par mois</div>
      <div id="genreByMonthList"></div>
    </div>`:``}

    <div class="stats-section stats-extremes reveal">
      ${s.best?`
      <div class="stats-extreme stats-extreme-best">
        ${s.best.posterUrl?`<img class="stats-extreme-poster" src="${escapeHtml(s.best.posterUrl)}" alt="" loading="lazy">`:`<div class="stats-extreme-poster stats-extreme-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
        <div class="stats-extreme-info">
          <div class="stats-extreme-label">Mieux noté</div>
          <div class="stats-extreme-title">${escapeHtml(s.best.title)}</div>
          <div class="stats-extreme-note">${getDisplayNote(s.best).toFixed(1)} / 5</div>
        </div>
      </div>`:``}
      ${s.worst&&s.worst!==s.best?`
      <div class="stats-extreme">
        ${s.worst.posterUrl?`<img class="stats-extreme-poster" src="${escapeHtml(s.worst.posterUrl)}" alt="" loading="lazy">`:`<div class="stats-extreme-poster stats-extreme-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
        <div class="stats-extreme-info">
          <div class="stats-extreme-label">Moins bien noté</div>
          <div class="stats-extreme-title">${escapeHtml(s.worst.title)}</div>
          <div class="stats-extreme-note">${getDisplayNote(s.worst).toFixed(1)} / 5</div>
        </div>
      </div>`:``}
    </div>
  `;wireStatsDistribution(content,list,s.distribution);wireLineChart(content);if(list===films)renderCatalogueControle(content,list);if(list===films&&typeof renderDnaSection===`function`)renderDnaSection();animateCounters(content.querySelector(`.stat-tiles`));if(list===films){const lien=document.createElement(`button`);lien.type=`button`;lien.className=`year-link`;lien.id=`openYearRecapBtn`;lien.textContent=`Ton année ${new Date().getFullYear()} ›`;content.insertBefore(lien,content.firstChild);lien.addEventListener(`click`,openYearRecap)}const genreByMonthEl=content.querySelector(`#genreByMonthList`);if(genreByMonthEl){renderCollapsible(genreByMonthEl,s.genreByMonth.slice().reverse(),genreMonthRowHtml,{previewCount:6})}}function renderStats(){const content=document.getElementById(`statsContent`);renderStatsInto(content,films);observeReveal(content)}function openStats(){closeProfileModal();renderStats();openOverlay(`statsOverlay`)}function closeStats(){closeOverlay(`statsOverlay`,()=>returnToProfile())}document.getElementById(`statsBtn`).addEventListener(`click`,openStats);document.getElementById(`closeStats`).addEventListener(`click`,closeStats);document.getElementById(`statsOverlay`).addEventListener(`click`,e=>{if(e.target.id===`statsOverlay`)closeStats()});