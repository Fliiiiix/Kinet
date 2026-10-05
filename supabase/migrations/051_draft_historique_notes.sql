-- BROUILLON, NON APPLIQUÉ (à appliquer par l'utilisateur dans Supabase).
-- Historique des notes (décision validée) : une ligne à chaque changement de
-- la note d'un film (grille de critères ou note manuelle). Lisible par son
-- propriétaire seulement ; écrit uniquement par le trigger ci-dessous.

create table if not exists public.film_note_history (
  id bigint generated always as identity primary key,
  film_id bigint not null references public.films(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  crit_avant jsonb,
  crit_apres jsonb,
  manuelle_avant numeric,
  manuelle_apres numeric,
  changed_at timestamptz not null default now()
);

create index if not exists film_note_history_film_idx on public.film_note_history (film_id, changed_at);

alter table public.film_note_history enable row level security;

drop policy if exists "note_history_select_own" on public.film_note_history;
create policy "note_history_select_own" on public.film_note_history
  for select using (auth.uid() = user_id);

create or replace function public.log_film_note_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  if new.crit is distinct from old.crit or new.manual_note is distinct from old.manual_note then
    insert into public.film_note_history (film_id, user_id, crit_avant, crit_apres, manuelle_avant, manuelle_apres)
    values (new.id, new.user_id, old.crit, new.crit, old.manual_note, new.manual_note);
  end if;
  return new;
end;
$func$;

drop trigger if exists films_note_history on public.films;
create trigger films_note_history
  after update of crit, manual_note on public.films
  for each row execute function public.log_film_note_change();
