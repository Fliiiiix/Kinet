-- À appliquer APRÈS 058_add_lists.sql (le trigger ci-dessous pose un
-- déclencheur sur public.lists, qui n'existe pas avant).
--
-- Flux d'activité amis élargi (retour utilisateur, étude comparative
-- Strava/Goodreads — un flux social mélange plusieurs TYPES d'événements,
-- pas seulement le plus "riche") : le fil scope='friend' (migrations/021)
-- ne logait jusqu'ici qu'un seul type d'événement (film_rated). Deux
-- ajouts, choisis parce que leur table source porte déjà un titre texte
-- directement exploitable (contrairement à film_likes, qui ne stocke
-- qu'un tmdb_id sans titre — une 3e insertion y exigerait un appel TMDB
-- qu'un trigger SQL ne peut pas faire, laissé de côté pour cette raison) :
--   - watchlist_added : un ami ajoute un film à sa watchlist.
--   - list_created : un ami crée une liste thématique (migrations/058).

alter table public.activity_events drop constraint if exists activity_events_event_type_check;
alter table public.activity_events add constraint activity_events_event_type_check
  check (event_type in (
    'proposal_created', 'proposal_commented', 'proposal_chosen', 'group_joined',
    'film_rated', 'watchlist_added', 'list_created'
  ));

create or replace function public.log_watchlist_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  insert into public.activity_events (scope, actor_id, group_id, event_type, target_label, target_poster_url, target_note, created_at)
  values ('friend', new.user_id, null, 'watchlist_added', new.title, new.poster_url, null, new.created_at);
  return new;
end;
$func$;

create trigger trg_log_watchlist_added
  after insert on public.watchlist
  for each row execute function public.log_watchlist_added();

create or replace function public.log_list_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  insert into public.activity_events (scope, actor_id, group_id, event_type, target_label, target_poster_url, target_note, created_at)
  values ('friend', new.user_id, null, 'list_created', new.title, null, null, new.created_at);
  return new;
end;
$func$;

create trigger trg_log_list_created
  after insert on public.lists
  for each row execute function public.log_list_created();
