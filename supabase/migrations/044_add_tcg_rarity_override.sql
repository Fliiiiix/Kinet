-- Gestion manuelle de la rareté des cartes (admin) — retour utilisateur :
-- la rareté calculée depuis la popularité TMDB rate des cas évidents (Louis
-- de Funès en Commun). En attendant une méthode de calcul plus fiable, l'admin
-- peut forcer la rareté d'une carte. Une surcharge manuelle PRIME toujours sur
-- le calcul automatique.
--
-- rarity_auto : rareté calculée (compute_card_rarity), recalculée au besoin.
-- rarity_override : rareté forcée par l'admin, NULL = pas de surcharge.
-- rarity : rareté effective = surcharge si présente, sinon calcul automatique.
-- Les tirages (open_booster) lisent rarity, donc la surcharge s'applique
-- partout sans rien changer à leur logique.

alter table public.tcg_cards
  add column rarity_auto text,
  add column rarity_override text check (rarity_override in ('commun', 'rare', 'epique', 'legendaire'));

update public.tcg_cards set rarity_auto = rarity;
alter table public.tcg_cards alter column rarity_auto set not null;

-- Fonction réservée au compte admin (même email que ADMIN_EMAIL côté client,
-- js/admin.js). Vérifiée côté base, pas seulement dans l'interface.
create or replace function public.admin_set_card_rarity(p_card_id bigint, p_rarity text)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if coalesce(auth.jwt() ->> 'email', '') <> 'sab.fxs@gmail.com' then
    raise exception 'admin_only';
  end if;
  if p_rarity is not null and p_rarity not in ('commun', 'rare', 'epique', 'legendaire') then
    raise exception 'invalid_rarity';
  end if;

  update public.tcg_cards
  set rarity_override = p_rarity,
      rarity = coalesce(p_rarity, rarity_auto)
  where id = p_card_id;

  if not found then
    raise exception 'unknown_card';
  end if;
end;
$func$;

revoke all on function public.admin_set_card_rarity(bigint, text) from public;
grant execute on function public.admin_set_card_rarity(bigint, text) to authenticated;

-- upsert_tcg_card() doit désormais renseigner rarity_auto aussi (colonne NOT
-- NULL ajoutée ci-dessus). Même corps que migrations/041-043, seul l'insert change.
create or replace function public.upsert_tcg_card(
  p_card_type text,
  p_tmdb_id integer,
  p_name text,
  p_image_url text,
  p_popularity numeric
)
returns public.tcg_cards
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_card public.tcg_cards;
begin
  insert into public.tcg_cards (card_type, tmdb_id, name, image_url, rarity, rarity_auto, popularity)
  values (p_card_type, p_tmdb_id, p_name, p_image_url,
          public.compute_card_rarity(p_popularity, p_card_type),
          public.compute_card_rarity(p_popularity, p_card_type),
          p_popularity)
  on conflict (card_type, tmdb_id) do update set name = excluded.name
  returning * into v_card;
  return v_card;
end;
$func$;
