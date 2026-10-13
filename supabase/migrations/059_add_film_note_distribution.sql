-- Histogramme de répartition des notes sur la fiche film (retour
-- utilisateur, étude comparative Letterboxd/Goodreads) : jusqu'ici la
-- fiche #/film/:tmdbId n'affichait qu'une moyenne unique (get_film_stats,
-- migrations/030), jamais comment ces notes se répartissent. 11 paliers
-- fixes (0 à 5 par pas de 0.5, le même pas que la grille de notation,
-- voir js/data.js CRITERIA et le slider manuel) : generate_series()
-- garantit que chaque palier apparaît même à zéro vote, pas seulement ceux
-- effectivement notés — renderBarChart() (js/stats.js) attend exactement
-- cette forme ("11 barres fixes", déjà prévu dans son commentaire
-- d'origine).
create or replace function public.get_film_note_distribution(p_tmdb_id integer)
returns table(note numeric, note_count integer)
language sql
security definer
set search_path = public
stable
as $func$
  select bucket.note, count(rated.tmdb_id)::integer as note_count
  from generate_series(0, 5, 0.5) as bucket(note)
  left join (
    select f.tmdb_id, coalesce(f.manual_note, (
      select round(avg(v.value::numeric) * 10) / 2
      from jsonb_each_text(f.crit) as v
    )) as note
    from public.films f
    where f.tmdb_id = p_tmdb_id
  ) rated on rated.note = bucket.note
  group by bucket.note
  order by bucket.note;
$func$;

revoke all on function public.get_film_note_distribution(integer) from public;
grant execute on function public.get_film_note_distribution(integer) to authenticated;
