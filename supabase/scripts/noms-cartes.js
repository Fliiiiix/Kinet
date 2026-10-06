// --- Rattrapage des noms illisibles des cartes acteur / réalisateur ---
// Une carte dont le nom est dans son alphabet d'origine (cyrillique, japonais,
// chinois...) reste illisible pour un lecteur français. Ce script lit un export
// CSV des cartes (id, card_type, tmdb_id, name), trouve les noms sans aucune
// lettre latine, cherche leur version latine sur TMDB, et écrit un SQL à relire.
//
// Usage :
//   TMDB_TOKEN=... node supabase/scripts/noms-cartes.js --cards <export.csv> --out noms.sql
//
// Export à faire dans l'éditeur SQL Supabase :
//   select id, card_type, tmdb_id, name from public.tcg_cards order by id;
//
// Jeton TMDB lu dans l'environnement, jamais écrit dans ce fichier. La règle de
// « latin » est la même que dans js/tcg.js (nomLatin).
const fs = require('fs');
const { lireCsvs } = require('./annees-cartes.js');

const LATIN = /[A-Za-z]/;
const LATIN_SEUL = /^[A-Za-z\u00C0-\u024F .'\-]+$/;

function echapperSql(s){ return String(s).replace(/'/g, "''"); }

async function nomLatinTmdb(name, personId, token){
  const res = await fetch(`https://api.themoviedb.org/3/person/${personId}?language=en-US`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });
  if(!res.ok) return null;
  const d = await res.json();
  if(d.name && LATIN_SEUL.test(d.name)) return d.name;
  return (d.also_known_as || []).find(n => LATIN_SEUL.test(n)) || null;
}

async function main(){
  const args = process.argv.slice(2);
  const get = (nom) => { const i = args.indexOf('--' + nom); return i >= 0 ? args[i + 1] : null; };
  const token = process.env.TMDB_TOKEN;
  const cartes = get('cards'), sortie = get('out') || 'noms.sql';
  if(!token || !cartes){
    console.error('Usage : TMDB_TOKEN=... node supabase/scripts/noms-cartes.js --cards <export.csv> [--out noms.sql]');
    process.exit(1);
  }
  const personnes = lireCsvs(cartes).filter(c => (c.card_type === 'actor' || c.card_type === 'director') && c.tmdb_id && c.name && !LATIN.test(c.name));
  const sql = ['begin;'];
  let corrigees = 0, introuvables = [];
  for(const c of personnes){
    const latin = await nomLatinTmdb(c.name, c.tmdb_id, token);
    if(latin){
      sql.push(`update public.tcg_cards set name = '${echapperSql(latin)}' where id = ${Number(c.id)};`);
      corrigees++;
    } else introuvables.push(`${c.id} (${c.name})`);
    await new Promise(r => setTimeout(r, 60));
  }
  sql.push('commit;');
  fs.writeFileSync(sortie, sql.join('\n') + '\n');
  console.log(`${corrigees} nom(s) corrigé(s) -> ${sortie}`);
  if(introuvables.length) console.log('Sans version latine sur TMDB (à corriger à la main) : ' + introuvables.join(', '));
}

if(require.main === module){
  main().catch(e => { console.error(e); process.exit(1); });
}
