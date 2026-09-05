-- Table des films notés, un jeu de données par utilisateur (RLS).
-- À exécuter dans Supabase → SQL Editor (nouveau projet). Pour un projet
-- déjà provisionné avec une version antérieure de ce schéma, voir plutôt
-- supabase/migrations/ pour les changements incrémentaux.

create table public.films (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  crit jsonb not null,
  fav boolean not null default false,
  added bigint not null,
  -- Note sur 5 saisie directement, en bypass de la grille de 7 critères —
  -- pour les films notés avec un référentiel différent (voir migrations/002).
  manual_note numeric,
  -- Commentaire libre (voir migrations/003).
  review text,
  -- Métadonnées TMDB, remplies à l'ajout via recherche (voir migrations/004).
  tmdb_id integer,
  poster_url text,
  overview text,
  release_year integer,
  -- Titre en langue d'origine, à côté du titre FR ci-dessus — pour que la
  -- recherche matche indifféremment "créatures féroces" ou "fierce creatures"
  -- sans traduction automatique (voir migrations/008).
  original_title text,
  -- Genres TMDB (v2.1, migrations/029) — id numérique brut (pas le libellé,
  -- traduit côté client via GENRE_MAP dans js/data.js).
  genre_ids integer[],
  created_at timestamptz not null default now()
);

alter table public.films enable row level security;

-- Chacun ne voit / modifie que ses propres films.
create policy "Users can view own films"
  on public.films for select
  using (auth.uid() = user_id);

create policy "Users can insert own films"
  on public.films for insert
  with check (auth.uid() = user_id);

create policy "Users can update own films"
  on public.films for update
  using (auth.uid() = user_id);

create policy "Users can delete own films"
  on public.films for delete
  using (auth.uid() = user_id);

-- Profil par utilisateur (pseudo + avatar), voir migrations/005.
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  -- Opt-in pour la page publique #/u/:userId, voir get_public_profile()
  -- plus bas et migrations/016. false par défaut : personne n'est exposé
  -- sans l'avoir explicitement choisi.
  public_profile boolean not null default false,
  -- Top films perso (v2.3, retour utilisateur : "un top films comme
  -- Letterboxd, mis en avant par choix pas par note") — tmdb_id choisis à la
  -- main, dans l'ordre voulu, au plus 4 ; résolu par get_public_profile()
  -- plus bas en rejoignant le catalogue déjà noté du propriétaire (jamais
  -- interrogé seul, pas la granularité qui justifierait une table à part —
  -- même raisonnement que films.genre_ids, migrations/029).
  top_films integer[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint profiles_top_films_max4
    check (array_length(top_films, 1) is null or array_length(top_films, 1) <= 4)
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = user_id);

-- Élargie par migrations/009 pour la recherche d'amis par pseudo — ne
-- concerne que display_name/avatar_url, jamais l'email.
create policy "Authenticated users can view all profiles"
  on public.profiles for select
  using (auth.role() = 'authenticated');

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = user_id);

-- Watchlist ("à voir"), séparée du catalogue noté, voir migrations/006.
create table public.watchlist (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  note text,
  tmdb_id integer,
  poster_url text,
  overview text,
  release_year integer,
  original_title text,
  -- Date de sortie complète (pas juste l'année), voir migrations/025 —
  -- utilisée par la section Prochaines sorties (js/upcoming.js).
  release_date date,
  added bigint not null,
  created_at timestamptz not null default now()
);

alter table public.watchlist enable row level security;

create policy "Users can view own watchlist"
  on public.watchlist for select
  using (auth.uid() = user_id);

create policy "Users can insert own watchlist"
  on public.watchlist for insert
  with check (auth.uid() = user_id);

create policy "Users can update own watchlist"
  on public.watchlist for update
  using (auth.uid() = user_id);

create policy "Users can delete own watchlist"
  on public.watchlist for delete
  using (auth.uid() = user_id);

-- Séries suivies, section à part du catalogue films, voir migrations/024.
create table public.tv_shows (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tmdb_id integer not null,
  title text not null,
  poster_url text,
  overview text,
  first_air_year integer,
  status text,
  number_of_seasons integer,
  number_of_episodes integer,
  in_production boolean,
  manual_note numeric,
  review text,
  added bigint not null,
  created_at timestamptz not null default now(),
  unique (user_id, tmdb_id)
);

alter table public.tv_shows enable row level security;

create policy "Users can view own tv shows"
  on public.tv_shows for select
  using (auth.uid() = user_id);

create policy "Users can insert own tv shows"
  on public.tv_shows for insert
  with check (auth.uid() = user_id);

create policy "Users can update own tv shows"
  on public.tv_shows for update
  using (auth.uid() = user_id);

create policy "Users can delete own tv shows"
  on public.tv_shows for delete
  using (auth.uid() = user_id);

-- Épisodes vus, une ligne par épisode — voir migrations/024.
create table public.tv_episodes_watched (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tv_show_id bigint not null references public.tv_shows(id) on delete cascade,
  season_number integer not null,
  episode_number integer not null,
  watched_at bigint not null,
  -- Optionnels (migrations/036) : note par épisode, jamais promue comme
  -- l'essentiel (voir tv_shows.manual_note, la note globale) — voir
  -- js/series.js. times_watched : un compteur direct plutôt qu'un
  -- historique façon `viewings` (une ligne par film) — l'utilisateur
  -- demande un NOMBRE de fois vu, pas une date par revisionnage.
  note numeric,
  times_watched integer not null default 1,
  unique (user_id, tv_show_id, season_number, episode_number)
);

alter table public.tv_episodes_watched enable row level security;

create policy "Users can view own watched episodes"
  on public.tv_episodes_watched for select
  using (auth.uid() = user_id);

create policy "Users can insert own watched episodes"
  on public.tv_episodes_watched for insert
  with check (auth.uid() = user_id);

create policy "Users can update own watched episodes"
  on public.tv_episodes_watched for update
  using (auth.uid() = user_id);

create policy "Users can delete own watched episodes"
  on public.tv_episodes_watched for delete
  using (auth.uid() = user_id);

-- Journal des visionnages (revisionnages), voir migrations/007.
create table public.viewings (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  film_id bigint not null references public.films(id) on delete cascade,
  watched_at bigint not null,
  note text,
  created_at timestamptz not null default now()
);

alter table public.viewings enable row level security;

create policy "Users can view own viewings"
  on public.viewings for select
  using (auth.uid() = user_id);

create policy "Users can insert own viewings"
  on public.viewings for insert
  with check (auth.uid() = user_id);

create policy "Users can update own viewings"
  on public.viewings for update
  using (auth.uid() = user_id);

create policy "Users can delete own viewings"
  on public.viewings for delete
  using (auth.uid() = user_id);

-- Amis : demande / acceptation, et visibilité croisée du catalogue noté
-- (lecture seule) une fois amis, voir migrations/009 et js/friends.js.
create table public.friendships (
  id bigint generated always as identity primary key,
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friendships_no_self check (requester_id <> addressee_id),
  constraint friendships_unique_pair unique (requester_id, addressee_id)
);

alter table public.friendships enable row level security;

create policy "Users can view their friendships"
  on public.friendships for select
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "Users can send friend requests"
  on public.friendships for insert
  with check (auth.uid() = requester_id);

create policy "Addressee can respond to a request"
  on public.friendships for update
  using (auth.uid() = addressee_id)
  with check (auth.uid() = addressee_id);

create policy "Either side can remove a friendship"
  on public.friendships for delete
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "Friends can view shared films"
  on public.films for select
  using (
    exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester_id = auth.uid() and f.addressee_id = films.user_id)
          or (f.addressee_id = auth.uid() and f.requester_id = films.user_id))
    )
  );

