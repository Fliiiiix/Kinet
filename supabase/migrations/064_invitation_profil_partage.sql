-- Profil partagé, piste A du 15/10 (« Partager et inviter », choix de Flix).
-- À lancer dans Supabase.
--
-- Quelqu'un ouvre le lien de ton profil, crée son compte depuis « Rejoindre
-- Kinet » : il t'a déjà en ami. Partager le lien vaut accord de ta part (le
-- panneau « Partager » le dit), cliquer sur « Rejoindre » vaut le sien.
--
-- accept_profile_invite(p_owner) :
-- - ne fait rien si le profil n'est pas (ou plus) partagé, ni pour soi-même ;
-- - déjà amis : rien à faire ;
-- - une demande en attente, dans un sens ou l'autre : acceptée ;
-- - une demande refusée : on la respecte, rien ne change ;
-- - sinon : amitié créée, déjà acceptée.
-- Renvoie vrai si vous êtes amis à la sortie.

create or replace function public.accept_profile_invite(p_owner uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing public.friendships%rowtype;
begin
  if me is null or p_owner is null or me = p_owner then
    return false;
  end if;
  if not exists (select 1 from public.profiles where user_id = p_owner and public_profile = true) then
    return false;
  end if;

  select * into existing from public.friendships
    where (requester_id = me and addressee_id = p_owner)
       or (requester_id = p_owner and addressee_id = me)
    limit 1;

  if found then
    if existing.status = 'accepted' then
      return true;
    elsif existing.status = 'pending' then
      update public.friendships set status = 'accepted', responded_at = now() where id = existing.id;
      return true;
    else
      return false;
    end if;
  end if;

  insert into public.friendships (requester_id, addressee_id, status, responded_at)
    values (p_owner, me, 'accepted', now());
  return true;
end;
$$;

revoke execute on function public.accept_profile_invite(uuid) from public, anon;
grant execute on function public.accept_profile_invite(uuid) to authenticated;
