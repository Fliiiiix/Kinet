// --- Import externe (Letterboxd, Trakt) ---
// Chantier v2.x, retour utilisateur. Contrairement à l'import JSON existant
// (importFilms(), js/app.js — un fichier déjà au format Kinet), ces imports
// viennent d'autres services : chaque ligne doit être retrouvée sur TMDB
// (titre + année) pour récupérer poster/résumé/genres, comme n'importe quel
// ajout manuel via la recherche TMDB (js/tmdb.js).
//
// Letterboxd est le premier service câblé ici : leur export ("Réglages du
// compte" → "Exporter vos données") télécharge un .zip contenant plusieurs
// CSV. Pas de dézippage automatique côté app (pas de dépendance externe,
// l'app reste 100% vanilla, aucune bibliothèque zip) — l'utilisateur dépose
// directement le CSV qui l'intéresse une fois le zip extrait localement.
// Trakt suivra (voir README) — pas d'export fichier du tout chez eux,
// seulement une API OAuth qui nécessite une appli enregistrée sur trakt.tv
// (client_id/secret propres à l'utilisateur, pas à ce dépôt). TV Time
// envisagé un temps, abandonné : leur site est une appli Flutter qui dessine
// tout sur un <canvas>, aucune donnée récupérable dans le HTML — et
// l'application elle-même a fermé depuis.

