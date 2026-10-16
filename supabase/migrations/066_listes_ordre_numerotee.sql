-- Audit des six écrans (16/10), Listes piste A choisie par Flix : réordonner
-- les films d'une liste et la numéroter (un top).
-- À lancer dans l'éditeur SQL de Supabase. Sans elle, l'ordre et « Numérotée »
-- ne s'enregistrent pas (renommer et ajouter marchent déjà).

alter table public.lists add column if not exists numbered boolean not null default false;

-- Changer la position d'un film de sa propre liste.
drop policy if exists "Users can reorder items of own lists" on public.list_items;
create policy "Users can reorder items of own lists"
  on public.list_items for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.lists l where l.id = list_id and l.user_id = auth.uid())
  );
