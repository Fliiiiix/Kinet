// --- Rattrapage des années de sortie des cartes FILM (migration 052) ---
// Les cartes générées avant la migration 052 n'ont pas d'année. Ce script lit
// un export CSV des cartes (id, card_type, tmdb_id), interroge TMDB pour chaque
// carte film sans année, et écrit un SQL à relire puis exécuter dans Supabase.
//
// Usage :
//   TMDB_TOKEN=... node supabase/scripts/annees-cartes.js --cards <export.csv> --out annees.sql
//
// Export à faire dans l'éditeur SQL Supabase :
//   select id, card_type, tmdb_id from public.tcg_cards order by id;
//
// Jeton TMDB lu dans l'environnement, jamais écrit dans ce fichier.
const fs = require('fs');

// Plusieurs exports possibles à la fois : --cards a.csv,b.csv,c.csv. Les lignes
// en double (même id) ne sont gardées qu'une fois.
function lireCsvs(liste){
  const vus = new Map();
  for(const fichier of liste.split(',').map(f => f.trim()).filter(Boolean)){
    for(const c of lireCsv(fichier)) if(!vus.has(c.id)) vus.set(c.id, c);
  }
  return [...vus.values()];
}

function lireCsv(fichier){
  const lignes = fs.readFileSync(fichier, 'utf8').split(/\r?\n/).filter(Boolean);
  const entete = lignes[0].split(',');
  return lignes.slice(1).map(l => {
    const cols = l.split(',');
    const o = {};
    entete.forEach((h, i) => { o[h] = cols[i] === undefined || cols[i] === 'null' ? null : cols[i]; });
    return o;
  });
}

async function anneeTmdb(tmdbId, token){
  const res = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });
  if(!res.ok) return null;
  const d = await res.json();
  const annee = d.release_date ? parseInt(d.release_date.slice(0, 4), 10) : null;
  return annee && annee >= 1880 && annee <= 2100 ? annee : null;
}

async function main(){
  const args = process.argv.slice(2);
  const get = (nom) => { const i = args.indexOf('--' + nom); return i >= 0 ? args[i + 1] : null; };
  const token = process.env.TMDB_TOKEN;
  const cartes = get('cards'), sortie = get('out') || 'annees.sql';
  if(!token || !cartes){
    console.error('Usage : TMDB_TOKEN=... node supabase/scripts/annees-cartes.js --cards <export.csv> [--out annees.sql]');
    process.exit(1);
  }
  const films = lireCsvs(cartes).filter(c => c.card_type === 'film' && c.tmdb_id);
  const sql = ['begin;'];
  let trouvees = 0, sansAnnee = 0;
  for(const c of films){
    const annee = await anneeTmdb(c.tmdb_id, token);
    if(annee){
      sql.push(`update public.tcg_cards set release_year = ${annee} where id = ${Number(c.id)} and release_year is null;`);
      trouvees++;
    } else sansAnnee++;
    await new Promise(r => setTimeout(r, 60)); // reste sous la limite de débit TMDB
  }
  sql.push('commit;');
  fs.writeFileSync(sortie, sql.join('\n') + '\n');
  console.log(`${trouvees} années trouvées, ${sansAnnee} sans année -> ${sortie}`);
}

if(require.main === module){
  main().catch(e => { console.error(e); process.exit(1); });
}
module.exports = { lireCsv, lireCsvs };
