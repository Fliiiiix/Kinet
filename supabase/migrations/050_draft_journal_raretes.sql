-- BROUILLON, NON APPLIQUÉ (à relire avant d'exécuter dans Supabase).
-- Journal des modifications de rareté (roadmap admin) : chaque changement de
-- rareté_override (ou de rareté_auto) est consigné avec l'ancienne et la
-- nouvelle valeur, la date et le compte qui l'a fait. Lecture réservée à
-- l'admin ; personne d'autre ne peut écrire dans le journal directement.

create table if not exists public.tcg_rarity_log (
  id bigint generated always as identity primary key,
  card_id bigint not null references public.tcg_cards(id) on delete cascade,
  champ text not null check (champ in ('rarity_override', 'rarity_auto')),
  ancienne text,
  nouvelle text,
  par_email text,
  changed_at timestamptz not null default now()
);

alter table public.tcg_rarity_log enable row level security;

drop policy if exists "rarity_log_admin_select" on public.tcg_rarity_log;
create policy "rarity_log_admin_select" on public.tcg_rarity_log
  for select using (coalesce(auth.jwt() ->> 'email', '') = 'sab.fxs@gmail.com');

create or replace function public.log_rarity_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  if new.rarity_override is distinct from old.rarity_override then
    insert into public.tcg_rarity_log (card_id, champ, ancienne, nouvelle, par_email)
    values (new.id, 'rarity_override', old.rarity_override, new.rarity_override, auth.jwt() ->> 'email');
  end if;
  if new.rarity_auto is distinct from old.rarity_auto then
    insert into public.tcg_rarity_log (card_id, champ, ancienne, nouvelle, par_email)
    values (new.id, 'rarity_auto', old.rarity_auto, new.rarity_auto, auth.jwt() ->> 'email');
  end if;
  return new;
end;
$func$;

drop trigger if exists tcg_cards_rarity_log on public.tcg_cards;
create trigger tcg_cards_rarity_log
  after update of rarity_override, rarity_auto on public.tcg_cards
  for each row execute function public.log_rarity_change();
