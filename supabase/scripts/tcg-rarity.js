// --- Calcul de la rareté des cartes (acteurs, réalisateurs, films) ---
// Hors de l'app, lancé à la main par l'admin (usage perso). Combine :
//   - les datasets publics IMDb (https://developer.imdb.com/non-commercial-datasets/,
//     usage personnel non commercial) : notes, votes, durée, type, casting ;
//   - l'API TMDB, seulement pour retrouver l'identifiant IMDb de chaque carte.
//
// Méthode :
//   1. Films "significatifs" : type movie, durée >= 60 min, >= MIN_VOTES votes.
//      Ça écarte courts-métrages, téléfilms, et films mal notés par 3 personnes.
//   2. Note bayésienne de chaque film significatif :
//        WR = v/(v+m) * R + m/(v+m) * C   (m = MIN_VOTES, C = moyenne globale)
//      Un film à 40 votes à 9,5 ne bat pas un classique à 500 000 votes.
//   3. Score d'une personne :
//        pic    = moyenne des 5 meilleurs WR de ses films significatifs
//                 (acteur : billing <= 5 ; réalisateur : tous ses films)
//        reach  = moyenne du log10 des votes de ces 5 films (notoriété)
//        volume = nombre de films significatifs de ce rôle
//        score  = 0,4 * pic_norm + 0,3 * reach_norm + 0,3 * volume_norm
//      Le pic protège un acteur de carrière (Louis de Funès : La Grande Vadrouille,
//      Le Corniaud...) même s'il a peu de popularité TMDB récente.
//   4. Tiers par PERCENTILE, séparément pour chaque type de carte
//      (films entre eux, acteurs entre eux, réalisateurs entre eux) :
//      83 % Commun, 11 % Rare, 4 % Épique, 2 % Légendaire (taux Wankul, voir migration 047).
//      Les probabilités annoncées restent donc vraies quand la base grandit.
//
// Usage (depuis la racine du projet) :
//   1. Une fois, pour remplir imdb_id :
//      TMDB_TOKEN=... node supabase/scripts/tcg-rarity.js --fetch-imdb \
//        --cards cards.csv --imdb-out imdb-ids.sql
//      puis appliquer imdb-ids.sql et ré-exporter cards.csv.
//   2. Calcul des raretés :
//      node supabase/scripts/tcg-rarity.js \
//        --dir <dossier avec les .tsv.gz IMDb> \
//        --cards <cards.csv> --out <updates.sql> [--report <report.csv>]
//
// cards.csv : export de la table, à faire dans l'éditeur SQL Supabase :
//   select id, card_type, tmdb_id, imdb_id, rarity_override from public.tcg_cards;
//   (exporter en CSV avec en-têtes ; imdb_id peut être vide, voir étape TMDB.)
//
// Les cartes sans imdb_id ni score ne sont pas modifiées.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');

const MIN_VOTES = 5000;
const MIN_RUNTIME = 60;
const TOP_N = 5;
const TIERS = [
  { rarity: 'legendaire', from: 0.98 }, // top 2 %
  { rarity: 'epique', from: 0.94 },     // 94 à 98 %
  { rarity: 'rare', from: 0.83 },       // 83 à 94 %
  { rarity: 'commun', from: 0 },        // 0 à 83 %
];

// Options "--nom valeur", ou "--nom" seul pour un indicateur (ex. --fetch-imdb).
function parseArgs(argv){
  const args = {};
  for(let i = 0; i < argv.length; i++){
    const key = argv[i].replace(/^--/, '');
    const next = argv[i + 1];
    if(next === undefined || next.startsWith('--')){ args[key] = true; continue; }
    args[key] = next;
    i++;
  }
  return args;
}

// Lit un .tsv.gz IMDb ligne à ligne sans tout charger en mémoire.
// `onRow(cols)` reçoit les colonnes ; \N = valeur absente.
async function streamTsv(file, onRow){
  const input = fs.createReadStream(file).pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let header = null;
  for await (const line of rl){
    if(!header){ header = line.split('\t'); continue; }
    onRow(line.split('\t'), header);
  }
}

const val = (v) => (v === '\\N' || v === undefined ? null : v);

async function loadRatings(dir){
  const ratings = new Map();
  await streamTsv(path.join(dir, 'title.ratings.tsv.gz'), ([tconst, avg, votes]) => {
    ratings.set(tconst, { R: Number(avg), v: Number(votes) });
  });
  return ratings;
}

