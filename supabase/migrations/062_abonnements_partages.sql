-- Mes abonnements partagés entre appareils (draft Profil du 15/10, choix de
-- Flix : « les mêmes sur PC et téléphone »). À lancer dans Supabase.
--
-- Les plateformes cochées dans À voir → Mes abonnements étaient gardées sur
-- l'appareil seulement (localStorage). Elles vivent désormais dans une
-- petite table de préférences, une ligne par compte, que seul son
-- propriétaire peut lire et modifier. Pas dans profiles : cette table-là est
-- lisible par tous les comptes connectés (migration 009).
--
-- streaming_services : noms de plateformes en minuscules (« netflix »,
-- « canal+ »...). Le premier appareil qui se connecte après la migration y
-- range ce qu'il avait déjà coché (syncMyStreamingServices(),
-- js/watchlist.js).

create table if not exists public.user_prefs (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  streaming_services text[],
  updated_at timestamptz not null default now()
);

alter table public.user_prefs enable row level security;

drop policy if exists "user_prefs_select_own" on public.user_prefs;
create policy "user_prefs_select_own" on public.user_prefs
  for select using (auth.uid() = user_id);

drop policy if exists "user_prefs_insert_own" on public.user_prefs;
create policy "user_prefs_insert_own" on public.user_prefs
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_prefs_update_own" on public.user_prefs;
create policy "user_prefs_update_own" on public.user_prefs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
