-- Audit des six écrans (16/10), Groupes piste A choisie par Flix : après la
-- séance, « On l'a vu » range le film élu dans « Déjà vus ensemble ».
-- À lancer dans l'éditeur SQL de Supabase. Sans elle, le bouton « On l'a vu »
-- reste masqué et « Déjà vus ensemble » s'appuie sur l'historique des élections.

alter table public.group_proposals add column if not exists seen_at timestamptz;

-- N'importe quel membre du groupe peut dire que le groupe a vu le film élu.
create or replace function public.mark_proposal_seen(p_group_id bigint, p_proposal_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'not group member';
  end if;
  update public.group_proposals
    set seen_at = now(), chosen = false
    where id = p_proposal_id and group_id = p_group_id;
end;
$$;

revoke all on function public.mark_proposal_seen(bigint, bigint) from public;
grant execute on function public.mark_proposal_seen(bigint, bigint) to authenticated;
