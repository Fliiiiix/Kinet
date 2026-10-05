-- BROUILLON, NON APPLIQUÉ. Opération IRRÉVERSIBLE : ne l'exécute qu'après
-- avoir relu. Suppression de compte (décision validée) : efface le compte
-- auth.users de l'utilisateur connecté. Les tables liées ont « on delete
-- cascade » vers auth.users (vérifié dans les migrations) : films, watchlist,
-- amis, cartes, boosters, échanges, etc. disparaissent avec le compte.
-- Exception volontaire : app_events (journal d'erreurs) garde ses lignes, avec
-- user_id mis à null (« on delete set null »), pour ne pas perdre les erreurs.
--
-- L'app impose en plus une confirmation tapée (« SUPPRIMER ») avant l'appel.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$func$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
