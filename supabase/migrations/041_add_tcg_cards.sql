-- Cartes à collectionner et à échanger façon TCG (retour utilisateur) :
-- films/acteurs/réalisateurs, rareté liée à leur notoriété réelle
-- (popularité TMDB), débloquées en boosters de 5 en regardant des films
-- (2 films vus = 1 booster), échangeables entre amis/membres de groupe,
-- doublons convertibles en poussière puis dépensés pour fabriquer une
-- carte précise. Voir js/tcg.js pour la logique côté client et README.md
-- → section dédiée pour le design complet.
--
-- Catalogue de cartes GLOBAL et PARTAGÉ (tcg_cards/tcg_card_links), pas une
-- copie par utilisateur : une carte "Parasite" ou "Bong Joon-ho" n'existe
-- qu'une fois pour tout le monde, générée à la volée la toute première
-- fois que N'IMPORTE QUEL utilisateur référence ce film (voir
-- upsert_tcg_card()/link_tcg_card() plus bas) — pas un pré-remplissage de
-- tout TMDB d'un coup, seulement ce qui a vraiment du sens pour la
-- communauté Kinet. tcg_user_cards (qui possède quoi) reste, lui, par
-- utilisateur.
--
-- Aucune policy INSERT/UPDATE/DELETE côté client sur AUCUNE de ces tables
-- (RLS activé, donc refusé par défaut sans policy) : toutes les écritures
-- passent par des fonctions security definer dédiées (upsert_tcg_card(),
-- open_booster(), disenchant_card(), craft_card(), les fonctions de
-- tcg_trades plus bas) qui valident/calculent côté serveur — même principe
-- que get_watchlist_friend_ratings()/are_friends() déjà en place ailleurs,
-- mais appliqué ici à de vraies écritures, pas seulement des lectures
-- agrégées : sans ce verrou, un client pourrait s'octroyer directement des
-- cartes ou de la poussière en insérant/modifiant les lignes lui-même.

create table public.tcg_cards (
  id bigint generated always as identity primary key,
  card_type text not null check (card_type in ('film', 'actor', 'director')),
  tmdb_id integer not null,
  name text not null,
  -- URL complète (comme poster_url sur `films`), pas juste le chemin TMDB —
  -- même raison : un seul format à gérer côté client, pas une base à
  -- reconstituer à chaque affichage.
  image_url text,
  rarity text not null check (rarity in ('commun', 'rare', 'epique', 'legendaire')),
  -- Popularité TMDB au moment de la génération (pas remise à jour ensuite,
  -- volontairement — voir compute_card_rarity() plus bas) : une STAR
  -- ponctuellement virale au moment du tirage reste une carte rare acquise
  -- à ce titre, sa rareté ne doit pas se dégrader après coup.
  popularity numeric not null default 0,
  created_at timestamptz not null default now(),
  -- Une même personne peut avoir une carte "actor" ET une carte "director"
  -- distinctes (ex. Clint Eastwood) — l'unicité porte donc sur le COUPLE
  -- (card_type, tmdb_id), jamais tmdb_id seul.
  unique (card_type, tmdb_id)
);

alter table public.tcg_cards enable row level security;

-- Lecture publique à tous les comptes connectés (pas de notion de
-- propriétaire ici, c'est un catalogue partagé) — nécessaire pour afficher
-- la collection d'un ami/membre de groupe en vue d'un échange, pas
-- seulement la sienne.
create policy "Authenticated users can view the shared card catalog"
  on public.tcg_cards for select
  to authenticated
  using (true);

-- Lien carte-film <-> carte-personne (casting/réalisation) — sert à
-- reconstruire, pour un film donné, quelles cartes acteur/réalisateur ont
-- été générées avec lui, et donc quelles cartes personne entrent dans le
-- "pool personnel" de quelqu'un qui a CE film à son catalogue (voir
-- open_booster() plus bas). Table de liaison pure, pas de colonnes en plus.
create table public.tcg_card_links (
  film_card_id bigint not null references public.tcg_cards(id) on delete cascade,
  person_card_id bigint not null references public.tcg_cards(id) on delete cascade,
  primary key (film_card_id, person_card_id)
);

