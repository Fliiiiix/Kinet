// --- Données : tout sauvegarder, restaurer (draft Profil du 15/10) ---
// L'ancien « Exporter (JSON) » ne gardait que les films. La sauvegarde met
// dans un seul fichier les films, leurs visionnages, À voir, les séries
// (avec les épisodes cochés) et les listes. Les films gardent le format
// d'avant (data.films), donc un fichier récent s'ouvre aussi avec l'ancien
// import, et un ancien fichier (films seuls) se restaure ici.
//
// Restaurer n'efface rien : ça ajoute ce qui manque, sans doublon. Un film
// ou une série se reconnaît à son identifiant TMDB (à défaut, au titre),
// une liste à son titre, un visionnage à sa date.

const BACKUP_VERSION = 4;

function backupKey(tmdbId, title){
  return tmdbId ? `t:${tmdbId}` : `n:${normalizeSearch(String(title || '').trim())}`;
}

async function loadMyWatchedEpisodes(){
  let res = await supabaseClient.from('tv_episodes_watched').select('tv_show_id, season_number, episode_number, watched_at, note, times_watched');
  // Sans la migration 036 (note, times_watched) : le simple vu/pas vu.
  if(res.error) res = await supabaseClient.from('tv_episodes_watched').select('tv_show_id, season_number, episode_number, watched_at');
  if(res.error) throw res.error;
  return res.data || [];
}

async function loadMyListsWithItems(){
  const { data: lists, error } = await supabaseClient.from('lists').select('id, title, description').eq('user_id', currentUser.id);
  if(error) throw error;
  if(!lists || lists.length === 0) return [];
  const { data: items, error: itemsError } = await supabaseClient
    .from('list_items')
    .select('list_id, tmdb_id, title, poster_url, release_year, position')
    .in('list_id', lists.map(l => l.id));
  if(itemsError) throw itemsError;
  return lists.map(l => ({ id: l.id, title: l.title, description: l.description || null,
    items: (items || []).filter(i => i.list_id === l.id).sort((a, b) => a.position - b.position) }));
}

async function collectBackup(){
  if(watchlist.length === 0) await loadWatchlist();
  if(trackedShows.length === 0) await loadTrackedShows();
  const [episodes, lists] = await Promise.all([loadMyWatchedEpisodes(), loadMyListsWithItems()]);
  const filmById = new Map(films.map(f => [f.id, f]));
  return {
    app: 'critique-films',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    films,
    viewings: viewings
      .filter(v => filmById.has(v.filmId))
      .map(v => { const f = filmById.get(v.filmId); return { tmdbId: f.tmdbId || null, title: f.title, watchedAt: v.watchedAt, note: v.note || null }; }),
    watchlist: watchlist.map(w => ({
      title: w.title, note: w.note || null, added: w.added, tmdbId: w.tmdbId || null, posterUrl: w.posterUrl || null,
      overview: w.overview || null, releaseYear: w.releaseYear || null, releaseDate: w.releaseDate || null, originalTitle: w.originalTitle || null
    })),
    series: trackedShows.map(s => ({
      tmdbId: s.tmdbId, title: s.title, posterUrl: s.posterUrl, overview: s.overview, firstAirYear: s.firstAirYear,
      status: s.status, numberOfSeasons: s.numberOfSeasons, numberOfEpisodes: s.numberOfEpisodes, inProduction: s.inProduction,
      manualNote: s.manualNote, review: s.review, added: s.added,
      episodes: episodes.filter(e => e.tv_show_id === s.id).map(e => ({
        season: e.season_number, episode: e.episode_number, watchedAt: e.watched_at,
        note: e.note != null ? e.note : null, timesWatched: e.times_watched != null ? e.times_watched : null
      }))
    })),
    lists: lists.map(l => ({ title: l.title, description: l.description,
      items: l.items.map(i => ({ tmdbId: i.tmdb_id, title: i.title, posterUrl: i.poster_url, releaseYear: i.release_year, position: i.position })) }))
  };
}

function backupSummary(b){
  const parts = [];
  const n = (count, one, many) => { if(count) parts.push(`${count} ${count > 1 ? many : one}`); };
  n((b.films || []).length, 'film', 'films');
  n((b.series || []).length, 'série', 'séries');
  n((b.watchlist || []).length, 'à voir', 'à voir');
  n((b.viewings || []).length, 'visionnage', 'visionnages');
  n((b.lists || []).length, 'liste', 'listes');
  return parts.join(', ');
}

async function downloadBackup(){
  if(blockIfOffline()) return;
  showToast('Sauvegarde en cours…');
  let backup;
  try{
    backup = await collectBackup();
  }catch(e){
    showToast('Erreur pendant la sauvegarde, réessaie');
    console.error(e);
    return;
  }
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kinet-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast(`Sauvegarde téléchargée : ${backupSummary(backup) || 'rien à sauvegarder pour l’instant'}`);
}

// --- Restaurer ---

