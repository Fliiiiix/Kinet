// --- Catalogue pour chercher sans réseau ---
// Construit data/catalogue-films.json et data/catalogue-series.json depuis
// TMDB : les films et séries les plus connus, année par année, assez légers
// pour tenir sur un téléphone. js/offlinePrep.js y cherche quand TMDB ne répond
// plus (dans l'avion). À relancer de temps en temps, puis monter
// CATALOGUE_VERSION (js/offlinePrep.js) pour que les appareils le reprennent.
//
// Lancer : node scripts/build-catalogue.js
// Une ligne = [id, titre, titre original ou 0, année, affiche, genres, popularité].
const fs = require('fs');
const path = require('path');

const racine = path.join(__dirname, '..');
const config = fs.readFileSync(path.join(racine, 'js', 'tmdbConfig.js'), 'utf8');
const CLE = (config.match(/TMDB_API_KEY\s*=\s*['"]([^'"]+)['"]/) || [])[1];
if(!CLE) throw new Error('Clé TMDB introuvable dans js/tmdbConfig.js');

const ANNEE_DEBUT = 1920;
const ANNEE_FIN = new Date().getFullYear() + 1;
const PAGES_MAX_PAR_ANNEE = 40; // 800 titres par an au plus, les plus connus d'abord
const VOTES_MIN = { movie: 40, tv: 15 };

const pause = (ms) => new Promise(r => setTimeout(r, ms));

async function lire(url){
  for(let essai = 0; essai < 5; essai++){
    try{
      const res = await fetch(url, { headers: { Authorization: `Bearer ${CLE}`, Accept: 'application/json' } });
      if(res.status === 429){ await pause(1500 * (essai + 1)); continue; }
      if(res.ok) return res.json();
    }catch(e){ /* réseau : on retente */ }
    await pause(500 * (essai + 1));
  }
  throw new Error(`Échec : ${url}`);
}

async function annee(media, y){
  const dateMin = media === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte';
  const dateMax = media === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte';
  const base = `https://api.themoviedb.org/3/discover/${media}?language=fr-FR&include_adult=false&sort_by=vote_count.desc&vote_count.gte=${VOTES_MIN[media]}&${dateMin}=${y}-01-01&${dateMax}=${y}-12-31`;
  const premier = await lire(`${base}&page=1`);
  const total = Math.min(premier.total_pages || 1, PAGES_MAX_PAR_ANNEE);
  const pages = [premier];
  for(let p = 2; p <= total; p += 6){
    const lot = [];
    for(let i = p; i < p + 6 && i <= total; i++) lot.push(lire(`${base}&page=${i}`));
    pages.push(...await Promise.all(lot));
  }
  return pages.flatMap(x => x.results || []);
}

function ligne(r, media){
  const titre = media === 'movie' ? r.title : r.name;
  const original = media === 'movie' ? r.original_title : r.original_name;
  const date = media === 'movie' ? r.release_date : r.first_air_date;
  return [
    r.id, titre, original && original !== titre ? original : 0,
    date ? parseInt(date.slice(0, 4), 10) : 0,
    r.poster_path ? r.poster_path.replace(/^\//, '') : 0,
    r.genre_ids || [], Math.round(r.popularity || 0),
  ];
}

async function construire(media, fichier){
  const lignes = new Map();
  for(let y = ANNEE_FIN; y >= ANNEE_DEBUT; y--){
    (await annee(media, y)).forEach(r => { if(!lignes.has(r.id)) lignes.set(r.id, ligne(r, media)); });
    if(y % 10 === 0) console.log(`${media} : ${y}, ${lignes.size} titres`);
  }
  const trie = [...lignes.values()].sort((a, b) => b[6] - a[6]);
  const sortie = path.join(racine, 'data', fichier);
  fs.mkdirSync(path.dirname(sortie), { recursive: true });
  fs.writeFileSync(sortie, JSON.stringify(trie));
  console.log(`${fichier} : ${trie.length} titres, ${Math.round(fs.statSync(sortie).size / 1024)} Ko`);
}

(async () => {
  await construire('movie', 'catalogue-films.json');
  await construire('tv', 'catalogue-series.json');
})();
