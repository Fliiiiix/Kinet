-- BROUILLON, NON APPLIQUÉ (à relire avant d'exécuter dans Supabase).
-- Classement entre amis (roadmap) : renvoie, pour moi et mes amis acceptés
-- uniquement, deux totaux : cartes possédées et films notés. Aucune note,
-- aucun titre, aucun contenu n'est exposé : seuls des compteurs.
--
-- Pourquoi une fonction et pas une lecture directe : les règles RLS actuelles
-- ne permettent pas de compter les films ou cartes d'un ami sans lui donner
-- accès à toutes ses lignes. La fonction contourne cela en ne renvoyant QUE
-- les compteurs, et seulement pour les amis acceptés.

create or replace function public.classement_amis()
returns table (user_id uuid, cartes_possedees bigint, films_notes bigint)
language sql
stable
security definer
set search_path = public
as $func$
  with amis as (
    select case when requester_id = auth.uid() then addressee_id else requester_id end as user_id
    from public.friendships
    where status = 'accepted' and (requester_id = auth.uid() or addressee_id = auth.uid())
  ),
  moi_et_amis as (
    select auth.uid() as user_id
    union
    select user_id from amis
  )
  select m.user_id,
         (select count(*) from public.tcg_user_cards c where c.user_id = m.user_id and c.quantity > 0) as cartes_possedees,
         (select count(*) from public.films f where f.user_id = m.user_id and (f.manual_note is not null or f.crit is not null)) as films_notes
  from moi_et_amis m;
$func$;

revoke all on function public.classement_amis() from public;
grant execute on function public.classement_amis() to authenticated;
