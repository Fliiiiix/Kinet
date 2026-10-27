-- « On regarde quoi ensemble ? » (idée 5 du 28/10). À lancer dans l'éditeur
-- SQL de Supabase.
--
-- Dans un groupe : les films qui sont dans les À voir d'au moins deux membres.
-- Les À voir restent privés (règles de la migration 006) : cette fonction ne
-- répond qu'à un membre du groupe (is_group_member(), migration 013) et ne
-- renvoie que des films communs, jamais la liste entière de quelqu'un.
-- Utilisée par js/groups.js ; sans elle, la section ne s'affiche pas.

create or replace function public.get_group_watchlist_overlap(p_group_id bigint)
returns table(
  tmdb_id integer,
  title text,
  poster_url text,
  release_year integer,
  member_ids uuid[],
  member_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.tmdb_id,
    (array_agg(w.title order by w.added desc))[1],
    (array_agg(w.poster_url order by w.added desc) filter (where w.poster_url is not null))[1],
    max(w.release_year),
    array_agg(distinct w.user_id),
    count(distinct w.user_id)::integer
  from public.watchlist w
  join public.group_members gm on gm.user_id = w.user_id and gm.group_id = p_group_id
  where w.tmdb_id is not null
    and public.is_group_member(p_group_id)
  group by w.tmdb_id
  having count(distinct w.user_id) >= 2
  order by count(distinct w.user_id) desc, max(w.added) desc
  limit 30;
$$;

revoke all on function public.get_group_watchlist_overlap(bigint) from public, anon;
grant execute on function public.get_group_watchlist_overlap(bigint) to authenticated, service_role;

-- Contrôle : la fonction existe (une ligne attendue).
select p.oid::regprocedure as fonction
from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
where ns.nspname = 'public' and p.proname = 'get_group_watchlist_overlap';
