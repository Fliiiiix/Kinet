-- Alerte "un ami a noté un film de ta watchlist" (retour utilisateur) —
-- jointure sur tmdb_id entre `watchlist` et `films`, jamais sur le titre
-- (activity_events dénormalise le titre en texte, migrations/019, bien
-- trop fragile pour un rapprochement fiable : deux fiches différentes
-- peuvent partager un titre, une même fiche peut avoir un titre traduit
-- différemment). tmdb_id est déjà l'identifiant fiable utilisé partout
-- ailleurs dans l'app pour rapprocher deux films (get_film_stats,
-- migrations/030, get_friend_recommendations, migrations/021).
create or replace function public.get_watchlist_friend_ratings()
returns table(watchlist_id bigint, tmdb_id integer, friend_id uuid, note numeric)
language sql
security definer
set search_path = public
stable
as $func$
  with rated as (
    select f.tmdb_id, f.user_id,
      coalesce(f.manual_note, (
        select round(avg(v.value::numeric) * 10) / 2
        from jsonb_each_text(f.crit) as v
      )) as note
    from public.films f
    where f.user_id <> auth.uid()
      and f.tmdb_id is not null
      and public.are_friends(auth.uid(), f.user_id)
  )
  select w.id as watchlist_id, w.tmdb_id, r.user_id as friend_id, r.note
  from public.watchlist w
  join rated r on r.tmdb_id = w.tmdb_id
  where w.user_id = auth.uid()
    and r.note is not null;
$func$;

revoke all on function public.get_watchlist_friend_ratings() from public;
grant execute on function public.get_watchlist_friend_ratings() to authenticated;