-- Recherche d'un ami par email exact sans exposer auth.users côté client —
-- voir migrations/009 pour le détail des garanties (pas de LIKE, pas
-- d'énumération en masse).
create or replace function public.find_user_by_email(search_email text)
returns table(user_id uuid, display_name text, avatar_url text)
language sql
security definer
set search_path = public
as $$
  select p.user_id, p.display_name, p.avatar_url
  from auth.users u
  join public.profiles p on p.user_id = u.id
  where lower(u.email) = lower(search_email)
    and u.id <> auth.uid()
  limit 1;
$$;

revoke all on function public.find_user_by_email(text) from public;
grant execute on function public.find_user_by_email(text) to authenticated;

-- Mode maintenance, voir migrations/010 et js/auth.js. Ligne unique,
-- modifiable seulement depuis le dashboard Supabase (Table Editor).
create table public.site_status (
  id integer primary key default 1,
  maintenance boolean not null default false,
  message text,
  updated_at timestamptz not null default now(),
  constraint site_status_single_row check (id = 1)
);

alter table public.site_status enable row level security;

create policy "Anyone can read site status"
  on public.site_status for select
  using (true);

insert into public.site_status (id, maintenance) values (1, false);

-- Groupes (famille/amis), voir migrations/011 et js/groups.js.
create table public.groups (
  id bigint generated always as identity primary key,
  name text not null,
  description text,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.groups enable row level security;

create table public.group_members (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  constraint group_members_unique unique (group_id, user_id)
);

alter table public.group_members enable row level security;

-- Vérifie l'appartenance à un groupe en SECURITY DEFINER (même pattern que
-- find_user_by_email plus haut) : une policy sur group_members qui
-- s'auto-interroge dans sa propre USING clause provoque une récursion
-- infinie côté Postgres (42P17) — voir migrations/013 pour l'historique.
create or replace function public.is_group_member(p_group_id bigint, p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = p_user_id
  );
$$;

revoke all on function public.is_group_member(bigint, uuid) from public;
grant execute on function public.is_group_member(bigint, uuid) to authenticated;

-- Le propriétaire voit toujours son propre groupe directement par owner_id,
-- sans dépendre de group_members : le trigger qui l'y ajoute (plus bas)
-- s'exécute après l'évaluation de cette policy pour le RETURNING de
-- l'insert (js/groups.js), donc une dépendance exclusive à
-- is_group_member() échoue à la création — voir migrations/014.
create policy "Members can view their groups"
  on public.groups for select
  using (owner_id = auth.uid() or public.is_group_member(id));

create policy "Users can create groups"
  on public.groups for insert
  with check (owner_id = auth.uid());

create policy "Owner can update group"
  on public.groups for update
  using (owner_id = auth.uid());

create policy "Owner can delete group"
  on public.groups for delete
  using (owner_id = auth.uid());

create policy "Members can view fellow group members"
  on public.group_members for select
  using (public.is_group_member(group_id));

create policy "Owner can add members"
  on public.group_members for insert
  with check (
    exists (select 1 from public.groups g where g.id = group_id and g.owner_id = auth.uid())
  );

create policy "Owner or self can remove a member"
  on public.group_members for delete
  using (
    user_id = auth.uid()
    or exists (select 1 from public.groups g where g.id = group_id and g.owner_id = auth.uid())
  );

create or replace function public.add_group_owner_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.group_members (group_id, user_id) values (new.id, new.owner_id);
  return new;
end;
$$;

create trigger trg_add_group_owner_as_member
  after insert on public.groups
  for each row execute function public.add_group_owner_as_member();

-- Propositions de films au sein d'un groupe : vote + discussion, voir
-- migrations/012 et js/proposals.js.
create table public.group_proposals (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.groups(id) on delete cascade,
  proposed_by uuid not null references auth.users(id) on delete cascade,
  title text not null,
  original_title text,
  tmdb_id integer,
  poster_url text,
  overview text,
  release_year integer,
  -- "Séance élue" (v1.6, migrations/020) : le créateur du groupe marque une
  -- proposition comme le prochain film à voir, avec une date optionnelle.
  chosen boolean not null default false,
  chosen_at timestamptz,
  watch_date date,
  created_at timestamptz not null default now()
);

alter table public.group_proposals enable row level security;

-- Un seul film "élu" à la fois par groupe (index partiel plutôt qu'une
-- colonne à part sur `groups`, qui obligerait une transaction séparée pour
-- rester cohérente avec cette table).
create unique index group_proposals_one_chosen on public.group_proposals(group_id) where chosen;

create table public.group_proposal_votes (
  id bigint generated always as identity primary key,
  proposal_id bigint not null references public.group_proposals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  value smallint not null check (value in (1, -1)),
  created_at timestamptz not null default now(),
  constraint group_proposal_votes_unique unique (proposal_id, user_id)
);

alter table public.group_proposal_votes enable row level security;

create table public.group_proposal_comments (
  id bigint generated always as identity primary key,
  proposal_id bigint not null references public.group_proposals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.group_proposal_comments enable row level security;

create policy "Members can view group proposals"
  on public.group_proposals for select
  using (
    exists (
      select 1 from public.group_members gm
      where gm.group_id = group_proposals.group_id and gm.user_id = auth.uid()
    )
  );

create policy "Members can propose films"
  on public.group_proposals for insert
  with check (
    proposed_by = auth.uid()
    and exists (
      select 1 from public.group_members gm
      where gm.group_id = group_id and gm.user_id = auth.uid()
    )
  );

create policy "Proposer or group owner can delete a proposal"
  on public.group_proposals for delete
  using (
    proposed_by = auth.uid()
    or exists (select 1 from public.groups g where g.id = group_id and g.owner_id = auth.uid())
  );

create policy "Members can view proposal votes"
  on public.group_proposal_votes for select
  using (
    exists (
      select 1 from public.group_proposals gp
      join public.group_members gm on gm.group_id = gp.group_id
      where gp.id = proposal_id and gm.user_id = auth.uid()
    )
  );

create policy "Members can vote"
  on public.group_proposal_votes for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.group_proposals gp
      join public.group_members gm on gm.group_id = gp.group_id
      where gp.id = proposal_id and gm.user_id = auth.uid()
    )
  );

