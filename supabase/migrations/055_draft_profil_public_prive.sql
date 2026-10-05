-- BROUILLON, NON APPLIQUÉ. À appliquer APRÈS la migration 054 (colonne is_private).
-- Profil public (décision « visibilité par film ») : get_public_profile() ne
-- renvoie plus les films privés, ni dans la liste ni dans les films mis en avant.
-- Le reste de la fonction est identique à la migration 032.

drop function if exists public.get_public_profile(uuid);
create function public.get_public_profile(p_user_id uuid)
returns table(
  display_name text,
  avatar_url text,
  films jsonb,
  top_films jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.display_name,
    p.avatar_url,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'tmdb_id', f.tmdb_id,
        'title', f.title,
        'poster_url', f.poster_url,
        'release_year', f.release_year,
        'note', coalesce(f.manual_note, (
          select round(avg(v.value::numeric) * 10) / 2
          from jsonb_each_text(f.crit) as v
        )),
        'fav', f.fav
      ) order by coalesce(f.manual_note, (
          select round(avg(v.value::numeric) * 10) / 2
          from jsonb_each_text(f.crit) as v
        )) desc nulls last)
      from public.films f
      where f.user_id = p.user_id
        and f.is_private = false
    ), '[]'::jsonb) as films,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'tmdb_id', f.tmdb_id,
        'title', f.title,
        'poster_url', f.poster_url,
        'release_year', f.release_year
      ) order by ord.pos)
      from unnest(p.top_films) with ordinality as ord(tmdb_id, pos)
      join public.films f on f.tmdb_id = ord.tmdb_id and f.user_id = p.user_id and f.is_private = false
    ), '[]'::jsonb) as top_films
  from public.profiles p
  where p.user_id = p_user_id and p.public_profile = true;
$$;

revoke all on function public.get_public_profile(uuid) from public;
grant execute on function public.get_public_profile(uuid) to anon, authenticated;