async function loadSignificantMovies(dir, ratings){
  const movies = new Map(); // tconst -> { R, v, WR }
  // Colonnes title.basics : tconst, titleType, primaryTitle, originalTitle,
  // isAdult, startYear, endYear, runtimeMinutes (index 7), genres.
  await streamTsv(path.join(dir, 'title.basics.tsv.gz'), ([tconst, titleType, , , , , , runtime]) => {
    if(titleType !== 'movie') return;
    const r = ratings.get(tconst);
    if(!r || r.v < MIN_VOTES) return;
    const rt = Number(val(runtime));
    if(!rt || rt < MIN_RUNTIME) return;
    movies.set(tconst, r);
  });
  // Moyenne globale C sur les films significatifs, puis note bayésienne.
  let somme = 0;
  for(const m of movies.values()) somme += m.R;
  const C = movies.size ? somme / movies.size : 0;
  const m = MIN_VOTES;
  for(const mv of movies.values()){
    mv.WR = (mv.v / (mv.v + m)) * mv.R + (m / (mv.v + m)) * C;
  }
  return { movies, C };
}

// Casting : acteurs billing <= TOP_N, réalisateurs. Seulement pour les films significatifs.
async function loadPeople(dir, movies){
  const people = new Map(); // nconst -> { films: Set<tconst>, role: 'actor'|'director' }
  await streamTsv(path.join(dir, 'title.principals.tsv.gz'), ([tconst, ordering, nconst, category]) => {
    if(!movies.has(tconst)) return;
    let role = null;
    if(category === 'actor' || category === 'actress'){
      if(Number(ordering) <= TOP_N) role = 'actor';
    } else if(category === 'director'){
      role = 'director';
    }
    if(!role) return;
    const key = role + ':' + nconst;
    if(!people.has(key)) people.set(key, { nconst, role, films: new Set() });
    people.get(key).films.add(tconst);
  });
  return people;
}

// Score brut d'une personne (avant normalisation).
// reach = rayonnement : moyenne du log10 des votes des TOP_N meilleurs films.
// Sans lui, un acteur à films très bien notés mais peu vus (ou une carrière
// de niche) passe devant une star dont les films sont énormément votés.
function personMetrics(person, movies){
  const best = [...person.films].map(t => movies.get(t)).sort((a, b) => b.WR - a.WR).slice(0, TOP_N);
  const pic = best.reduce((a, m) => a + m.WR, 0) / best.length;
  const reach = best.reduce((a, m) => a + Math.log10(m.v), 0) / best.length;
  return { pic, reach, volume: person.films.size };
}

// Rang percentile -> rareté, sur une liste de { id, score }.
function assignTiers(items){
  const sorted = [...items].sort((a, b) => a.score - b.score);
  const n = sorted.length;
  return sorted.map((it, i) => {
    const p = n === 1 ? 1 : i / (n - 1);
    const tier = TIERS.find(t => p >= t.from) || TIERS[TIERS.length - 1];
    return { id: it.id, rarity: tier.rarity, score: it.score };
  });
}