create policy "Users can change their own vote"
  on public.group_proposal_votes for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can remove their own vote"
  on public.group_proposal_votes for delete
  using (user_id = auth.uid());

create policy "Members can view proposal comments"
  on public.group_proposal_comments for select
  using (
    exists (
      select 1 from public.group_proposals gp
      join public.group_members gm on gm.group_id = gp.group_id
      where gp.id = proposal_id and gm.user_id = auth.uid()
    )
  );

create policy "Members can comment"
  on public.group_proposal_comments for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.group_proposals gp
      join public.group_members gm on gm.group_id = gp.group_id
      where gp.id = proposal_id and gm.user_id = auth.uid()
    )
  );

create policy "Author or group owner can delete a comment"
  on public.group_proposal_comments for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.group_proposals gp
      join public.groups g on g.id = gp.group_id
      where gp.id = proposal_id and g.owner_id = auth.uid()
    )
  );

-- =========================================================================
-- Bloc synchronisé après coup (audit) : tables/fonctions des migrations
-- 018-023 qui existaient déjà sur le projet réel mais n'avaient jamais été
-- reportées ici — schema.sql n'était donc plus vraiment "le schéma complet
-- pour un nouveau projet" pour tout ce qui suit (invitations de groupe,
-- séance élue, fil d'activité, compatibilité ciné, suggestions/
-- recommandations d'amis, config admin, badges "vu"). Contenu inchangé par
-- rapport aux migrations d'origine, sauf get_group_top_films qui reprend
-- directement sa version corrigée (migrations/034 — voir la note sur les
-- notes null triées en premier, section Top films plus bas).
-- =========================================================================

-- --- Séance élue : owner-only vérifié en dur dans la fonction (pas une
-- policy UPDATE dédiée, pour garder l'unset-puis-set atomique dans la même
-- transaction et éviter une course contre l'index partiel unique
-- ci-dessus). Log aussi l'événement dans activity_events (voir plus bas).
create or replace function public.set_chosen_proposal(p_group_id bigint, p_proposal_id bigint, p_watch_date date default null)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if not exists (select 1 from public.groups where id = p_group_id and owner_id = auth.uid()) then
    raise exception 'not group owner';
  end if;

  update public.group_proposals set chosen = false, chosen_at = null, watch_date = null
    where group_id = p_group_id and chosen = true;
  update public.group_proposals set chosen = true, chosen_at = now(), watch_date = p_watch_date
    where id = p_proposal_id and group_id = p_group_id;

  insert into public.activity_events (scope, actor_id, group_id, event_type, target_label, target_poster_url, created_at)
  select 'group', auth.uid(), group_id, 'proposal_chosen', title, poster_url, now()
  from public.group_proposals where id = p_proposal_id and group_id = p_group_id;
end;
$func$;

revoke all on function public.set_chosen_proposal(bigint, bigint, date) from public;
grant execute on function public.set_chosen_proposal(bigint, bigint, date) to authenticated;

