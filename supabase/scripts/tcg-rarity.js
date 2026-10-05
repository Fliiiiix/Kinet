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
//        volume = nombre de films significatifs de ce rôle
//        score  = 0,6 * pic_norm + 0,4 * volume_norm
//      Le pic protège un acteur de carrière (Louis de Funès : La Grande Vadrouille,
//      Le Corniaud...) même s'il a peu de popularité TMDB récente.
//   4. Tiers par PERCENTILE, séparément pour chaque type de carte
//      (films entre eux, acteurs entre eux, réalisateurs entre eux) :
//      60 % Commun, 27 % Rare, 10 % Épique, 3 % Légendaire.
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
  { rarity: 'legendaire', from: 0.97 }, // top 3 %
  { rarity: 'epique', from: 0.87 },     // 87 à 97 %
  { rarity: 'rare', from: 0.60 },       // 60 à 87 %
  { rarity: 'commun', from: 0 },        // 0 à 60 %
];

function parseArgs(argv){
  const args = {};
  for(let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
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
  await streamTsv(path.join(dir, 'title.basics.tsv.gz'), ([tconst, titleType, , , , , , , , runtime]) => {
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
function personMetrics(person, movies){
  const wrs = [...person.films].map(t => movies.get(t).WR).sort((a, b) => b - a);
  const top = wrs.slice(0, TOP_N);
  const pic = top.reduce((a, b) => a + b, 0) / top.length;
  return { pic, volume: person.films.size };
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
    const found = await fetchImdbIds(cards, token);
    const sql = ['begin;', ...found.map(f => `update public.tcg_cards set imdb_id = '${sqlEscape(f.imdb)}' where id = ${f.id};`), 'commit;'].join('\n') + '\n';
    fs.writeFileSync(args['imdb-out'] || 'imdb-ids.sql', sql);
    console.log(`${found.length} identifiants IMDb trouvés. Applique le SQL, ré-exporte cards.csv, puis relance sans --fetch-imdb.`);
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
  for(const x of rawPeople){
    if(x.volume < 2) continue; // pas assez de films significatifs pour juger
    const score = 0.6 * (x.pic / maxPic) + 0.4 * (Math.log1p(x.volume) / maxVol);
    scored[x.c.card_type].push({ id: x.c.id, score, imdb: x.p.nconst, pic: x.pic, volume: x.volume, override: x.c.rarity_override });
  }

  console.log('4/4 percentiles et SQL…');
  const updates = [];
  const report = [['id', 'type', 'imdb', 'score', 'rarity']];
  for(const type of ['film', 'actor', 'director']){
    const tiered = assignTiers(scored[type]);
    tiered.forEach(t => {
      updates.push({ id: t.id, rarity: t.rarity });
      report.push([t.id, type, '', t.score.toFixed(4), t.rarity]);
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