alter table public.tcg_card_links enable row level security;

create policy "Authenticated users can view card links"
  on public.tcg_card_links for select
  to authenticated
  using (true);

-- Qui possède quoi, et en combien d'exemplaires. quantity (pas une ligne
-- par exemplaire) : un doublon est une info de COMPTAGE, jamais besoin de
-- distinguer un exemplaire précis d'un autre de la même carte.
create table public.tcg_user_cards (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id bigint not null references public.tcg_cards(id) on delete cascade,
  quantity integer not null default 1 check (quantity >= 0),
  first_obtained_at timestamptz not null default now(),
  unique (user_id, card_id)
);

alter table public.tcg_user_cards enable row level security;

-- Visible par son propriétaire ET ses amis (voir are_friends(),
-- migrations/022) — condition pour proposer un échange en connaissance de
-- cause (voir "quelles cartes l'autre a en double" une fois l'UI
-- d'échange en place), pas seulement sa propre collection.
create policy "Users can view own or friends' card collection"
  on public.tcg_user_cards for select
  using (public.are_friends(auth.uid(), user_id));

-- Combien de poussière (monnaie de fabrication) ce compte possède — une
-- ligne par utilisateur plutôt qu'un historique de mouvements : le solde
-- est tout ce dont l'app a besoin, jamais d'historique à restituer.
create table public.tcg_dust (
  user_id uuid primary key references auth.users(id) on delete cascade,
  amount integer not null default 0 check (amount >= 0)
);

alter table public.tcg_dust enable row level security;

create policy "Users can view own dust balance"
  on public.tcg_dust for select
  using (auth.uid() = user_id);

-- Historique des boosters ouverts — sert à CALCULER combien il en reste de
-- disponibles (voir get_available_boosters() plus bas, qui compare au
-- nombre de visionnages) plutôt que de maintenir un compteur séparé à
-- resynchroniser à chaque film vu/retiré ; conservé aussi pour un futur
-- "Journal" des ouvertures (symétrique du Journal des visionnages déjà en
-- place, js/journal.js).
create table public.tcg_booster_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  opened_at timestamptz not null default now(),
  card_ids bigint[] not null
);

alter table public.tcg_booster_log enable row level security;

create policy "Users can view own booster history"
  on public.tcg_booster_log for select
  using (auth.uid() = user_id);