create or replace function public.unset_chosen_proposal(p_group_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if not exists (select 1 from public.groups where id = p_group_id and owner_id = auth.uid()) then
    raise exception 'not group owner';
  end if;

  update public.group_proposals set chosen = false, chosen_at = null, watch_date = null
    where group_id = p_group_id and chosen = true;
end;
$func$;

revoke all on function public.unset_chosen_proposal(bigint) from public;
grant execute on function public.unset_chosen_proposal(bigint) to authenticated;

-- --- Lien d'invitation de groupe --- pgcrypto pour gen_random_uuid() —
-- quasi toujours déjà actif sur un projet Supabase (auth.users en dépend),
-- "if not exists" par prudence uniquement.
create extension if not exists pgcrypto;

create table public.group_invites (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.groups(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  max_uses integer,
  use_count integer not null default 0
);

alter table public.group_invites enable row level security;

create policy "Owner can manage invites"
  on public.group_invites for all
  using (exists (select 1 from public.groups g where g.id = group_id and g.owner_id = auth.uid()))
  with check (exists (select 1 from public.groups g where g.id = group_id and g.owner_id = auth.uid()));

-- Aperçu avant connexion : doit marcher sans session, comme
-- get_public_profile plus bas — ne renvoie que de quoi afficher "tu es
-- invité·e à rejoindre X", jamais les colonnes internes de l'invite.
create or replace function public.get_group_invite_preview(p_token uuid)
returns table(group_id bigint, group_name text, valid boolean)
language sql
security definer
set search_path = public
stable
as $func$
  select g.id, g.name,
    (gi.expires_at is null or gi.expires_at > now())
      and (gi.max_uses is null or gi.use_count < gi.max_uses) as valid
  from public.group_invites gi
  join public.groups g on g.id = gi.group_id
  where gi.token = p_token;
$func$;

revoke all on function public.get_group_invite_preview(uuid) from public;
grant execute on function public.get_group_invite_preview(uuid) to anon, authenticated;

-- Rejoindre : connecté uniquement. N'ajoute QUE group_members (jamais
-- friendships, décision confirmée) — l'insertion déclenche déjà
-- trg_log_group_joined plus bas, pas besoin de logger l'activité ici en
-- plus. "on conflict do nothing" : rouvrir son propre lien une fois déjà
-- membre ne doit pas planter ni créer de doublon.
create or replace function public.accept_group_invite(p_token uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_group_id bigint;
  v_ok boolean;
begin
  select gi.group_id,
    (gi.expires_at is null or gi.expires_at > now()) and (gi.max_uses is null or gi.use_count < gi.max_uses)
  into v_group_id, v_ok
  from public.group_invites gi where gi.token = p_token;

  if v_group_id is null or not v_ok then
    return null;
  end if;

  insert into public.group_members (group_id, user_id) values (v_group_id, auth.uid())
    on conflict (group_id, user_id) do nothing;
  update public.group_invites set use_count = use_count + 1 where token = p_token;

  return v_group_id;
end;
$func$;

revoke all on function public.accept_group_invite(uuid) from public;
grant execute on function public.accept_group_invite(uuid) to authenticated;

-- --- Fil d'activité (Amis + Groupes) --- Une seule table pour les deux
-- portées (`scope`) : "note de film" (portée amis) n'a aucun horodatage
-- serveur fiable ailleurs (films.added est une horloge CLIENT, falsifiable,
-- jamais à utiliser pour un flux inter-utilisateurs). Aucune ligne n'est
-- jamais insérée par le client (pas de policy insert pour `authenticated`) :
-- tout passe par des fonctions trigger SECURITY DEFINER, même gabarit que
-- add_group_owner_as_member plus haut. Lignes dénormalisées (titre/affiche
-- copiés à l'écriture) plutôt qu'un FK polymorphe vers films/
-- group_proposals/group_proposal_comments (impossible proprement en SQL).
create table public.activity_events (
  id bigint generated always as identity primary key,
  scope text not null check (scope in ('friend', 'group')),
  actor_id uuid not null references auth.users(id) on delete cascade,
  group_id bigint references public.groups(id) on delete cascade, -- null si scope='friend'
  event_type text not null check (event_type in (
    'proposal_created', 'proposal_commented', 'proposal_chosen', 'group_joined', 'film_rated'
  )),
  target_label text,
  target_poster_url text,
  target_note numeric,
  created_at timestamptz not null default now()
);

alter table public.activity_events enable row level security;

-- Portée "group" : visible par tout membre du groupe concerné. Portée
-- "friend" : visible par l'auteur lui-même, et par ses amis acceptés —
-- même sous-requête que "Friends can view shared films" plus haut.
create policy "Visible activity events"
  on public.activity_events for select
  using (
    (scope = 'group' and group_id is not null and public.is_group_member(group_id))
    or (scope = 'friend' and (
      actor_id = auth.uid()
      or exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and ((f.requester_id = auth.uid() and f.addressee_id = activity_events.actor_id)
            or (f.addressee_id = auth.uid() and f.requester_id = activity_events.actor_id))
      )
    ))
  );

create or replace function public.log_proposal_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  insert into public.activity_events (scope, actor_id, group_id, event_type, target_label, target_poster_url, created_at)
  values ('group', new.proposed_by, new.group_id, 'proposal_created', new.title, new.poster_url, new.created_at);
  return new;
end;
$func$;

create trigger trg_log_proposal_created
  after insert on public.group_proposals
  for each row execute function public.log_proposal_created();

-- group_proposal_comments n'a pas de group_id direct : on le retrouve via
-- la proposition (comme le font déjà les policies RLS de cette table).
create or replace function public.log_proposal_commented()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_group_id bigint;
  v_title text;
  v_poster_url text;
begin
  select gp.group_id, gp.title, gp.poster_url into v_group_id, v_title, v_poster_url
  from public.group_proposals gp where gp.id = new.proposal_id;

  insert into public.activity_events (scope, actor_id, group_id, event_type, target_label, target_poster_url, created_at)
  values ('group', new.user_id, v_group_id, 'proposal_commented', v_title, v_poster_url, new.created_at);
  return new;
end;
$func$;

create trigger trg_log_proposal_commented
  after insert on public.group_proposal_comments
  for each row execute function public.log_proposal_commented();

-- Couvre aussi le créateur (ajouté par add_group_owner_as_member plus
-- haut) : c'est un vrai "a rejoint" pour le fil du groupe, sert de tout
-- premier événement visible dans un groupe fraîchement créé.
create or replace function public.log_group_joined()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  insert into public.activity_events (scope, actor_id, group_id, event_type, created_at)
  values ('group', new.user_id, new.group_id, 'group_joined', new.joined_at);
  return new;
end;
$func$;

create trigger trg_log_group_joined
  after insert on public.group_members
  for each row execute function public.log_group_joined();

-- Note de film (portée "friend") : nouvelle ligne seulement, pas une
-- modification — une note qui change sur un film déjà noté ne redéclenche
-- rien, pour éviter le bruit d'un ajustement mineur.
create or replace function public.log_film_rated()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_note numeric;
begin
  v_note := coalesce(new.manual_note, (
    select round(avg(v.value::numeric) * 10) / 2
    from jsonb_each_text(new.crit) as v
  ));
  insert into public.activity_events (scope, actor_id, group_id, event_type, target_label, target_poster_url, target_note, created_at)
  values ('friend', new.user_id, null, 'film_rated', new.title, new.poster_url, v_note, new.created_at);
  return new;
end;
$func$;

create trigger trg_log_film_rated
  after insert on public.films
  for each row execute function public.log_film_rated();

-- --- Suggestions d'amis : amis de mes amis, pas déjà amis / en attente ---
-- Le cas "profils existants qu'on n'a encore jamais ajoutés" ne demande
-- aucune fonction ici : profiles est déjà lisible par tout compte connecté,
-- une requête client simple suffit (voir js/friends.js).
create or replace function public.get_friend_suggestions(p_limit int default 10)
returns table(user_id uuid, display_name text, avatar_url text, mutual_count integer)
language sql
security definer
set search_path = public
stable
as $func$
  with my_friends as (
    select addressee_id as uid from public.friendships
      where requester_id = auth.uid() and status = 'accepted'
    union
    select requester_id as uid from public.friendships
      where addressee_id = auth.uid() and status = 'accepted'
  ),
  candidates as (
    select f.addressee_id as uid from public.friendships f
      join my_friends mf on mf.uid = f.requester_id
      where f.status = 'accepted'
    union all
    select f.requester_id as uid from public.friendships f
      join my_friends mf on mf.uid = f.addressee_id
      where f.status = 'accepted'
  )
  select c.uid, p.display_name, p.avatar_url, count(*)::integer as mutual_count
  from candidates c
  join public.profiles p on p.user_id = c.uid
  where c.uid <> auth.uid()
    and c.uid not in (select uid from my_friends)
    and not exists (
      select 1 from public.friendships f
      where f.status = 'pending'
        and ((f.requester_id = auth.uid() and f.addressee_id = c.uid)
          or (f.addressee_id = auth.uid() and f.requester_id = c.uid))
    )
  group by c.uid, p.display_name, p.avatar_url
  order by mutual_count desc
  limit p_limit;
$func$;

revoke all on function public.get_friend_suggestions(int) from public;
grant execute on function public.get_friend_suggestions(int) to authenticated;

-- --- Recommandations croisées : films aimés (>=4) par mon cercle, que je
-- n'ai pas encore notés --- même gabarit que get_friends_top_films plus
-- bas, mais exclut mon propre catalogue et applique un seuil. Le having
-- sur une moyenne qui peut être null exclut déjà, de fait, tout film sans
-- aucune note calculable (null >= 4 n'est jamais vrai) — contrairement à
-- get_group_top_films/get_global_top_films, pas concerné par le bug des
-- notes null triées en premier (voir migrations/033).
create or replace function public.get_friend_recommendations(p_limit int default 20)
returns table(
  tmdb_id integer,
  title text,
  poster_url text,
  release_year integer,
  avg_note numeric,
  rating_count integer
)
language sql
security definer
set search_path = public
stable
as $func$
  with my_circle as (
    select auth.uid() as uid
    union
    select addressee_id from public.friendships
      where requester_id = auth.uid() and status = 'accepted'
    union
    select requester_id from public.friendships
      where addressee_id = auth.uid() and status = 'accepted'
  ),
  mine as (
    select tmdb_id from public.films where user_id = auth.uid() and tmdb_id is not null
  )
  select
    f.tmdb_id,
    max(f.title) as title,
    max(f.poster_url) as poster_url,
    max(f.release_year) as release_year,
    round(avg(coalesce(f.manual_note, (
      select round(avg(v.value::numeric) * 10) / 2
      from jsonb_each_text(f.crit) as v
    ))), 2) as avg_note,
    count(*)::integer as rating_count
  from public.films f
  join my_circle mc on mc.uid = f.user_id and mc.uid <> auth.uid()
  where f.tmdb_id is not null
    and f.tmdb_id not in (select tmdb_id from mine)
  group by f.tmdb_id
  having avg(coalesce(f.manual_note, (
      select round(avg(v.value::numeric) * 10) / 2
      from jsonb_each_text(f.crit) as v
    ))) >= 4
  order by avg_note desc, rating_count desc
  limit p_limit;
$func$;

revoke all on function public.get_friend_recommendations(int) from public;
grant execute on function public.get_friend_recommendations(int) to authenticated;

-- --- Compatibilité ciné entre deux amis : moyenne des écarts de note sur
-- les films notés par les deux (recoupés par tmdb_id). Vérifie l'amitié
-- acceptée via un CTE qui reste vide si ce n'est pas le cas : le WHERE
-- exists(...) qui en dépend élimine alors toutes les lignes AVANT
-- l'agrégation, donc la fonction ne peut jamais exposer de comparaison de
-- notes entre deux comptes qui ne sont pas amis, même si elle lit les deux
-- catalogues en interne (SECURITY DEFINER, contournement RLS assumé).
create or replace function public.get_friend_compatibility(p_friend_id uuid)
returns table(compatibility numeric, common_count integer)
language sql
security definer
set search_path = public
stable
as $func$
  with ok as (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester_id = auth.uid() and addressee_id = p_friend_id)
        or (addressee_id = auth.uid() and requester_id = p_friend_id))
  ),
  mine as (
    select tmdb_id, coalesce(manual_note, (
      select round(avg(v.value::numeric) * 10) / 2
      from jsonb_each_text(crit) as v
    )) as note
    from public.films where user_id = auth.uid() and tmdb_id is not null
  ),
  theirs as (
    select tmdb_id, coalesce(manual_note, (
      select round(avg(v.value::numeric) * 10) / 2
      from jsonb_each_text(crit) as v
    )) as note
    from public.films where user_id = p_friend_id and tmdb_id is not null
  )
  select
    round(100 * (1 - avg(abs(m.note - t.note)) / 5), 1) as compatibility,
    count(*)::integer as common_count
  from mine m
  join theirs t on t.tmdb_id = m.tmdb_id
  where exists (select 1 from ok);
$func$;

revoke all on function public.get_friend_compatibility(uuid) from public;
grant execute on function public.get_friend_compatibility(uuid) to authenticated;

-- --- Goûts du groupe : films notés par au moins 2 membres (jamais un
-- seul — les membres d'un groupe n'ont normalement aucun accès en lecture
-- au catalogue individuel des autres, exposer un film noté par une seule
-- personne reviendrait à exposer sa note à tout le groupe). Version
-- corrigée directement (migrations/022 puis 034) : les lignes sans note
-- calculable sont filtrées AVANT le group by (CTE `rated`) plutôt qu'après
-- — voir la note sur les notes null triées en premier, section Top films
-- juste après.
create or replace function public.get_group_top_films(p_group_id bigint, p_limit int default 20)
returns table(
  tmdb_id integer,
  title text,
  poster_url text,
  release_year integer,
  avg_note numeric,
  rating_count integer
)
language sql
security definer
set search_path = public
stable
as $func$
  with rated as (
    select
      f.tmdb_id,
      f.title,
      f.poster_url,
      f.release_year,
      coalesce(f.manual_note, (
        select round(avg(v.value::numeric) * 10) / 2
        from jsonb_each_text(f.crit) as v
      )) as note
    from public.films f
    join public.group_members gm on gm.user_id = f.user_id and gm.group_id = p_group_id
    where f.tmdb_id is not null
      and public.is_group_member(p_group_id)
  )
  select
    tmdb_id,
    max(title) as title,
    max(poster_url) as poster_url,
    max(release_year) as release_year,
    round(avg(note), 2) as avg_note,
    count(*)::integer as rating_count
  from rated
  where note is not null
  group by tmdb_id
  having count(*) >= 2
  order by avg_note desc, rating_count desc
  limit p_limit;
$func$;

revoke all on function public.get_group_top_films(bigint, int) from public;
grant execute on function public.get_group_top_films(bigint, int) to authenticated;

-- --- Config admin (succès + happenings, v2.1) : un seul blob JSON par
-- utilisateur — les succès/happenings restent définis dans le code
-- (js/achievements.js, js/happenings.js), cette table ne stocke que les
-- écarts (seuil modifié, activé/désactivé, happenings "génériques" créés
-- depuis l'interface). Accessible à n'importe quel compte côté RLS
-- (chacun ne voit/modifie que sa propre ligne) — la restriction à un seul
-- email admin (ADMIN_EMAIL, js/admin.js) est un choix d'affichage côté
-- client, pas une vraie séparation de rôle en base, suffisant pour un
-- usage perso.
create table public.admin_config (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.admin_config enable row level security;

create policy "Users can view own admin config"
  on public.admin_config for select
  using (auth.uid() = user_id);

create policy "Users can insert own admin config"
  on public.admin_config for insert
  with check (auth.uid() = user_id);

create policy "Users can update own admin config"
  on public.admin_config for update
  using (auth.uid() = user_id);

-- --- Digest de retour + badges de notification (v1.6) : une seule ligne
-- par utilisateur, jamais localStorage — l'utilisateur se connecte déjà
-- depuis plusieurs appareils (upload d'avatar, etc.), un badge "vu" doit
-- suivre partout plutôt que rester coincé sur un seul appareil. Voir
-- js/activityState.js. last_seen_changelog ajouté par migrations/028, ici
-- directement dans la table plutôt qu'en ALTER après coup.
create table public.user_activity_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_amis timestamptz,
  last_seen_groupes timestamptz,
  last_seen_changelog timestamptz,
  last_digest_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.user_activity_state enable row level security;

create policy "Users can view own activity state"
  on public.user_activity_state for select
  using (auth.uid() = user_id);

create policy "Users can insert own activity state"
  on public.user_activity_state for insert
  with check (auth.uid() = user_id);

create policy "Users can update own activity state"
  on public.user_activity_state for update
  using (auth.uid() = user_id);

-- Top films : deux classements agrégés (voir js/top.js, migrations/015,
-- corrigé en migrations/033 — voir ce fichier pour le détail du bug).
-- Comme is_group_member plus haut, ces fonctions SECURITY DEFINER lisent
-- `films` de tout le monde en interne (RLS contournée volontairement) mais
-- ne renvoient QUE des agrégats — jamais user_id ni review, donc pas de
-- fuite de "qui a mis quelle note" même sur un film noté par une seule
-- personne. Un film est identifié par son tmdb_id (les ajouts manuels sans
-- fiche TMDB ne peuvent pas être recoupés entre utilisateurs, donc exclus).
-- La note de chaque utilisateur est recalculée avec la même formule que
-- computeNote() côté client (js/app.js) : moyenne des 7 critères (0..1)
-- arrondie au demi-point sur 5, ou manual_note directement si renseignée.
-- Le calcul par ligne (CTE `rated`) est filtré `where note is not null`
-- AVANT le group by : un film jamais noté par personne (manual_note null
-- ET crit vide/incomplet — ex. import Letterboxd sans Rating) n'a pas de
-- note à moyenner, ne doit pas apparaître dans un classement, et ne doit
-- surtout pas se retrouver en tête via le tri par défaut de Postgres (qui
-- place les null en premier sur un "order by ... desc").

create or replace function public.get_global_top_films(p_limit int default 30)
returns table(
  tmdb_id integer,
  title text,
  poster_url text,
  release_year integer,
  avg_note numeric,
  rating_count integer
)
language sql
security definer
set search_path = public
stable
as $$
  with rated as (
    select
      f.tmdb_id,
      f.title,
      f.poster_url,
      f.release_year,
      coalesce(f.manual_note, (
        select round(avg(v.value::numeric) * 10) / 2
        from jsonb_each_text(f.crit) as v
      )) as note
    from public.films f
    where f.tmdb_id is not null
  )
  select
    tmdb_id,
    max(title) as title,
    max(poster_url) as poster_url,
    max(release_year) as release_year,
    round(avg(note), 2) as avg_note,
    count(*)::integer as rating_count
  from rated
  where note is not null
  group by tmdb_id
  order by avg_note desc, rating_count desc
  limit p_limit;
$$;

revoke all on function public.get_global_top_films(int) from public;
grant execute on function public.get_global_top_films(int) to authenticated;

-- Même chose, restreint à "moi + mes amis acceptés" (directs uniquement —
-- pas les amis de mes amis) : personnel à chaque appelant (auth.uid()), si
-- j'ai 4 amis mon top porte sur nous 5, si l'un d'eux a 7 amis le sien
-- porte sur eux 8.
create or replace function public.get_friends_top_films(p_limit int default 30)
returns table(
  tmdb_id integer,
  title text,
  poster_url text,
  release_year integer,
  avg_note numeric,
  rating_count integer
)
language sql
security definer
set search_path = public
stable
as $$
  with my_circle as (
    select auth.uid() as uid
    union
    select addressee_id from public.friendships
      where requester_id = auth.uid() and status = 'accepted'
    union
    select requester_id from public.friendships
      where addressee_id = auth.uid() and status = 'accepted'
  ),
  rated as (
    select
      f.tmdb_id,
      f.title,
      f.poster_url,
      f.release_year,
      coalesce(f.manual_note, (
        select round(avg(v.value::numeric) * 10) / 2
        from jsonb_each_text(f.crit) as v
      )) as note
    from public.films f
    join my_circle mc on mc.uid = f.user_id
    where f.tmdb_id is not null
  )
  select
    tmdb_id,
    max(title) as title,
    max(poster_url) as poster_url,
    max(release_year) as release_year,
    round(avg(note), 2) as avg_note,
    count(*)::integer as rating_count
  from rated
  where note is not null
  group by tmdb_id
  order by avg_note desc, rating_count desc
  limit p_limit;
$$;

revoke all on function public.get_friends_top_films(int) from public;
grant execute on function public.get_friends_top_films(int) to authenticated;

-- Profil partageable : page publique en lecture seule (#/u/:userId, voir
-- js/publicProfile.js, migrations/016), SANS connexion requise — seule
-- fonction de tout ce fichier accordée à `anon`. Lue par n'importe qui,
-- mais renvoie uniquement pseudo/avatar + un résumé du catalogue
-- (tmdb_id/titre/affiche/année/note/favori — tmdb_id ajouté en migrations/
-- 032, rien de sensible, permet de rendre les lignes cliquables vers leur
-- fiche), jamais l'email ni review, et rien du tout si public_profile est
-- resté à false (0 ligne, sans distinguer "profil inexistant" de "profil
-- privé"). Chaque colonne est sa propre sous-requête corrélée plutôt qu'un
-- group by commun (migrations/032) : `films` (tri par note) et `top_films`
-- (tri par l'ordre choisi par l'utilisateur, voir profiles.top_films)
-- n'ont pas le même tri, les mélanger dans un seul jsonb_agg groupé était
-- plus verbeux que deux sous-requêtes indépendantes.
create or replace function public.get_public_profile(p_user_id uuid)
returns table(
  display_name text,
  avatar_url text,
  films jsonb,
  top_films jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.display_name,
    p.avatar_url,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'tmdb_id', f.tmdb_id,
        'title', f.title,
        'poster_url', f.poster_url,
        'release_year', f.release_year,
        'note', coalesce(f.manual_note, (
          select round(avg(v.value::numeric) * 10) / 2
          from jsonb_each_text(f.crit) as v
        )),
        'fav', f.fav
      ) order by coalesce(f.manual_note, (
          select round(avg(v.value::numeric) * 10) / 2
          from jsonb_each_text(f.crit) as v
        )) desc nulls last)
      from public.films f
      where f.user_id = p.user_id
    ), '[]'::jsonb) as films,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'tmdb_id', f.tmdb_id,
        'title', f.title,
        'poster_url', f.poster_url,
        'release_year', f.release_year
      ) order by ord.pos)
      from unnest(p.top_films) with ordinality as ord(tmdb_id, pos)
      join public.films f on f.tmdb_id = ord.tmdb_id and f.user_id = p.user_id
    ), '[]'::jsonb) as top_films
  from public.profiles p
  where p.user_id = p_user_id and p.public_profile = true;
