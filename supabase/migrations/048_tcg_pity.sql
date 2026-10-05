-- Pity system (roadmap) : si un compte ouvre 10 boosters d'affilée sans aucune
-- Légendaire, le 10e booster en garantit une (remplace le dernier emplacement
-- libre). Le compteur est par compte, mis à jour à chaque ouverture.
--
-- Garanties existantes (046, 047) conservées : 1 film, 1 acteur, 1 réalisateur,
-- Rare+ au moins, pas de doublon. La Légendaire pity remplace un emplacement
-- LIBRE (jamais un des trois emplacements typés).

create table if not exists public.tcg_pity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  boosters_sans_legendaire integer not null default 0
);

alter table public.tcg_pity enable row level security;

drop policy if exists "pity_select_own" on public.tcg_pity;
create policy "pity_select_own" on public.tcg_pity for select using (auth.uid() = user_id);

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
  v_has_legendaire boolean;
  v_pity integer;
  v_tentatives integer := 0;
  v_seuil_pity constant integer := 10;
begin
  v_available := public.get_available_boosters();
  if v_available <= 0 then
    raise exception 'no_booster_available';
  end if;

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

  -- 1) Les trois emplacements typés : un film, un acteur, un réalisateur.
  foreach v_type in array array['film', 'actor', 'director'] loop
    v_card_id := public.draw_booster_card(v_type, v_personal_pool, v_chosen_ids);
    if v_card_id is not null then
      v_chosen_ids := v_chosen_ids || v_card_id;
    end if;
  end loop;

  -- 2) Compléter jusqu'à 5 avec des emplacements libres.
  while array_length(v_chosen_ids, 1) is null or array_length(v_chosen_ids, 1) < 5 loop
    exit when v_tentatives >= 20;
    v_tentatives := v_tentatives + 1;
    v_card_id := public.draw_booster_card(null, v_personal_pool, v_chosen_ids);
    if v_card_id is not null then
      v_chosen_ids := v_chosen_ids || v_card_id;
    end if;
  end loop;

  -- 3) Garantie Rare+ (046) : si tout est Commun, le dernier emplacement libre
  --    devient une Rare+.
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

  -- 4) Pity : compteur par compte. Si ce booster est le 10e sans Légendaire et
  --    qu'il n'en contient pas, le dernier emplacement libre (le 5e) devient
  --    une Légendaire.
  insert into public.tcg_pity (user_id, boosters_sans_legendaire)
  values (auth.uid(), 0)
  on conflict (user_id) do nothing;

  select boosters_sans_legendaire into v_pity from public.tcg_pity where user_id = auth.uid();

  select exists (
    select 1 from public.tcg_cards where id = any(v_chosen_ids) and rarity = 'legendaire'
  ) into v_has_legendaire;

  if not v_has_legendaire and v_pity + 1 >= v_seuil_pity and array_length(v_chosen_ids, 1) = 5 then
    -- On ne retire le 5e emplacement que si une Légendaire existe vraiment
    -- dans le catalogue : sinon le booster reste tel quel.
    select id into v_card_id from public.tcg_cards
    where rarity = 'legendaire' and not (id = any(v_chosen_ids))
    order by random() limit 1;
    if v_card_id is not null then
      v_chosen_ids := v_chosen_ids[1:4] || v_card_id;
      v_has_legendaire := true;
    end if;
  end if;

  update public.tcg_pity
  set boosters_sans_legendaire = case when v_has_legendaire then 0 else v_pity + 1 end
  where user_id = auth.uid();

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