// Phase optionnelle --fetch-imdb : retrouve l'imdb_id de chaque carte qui n'en a
// pas, via TMDB (movie/person details). Jeton lu dans TMDB_TOKEN (variable
// d'environnement, jamais écrit dans ce fichier). Limité en débit : ~20 req/s.
async function fetchImdbIds(cards, token){
  const out = [];
  for(const c of cards){
    if(c.imdb_id) continue;
    const kind = c.card_type === 'film' ? 'movie' : 'person';
    const res = await fetch(`https://api.themoviedb.org/3/${kind}/${c.tmdb_id}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });
    if(!res.ok){ console.error(`TMDB ${res.status} pour la carte ${c.id}`); continue; }
    const d = await res.json();
    if(d.imdb_id) out.push({ id: c.id, imdb: d.imdb_id });
    await new Promise(r => setTimeout(r, 50));
  }
  return out;
}

function sqlEscape(s){ return String(s).replace(/'/g, "''"); }

function buildSql(updates){
  const lines = ['begin;'];
  for(const u of updates){
    lines.push(
      `update public.tcg_cards set rarity_auto = '${u.rarity}', rarity = coalesce(rarity_override, '${u.rarity}') where id = ${u.id};`
    );
  }
  lines.push('commit;');
  return lines.join('\n') + '\n';
}

function readCardsCsv(file){
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',');
  return lines.slice(1).map(l => {
    const cols = l.split(',');
    const o = {};
    head.forEach((h, i) => { o[h] = cols[i] === '' ? null : cols[i]; });
    return o;
  });
}

async function main(){
  const args = parseArgs(process.argv.slice(2));
  if(args['fetch-imdb']){
    const token = process.env.TMDB_TOKEN;
    if(!token){ console.error('Définis TMDB_TOKEN (jeton de lecture TMDB) avant de lancer.'); process.exit(1); }
    const cards = readCardsCsv(args.cards);
    const found = new Map(await fetchImdbIds(cards, token).then(l => l.map(f => [f.id, f.imdb])));
    const head = ['id', 'card_type', 'tmdb_id', 'imdb_id', 'rarity_override'];
    const rows = cards.map(c => [c.id, c.card_type, c.tmdb_id, c.imdb_id || found.get(c.id) || '', c.rarity_override || '']);
    const out = args['cards-out'] || args.cards.replace(/\.csv$/, '') + '-imdb.csv';
    fs.writeFileSync(out, [head, ...rows].map(r => r.join(',')).join('\n') + '\n');
    const manquants = cards.filter(c => !(c.imdb_id || found.get(c.id))).length;
    console.log(`${found.size} identifiants IMDb trouvés, ${manquants} sans identifiant -> ${out}`);
    return;
  }
  if(!args.dir || !args.cards || !args.out){
    console.error('Usage : node tcg-rarity.js --dir <dossier IMDb> --cards <cards.csv> --out <updates.sql> [--report <csv>]');
    process.exit(1);
  }
  console.log('1/4 notes IMDb…');
  const ratings = await loadRatings(args.dir);
  console.log('2/4 films significatifs…');
  const { movies, C } = await loadSignificantMovies(args.dir, ratings);
  console.log(`   ${movies.size} films significatifs (C = ${C.toFixed(2)})`);
  console.log('3/4 casting…');
  const people = await loadPeople(args.dir, movies);

  // Scores bruts par type de carte, puis normalisation 0..1 sur le lot.
  const cards = readCardsCsv(args.cards);
  const byImdb = new Map();
  for(const c of cards){ if(c.imdb_id) byImdb.set(c.imdb_id, c); }

  const scored = { film: [], actor: [], director: [] };
  for(const [tconst, mv] of movies){
    const c = byImdb.get(tconst);
    if(c && c.card_type === 'film') scored.film.push({ id: c.id, score: mv.WR, imdb: tconst, override: c.rarity_override });
  }
  const rawPeople = [];
  for(const p of people.values()){
    const c = byImdb.get(p.nconst);
    if(!c || c.card_type !== p.role) continue;
    rawPeople.push({ c, p, ...personMetrics(p, movies) });
  }
  const maxVol = Math.max(1, ...rawPeople.map(x => Math.log1p(x.volume)));
  const maxPic = Math.max(1, ...rawPeople.map(x => x.pic));
  const maxReach = Math.max(1, ...rawPeople.map(x => x.reach));
  for(const x of rawPeople){
    if(x.volume < 2) continue; // pas assez de films significatifs pour juger
    const score = 0.4 * (x.pic / maxPic) + 0.3 * (Math.log1p(x.volume) / maxVol) + 0.3 * (x.reach / maxReach);
    scored[x.c.card_type].push({ id: x.c.id, score, imdb: x.p.nconst, pic: x.pic, reach: x.reach, volume: x.volume, override: x.c.rarity_override });
  }

  console.log('4/4 percentiles et SQL…');
  const updates = [];
  const report = [['id', 'type', 'imdb', 'score', 'pic', 'reach', 'volume', 'rarity']];
  for(const type of ['film', 'actor', 'director']){
    const byId = new Map(scored[type].map(s => [s.id, s]));
    const tiered = assignTiers(scored[type]);
    tiered.forEach(t => {
      const src = byId.get(t.id);
      updates.push({ id: t.id, rarity: t.rarity });
      report.push([t.id, type, src.imdb, t.score.toFixed(4), src.pic != null ? src.pic.toFixed(3) : '', src.reach != null ? src.reach.toFixed(3) : '', src.volume ?? '', t.rarity]);
    });
  }
  fs.writeFileSync(args.out, buildSql(updates));
  if(args.report) fs.writeFileSync(args.report, report.map(r => r.join(',')).join('\n') + '\n');
  console.log(`${updates.length} cartes mises à jour -> ${args.out}`);
  console.log('Les cartes sans imdb_id ou avec moins de 2 films significatifs gardent leur rareté actuelle.');
}

if(require.main === module){
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { personMetrics, assignTiers, buildSql, MIN_VOTES, MIN_RUNTIME };
