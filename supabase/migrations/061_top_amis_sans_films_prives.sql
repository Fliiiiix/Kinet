-- Top films (draft du 15/10, piste A, choix de Flix). À lancer dans Supabase.
-- Nécessite la migration 054 (colonne films.is_private), déjà appliquée.
--
-- 1. Le top de tes amis ne compte plus leurs films privés. La case « Privé :
--    mes amis ne voient pas ce film » le promet, mais get_friends_top_films()
--    (SECURITY DEFINER, donc au-dessus des règles RLS) les incluait : avec un
--    seul ami qui l'a noté, on devinait qui. Tes propres films privés restent
--    dans TON top des amis : ce sont les tiens.
--    Le top de tout le monde, lui, garde les films privés (choix de Flix) :
--    ce sont des moyennes sans nom, et sans eux il n'y aurait presque pas de
--    top public.
-- 2. Les deux classements sont réservés aux comptes connectés : comme le
--    reste de l'appli, ils ne se lisent plus sans session.
--
-- Le seuil « 2 notes minimum » se fait dans l'appli (js/top.js), rien à
-- changer ici : les fonctions renvoient toujours moyenne et nombre de notes.

create or replace function public.get_friends_top_films(p_limit int default 30)
returns table(
  tmdb_id integer,
  title text,
  poster_url text,
  release_year integer,
  avg_note numeric,
  rating_count integer
)
language sql
security definer
set search_path = public
stable
as $$
  with my_circle as (
    select auth.uid() as uid
    union
    select addressee_id from public.friendships
      where requester_id = auth.uid() and status = 'accepted'
    union
    select requester_id from public.friendships
      where addressee_id = auth.uid() and status = 'accepted'
  ),
  rated as (
    select
      f.tmdb_id,
      f.title,
      f.poster_url,
      f.release_year,
      coalesce(f.manual_note, (
        select round(avg(v.value::numeric) * 10) / 2
        from jsonb_each_text(f.crit) as v
      )) as note
    from public.films f
    join my_circle mc on mc.uid = f.user_id
    where f.tmdb_id is not null
      and (f.is_private = false or f.user_id = auth.uid())
  )
  select
    tmdb_id,
    max(title) as title,
    max(poster_url) as poster_url,
    max(release_year) as release_year,
    round(avg(note), 2) as avg_note,
    count(*)::integer as rating_count
  from rated
  where note is not null
  group by tmdb_id
  order by avg_note desc, rating_count desc
  limit p_limit;
$$;

revoke execute on function public.get_global_top_films(int) from public, anon;
revoke execute on function public.get_friends_top_films(int) from public, anon;
grant execute on function public.get_global_top_films(int) to authenticated;
grant execute on function public.get_friends_top_films(int) to authenticated;