-- Propositions d'échange, amis OU membres d'un même groupe (retour
-- utilisateur : "un système d'échange qui passe par l'amitié et les
-- groupes") — pas de colonne group_id : l'échange reste toujours entre
-- DEUX comptes précis (from_user/to_user), un groupe n'est qu'un chemin de
-- plus pour se trouver mutuellement éligibles (voir la policy insert plus
-- bas), jamais un échange à plusieurs ni un pot commun.
create table public.tcg_trades (
  id bigint generated always as identity primary key,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  -- [{"card_id": 1, "quantity": 2}, ...] des deux côtés — jsonb plutôt que
  -- deux tables de lignes séparées, même choix que `crit` sur `films` pour
  -- une petite structure qui ne sera jamais filtrée/jointe par son contenu
  -- interne côté SQL (toute la validation a lieu dans accept_trade() ci-
  -- dessous, pas via des contraintes de colonnes).
  offered jsonb not null,
  requested jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

alter table public.tcg_trades enable row level security;

create policy "Users can view trades they're party to"
  on public.tcg_trades for select
  using (auth.uid() = from_user or auth.uid() = to_user);

-- La proposition elle-même (pas le transfert, voir accept_trade() plus
-- bas) ne demande pas de validation serveur poussée — même niveau de
-- confiance que le reste de l'app côté écriture directe (ex. insérer sa
-- propre critique) — mais reste limitée à un ami ou un co-membre de
-- groupe, jamais n'importe quel compte au hasard.
create policy "Users can propose a trade to a friend or group co-member"
  on public.tcg_trades for insert
  with check (
    auth.uid() = from_user
    and (
      public.are_friends(from_user, to_user)
      or exists (
        select 1 from public.group_members gm1
        join public.group_members gm2 on gm1.group_id = gm2.group_id
        where gm1.user_id = from_user and gm2.user_id = to_user
      )
    )
  );

-- Refuser/annuler reste une simple mise à jour de statut (par n'importe
-- laquelle des deux parties) — ACCEPTER, en revanche, déplace de vraies
-- cartes et passe donc par accept_trade() (security definer, plus bas),
-- jamais par un UPDATE direct du statut à 'accepted'.
create policy "Either party can decline/cancel a pending trade"
  on public.tcg_trades for update
  using ((auth.uid() = from_user or auth.uid() = to_user) and status = 'pending')
  with check (status in ('declined', 'cancelled'));

-- --- Fonctions ---

-- Paliers en escalier logarithmique (pas linéaire) : la popularité TMDB
-- est très étalée (une poignée de stars/blockbusters à des scores énormes,
-- l'immense majorité des films/personnes à un score faible) — des paliers
-- linéaires laisseraient presque tout dans "Commun" et quasi rien ailleurs.
-- Fonction pure séparée (pas inlinée dans upsert_tcg_card()) : réutilisée
-- telle quelle par open_booster() pour choisir une rareté AVANT de piocher
-- une carte, voir plus bas.
create or replace function public.compute_card_rarity(p_popularity numeric)
returns text
language sql
immutable
as $func$
  select case
    when p_popularity >= 60 then 'legendaire'
    when p_popularity >= 25 then 'epique'
    when p_popularity >= 8 then 'rare'
    else 'commun'
  end;
$func$;

-- Crée la carte si elle n'existe pas encore (idempotent — appelée par
-- n'importe quel compte qui croise ce film/cette personne en premier),
-- renvoie la ligne dans tous les cas. p_popularity vient du client (lu
-- depuis la réponse TMDB au moment de l'appel, voir js/tcg.js) — la
-- RARETÉ, elle, est toujours RECALCULÉE ici via compute_card_rarity(),
-- jamais acceptée telle quelle depuis le client : un client qui mentirait
-- sur la popularité obtiendrait au pire une rareté cohérente avec SA
-- valeur, jamais une rareté qu'il aurait choisie directement à la main.
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
  insert into public.tcg_cards (card_type, tmdb_id, name, image_url, rarity, popularity)
  values (p_card_type, p_tmdb_id, p_name, p_image_url, public.compute_card_rarity(p_popularity), p_popularity)
  on conflict (card_type, tmdb_id) do update set name = excluded.name -- no-op utile : force le retour de la ligne existante via RETURNING ci-dessous
  returning * into v_card;
  return v_card;
end;
$func$;

revoke all on function public.upsert_tcg_card(text, integer, text, text, numeric) from public;
grant execute on function public.upsert_tcg_card(text, integer, text, text, numeric) to authenticated;

-- Lie une carte film à une carte personne (casting/réalisation) — appelée
-- une fois par membre du casting/équipe retenu, juste après avoir généré
-- (ou retrouvé) les deux cartes via upsert_tcg_card(). on conflict do
-- nothing : idempotent comme upsert_tcg_card(), un même lien peut être
-- redemandé par plusieurs comptes qui croisent le même film.
create or replace function public.link_tcg_card(p_film_card_id bigint, p_person_card_id bigint)
returns void
language sql
security definer
set search_path = public
as $func$
  insert into public.tcg_card_links (film_card_id, person_card_id)
  values (p_film_card_id, p_person_card_id)
  on conflict do nothing;
$func$;

revoke all on function public.link_tcg_card(bigint, bigint) from public;
grant execute on function public.link_tcg_card(bigint, bigint) to authenticated;

-- Combien de boosters ce compte peut encore ouvrir : 1 tous les 2 films
-- VUS (table viewings — chaque film compte, y compris un revisionnage,
-- voir journal.js, c'est bien "regarder des films" qui débloque, pas
-- "noter des films") moins ceux déjà ouverts (tcg_booster_log). Toujours
-- RECALCULÉ depuis ces deux tables plutôt que maintenu à part — même
-- philosophie que le reste de l'app (ex. "Où regarder" jamais stocké) :
-- aucun compteur à resynchroniser si un visionnage est un jour retiré.
create or replace function public.get_available_boosters()
returns integer
language sql
security definer
set search_path = public
stable
as $func$
  select greatest(0,
    (select count(*)::integer / 2 from public.viewings where user_id = auth.uid())
    - (select count(*)::integer from public.tcg_booster_log where user_id = auth.uid())
  );
$func$;

revoke all on function public.get_available_boosters() from public;
grant execute on function public.get_available_boosters() to authenticated;

-- Ouvre un booster de 5 cartes. Pool personnel (cartes déjà liées à un
-- film du catalogue noté OU de la watchlist de ce compte, casting/
-- réalisation compris via tcg_card_links) tiré 70% du temps, pool global
-- (tout tcg_cards, déjà "découvert" par n'importe quel compte puisque les
-- cartes ne sont générées qu'à la demande) tiré 30% du temps — retour
-- utilisateur explicite : éviter qu'ajouter UN film précis garantisse UNE
-- carte précise. La rareté de chaque carte, elle, est tirée D'ABORD et
-- INDÉPENDAMMENT de la source (voir les seuils ci-dessous, mêmes paliers
-- que compute_card_rarity()) : la source ne influence QUE *dans quel sous-
-- ensemble* chercher une carte de cette rareté-là, jamais la rareté elle-
-- même. Repli en cascade si le tirage choisi n'a candidat nulle part
-- (ex. aucune légendaire générée sur le serveur pour l'instant) : un slot
-- ne reste vide que si tcg_cards est intégralement vide (aucune carte
-- générée nulle part, à peu près impossible dès qu'un compte a noté/mis
-- en watchlist un film avec fiche TMDB) — le client doit quand même
-- gérer un booster de moins de 5 cartes en retour, par prudence.
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
  v_rarity text;
  v_card_id bigint;
  v_use_personal boolean;
  v_has_rare_plus boolean := false;
  v_tiers text[] := array['commun', 'rare', 'epique', 'legendaire'];
  i integer;
  v_fallback_idx integer;
begin
  v_available := public.get_available_boosters();
  if v_available <= 0 then
    raise exception 'no_booster_available';
  end if;

  -- Pool = la carte de chaque film du catalogue (noté OU watchlist) UNIE
  -- aux cartes acteur/réalisateur liées à ces films (tcg_card_links) —
  -- deux sous-requêtes sur la même base `owned` plutôt qu'un join/lateral
  -- unique : plus simple à relire que de coalescer un id de film de repli
  -- quand aucun lien n'existe encore pour ce film.
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

  for i in 1..5 loop
    -- Rareté d'abord, indépendamment de la source — mêmes seuils (en
    -- fréquence, pas en popularité) que la distribution attendue d'un
    -- vrai tirage de carte à collectionner : l'essentiel du lot en
    -- Commun, le Légendaire volontairement rare.
    v_rarity := case
      when random() < 0.60 then 'commun'
      when random() < 0.87 then 'rare'
      when random() < 0.97 then 'epique'
      else 'legendaire'
    end;

    v_use_personal := random() < 0.70 and v_personal_pool is not null and array_length(v_personal_pool, 1) > 0;

    -- Repli en cascade : pool demandé -> l'autre pool -> rareté en
    -- dessous (jusqu'à 'commun', toujours représenté dès la 1ère carte
    -- jamais générée) -> jamais de slot vide.
    v_card_id := null;
    v_fallback_idx := array_position(v_tiers, v_rarity);
    while v_card_id is null and v_fallback_idx >= 1 loop
      select id into v_card_id from public.tcg_cards
      where rarity = v_tiers[v_fallback_idx]
        and (not v_use_personal or id = any(v_personal_pool))
      order by random() limit 1;

      if v_card_id is null and v_use_personal then
        -- même rareté, pool global cette fois
        select id into v_card_id from public.tcg_cards
        where rarity = v_tiers[v_fallback_idx]
        order by random() limit 1;
      end if;

      v_fallback_idx := v_fallback_idx - 1;
    end loop;

    if v_card_id is not null then
      v_chosen_ids := v_chosen_ids || v_card_id;
      -- La rareté RÉELLEMENT obtenue (pas v_rarity, qui peut avoir cédé la
      -- place à un repli en cascade juste au-dessus) — ce qui compte pour
      -- la garantie "au moins 1 Rare+", c'est ce qui finit dans le
      -- booster, jamais ce qui a été tiré au départ.
      if (select rarity from public.tcg_cards where id = v_card_id) != 'commun' then
        v_has_rare_plus := true;
      end if;
    end if;
  end loop;

  -- Garantie "au moins 1 Rare+" (convention TCG classique, retour
  -- utilisateur implicite : une ouverture qui ne surprend jamais déçoit) —
  -- si les 5 tirages sont tombés en Commun, on retire le dernier slot et
  -- on le retire une seule fois, forcé en Rare minimum (même logique de
  -- repli en cascade que ci-dessus, departure à 'rare' au lieu de la
  -- rareté tirée au hasard).
  if not v_has_rare_plus and array_length(v_chosen_ids, 1) = 5 then
    v_chosen_ids := v_chosen_ids[1:4];
    v_card_id := null;
    v_fallback_idx := 2; -- 'rare'
    while v_card_id is null and v_fallback_idx <= 4 loop
      select id into v_card_id from public.tcg_cards where rarity = v_tiers[v_fallback_idx] order by random() limit 1;
      v_fallback_idx := v_fallback_idx + 1;
    end loop;
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

-- Valeur de désenchantement (poussière reçue par exemplaire EN TROP, pas
-- par exemplaire total) et coût de fabrication (poussière dépensée pour
-- choisir une carte précise) — fabriquer coûte volontairement plus que
-- désenchanter plusieurs cartes de même rareté (~4x) : un vrai choix, pas
-- un recyclage gratuit d'un doublon vers un autre.
create or replace function public.dust_value(p_rarity text)
returns integer
language sql
immutable
as $func$
  select case p_rarity
    when 'legendaire' then 400
    when 'epique' then 100
    when 'rare' then 20
    else 5
  end;
$func$;

create or replace function public.craft_cost(p_rarity text)
returns integer
language sql
immutable
as $func$
  select public.dust_value(p_rarity) * 4;
$func$;

-- Désenchante p_quantity exemplaires EN TROP d'une carte (jamais le
-- dernier exemplaire : une carte qu'on ne possède qu'une fois reste
-- intouchable, désenchanter n'existe que pour les VRAIS doublons).
create or replace function public.disenchant_card(p_card_id bigint, p_quantity integer)
returns integer -- nouveau solde de poussière
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_owned integer;
  v_rarity text;
  v_gain integer;
  v_new_balance integer;
begin
  if p_quantity <= 0 then
    raise exception 'invalid_quantity';
  end if;

  select quantity into v_owned from public.tcg_user_cards where user_id = auth.uid() and card_id = p_card_id;
  if v_owned is null or v_owned - p_quantity < 1 then
    raise exception 'not_enough_duplicates';
  end if;

  select rarity into v_rarity from public.tcg_cards where id = p_card_id;
  v_gain := public.dust_value(v_rarity) * p_quantity;

  update public.tcg_user_cards set quantity = quantity - p_quantity where user_id = auth.uid() and card_id = p_card_id;

  insert into public.tcg_dust (user_id, amount) values (auth.uid(), v_gain)
  on conflict (user_id) do update set amount = public.tcg_dust.amount + v_gain
  returning amount into v_new_balance;

  return v_new_balance;
end;
$func$;

revoke all on function public.disenchant_card(bigint, integer) from public;
grant execute on function public.disenchant_card(bigint, integer) to authenticated;

-- Fabrique UNE carte précise contre de la poussière.
create or replace function public.craft_card(p_card_id bigint)
returns integer -- nouveau solde de poussière
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_rarity text;
  v_cost integer;
  v_balance integer;
  v_new_balance integer;
begin
  select rarity into v_rarity from public.tcg_cards where id = p_card_id;
  if v_rarity is null then
    raise exception 'unknown_card';
  end if;
  v_cost := public.craft_cost(v_rarity);

  select amount into v_balance from public.tcg_dust where user_id = auth.uid();
  if v_balance is null or v_balance < v_cost then
    raise exception 'not_enough_dust';
  end if;

  update public.tcg_dust set amount = amount - v_cost where user_id = auth.uid() returning amount into v_new_balance;

  insert into public.tcg_user_cards (user_id, card_id, quantity)
  values (auth.uid(), p_card_id, 1)
  on conflict (user_id, card_id) do update set quantity = public.tcg_user_cards.quantity + 1;

  return v_new_balance;
end;
$func$;

revoke all on function public.craft_card(bigint) from public;
grant execute on function public.craft_card(bigint) to authenticated;

-- Accepte un échange EN ATTENTE : vérifie que les deux parties possèdent
-- bien, à cet instant précis, ce qu'elles ont mis sur la table (jamais
-- supposé depuis l'état au moment de la PROPOSITION, qui peut dater) puis
-- déplace les cartes dans les deux sens en une seule transaction — soit
-- tout l'échange a lieu, soit rien. Seul to_user peut accepter (symétrique
-- de decline/cancel, ouvert aux deux côtés via la policy update plus
-- haut) : c'est forcément l'autre partie qui "accepte" une proposition
-- qu'on lui a faite.
create or replace function public.accept_trade(p_trade_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_trade public.tcg_trades;
  v_item jsonb;
begin
  select * into v_trade from public.tcg_trades where id = p_trade_id and status = 'pending';
  if v_trade is null then
    raise exception 'trade_not_found_or_resolved';
  end if;
  if auth.uid() != v_trade.to_user then
    raise exception 'not_your_trade_to_accept';
  end if;

  for v_item in select * from jsonb_array_elements(v_trade.offered) loop
    if coalesce((select quantity from public.tcg_user_cards where user_id = v_trade.from_user and card_id = (v_item->>'card_id')::bigint), 0) < (v_item->>'quantity')::integer then
      raise exception 'offer_no_longer_available';
    end if;
  end loop;
  for v_item in select * from jsonb_array_elements(v_trade.requested) loop
    if coalesce((select quantity from public.tcg_user_cards where user_id = v_trade.to_user and card_id = (v_item->>'card_id')::bigint), 0) < (v_item->>'quantity')::integer then
      raise exception 'request_no_longer_available';
    end if;
  end loop;

  for v_item in select * from jsonb_array_elements(v_trade.offered) loop
    update public.tcg_user_cards set quantity = quantity - (v_item->>'quantity')::integer where user_id = v_trade.from_user and card_id = (v_item->>'card_id')::bigint;
    insert into public.tcg_user_cards (user_id, card_id, quantity) values (v_trade.to_user, (v_item->>'card_id')::bigint, (v_item->>'quantity')::integer)
    on conflict (user_id, card_id) do update set quantity = public.tcg_user_cards.quantity + (v_item->>'quantity')::integer;
  end loop;
  for v_item in select * from jsonb_array_elements(v_trade.requested) loop
    update public.tcg_user_cards set quantity = quantity - (v_item->>'quantity')::integer where user_id = v_trade.to_user and card_id = (v_item->>'card_id')::bigint;
    insert into public.tcg_user_cards (user_id, card_id, quantity) values (v_trade.from_user, (v_item->>'card_id')::bigint, (v_item->>'quantity')::integer)
    on conflict (user_id, card_id) do update set quantity = public.tcg_user_cards.quantity + (v_item->>'quantity')::integer;
  end loop;

  update public.tcg_trades set status = 'accepted', responded_at = now() where id = p_trade_id;
end;
$func$;

revoke all on function public.accept_trade(bigint) from public;
grant execute on function public.accept_trade(bigint) to authenticated;