function filmRowFromBackup(f){
  return {
    title: f.title.trim(),
    crit: f.crit,
    fav: !!f.fav,
    added: typeof f.added === 'number' ? f.added : Date.now(),
    manual_note: typeof f.manualNote === 'number' ? f.manualNote : null,
    review: f.review || null,
    tmdb_id: f.tmdbId || null,
    poster_url: f.posterUrl || null,
    overview: f.overview || null,
    release_year: f.releaseYear || null,
    original_title: f.originalTitle || null,
    genre_ids: f.genreIds || []
  };
}

async function restoreFilms(backup, report){
  const imported = (Array.isArray(backup) ? backup : (backup.films || [])).filter(isValidImportedFilm);
  const have = new Set(films.map(f => backupKey(f.tmdbId, f.title)));
  const seen = new Set();
  const missing = imported.filter(f => {
    const k = backupKey(f.tmdbId, f.title);
    if(have.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if(missing.length === 0) return [];
  const { data, error } = await supabaseClient.from('films').insert(missing.map(filmRowFromBackup)).select();
  if(error) throw error;
  data.forEach(row => films.push(rowToFilm(row)));
  report.films = data.length;
  return data;
}

async function restoreViewings(backup, insertedFilms, report){
  const filmByKey = new Map(films.map(f => [backupKey(f.tmdbId, f.title), f]));
  const list = Array.isArray(backup.viewings) ? backup.viewings : [];
  const rows = [];
  const seen = new Set(viewings.map(v => `${v.filmId}|${v.watchedAt}`));
  list.forEach(v => {
    const film = filmByKey.get(backupKey(v.tmdbId, v.title));
    if(!film || typeof v.watchedAt !== 'number') return;
    const k = `${film.id}|${v.watchedAt}`;
    if(seen.has(k)) return;
    seen.add(k);
    rows.push({ film_id: film.id, watched_at: v.watchedAt, note: v.note || null });
  });
  // Ancien fichier sans visionnages : un premier visionnage daté de l'ajout,
  // comme l'ancien import.
  insertedFilms.forEach(row => {
    if(!rows.some(r => r.film_id === row.id)) rows.push({ film_id: row.id, watched_at: row.added, note: null });
  });
  if(rows.length === 0) return;
  const { data, error } = await supabaseClient.from('viewings').insert(rows).select();
  if(error) throw error;
  data.forEach(row => viewings.push({ id: row.id, filmId: row.film_id, watchedAt: row.watched_at, note: row.note || null }));
  report.viewings = list.length ? data.length : 0;
}

async function restoreWatchlist(backup, report){
  const list = Array.isArray(backup.watchlist) ? backup.watchlist : [];
  if(list.length === 0) return;
  if(watchlist.length === 0) await loadWatchlist();
  // Déjà dans À voir, ou déjà vu et noté depuis : pas remis dans À voir.
  const have = new Set(watchlist.map(w => backupKey(w.tmdbId, w.title)).concat(films.map(f => backupKey(f.tmdbId, f.title))));
  const rows = [];
  list.forEach(w => {
    if(!w || typeof w.title !== 'string' || !w.title.trim()) return;
    const k = backupKey(w.tmdbId, w.title);
    if(have.has(k)) return;
    have.add(k);
    rows.push({
      title: w.title.trim(), note: w.note || null, added: typeof w.added === 'number' ? w.added : Date.now(),
      tmdb_id: w.tmdbId || null, poster_url: w.posterUrl || null, overview: w.overview || null,
      release_year: w.releaseYear || null, release_date: w.releaseDate || null, original_title: w.originalTitle || null
    });
  });
  if(rows.length === 0) return;
  const { data, error } = await supabaseClient.from('watchlist').insert(rows).select();
  if(error) throw error;
  report.watchlist = data.length;
  await loadWatchlist();
}

async function insertWatchedEpisodes(rows){
  let res = await supabaseClient.from('tv_episodes_watched')
    .upsert(rows, { onConflict: 'user_id,tv_show_id,season_number,episode_number', ignoreDuplicates: true })
    .select('id');
  if(res.error && /note|times_watched/.test(res.error.message || '')){
    const plain = rows.map(({ note, times_watched, ...rest }) => rest);
    res = await supabaseClient.from('tv_episodes_watched')
      .upsert(plain, { onConflict: 'user_id,tv_show_id,season_number,episode_number', ignoreDuplicates: true })
      .select('id');
  }
  if(res.error) throw res.error;
  return (res.data || []).length;
}

async function restoreSeries(backup, report){
  const list = Array.isArray(backup.series) ? backup.series : [];
  if(list.length === 0) return;
  if(trackedShows.length === 0) await loadTrackedShows();
  const byTmdb = new Map(trackedShows.map(s => [s.tmdbId, s]));
  const missing = list.filter((s, i) => s && s.tmdbId && !byTmdb.has(s.tmdbId) && list.findIndex(x => x && x.tmdbId === s.tmdbId) === i);
  if(missing.length){
    const { data, error } = await supabaseClient.from('tv_shows').insert(missing.map(s => ({
      tmdb_id: s.tmdbId, title: s.title, poster_url: s.posterUrl || null, overview: s.overview || null,
      first_air_year: s.firstAirYear || null, status: s.status || null, number_of_seasons: s.numberOfSeasons || null,
      number_of_episodes: s.numberOfEpisodes || null, in_production: !!s.inProduction,
      manual_note: typeof s.manualNote === 'number' ? s.manualNote : null, review: s.review || null,
      added: typeof s.added === 'number' ? s.added : Date.now()
    }))).select();
    if(error) throw error;
    data.forEach(row => { const show = rowToShow(row); trackedShows.push(show); byTmdb.set(show.tmdbId, show); });
    report.series = data.length;
  }
  const episodeRows = [];
  list.forEach(s => {
    const show = s && byTmdb.get(s.tmdbId);
    if(!show || !Array.isArray(s.episodes)) return;
    s.episodes.forEach(e => {
      if(!Number.isFinite(e.season) || !Number.isFinite(e.episode)) return;
      const row = { user_id: currentUser.id, tv_show_id: show.id, season_number: e.season, episode_number: e.episode,
        watched_at: typeof e.watchedAt === 'number' ? e.watchedAt : Date.now() };
      if(e.note != null) row.note = e.note;
      if(e.timesWatched != null) row.times_watched = e.timesWatched;
      episodeRows.push(row);
    });
  });
  if(episodeRows.length) report.episodes = await insertWatchedEpisodes(episodeRows);
}

async function restoreLists(backup, report){
  const list = Array.isArray(backup.lists) ? backup.lists : [];
  if(list.length === 0) return;
  const mine = await loadMyListsWithItems();
  const byTitle = new Map(mine.map(l => [normalizeSearch(l.title), l]));
  for(const l of list){
    if(!l || typeof l.title !== 'string' || !l.title.trim()) continue;
    let target = byTitle.get(normalizeSearch(l.title.trim()));
    if(!target){
      const { data, error } = await supabaseClient.from('lists')
        .insert({ user_id: currentUser.id, title: l.title.trim(), description: l.description || null })
        .select().single();
      if(error) throw error;
      target = { id: data.id, title: data.title, items: [] };
      byTitle.set(normalizeSearch(target.title), target);
      report.lists++;
    }
    const have = new Set(target.items.map(i => i.tmdb_id));
    const rows = (Array.isArray(l.items) ? l.items : [])
      .filter(i => i && i.tmdbId && !have.has(i.tmdbId) && have.add(i.tmdbId))
      .map((i, n) => ({ list_id: target.id, user_id: currentUser.id, tmdb_id: i.tmdbId, title: i.title, poster_url: i.posterUrl || null,
        release_year: i.releaseYear || null, position: target.items.length + n }));
    if(rows.length){
      const { error } = await supabaseClient.from('list_items').insert(rows);
      if(error) throw error;
    }
  }
}

function restoreReportText(r){
  const parts = [];
  const n = (count, one, many) => { if(count) parts.push(`${count} ${count > 1 ? many : one}`); };
  n(r.films, 'film', 'films');
  n(r.viewings, 'visionnage', 'visionnages');
  n(r.watchlist, 'à voir', 'à voir');
  n(r.series, 'série', 'séries');
  n(r.episodes, 'épisode', 'épisodes');
  n(r.lists, 'liste', 'listes');
  return parts.length ? `Restauré : ${parts.join(', ')}` : 'Rien à ajouter : tout y est déjà';
}

async function restoreBackup(backup){
  const report = { films: 0, viewings: 0, watchlist: 0, series: 0, episodes: 0, lists: 0 };
  const insertedFilms = await restoreFilms(backup, report);
  await restoreViewings(Array.isArray(backup) ? {} : backup, insertedFilms, report);
  if(!Array.isArray(backup)){
    await restoreWatchlist(backup, report);
    await restoreSeries(backup, report);
    await restoreLists(backup, report);
  }
  return report;
}

function handleRestoreFile(file){
  if(!file) return;
  if(blockIfOffline()) return;
  const reader = new FileReader();
  reader.onload = async () => {
    let data;
    try{ data = JSON.parse(reader.result); }
    catch(e){ showToast('Ce fichier n’est pas une sauvegarde Kinet'); return; }
    const filmsPart = Array.isArray(data) ? data : data && data.films;
    if(!data || (!Array.isArray(filmsPart) && !Array.isArray(data.series) && !Array.isArray(data.watchlist))){
      showToast('Ce fichier n’est pas une sauvegarde Kinet');
      return;
    }
    showToast('Restauration en cours…');
    try{
      const report = await restoreBackup(data);
      buildGenreFilterOptions();
      render();
      showToast(restoreReportText(report));
    }catch(e){
      showToast('Erreur pendant la restauration, réessaie');
      console.error(e);
    }
  };
  reader.onerror = () => showToast('Impossible de lire le fichier');
  reader.readAsText(file);
}

document.getElementById('settingsBackupBtn').addEventListener('click', downloadBackup);
document.getElementById('settingsRestoreBtn').addEventListener('click', () => document.getElementById('restoreFile').click());
document.getElementById('restoreFile').addEventListener('change', (e) => {
  handleRestoreFile(e.target.files[0]);
  e.target.value = '';
});
