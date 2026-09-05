-- Préparation Trakt (import, chantier suivant — voir js/traktImport.js) :
-- table pour stocker le jeton OAuth de CHAQUE utilisateur qui connecte son
-- compte Trakt, une fois l'appli OAuth du site elle-même enregistrée par
-- son propriétaire sur trakt.tv/oauth/applications (client_id, voir
-- js/traktConfig.js — resté vide tant que ce n'est pas fait, l'import ne
-- peut pas se déclencher avant).
--
-- Une ligne par utilisateur (comme admin_config, user_activity_state) :
-- access_token/refresh_token propres à CE compte Kinet, jamais partagés.
-- refresh_token stocké pour renouveler sans repasser par l'écran
-- d'autorisation Trakt à chaque expiration (Trakt expire ses access_token
-- après quelques mois).
create table public.trakt_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  connected_at timestamptz not null default now()
);

alter table public.trakt_tokens enable row level security;

-- Chacun ne voit/modifie que son propre jeton — jamais lisible par un
-- autre compte, y compris l'admin (contrairement à feedback/changelog,
-- rien ici ne justifie une policy admin à part).
create policy "Users can view own trakt token"
  on public.trakt_tokens for select
  using (auth.uid() = user_id);

create policy "Users can insert own trakt token"
  on public.trakt_tokens for insert
  with check (auth.uid() = user_id);

create policy "Users can update own trakt token"
  on public.trakt_tokens for update
  using (auth.uid() = user_id);

create policy "Users can delete own trakt token"
  on public.trakt_tokens for delete
  using (auth.uid() = user_id);
