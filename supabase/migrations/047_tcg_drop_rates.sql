-- Taux de tirage des cartes, alignés sur les boosters du jeu de cartes
-- Wankul (référence française du genre) : sur un booster, la répartition par
-- carte est d'environ 83 % Commun, 11 % Rare, 4 % Épique (« ultra rare »),
-- 1,3 % Légendaire. On arrondit le Légendaire à 2 % pour qu'il reste visible
-- dans un tirage. Terrains et duos (propres à Wankul) ne sont pas repris.
--
-- Seule la fonction de tirage change ; open_booster() (migration 046) l'appelle
-- telle quelle, la garantie de composition et la Rare+ restent identiques.
-- Les seuils cumulés : Commun < 0,83 ; Rare < 0,94 ; Épique < 0,98 ; sinon Légendaire.

create or replace function public.draw_booster_card(
  p_card_type text,
  p_personal_pool bigint[],
  p_exclude bigint[]
)
returns bigint
language plpgsql
volatile
set search_path = public
as $func$
declare
  v_tiers text[] := array['commun', 'rare', 'epique', 'legendaire'];
  v_rarity text;
  v_use_personal boolean;
  v_idx integer;
  v_id bigint;
  v_exclude bigint[] := coalesce(p_exclude, '{}');
begin
  v_rarity := case
    when random() < 0.83 then 'commun'
    when random() < 0.94 then 'rare'
    when random() < 0.98 then 'epique'
    else 'legendaire'
  end;
  v_use_personal := random() < 0.70 and p_personal_pool is not null and array_length(p_personal_pool, 1) > 0;

  v_idx := array_position(v_tiers, v_rarity);
  while v_idx >= 1 loop
    v_id := null;
    if v_use_personal then
      select id into v_id from public.tcg_cards
      where rarity = v_tiers[v_idx]
        and (p_card_type is null or card_type = p_card_type)
        and id = any(p_personal_pool)
        and not (id = any(v_exclude))
      order by random() limit 1;
    end if;
    if v_id is null then
      -- même rareté, pool global (ou pool global demandé directement)
      select id into v_id from public.tcg_cards
      where rarity = v_tiers[v_idx]
        and (p_card_type is null or card_type = p_card_type)
        and not (id = any(v_exclude))
      order by random() limit 1;
    end if;
    exit when v_id is not null;
    v_idx := v_idx - 1;
  end loop;

  return v_id;
end;
$func$;

revoke all on function public.draw_booster_card(text, bigint[], bigint[]) from public;
