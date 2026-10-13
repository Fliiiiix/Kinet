-- Notes des amis directement sur la fiche film (retour utilisateur, étude
-- comparative Letterboxd/Goodreads) : jusqu'ici la fiche #/film/:tmdbId
-- n'affichait que la note moyenne COMMUNAUTAIRE globale (get_film_stats,
-- migrations/030) — jamais qui, PARMI MES AMIS, l'a vu/noté. Même principe
-- que get_watchlist_friend_ratings() (migrations/039) : jointure fiable sur
-- tmdb_id, jamais le titre, et public.are_friends() pour la restriction
-- "amis uniquement" (jamais tout le monde, contrairement à la moyenne
-- globale qui elle reste communautaire).
--
-- NB : ne filtre pas encore sur is_private (migrations/054_draft, pas
-- encore appliquée à ce jour) — à revoir une fois 054 appliquée, pour
-- exclure un film qu'un ami a explicitement marqué privé, comme
-- get_public_profile() le fait déjà (migrations/055_draft).
create or replace function public.get_film_friend_ratings(p_tmdb_id integer)
returns table(friend_id uuid, note numeric)
language sql
security definer
set search_path = public
stable
as $func$
  select f.user_id as friend_id,
    coalesce(f.manual_note, (
      select round(avg(v.value::numeric) * 10) / 2
      from jsonb_each_text(f.crit) as v
    )) as note
  from public.films f
  where f.tmdb_id = p_tmdb_id
    and f.user_id <> auth.uid()
    and public.are_friends(auth.uid(), f.user_id)
    and coalesce(f.manual_note, (
      select round(avg(v.value::numeric) * 10) / 2
      from jsonb_each_text(f.crit) as v
    )) is not null;
$func$;

revoke all on function public.get_film_friend_ratings(integer) from public;
grant execute on function public.get_film_friend_ratings(integer) to authenticated;