$$;

revoke all on function public.get_public_profile(uuid) from public;
grant execute on function public.get_public_profile(uuid) to anon, authenticated;

-- Upload d'avatar réel (Supabase Storage), voir migrations/017 et la case
-- "Ou uploader une image" dans js/profile.js. Bucket public en lecture
-- (l'avatar doit s'afficher pour les amis et sur le profil public, qui
-- n'exige pas de connexion) mais chacun ne peut écrire que dans son propre
-- dossier (avatars/<user_id>/...). Chemin fixe par utilisateur : re-uploader
-- remplace l'ancien avatar plutôt que d'accumuler des fichiers orphelins.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Public read access on avatars"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "Users can upload their own avatar"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can update their own avatar"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own avatar"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Feedback utilisateur — voir js/feedback.js et migrations/026. Séparation
-- admin en vraie policy RLS ici (pas juste un choix d'affichage côté
-- client comme admin_config) : un retour peut contenir une remarque
-- personnelle, aucun autre compte ne doit pouvoir le lire.
create table public.feedback (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('bug', 'idee', 'autre')),
  message text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

create policy "Users can insert own feedback"
  on public.feedback for insert
  with check (auth.uid() = user_id);

create policy "Users can view own feedback"
  on public.feedback for select
  using (auth.uid() = user_id);

create policy "Admin can view all feedback"
  on public.feedback for select
  using ((auth.jwt() ->> 'email') = 'sab.fxs@gmail.com');

create policy "Admin can update feedback"
  on public.feedback for update
  using ((auth.jwt() ->> 'email') = 'sab.fxs@gmail.com');

-- Journal d'événements + stats admin — voir js/logging.js et
-- migrations/027. INSERT ouvert même sans session (une erreur peut
-- survenir avant toute connexion) ; LECTURE réservée à l'admin (vraie
-- policy RLS, comme feedback ci-dessus).
create table public.app_events (
  id bigint generated by default as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  detail text,
  created_at timestamptz not null default now()
);

