-- Audit général du 16/10 (T2) : les fonctions de la base restaient
-- appelables sans session. Supabase donne EXECUTE au rôle anon par défaut,
-- et le « revoke all ... from public » des migrations ne le retire pas
-- (vu avec mark_proposal_seen, appelée sans session : refus « not group
-- member » venu de la fonction elle-même, pas des droits).
-- À lancer dans l'éditeur SQL de Supabase. Ne change rien pour un compte
-- connecté : chaque fonction fermée aux visiteurs est rouverte à
-- authenticated (et service_role).
--
-- Restent ouvertes aux visiteurs :
--   - get_public_profile et get_group_invite_preview (profil partagé et
--     lien d'invitation, ouverts sans compte) ;
--   - les fonctions utilisées dans une règle d'accès (RLS), pour qu'une
--     requête sans session reçoive « rien » plutôt qu'une erreur ;
--   - les fonctions de déclencheur et celles des extensions.

do $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.prokind = 'f'
      and p.prorettype <> 'trigger'::regtype
      and p.proname not in ('get_public_profile', 'get_group_invite_preview')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and not exists (
        select 1 from pg_policies pol
        where (coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '')) ~ ('\m' || p.proname || '\(')
      )
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
    n := n + 1;
    raise notice 'Fermée aux visiteurs : %', r.sig;
  end loop;
  raise notice '% fonction(s) fermée(s) aux visiteurs', n;
end $$;

-- Les prochaines fonctions ne seront plus ouvertes à anon d'office.
do $$
begin
  alter default privileges for role postgres in schema public revoke execute on functions from anon;
exception when others then
  raise notice 'Droits par défaut inchangés : %', sqlerrm;
end $$;

-- Contrôle : ce qui reste appelable sans session (doit se limiter aux
-- fonctions listées en tête, aux règles d'accès et aux déclencheurs).
select p.oid::regprocedure as fonction_ouverte_aux_visiteurs
from pg_proc p
join pg_namespace ns on ns.oid = p.pronamespace
where ns.nspname = 'public'
  and p.prokind = 'f'
  and p.prorettype <> 'trigger'::regtype
  and has_function_privilege('anon', p.oid, 'EXECUTE')
order by 1;
