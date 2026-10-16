// --- Notation en pas à pas (audit des six écrans, piste B choisie le 16/10) ---
// La fenêtre #overlay ne montre plus la grille entière : pour un nouveau film,
// un critère à la fois, en grand, avec ses trois repères ; puis un résumé où
// l'on relit tout (chaque critère se touche pour y revenir), avec le
// commentaire, « Privé » et les visionnages. Un film déjà noté s'ouvre sur ce
// résumé, ou sur sa note directe s'il a été noté sans critères.
//
// Les anciens champs restent dans la page, cachés, comme modèle de données :
// les curseurs #slider-<critère> (buildCriteriaInputs(), js/app.js),
// #manualToggle et #manualScoreSlider. Cet écran les règle ; handleSave()
// les lit comme avant.

let ntScreen = 'step';   // 'pick' (choisir le film) | 'step' | 'summary' | 'direct'
let ntStep = 0;          // critère affiché, de 0 à CRITERIA.length - 1
let ntDirectTouched = false;
let ntFirstViewDate = ''; // « Vu le » d'un nouveau film, AAAA-MM-JJ

function ntTodayIso(){ return new Date().toISOString().slice(0, 10); }

// Les trois repères d'un critère (0, 2.5 et 5), tirés de CRITERIA.anchors
// (« 0 → incohérente…\n0.5 → …\n1 → … », écrits sur l'ancienne échelle 0-1).
function ntAnchors(c){
  return String(c.anchors || '').split('\n')
    .map(l => l.replace(/^\s*[\d.]+\s*→\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

function ntCritValue(key){
  const el = document.getElementById('slider-' + key);
  return el ? parseFloat(el.value) : 0.5;
}
function ntSetCritValue(key, v){
  const el = document.getElementById('slider-' + key);
  if(el) el.value = v;
  const val = document.getElementById('val-' + key);
  if(val) val.value = critToDisplay(v);
  critPristine = false;
  critTouched = true;
}
function ntCurrentNote(){
  if(isManualMode()) return (ntScreen === 'direct' && !ntDirectTouched && !editingId) ? null : parseFloat(document.getElementById('manualScoreSlider').value);
  return critPristine ? null : computeNote(readCriteriaFromForm());
}
function ntFilmHasCrit(film){
  return !!(film && film.crit && CRITERIA.some(c => typeof film.crit[c.key] === 'number'));
}

// Appelée par openModal() (js/app.js) après le remplissage des anciens champs.
function ntOpen(film){
  ntStep = 0;
  ntDirectTouched = false;
  ntFirstViewDate = ntTodayIso();
  const hasNote = !!film && getDisplayNote(film) !== null;
  const hasCrit = ntFilmHasCrit(film);
  const manual = document.getElementById('manualToggle');
  if(!film && !tmdbSelected){
    ntScreen = 'pick';
  }else if(hasNote && hasCrit && (film.manualNote == null || film.manualNote === computeNote(film.crit))){
    // Grille et note directe égales (les 52 films de l'audit N1) : le résumé
    // des critères, qui donne la même note.
    ntScreen = 'summary';
    manual.checked = false;
  }else if(hasNote && film.manualNote != null){
    ntScreen = 'direct';
    manual.checked = true;
    ntDirectTouched = true;
  }else{
    ntScreen = 'step';
    manual.checked = false;
  }
  ntRender();
}

// Une fiche TMDB vient d'être choisie ou retirée (updateTmdbSelectedUI(), js/tmdb.js).
function ntOnFilmChosen(){
  if(!document.getElementById('ntBody')) return;
  if(ntScreen === 'pick' && tmdbSelected){ ntScreen = 'step'; ntStep = 0; }
  else if(!tmdbSelected && !editingId){ ntScreen = 'pick'; }
  ntRender();
}

function ntGo(screen, step){
  ntScreen = screen;
  if(step !== undefined) ntStep = step;
  const manual = document.getElementById('manualToggle');
  if(screen === 'direct'){
    manual.checked = true;
    // Point de départ : la note directe existante, sinon la note des critères.
    if(!ntDirectTouched){
      const fromCrit = critPristine ? null : computeNote(readCriteriaFromForm());
      if(fromCrit !== null) document.getElementById('manualScoreSlider').value = Math.max(0.5, fromCrit);
    }
  }else if(screen === 'step' || screen === 'summary'){
    manual.checked = false;
  }
  ntRender();
  const scroll = document.getElementById('ntScroll');
  if(scroll) scroll.scrollTop = 0;
}

function ntHeaderHtml(){
  const film = editingId ? films.find(f => f.id === editingId) : null;
  const title = film ? film.title : (tmdbSelected ? tmdbSelected.title : 'Noter un film');
  const year = film ? film.releaseYear : (tmdbSelected ? tmdbSelected.release_year : null);
  document.getElementById('ntTitle').textContent = title;
  const genres = ((film && film.genreIds) || (tmdbSelected && tmdbSelected.genre_ids) || []).map(id => GENRE_MAP[id]).filter(Boolean).slice(0, 2).join(', ');
  document.getElementById('ntSub').textContent = [year, genres].filter(Boolean).join(' · ');
}

function ntStepHtml(){
  const c = CRITERIA[ntStep];
  const v = ntCritValue(c.key);
  const anchors = ntAnchors(c);
  const neutral = critPristine;
  return `
    <div class="nt-steps" aria-hidden="true">${CRITERIA.map((x, i) => `<i class="${i <= ntStep ? 'on' : ''}"></i>`).join('')}</div>
    <div class="nt-step">
      <span class="nt-step-count">Critère ${ntStep + 1} sur ${CRITERIA.length}</span>
      <h3 class="nt-step-label">${escapeHtml(c.label)}</h3>
      <p class="nt-step-def">${escapeHtml(c.def)}</p>
      <div class="nt-step-val num ${neutral ? '' : noteColorClass(v * CRIT_DISPLAY_SCALE)}" id="ntStepVal">${critToDisplay(v)}</div>
      <input type="range" class="nt-range nt-range-big${neutral ? ' is-unset' : ''}" min="0" max="1" step="0.1" value="${v}" data-nt-crit="${c.key}" aria-label="${escapeHtml(c.label)}, sur 5">
      <div class="nt-anchors">
        <div><b>0</b>${escapeHtml(anchors[0] || '')}</div>
        <div><b>2.5</b>${escapeHtml(anchors[1] || '')}</div>
        <div><b>5</b>${escapeHtml(anchors[2] || '')}</div>
      </div>
    </div>`;
}

function ntSummaryHtml(){
  const note = ntCurrentNote();
  return `
    <div class="nt-score">
      <span class="counter nt-ring ${note === null ? '' : noteColorClass(note)}" id="ntRing">${note === null ? '—' : note.toFixed(1)}</span>
      <div><b>Ta note</b><small>${note === null ? 'Règle au moins un critère' : 'calculée sur tes 7 critères'}</small></div>
    </div>
    <div class="nt-sum">${CRITERIA.map((c, i) => {
      const v = ntCritValue(c.key);
      return `<button type="button" class="nt-sumrow" data-nt-goto="${i}"><span>${escapeHtml(critShortLabel(c.key))}</span><i><b style="width:${critPristine ? 0 : Math.round(v * 100)}%"></b></i><span class="num">${critPristine ? '—' : critToDisplay(v)}</span></button>`;
    }).join('')}</div>
    <p class="nt-hint">Touche un critère pour y revenir. <button type="button" class="ff-link" data-nt-direct>Note directe</button></p>`;
}

function ntDirectHtml(){
  const film = editingId ? films.find(f => f.id === editingId) : null;
  const v = parseFloat(document.getElementById('manualScoreSlider').value);
  const unset = !ntDirectTouched && !(film && film.manualNote != null);
  const hasCrit = ntFilmHasCrit(film) || !critPristine;
  return `
    <h3 class="nt-direct-title">Note directe</h3>
    <div class="nt-direct">
      <div class="nt-direct-val num ${unset ? '' : noteColorClass(v)}" id="ntDirectVal">${unset ? '—' : v.toFixed(1)}</div>
      <input type="range" class="nt-range nt-range-big${unset ? ' is-unset' : ''}" min="0.5" max="5" step="0.5" value="${v}" data-nt-direct-range aria-label="Note directe">
      <div class="nt-scale"><span>0.5</span><span>2.5</span><span>5</span></div>
      <p class="nt-hint">${hasCrit ? 'Sans passer par les critères. Ta grille reste enregistrée, mais c’est cette note qui compte.' : 'Sans passer par les critères.'}</p>
    </div>
    <button type="button" class="ff-link" data-nt-crit-mode>Noter par critères</button>`;
}

// Ligne des visionnages : « Vu une fois, le 21 août 2026 · Changer la date ·
// + Je l'ai revu ». Un nouveau film : « Vu aujourd'hui · Changer la date ».
function ntSeenLineHtml(){
  if(!editingId){
    const d = ntFirstViewDate && ntFirstViewDate !== ntTodayIso()
      ? `Vu le ${new Date(ntFirstViewDate + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`
      : 'Vu aujourd’hui';
    return `<span>${d}</span><button type="button" class="ff-link nt-link-quiet" data-nt-date>Changer la date</button>`;
  }
  const items = typeof viewingsForFilm === 'function' ? viewingsForFilm(editingId) : [];
  const last = items[items.length - 1];
  const fmt = (ts) => new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const text = !items.length ? 'Pas encore de visionnage' : items.length === 1 ? `Vu une fois, le ${fmt(last.watchedAt)}` : `Vu ${items.length} fois, la dernière le ${fmt(last.watchedAt)}`;
  return `<span>${text}</span>${last ? '<button type="button" class="ff-link nt-link-quiet" data-nt-date>Changer la date</button>' : ''}<button type="button" class="ff-link" data-nt-rewatch>+ Je l'ai revu</button>${items.length > 1 ? `<button type="button" class="ff-link nt-link-quiet" data-nt-all>Les ${items.length} visionnages</button>` : ''}`;
}

function ntRender(){
  const body = document.getElementById('ntBody');
  if(!body) return;
  ntHeaderHtml();
  const isNew = !editingId;
  document.getElementById('ntPick').hidden = ntScreen !== 'pick';
  document.getElementById('ntExtras').hidden = !(ntScreen === 'summary' || ntScreen === 'direct');
  body.hidden = ntScreen === 'pick';
  body.innerHTML = ntScreen === 'step' ? ntStepHtml() : ntScreen === 'summary' ? ntSummaryHtml() : ntScreen === 'direct' ? ntDirectHtml() : '';
  document.getElementById('ntSeenLine').innerHTML = ntSeenLineHtml();
  const show = (id, on) => { const el = document.getElementById(id); if(el) el.hidden = !on; };
  const inStep = ntScreen === 'step';
  show('ntDirectBtn', inStep);
  show('ntPrevBtn', inStep && ntStep > 0);
  show('ntNextBtn', inStep);
  show('saveBtn', ntScreen === 'summary' || ntScreen === 'direct');
  show('cancelBtn', !inStep);
  const next = document.getElementById('ntNextBtn');
  if(next) next.textContent = ntStep === CRITERIA.length - 1 ? 'Voir le résumé' : 'Suivant';
  show('ntChangeFilmBtn', isNew && ntScreen !== 'pick');
}

// Peut-on enregistrer ? (appelée en tête de handleSave())
function ntCanSave(){
  if(ntScreen === 'pick'){ showToast('Choisis d’abord un film'); return false; }
  if(ntScreen === 'summary' && critPristine){ showToast('Règle au moins un critère, ou passe en note directe'); return false; }
  if(ntScreen === 'direct' && !ntDirectTouched && !editingId){ showToast('Choisis une note'); return false; }
  return true;
}
// Date du premier visionnage d'un nouveau film (« Vu le »), en millisecondes.
function ntFirstViewTimestamp(fallback){
  if(ntFirstViewDate && ntFirstViewDate !== ntTodayIso()) return new Date(ntFirstViewDate + 'T12:00:00').getTime();
  return fallback;
}

function ntCloseMenu(){
  const menu = document.getElementById('ntMenu');
  if(menu) menu.hidden = true;
  const btn = document.getElementById('ntMoreBtn');
  if(btn) btn.setAttribute('aria-expanded', 'false');
}

// --- Câblage ---
{
  const body = document.getElementById('ntBody');
  body.addEventListener('input', (e) => {
    const r = e.target;
    if(r.dataset.ntCrit){
      const v = parseFloat(r.value);
      ntSetCritValue(r.dataset.ntCrit, v);
      r.classList.remove('is-unset');
      const out = document.getElementById('ntStepVal');
      if(out){ out.textContent = critToDisplay(v); out.className = 'nt-step-val num ' + noteColorClass(v * CRIT_DISPLAY_SCALE); }
    }else if(r.hasAttribute('data-nt-direct-range')){
      const v = parseFloat(r.value);
      document.getElementById('manualScoreSlider').value = v;
      document.getElementById('manualToggle').checked = true;
      ntDirectTouched = true;
      r.classList.remove('is-unset');
      const out = document.getElementById('ntDirectVal');
      if(out){ out.textContent = v.toFixed(1); out.className = 'nt-direct-val num ' + noteColorClass(v); }
    }
  });
  body.addEventListener('click', (e) => {
    const goto = e.target.closest('[data-nt-goto]');
    if(goto){ ntGo('step', parseInt(goto.dataset.ntGoto, 10)); return; }
    if(e.target.closest('[data-nt-direct]')){ ntGo('direct'); return; }
    if(e.target.closest('[data-nt-crit-mode]')){ ntGo(ntFilmHasCrit(editingId ? films.find(f => f.id === editingId) : null) || !critPristine ? 'summary' : 'step', 0); }
  });
  document.getElementById('ntNextBtn').addEventListener('click', () => {
    if(ntStep < CRITERIA.length - 1) ntGo('step', ntStep + 1);
    else ntGo('summary');
  });
  document.getElementById('ntPrevBtn').addEventListener('click', () => ntGo('step', Math.max(0, ntStep - 1)));
  document.getElementById('ntDirectBtn').addEventListener('click', () => ntGo('direct'));

  // Visionnages
  const seenLine = document.getElementById('ntSeenLine');
  const seenDate = document.getElementById('ntSeenDate');
  seenLine.addEventListener('click', async (e) => {
    if(e.target.closest('[data-nt-date]')){
      const items = editingId && typeof viewingsForFilm === 'function' ? viewingsForFilm(editingId) : [];
      const last = items[items.length - 1];
      seenDate.max = ntTodayIso();
      seenDate.value = editingId ? (last ? new Date(last.watchedAt).toISOString().slice(0, 10) : ntTodayIso()) : ntFirstViewDate;
      seenDate.hidden = false;
      if(seenDate.showPicker){ try{ seenDate.showPicker(); }catch(err){} }
      seenDate.focus();
      return;
    }
    if(e.target.closest('[data-nt-rewatch]')){
      if(blockIfOffline()) return;
      const v = await addViewing(editingId, Date.now());
      if(v){ showToast('Visionnage ajouté, daté d’aujourd’hui'); renderViewingsSection(editingId); ntRender(); if(typeof render === 'function') render(); }
      return;
    }
    if(e.target.closest('[data-nt-all]')){
      const list = document.getElementById('viewingsList');
      list.hidden = !list.hidden;
    }
  });
  seenDate.addEventListener('change', async () => {
    const value = seenDate.value;
    seenDate.hidden = true;
    if(!value || value > ntTodayIso()) return;
    if(!editingId){ ntFirstViewDate = value; ntRender(); return; }
    const items = viewingsForFilm(editingId);
    const last = items[items.length - 1];
    if(!last) return;
    if(await updateViewingDate(last.id, new Date(value + 'T12:00:00').getTime())){
      renderViewingsSection(editingId);
      ntRender();
      if(typeof render === 'function') render();
    }
  });

  // Menu « ⋯ » du pied : voir la fiche, changer de film, supprimer.
  const moreBtn = document.getElementById('ntMoreBtn');
  moreBtn.innerHTML = uiIcon('dots');
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('ntMenu');
    menu.hidden = !menu.hidden;
    moreBtn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.getElementById('ntMenu').addEventListener('click', () => ntCloseMenu());
  document.addEventListener('click', (e) => { if(!e.target.closest || !e.target.closest('.nt-more')) ntCloseMenu(); });
  document.getElementById('ntChangeFilmBtn').addEventListener('click', () => {
    clearTmdbSelection();
    document.getElementById('titleInput').value = '';
    ntGo('pick');
    document.getElementById('titleInput').focus();
  });
}