alter table public.app_events enable row level security;

create policy "Anyone can log an event"
  on public.app_events for insert
  to anon, authenticated
  with check (true);

create policy "Admin can view all events"
  on public.app_events for select
  using ((auth.jwt() ->> 'email') = 'sab.fxs@gmail.com');

-- Compteurs globaux ("Activité globale" de l'onglet admin) — SECURITY
-- DEFINER comme get_global_top_films plus haut : lit films/tv_shows/
-- viewings/auth.users de tout le monde en interne mais ne renvoie que 4
-- nombres, jamais une ligne individuelle.
create or replace function public.get_admin_site_stats()
returns table(
  total_users bigint,
  total_films bigint,
  total_series bigint,
  total_viewings bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    (select count(*) from auth.users) as total_users,
    (select count(*) from public.films) as total_films,
    (select count(*) from public.tv_shows) as total_series,
    (select count(*) from public.viewings) as total_viewings;
$$;

revoke all on function public.get_admin_site_stats() from public;
grant execute on function public.get_admin_site_stats() to authenticated;

-- Nouveautés (v2.1+) — voir js/changelog.js, js/admin.js et
-- migrations/028. Vraie policy RLS ici (comme feedback plus haut) : lisible
-- par tout le monde une fois publiée (published = true), brouillon réservé
-- à l'admin le temps de la rédaction. Badge "vu" : colonne
-- last_seen_changelog sur user_activity_state (migrations/023 — cette
-- table n'est pas reprise dans ce fichier consolidé, gap préexistant à
-- corriger un jour ; la colonne ci-dessous suppose la table déjà créée).
create table public.changelog_entries (
  id bigint generated by default as identity primary key,
  version text not null,
  title text not null,
  body text not null,
  published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.changelog_entries enable row level security;

create policy "Anyone can view published changelog entries"
  on public.changelog_entries for select
  using (published = true);

create policy "Admin can view all changelog entries"
  on public.changelog_entries for select
  using ((auth.jwt() ->> 'email') = 'sab.fxs@gmail.com');

create policy "Admin can insert changelog entries"
  on public.changelog_entries for insert
  with check ((auth.jwt() ->> 'email') = 'sab.fxs@gmail.com');

create policy "Admin can update changelog entries"
  on public.changelog_entries for update
  using ((auth.jwt() ->> 'email') = 'sab.fxs@gmail.com');

create policy "Admin can delete changelog entries"
  on public.changelog_entries for delete
  using ((auth.jwt() ->> 'email') = 'sab.fxs@gmail.com');

-- Fiche film (v2.1, retour utilisateur) — voir js/filmDetail.js. Cliquer
-- sur un film n'importe où dans l'app (profil d'un ami, Top, groupes...)
-- ouvre désormais une vraie page dédiée : résumé, genre, note moyenne
-- communautaire, + noter/aimer/commenter, plutôt que la seule note posée
-- à côté du titre.
--
-- Un film est identifié par son tmdb_id (comme get_global_top_films,
-- migrations/015) : pas de table "films canoniques" séparée à maintenir,
-- like/commentaire s'accrochent directement à l'id numérique TMDB.

-- --- Like (v2.1) --- Distinct du ★ favori (personnel, jamais vu des
-- autres) : un like ici est un vrai signal social, visible des amis.
create table public.film_likes (
  id bigint generated by default as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tmdb_id integer not null,
  created_at timestamptz not null default now(),
  unique (user_id, tmdb_id)
);

-- --- Commentaire (v2.1) --- Distinct de `films.review` (personnel) : un
-- commentaire ici est public (entre amis), plusieurs personnes peuvent en
-- laisser un sur le même film — même principe que
-- group_proposal_comments (migrations/012), à l'échelle d'un film plutôt
-- que d'une proposition de groupe.
create table public.film_comments (
  id bigint generated by default as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tmdb_id integer not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.film_likes enable row level security;
alter table public.film_comments enable row level security;

-- Vérifie l'amitié en contournant RLS pour sa propre requête interne —
-- même pattern que is_group_member (migrations/013), pour éviter toute
-- récursion de policy et pouvoir être appelée directement depuis une
-- USING clause.
create or replace function public.are_friends(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select p_user_a = p_user_b or exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester_id = p_user_a and addressee_id = p_user_b)
        or (requester_id = p_user_b and addressee_id = p_user_a))
  );
$$;

revoke all on function public.are_friends(uuid, uuid) from public;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

create policy "Users can view own or friends' likes"
  on public.film_likes for select
  using (public.are_friends(auth.uid(), user_id));

create policy "Users can like as themselves"
  on public.film_likes for insert
  with check (auth.uid() = user_id);

create policy "Users can unlike their own like"
  on public.film_likes for delete
  using (auth.uid() = user_id);

create policy "Users can view own or friends' comments"
  on public.film_comments for select
  using (public.are_friends(auth.uid(), user_id));

create policy "Users can comment as themselves"
  on public.film_comments for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own comment"
  on public.film_comments for delete
  using (auth.uid() = user_id);

-- --- Note moyenne communautaire (v2.1) --- Même formule que
-- get_global_top_films (migrations/015), restreinte à un seul tmdb_id
-- plutôt qu'un classement — n'expose que l'agrégat (moyenne + nombre de
-- votants), jamais une ligne individuelle, même principe que le top.
create or replace function public.get_film_stats(p_tmdb_id integer)
returns table(avg_note numeric, rating_count integer)
language sql
security definer
set search_path = public
stable
as $$
  select
    round(avg(coalesce(f.manual_note, (
      select round(avg(v.value::numeric) * 10) / 2
      from jsonb_each_text(f.crit) as v
    ))), 2) as avg_note,
    count(*)::integer as rating_count
  from public.films f
  where f.tmdb_id = p_tmdb_id;
$$;

revoke all on function public.get_film_stats(integer) from public;
grant execute on function public.get_film_stats(integer) to authenticated;
