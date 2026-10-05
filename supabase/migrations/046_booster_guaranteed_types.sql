-- Garantie de composition des boosters (retour utilisateur) : chaque booster
-- contient obligatoirement 1 film, 1 acteur et 1 réalisateur. Les 2 cartes
-- restantes sont libres (n'importe quel type).
--
-- Tirage d'une carte factorisé dans draw_booster_card() : même logique que
-- précédemment (rareté tirée d'abord, 70 % pool personnel / 30 % global,
-- repli en cascade vers la rareté en dessous), avec en plus :
--   - un filtre par type de carte (p_card_type, NULL = tous types) ;
--   - une exclusion (p_exclude) : pas deux fois la même carte dans un booster.
-- Les probabilités annoncées (60 / 27 / 10 / 3) restent donc les mêmes.

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
    when random() < 0.60 then 'commun'
    when random() < 0.87 then 'rare'
    when random() < 0.97 then 'epique'
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

create or replace function public.open_booster()
returns setof public.tcg_cards
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_available integer;
  v_personal_pool bigint[];
  v_chosen_ids bigint[] := '{}';
  v_card_id bigint;
  v_type text;
  v_has_rare_plus boolean;
  v_tentatives integer := 0;
begin
  v_available := public.get_available_boosters();
  if v_available <= 0 then
    raise exception 'no_booster_available';
  end if;

  -- Pool = la carte de chaque film du catalogue (noté OU watchlist) UNIE aux
  -- cartes acteur/réalisateur liées à ces films (tcg_card_links).
  with owned as (
    select tmdb_id from public.films where user_id = auth.uid() and tmdb_id is not null
    union
    select tmdb_id from public.watchlist where user_id = auth.uid() and tmdb_id is not null
  )
  select array_agg(distinct pool.card_id) into v_personal_pool
  from (
    select film_card.id as card_id
    from owned join public.tcg_cards film_card
      on film_card.card_type = 'film' and film_card.tmdb_id = owned.tmdb_id
    union
    select links.person_card_id as card_id
    from owned
    join public.tcg_cards film_card on film_card.card_type = 'film' and film_card.tmdb_id = owned.tmdb_id
    join public.tcg_card_links links on links.film_card_id = film_card.id
  ) pool;

  -- 1) Les trois emplacements garantis : un film, un acteur, un réalisateur.
  foreach v_type in array array['film', 'actor', 'director'] loop
    v_card_id := public.draw_booster_card(v_type, v_personal_pool, v_chosen_ids);
    if v_card_id is not null then
      v_chosen_ids := v_chosen_ids || v_card_id;
    end if;
  end loop;

  -- 2) Compléter jusqu'à 5 cartes avec des emplacements libres (tous types).
  --    Borne de tentatives : si le catalogue est trop petit, on ne boucle pas
  --    indéfiniment, le booster peut alors contenir moins de 5 cartes.
  while array_length(v_chosen_ids, 1) is null or array_length(v_chosen_ids, 1) < 5 loop
    exit when v_tentatives >= 20;
    v_tentatives := v_tentatives + 1;
    v_card_id := public.draw_booster_card(null, v_personal_pool, v_chosen_ids);
    if v_card_id is not null then
      v_chosen_ids := v_chosen_ids || v_card_id;
    end if;
  end loop;

  -- 3) Garantie "au moins 1 Rare+" : si les 5 cartes sont toutes Communes,
  --    le dernier emplacement libre est remplacé par une Rare+ (tous types).
  select exists (
    select 1 from public.tcg_cards where id = any(v_chosen_ids) and rarity <> 'commun'
  ) into v_has_rare_plus;

  if not v_has_rare_plus and array_length(v_chosen_ids, 1) = 5 then
    v_chosen_ids := v_chosen_ids[1:4];
    select id into v_card_id from public.tcg_cards
    where rarity in ('rare', 'epique', 'legendaire')
      and not (id = any(v_chosen_ids))
    order by random() limit 1;
    if v_card_id is not null then
      v_chosen_ids := v_chosen_ids || v_card_id;
    end if;
  end if;

  insert into public.tcg_booster_log (user_id, card_ids) values (auth.uid(), v_chosen_ids);

  foreach v_card_id in array v_chosen_ids loop
    insert into public.tcg_user_cards (user_id, card_id, quantity)
    values (auth.uid(), v_card_id, 1)
    on conflict (user_id, card_id) do update set quantity = public.tcg_user_cards.quantity + 1;
  end loop;

  return query select * from public.tcg_cards where id = any(v_chosen_ids);
end;
$func$;

revoke all on function public.open_booster() from public;
grant execute on function public.open_booster() to authenticated;
