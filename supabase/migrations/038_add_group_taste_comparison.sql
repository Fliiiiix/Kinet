-- Comparaison de goûts élargie (groupe entier), retour utilisateur — la
-- compatibilité ciné existante (get_friend_compatibility, migrations/022)
-- ne compare que 2 personnes à la fois ; "Goûts du groupe"
-- (get_group_top_films, migrations/022, corrigée en 034) n'affiche que la
-- moyenne du groupe par film, jamais qui a mis quelle note. Cette fonction
-- renvoie le détail par membre pour les mêmes films (notés par ≥2 membres,
-- même CTE `rated` que get_group_top_films) — notes agrégées en JSON par
-- film plutôt qu'une ligne par (film, membre) : plus simple à consommer
-- côté client (un seul film à retrouver par tmdb_id, pas à regrouper
-- soi-même). Nouvelle fonction plutôt que d'étendre get_group_top_films en
-- place : ce dernier a déjà un appelant qui n'a besoin QUE de l'agrégat
-- (renderGroupTopFilms, js/groups.js), pas la peine de lui faire porter
-- une charge JSON à chaque appel qu'il n'utilisera jamais.
create or replace function public.get_group_taste_comparison(p_group_id bigint, p_limit int default 20)
returns table(
  tmdb_id integer,
  title text,
  poster_url text,
  release_year integer,
  avg_note numeric,
  notes jsonb
)
language sql
security definer
set search_path = public
stable
as $func$
  with rated as (
    select
      f.tmdb_id,
      f.title,
      f.poster_url,
      f.release_year,
      f.user_id,
      coalesce(f.manual_note, (
        select round(avg(v.value::numeric) * 10) / 2
        from jsonb_each_text(f.crit) as v
      )) as note
    from public.films f
    join public.group_members gm on gm.user_id = f.user_id and gm.group_id = p_group_id
    where f.tmdb_id is not null
      and public.is_group_member(p_group_id)
  )
  select
    tmdb_id,
    max(title) as title,
    max(poster_url) as poster_url,
    max(release_year) as release_year,
    round(avg(note), 2) as avg_note,
    jsonb_agg(jsonb_build_object('user_id', user_id, 'note', note) order by note desc) as notes
  from rated
  where note is not null
  group by tmdb_id
  having count(*) >= 2
  order by avg_note desc
  limit p_limit;
$func$;

revoke all on function public.get_group_taste_comparison(bigint, int) from public;
grant execute on function public.get_group_taste_comparison(bigint, int) to authenticated;
