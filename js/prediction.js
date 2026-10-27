// --- Ta note prévue (idée 6 du 28/10) ---
// Sur la fiche d'un film, la note que tu lui mettrais probablement, tirée de
// tes propres notes : ta moyenne, ta façon de suivre (ou pas) la note TMDB,
// puis tes écarts habituels sur ses genres et ses réalisateurs. Pour un film
// déjà noté, la même estimation sans lui, et l'écart avec ta vraie note.
//
// Petit modèle, volontairement simple : une droite note ~ note TMDB (si au
// moins 10 films notés ont une note TMDB fiable), puis les écarts restants
// moyennés par genre et par réalisateur, rapprochés de zéro quand ils
// reposent sur peu de films (on ne conclut rien d'un seul film). Les durées,
// genres et réalisateurs viennent de fetchFilmFacts() (js/tmdb.js), gardés
// sur l'appareil.

const PREDICTION_MIN_FILMS = 8;
const PREDICTION_MIN_VOTES = 50;      // en dessous, la note TMDB ne dit pas grand-chose
const PREDICTION_GENRE_SHRINK = 3;    // « films fantômes » à écart nul ajoutés par genre
const PREDICTION_DIRECTOR_SHRINK = 2;
const PREDICTION_GENRE_WEIGHT = 0.7;

const predMean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const predFr = (x) => x.toFixed(1).replace('.', ',');
const predReliableVote = (f) => !!(f && typeof f.vote === 'number' && f.votes >= PREDICTION_MIN_VOTES);

// rated : [{ note, genres: [ids], facts? }] ; target : { genres, facts? }.
// Renvoie { note, base, parts: [{ label, value }] } ou null (trop peu de films).
function predictNote(target, rated){
  if(rated.length < PREDICTION_MIN_FILMS) return null;
  const mu = predMean(rated.map(r => r.note));
  let a = mu, b = 0, meanVote = null;
  const withVote = rated.filter(r => predReliableVote(r.facts));
  if(withVote.length >= 10){
    const xs = withVote.map(r => r.facts.vote), ys = withVote.map(r => r.note);
    const mx = predMean(xs), my = predMean(ys);
    let cov = 0, varx = 0;
    xs.forEach((x, i) => { cov += (x - mx) * (ys[i] - my); varx += (x - mx) * (x - mx); });
    b = varx > 0 ? Math.max(0, Math.min(1.2, cov / varx)) : 0;
    b *= withVote.length / (withVote.length + 10); // prudence avec peu de films
    a = my - b * mx;
    meanVote = mx;
  }
  const baseOf = (facts) => (b && predReliableVote(facts) ? a + b * facts.vote : mu);
  const resid = rated.map(r => ({ r, e: r.note - baseOf(r.facts) }));
  const parts = [];

  const base = baseOf(target.facts);
  if(b && predReliableVote(target.facts) && meanVote !== null){
    parts.push({ kind: 'tmdb', label: `la note TMDB (${predFr(target.facts.vote)})`, value: b * (target.facts.vote - meanVote) });
  }

  const genreEffects = (target.genres || []).map(g => {
    const hits = resid.filter(x => (x.r.genres || []).includes(g));
    if(!hits.length) return null;
    return { g, value: hits.reduce((s, x) => s + x.e, 0) / (hits.length + PREDICTION_GENRE_SHRINK) };
  }).filter(Boolean);
  const genreEffect = genreEffects.length ? PREDICTION_GENRE_WEIGHT * predMean(genreEffects.map(x => x.value)) : 0;
  genreEffects.forEach(x => {
    const name = typeof GENRE_MAP !== 'undefined' && GENRE_MAP[x.g];
    if(name) parts.push({ kind: 'genre', label: name, value: PREDICTION_GENRE_WEIGHT * x.value / genreEffects.length });
  });

  const directors = (target.facts && target.facts.directors) || [];
  const dirEffects = directors.map(d => {
    const hits = resid.filter(x => x.r.facts && (x.r.facts.directors || []).some(o => o.id === d.id));
    if(!hits.length) return null;
    return { name: d.name, value: hits.reduce((s, x) => s + x.e, 0) / (hits.length + PREDICTION_DIRECTOR_SHRINK) };
  }).filter(Boolean);
  const dirEffect = dirEffects.length ? predMean(dirEffects.map(x => x.value)) : 0;
  dirEffects.forEach(x => parts.push({ kind: 'director', label: x.name, value: x.value / dirEffects.length }));

  const note = Math.max(0.5, Math.min(5, base + genreEffect + dirEffect));
  return { note: Math.round(note * 10) / 10, mean: mu, parts: parts.sort((p, q) => Math.abs(q.value) - Math.abs(p.value)) };
}

// « d'après tes notes en Science-fiction et sur Denis Villeneuve » : les deux
// raisons qui pèsent le plus, sinon ta moyenne.
function predictionReason(pred){
  const strong = pred.parts.filter(p => Math.abs(p.value) >= 0.1).slice(0, 2);
  if(!strong.length) return 'd’après ta moyenne';
  const bits = strong.map(p => p.kind === 'genre' ? `tes notes en ${p.label}` : p.kind === 'director' ? `ton avis sur ${p.label}` : p.label);
  return `d’après ${bits.join(' et ')}`;
}

// Tes films notés (sauf celui de la fiche), avec ce qu'on sait déjà d'eux.
function predictionRatedFilms(exceptTmdbId){
  return films
    .filter(f => f.tmdbId && f.tmdbId !== exceptTmdbId && getDisplayNote(f) !== null)
    .map(f => ({ note: getDisplayNote(f), genres: f.genreIds || [], facts: cachedFilmFacts(f.tmdbId), tmdbId: f.tmdbId }));
}

// Remplit #filmPredict sur la fiche ouverte. Tout de suite avec ce qui est
// déjà connu, puis une seconde fois si charger le reste change l'estimation.
async function fillFilmPrediction(tmdbId, myNote){
  const write = (pred) => {
    const el = document.getElementById('filmPredict');
    if(!el || currentFilmTmdbId !== tmdbId) return;
    if(!pred){ el.hidden = true; return; }
    if(myNote != null){
      const gap = Math.round((myNote - pred.note) * 10) / 10;
      el.textContent = `Kinet prévoyait ${predFr(pred.note)}${Math.abs(gap) >= 0.1 ? `, écart de ${gap > 0 ? '+' : '−'}${predFr(Math.abs(gap))}` : ', dans le mille'}.`;
    }else{
      el.textContent = `Ta note prévue : environ ${predFr(pred.note)}, ${predictionReason(pred)}.`;
    }
    el.hidden = false;
  };
  const targetOf = (facts) => ({ facts, genres: facts ? facts.genres : ((currentFilmData && currentFilmData.genre_ids) || []) });
  write(predictNote(targetOf(cachedFilmFacts(tmdbId)), predictionRatedFilms(tmdbId)));
  try{
    const [facts] = await Promise.all([
      fetchFilmFacts(tmdbId),
      fetchFilmFactsMany(predictionRatedFilms(tmdbId).map(r => r.tmdbId)),
    ]);
    write(predictNote(targetOf(facts), predictionRatedFilms(tmdbId)));
  }catch(e){
    console.error(e);
  }
}
