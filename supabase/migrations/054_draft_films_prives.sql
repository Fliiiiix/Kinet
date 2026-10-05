-- BROUILLON, NON APPLIQUÉ (à appliquer par l'utilisateur dans Supabase).
-- Visibilité par film (décision validée) : un film marqué « privé » n'est plus
-- visible par les amis. Il reste visible et modifiable par son propriétaire.
--
-- Pas encore fait (voir A-FAIRE-PAR-TOI.md) : la fonction get_public_profile()
-- doit aussi exclure les films privés. Sa version actuelle (migration 032) sera
-- réécrite dans une migration à part, après relecture.

alter table public.films add column if not exists is_private boolean not null default false;

drop policy if exists "Friends can view shared films" on public.films;
create policy "Friends can view shared films"
  on public.films for select
  using (
    films.is_private = false
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester_id = auth.uid() and f.addressee_id = films.user_id)
          or (f.addressee_id = auth.uid() and f.requester_id = films.user_id))
    )
  );
