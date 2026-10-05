-- BROUILLON, NON APPLIQUÉ (à appliquer par l'utilisateur dans Supabase).
-- Sets par décennie (décision validée) : chaque carte FILM reçoit son année de
-- sortie. Les acteurs et réalisateurs n'en ont pas (pas d'année fiable pour une
-- personne) : ils restent « sans décennie ».
--
-- set_card_release_year() ne remplit que les cartes film encore vides, et seulement
-- avec une année plausible : une valeur déjà présente n'est jamais écrasée.

alter table public.tcg_cards add column if not exists release_year integer;
create index if not exists tcg_cards_release_year_idx on public.tcg_cards (release_year);

create or replace function public.set_card_release_year(p_card_id bigint, p_year integer)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if p_year is null or p_year < 1880 or p_year > 2100 then
    return;
  end if;
  update public.tcg_cards
  set release_year = p_year
  where id = p_card_id and card_type = 'film' and release_year is null;
end;
$func$;

revoke all on function public.set_card_release_year(bigint, integer) from public;
grant execute on function public.set_card_release_year(bigint, integer) to authenticated;
