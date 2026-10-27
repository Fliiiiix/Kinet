-- Limite d'envoi du journal d'événements (idée 15 du 28/10, point 2 de
-- docs/audit-rls.md). À lancer dans l'éditeur SQL de Supabase.
--
-- app_events reste ouvert en écriture sans connexion (une erreur peut
-- arriver sur l'écran de connexion, migration 027), mais :
--   - un compte ne peut plus écrire au nom d'un autre (user_id vide ou le sien) ;
--   - type et détail ont une taille maximale (40 et 500 caractères, ce que
--     l'appli envoie déjà, js/logging.js) ;
--   - au-delà de 30 événements par minute pour un compte, ou de 60 par minute
--     pour l'ensemble des visiteurs sans compte, les suivants sont ignorés
--     sans erreur : un script qui tourne en boucle ne remplit plus la table.

-- Index pour compter vite les dernières lignes.
create index if not exists app_events_created_at_idx on public.app_events (created_at desc);
create index if not exists app_events_user_created_idx on public.app_events (user_id, created_at desc);

drop policy if exists "Anyone can log an event" on public.app_events;
create policy "Anyone can log an event"
  on public.app_events for insert
  to anon, authenticated
  with check (
    (user_id is null or user_id = auth.uid())
    and char_length(event_type) between 1 and 40
    and (detail is null or char_length(detail) <= 500)
  );

-- Security definer : la lecture du journal est réservée à l'admin (règle de
-- la migration 027), un visiteur ne pourrait sinon rien compter.
create or replace function public.app_events_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent integer;
begin
  if new.user_id is not null then
    select count(*) into recent from public.app_events
      where user_id = new.user_id and created_at > now() - interval '1 minute';
    if recent >= 30 then return null; end if;
  else
    select count(*) into recent from public.app_events
      where user_id is null and created_at > now() - interval '1 minute';
    if recent >= 60 then return null; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists app_events_rate_limit on public.app_events;
create trigger app_events_rate_limit
  before insert on public.app_events
  for each row execute function public.app_events_rate_limit();

-- Contrôle : la règle et le déclencheur sont en place (deux lignes attendues).
select 'règle' as quoi, policyname as nom from pg_policies where tablename = 'app_events' and cmd = 'INSERT'
union all
select 'déclencheur', tgname from pg_trigger where tgname = 'app_events_rate_limit';