// --- Parseur CSV générique (RFC4180 minimal) ---
// Gère les champs entre guillemets pouvant contenir virgules, retours à la
// ligne et guillemets doublés ("") — nécessaire pour Review (reviews.csv)
// qui peut contenir tout ça. new Function côté navigateur uniquement, aucun
// besoin d'une lib externe pour un format aussi simple.
function parseCsv(text){
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for(let i = 0; i < text.length; i++){
    const c = text[i];
    if(inQuotes){
      if(c === '"'){
        if(text[i+1] === '"'){ field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if(c === '"'){
      inQuotes = true;
    } else if(c === ','){
      row.push(field); field = '';
    } else if(c === '\n' || c === '\r'){
      if(c === '\r' && text[i+1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if(field.length > 0 || row.length > 0){ row.push(field); rows.push(row); }
  if(rows.length === 0) return [];
  const headers = rows[0].map(h => h.trim());
  return rows
    .slice(1)
    .filter(r => r.length > 1 || (r[0] || '').trim() !== '') // dernière ligne vide fréquente en fin de fichier
    .map(r => {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? r[idx] : ''; });
      return obj;
    });
}

// --- Détection du fichier Letterboxd déposé ---
// D'abord par son nom (Letterboxd génère toujours exactement ces noms-là
// dans son zip), colonnes en repli si le fichier a été renommé entre-temps.
function detectLetterboxdType(filename, headers){
  const name = (filename || '').toLowerCase();
  if(name.includes('diary')) return 'diary';
  if(name.includes('ratings')) return 'ratings';
  if(name.includes('reviews')) return 'reviews';
  if(name.includes('watchlist')) return 'watchlist';
  if(name.includes('watched')) return 'watched';
  // Le zip Letterboxd contient aussi ces fichiers-là, sans aucune donnée de
  // film à en tirer (juste du compte/social) — reconnus explicitement pour
  // afficher un message clair plutôt qu'un "fichier non reconnu" qui laisse
  // penser à un bug (retour utilisateur : "l'import du profile ne marche
  // pas" après avoir déposé profile.csv, trouvé dans le même zip que
  // diary.csv/ratings.csv).
  if(name.includes('profile')) return 'profile';
  if(name.includes('comments')) return 'comments';
  if(headers.includes('Rewatch') && headers.includes('Watched Date')) return 'diary';
  if(headers.includes('Review')) return 'reviews';
  if(headers.includes('Rating')) return 'ratings';
  // watched.csv et watchlist.csv ont EXACTEMENT les mêmes colonnes (Date,
  // Name, Year, Letterboxd URI) : sans indice dans le nom du fichier, rien
  // ne permet de choisir entre les deux. Type dédié plutôt qu'un choix
  // silencieux (l'ancien code retournait 'watched' par défaut, un mauvais
  // repli aurait mélangé watchlist et films vus sans que rien ne le signale) :
  // importLetterboxdFile() explique la situation plutôt que de deviner.
  if(headers.includes('Name') && headers.includes('Year')) return 'watched_or_watchlist';
  return null;
}

// Letterboxd exporte le texte de la critique avec un minimum de mise en
// forme HTML (paragraphes, gras/italique, liens) plutôt qu'en texte brut.
// Sans ce nettoyage, ces balises apparaîtraient telles quelles dans Kinet
// (ex. "<p>Texte de la critique</p>"), ce qui a de bonnes chances d'être
// une partie du retour "l'import review ne marche pas" : le texte arrive
// bien, mais entouré de balises qui le rendent illisible/cassé à l'œil. On
// ne reconnaît que ce sous-ensemble précis de balises Letterboxd (jamais un
// nettoyage HTML générique, qui pourrait avaler un "<" tapé volontairement
// dans une vraie critique, ex. "<3 ce film").
function stripLetterboxdReviewHtml(text){
  if(!text) return text;
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/?p[^>]*>/gi, '')
    .replace(/<\/?(em|i|strong|b|blockquote)[^>]*>/gi, '')
    .replace(/<a\s+[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .trim();
}

function normalizeLetterboxdRow(r){
  return {
    title: (r['Name'] || '').trim(),
    year: r['Year'] ? parseInt(r['Year'], 10) : null,
    rating: r['Rating'] ? parseFloat(r['Rating']) : null,
    watchedDate: r['Watched Date'] || r['Date'] || null,
    review: stripLetterboxdReviewHtml((r['Review'] || '').trim()) || null
  };
}

// Un même film peut apparaître plusieurs fois dans diary.csv (revisionnages)
// — regroupé ici en une seule entrée (note/avis les plus récents, toutes les
// dates gardées pour le journal de visionnages, voir js/journal.js).
function groupLetterboxdEntries(records){
  const map = new Map();
  records.forEach(raw => {
    const n = normalizeLetterboxdRow(raw);
    if(!n.title) return;
    const key = normalizeSearch(n.title) + '|' + (n.year || '');
    if(!map.has(key)) map.set(key, { title: n.title, year: n.year, rating: null, review: null, dates: [] });
    const g = map.get(key);
    if(n.watchedDate) g.dates.push(n.watchedDate);
    if(n.rating != null) g.rating = n.rating;
    if(n.review && !g.review) g.review = n.review;
  });
  return [...map.values()];
}

// Départage plusieurs fiches TMDB candidates pour un même titre/année —
// bug réel constaté (retour utilisateur) : "The Handmaiden" (2016) renvoie
// EN PREMIER "Making of The Handmaiden" (un making-of, même titre littéral,
// même année 2016), avant "Mademoiselle" (le vrai film, indexé sous son
// titre français, 4472 votes) — l'ancien code prenait `.find()`, donc le
// PREMIER match d'année peu importe lequel des deux c'est. Un titre
// littéralement identique à la recherche ne suffit pas à départager (ça
// aurait justement favorisé le making-of ici) : on retient la popularité
// TMDB (proxy de "c'est le vrai film que tout le monde connaît, pas une
// featurette/un bonus obscur") comme critère principal, avec un bonus pour
// un titre EXACTEMENT identique (FR ou VO) qui reste un signal fiable sans
// être trompé par une simple inclusion de texte comme ci-dessus.
function bestTmdbCandidate(results, title){
  const queryNorm = normalizeSearch(title);
  let best = null, bestScore = -Infinity;
  for(const r of results){
    const exactMatch = normalizeSearch(r.title || '') === queryNorm || normalizeSearch(r.original_title || '') === queryNorm;
    const score = (exactMatch ? 1e6 : 0) + (r.popularity || 0);
    if(score > bestScore){ bestScore = score; best = r; }
  }
  return best;
}

async function matchLetterboxdToTmdb(title, year){
  try{
    const results = await searchTmdb(title);
    if(results.length === 0) return null;
    if(year){
      const exact = results.filter(r => r.release_year === year);
      if(exact.length) return bestTmdbCandidate(exact, title);
      // ±1 an toléré : Letterboxd affiche parfois l'année de sortie US/
      // festival plutôt que la sortie France que TMDB retient par défaut.
      const close = results.filter(r => r.release_year && Math.abs(r.release_year - year) <= 1);
      if(close.length) return bestTmdbCandidate(close, title);
    }
    return bestTmdbCandidate(results, title);
  }catch(e){
    console.error(e);
    return null;
  }
}

// --- Import films notés (ratings.csv / diary.csv) ---
async function importLetterboxdRatings(records){
  const groups = groupLetterboxdEntries(records);
  if(groups.length === 0){ showToast('Aucune entrée trouvée dans ce fichier'); return; }

  const existingTmdbIds = new Set(films.map(f => f.tmdbId).filter(Boolean));
  let matched = 0, skipped = 0, unmatched = 0, done = 0;
  const toInsert = [];
  const datesForRow = [];

  // 4 recherches TMDB en parallèle : assez pour rester rapide sur un gros
  // catalogue Letterboxd (des centaines d'entrées possibles) sans bombarder
  // l'API. Chaque worker consomme la file `groups` par index partagé —
  // sûr en JS (un seul thread, `idx++` s'exécute avant tout await).
  let idx = 0;
  async function worker(){
    while(idx < groups.length){
      const g = groups[idx++];
      done++;
      if(done % 3 === 0 || done === groups.length) showToast(`Import Letterboxd… ${done}/${groups.length}`);
      const m = await matchLetterboxdToTmdb(g.title, g.year);
      if(!m){ unmatched++; continue; }
      if(existingTmdbIds.has(m.id)){ skipped++; continue; }
      existingTmdbIds.add(m.id); // évite un doublon si 2 lignes du fichier matchent le même film
      matched++;
      toInsert.push({
        title: m.title,
        crit: {},
        fav: false,
        added: g.dates.length ? new Date([...g.dates].sort().pop()).getTime() : Date.now(),
        manual_note: g.rating,
        review: g.review,
        tmdb_id: m.id,
        poster_url: m.poster_path ? TMDB_IMG_BASE + m.poster_path : null,
        overview: m.overview,
        release_year: m.release_year,
        original_title: m.original_title,
        genre_ids: m.genre_ids || []
      });
      datesForRow.push(g.dates);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));

  if(toInsert.length === 0){
    showToast(`Rien à importer (${skipped} déjà dans ton catalogue, ${unmatched} introuvable(s) sur TMDB)`);
    return;
  }

  const { data: inserted, error } = await supabaseClient.from('films').insert(toInsert).select();
  if(error){
    showToast('Erreur pendant l\'import, réessaie');
    console.error(error);
    return;
  }
  inserted.forEach((row, i) => {
    films.push(rowToFilm(row));
    const dates = datesForRow[i];
    if(dates && dates.length){
      // Un visionnage par date du journal Letterboxd (revisionnages inclus)
      // — alimente directement le badge "revu ×N" (js/app.js) comme n'importe
      // quel visionnage ajouté depuis l'app.
      dates.forEach(d => addViewing(row.id, new Date(d).getTime()));
    } else {
      addViewing(row.id, row.added);
    }
  });
  buildGenreFilterOptions();
  render();
  showToast(`${matched} film(s) importé(s) depuis Letterboxd (${skipped} déjà présent(s), ${unmatched} introuvable(s) sur TMDB)`);
}

// --- Import reviews.csv ---
// Bug remonté par l'utilisateur : "l'import review ne marche pas". Cause
// réelle — reviews.csv liste les MÊMES films que ratings.csv/diary.csv (une
// critique accompagne toujours une note déjà exportée ailleurs), donc dans
// l'ordre d'import naturel (diary/ratings d'abord, reviews ensuite pour
// récupérer le texte), importLetterboxdRatings() les aurait tous trouvés
// déjà présents et purement SKIPPÉS — le texte de la critique ne partait
// jamais nulle part, l'import semblait ne rien faire ("0 importé(s), tous
// déjà présents"). Ici on distingue les deux cas : film déjà au catalogue →
// on COMPLÈTE l'entrée existante (review, et manual_note si absente),
// jamais on n'écrase une critique déjà écrite dans Kinet ; film absent → on
// l'importe comme importLetterboxdRatings (avec sa note et sa critique).
async function importLetterboxdReviews(records){
  const groups = groupLetterboxdEntries(records);
  if(groups.length === 0){ showToast('Aucune entrée trouvée dans ce fichier'); return; }

  const filmsByTmdbId = new Map(films.filter(f => f.tmdbId).map(f => [f.tmdbId, f]));
  let updated = 0, added = 0, unchanged = 0, unmatched = 0, done = 0;
  const toInsert = [];
  const datesForInsert = [];
  const toUpdate = [];

  let idx = 0;
  async function worker(){
    while(idx < groups.length){
      const g = groups[idx++];
      done++;
      if(done % 3 === 0 || done === groups.length) showToast(`Import des critiques Letterboxd… ${done}/${groups.length}`);
      if(!g.review){ unchanged++; continue; } // reviews.csv sans texte : rien à récupérer ici
      const m = await matchLetterboxdToTmdb(g.title, g.year);
      if(!m){ unmatched++; continue; }
      const existing = filmsByTmdbId.get(m.id);
      if(existing){
        const patch = {};
        if(!existing.review) patch.review = g.review;
        if(existing.manualNote == null && g.rating != null) patch.manual_note = g.rating;
        if(Object.keys(patch).length === 0){ unchanged++; continue; } // déjà complet côté Kinet
        toUpdate.push({ id: existing.id, patch });
        continue;
      }
      toInsert.push({
        title: m.title,
        crit: {},
        fav: false,
        added: g.dates.length ? new Date([...g.dates].sort().pop()).getTime() : Date.now(),
        manual_note: g.rating,
        review: g.review,
        tmdb_id: m.id,
        poster_url: m.poster_path ? TMDB_IMG_BASE + m.poster_path : null,
        overview: m.overview,
        release_year: m.release_year,
        original_title: m.original_title,
        genre_ids: m.genre_ids || []
      });
      datesForInsert.push(g.dates);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));

  for(const u of toUpdate){
    const { error } = await supabaseClient.from('films').update(u.patch).eq('id', u.id);
    if(error){ console.error(error); continue; }
    const f = films.find(x => x.id === u.id);
    if(f){
      if('review' in u.patch) f.review = u.patch.review;
      if('manual_note' in u.patch) f.manualNote = parseFloat(u.patch.manual_note);
    }
    updated++;
  }

  if(toInsert.length){
    const { data: inserted, error } = await supabaseClient.from('films').insert(toInsert).select();
    if(error){
      showToast('Erreur pendant l\'import, réessaie');
      console.error(error);
    } else {
      inserted.forEach((row, i) => {
        films.push(rowToFilm(row));
        const dates = datesForInsert[i];
        if(dates && dates.length) dates.forEach(d => addViewing(row.id, new Date(d).getTime()));
        else addViewing(row.id, row.added);
      });
      added = inserted.length;
    }
  }

  if(updated || added){
    buildGenreFilterOptions();
    render();
  }
  // "0 critique(s) complétée(s), 0 film(s) importé(s)" se lit comme un échec
  // générique même quand tout s'est bien passé (retour utilisateur : "l'import
  // review ne marche pas"). Un vrai zéro-partout n'arrive que si CE fichier
  // n'apporte rien de neuf : soit chaque film qu'il liste a déjà sa critique
  // dans Kinet (unchanged), soit aucun n'a été retrouvé sur TMDB (unmatched).
  // Un message dédié à chacun de ces deux cas plutôt que la phrase générique,
  // pour que "rien à faire" ne se lise plus jamais comme "ça n'a pas marché".
  if(updated === 0 && added === 0){
    if(unmatched > 0 && unchanged === 0){
      showToast(`Aucune critique importée : ${unmatched} film${unmatched > 1 ? 's' : ''} introuvable${unmatched > 1 ? 's' : ''} sur TMDB.`);
    } else {
      showToast('Rien à importer : les critiques de ce fichier sont déjà toutes dans Kinet.');
    }
    return;
  }
  showToast(`${updated} critique(s) complétée(s) sur des films déjà présents, ${added} film(s) importé(s), ${unmatched} introuvable(s) sur TMDB`);
}

// --- Import watchlist.csv ---
async function importLetterboxdWatchlist(records){
  const rows = records
    .map(r => ({ title: (r['Name'] || '').trim(), year: r['Year'] ? parseInt(r['Year'], 10) : null }))
    .filter(r => r.title);
  if(rows.length === 0){ showToast('Aucune entrée trouvée dans ce fichier'); return; }

  const existingTmdbIds = new Set(watchlist.map(w => w.tmdbId).filter(Boolean));
  const existingTitles = new Set(watchlist.map(w => normalizeSearch(w.title)));
  let added = 0, skipped = 0, unmatched = 0, done = 0;
  const toInsert = [];

  let idx = 0;
  async function worker(){
    while(idx < rows.length){
      const r = rows[idx++];
      done++;
      if(done % 3 === 0 || done === rows.length) showToast(`Import watchlist Letterboxd… ${done}/${rows.length}`);
      if(existingTitles.has(normalizeSearch(r.title))){ skipped++; continue; }
      const m = await matchLetterboxdToTmdb(r.title, r.year);
      if(!m){ unmatched++; continue; }
      if(existingTmdbIds.has(m.id)){ skipped++; continue; }
      existingTmdbIds.add(m.id);
      added++;
      toInsert.push({
        title: m.title,
        note: null,
        added: Date.now(),
        tmdb_id: m.id,
        poster_url: m.poster_path ? TMDB_IMG_BASE + m.poster_path : null,
        overview: m.overview,
        release_year: m.release_year,
        release_date: m.release_date,
        original_title: m.original_title
      });
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));

  if(toInsert.length === 0){
    showToast(`Rien à ajouter (${skipped} déjà dans ta watchlist, ${unmatched} introuvable(s) sur TMDB)`);
    return;
  }
  const { data: inserted, error } = await supabaseClient.from('watchlist').insert(toInsert).select();
  if(error){
    showToast('Erreur pendant l\'import, réessaie');
    console.error(error);
    return;
  }
  inserted.forEach(row => watchlist.unshift({
    id: row.id, title: row.title, note: null,
    tmdbId: row.tmdb_id, posterUrl: row.poster_url, overview: row.overview,
    releaseYear: row.release_year, releaseDate: row.release_date, originalTitle: row.original_title,
    added: row.added
  }));
  renderWatchlist();
  showToast(`${added} film(s) ajouté(s) à ta watchlist (${skipped} déjà présent(s), ${unmatched} introuvable(s) sur TMDB)`);
}

async function importLetterboxdFile(file){
  if(blockIfOffline()) return; // js/offline.js — écriture impossible hors ligne
  let text;
  try{
    text = await file.text();
  }catch(e){
    showToast('Impossible de lire le fichier');
    return;
  }
  const records = parseCsv(text);
  if(records.length === 0){ showToast('Fichier vide ou illisible'); return; }
  const headers = Object.keys(records[0]);
  const type = detectLetterboxdType(file.name, headers);

  if(type === null){
    showToast('Fichier non reconnu — dépose un CSV de l\'export Letterboxd (ratings.csv, diary.csv, reviews.csv ou watchlist.csv)');
    return;
  }
  // Fichiers réels du zip Letterboxd, mais sans aucune note/critique de film
  // dedans (compte, commentaires…) — rien à importer, on l'explique plutôt
  // que de laisser croire à un bug. watched.csv N'EST PAS dans ce cas (retour
  // utilisateur : "l'import de film vu et non noté ne marche pas non plus et
  // ça c'est mauvais") — il liste les films marqués vus, notés ou non,
  // certains n'existant nulle part ailleurs dans l'export (jamais loggés au
  // journal ni notés). Kinet gère très bien un film sans note (voir Top
  // films, migrations/033) : le rejeter ici privait l'import d'une partie
  // réelle de l'historique. Il suit donc le même chemin que diary.csv/
  // ratings.csv (importLetterboxdRatings gère déjà manual_note null).
  const UNSUPPORTED_MESSAGES = {
    profile: 'profile.csv contient tes infos de compte Letterboxd (pseudo, bio, date d\'inscription…), pas tes films — rien à importer depuis ce fichier. Utilise diary.csv, ratings.csv, reviews.csv ou watchlist.csv',
    comments: 'comments.csv contient tes commentaires sous des films, pas tes notes — utilise diary.csv, ratings.csv, reviews.csv ou watchlist.csv'
  };
  if(UNSUPPORTED_MESSAGES[type]){
    showToast(UNSUPPORTED_MESSAGES[type]);
    return;
  }
  // watched.csv et watchlist.csv sont indiscernables par leurs colonnes
  // (voir detectLetterboxdType()) : averti explicitement plutôt que de
  // deviner en silence, avec l'action pour corriger si le repli est faux.
  if(type === 'watched_or_watchlist'){
    showToast('Nom de fichier peu clair : traité comme des films VUS (comme watched.csv). Si c\'était plutôt ta watchlist, renomme le fichier en "watchlist.csv" et réimporte-le.');
    await importLetterboxdRatings(records);
    return;
  }
  showToast('Import en cours…');
  if(type === 'watchlist'){
    await importLetterboxdWatchlist(records);
  } else if(type === 'reviews'){
    await importLetterboxdReviews(records);
  } else {
    // diary / ratings / watched : films vus, notés ou non.
    await importLetterboxdRatings(records);
  }
}

// --- Tutoriel d'import (retour utilisateur) ---
// Un ami de l'utilisateur a testé l'import sans aide et ça a marché, mais
// rien n'explique où trouver son export Letterboxd ni quel fichier choisir
// dans le zip pour quelqu'un qui découvre. Affiché seulement au clic sur
// "Importer depuis Letterboxd" (jamais avant : à la connexion, en bannière,
// etc. — ça gênerait tous ceux qui n'importent rien). "Ne plus afficher"
// mémorisé en localStorage (préférence d'affichage locale à l'appareil, pas
// une donnée utilisateur à synchroniser en base).
const LETTERBOXD_TUTO_HIDE_KEY = 'kinet_hide_letterboxd_tuto';

document.getElementById('importLetterboxdBtn').addEventListener('click', () => {
  if(localStorage.getItem(LETTERBOXD_TUTO_HIDE_KEY) === '1'){
    document.getElementById('importLetterboxdFile').click();
  } else {
    openOverlay('importLetterboxdTutoOverlay');
  }
});
document.getElementById('closeLetterboxdTuto').addEventListener('click', () => closeOverlay('importLetterboxdTutoOverlay'));
document.getElementById('letterboxdTutoCancelBtn').addEventListener('click', () => closeOverlay('importLetterboxdTutoOverlay'));
document.getElementById('importLetterboxdTutoOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'importLetterboxdTutoOverlay') closeOverlay('importLetterboxdTutoOverlay');
});
document.getElementById('letterboxdTutoContinueBtn').addEventListener('click', () => {
  if(document.getElementById('hideLetterboxdTutoCheck').checked){
    localStorage.setItem(LETTERBOXD_TUTO_HIDE_KEY, '1');
  }
  closeOverlay('importLetterboxdTutoOverlay');
  document.getElementById('importLetterboxdFile').click();
});
document.getElementById('importLetterboxdFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if(file) importLetterboxdFile(file);
  e.target.value = ''; // permet de réimporter le même fichier
});
