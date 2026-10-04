-- Rareté des cartes (TCG, migrations/041) recalibrée — retour utilisateur :
-- "pourquoi les acteurs ont tous l'air commun alors qu'il y a des acteurs
-- de légende ? pareil pour certains films". Vérifié contre la vraie API
-- TMDB (pas une supposition) : l'échelle de popularité n'a RIEN à voir
-- entre une personne et un film — Tom Cruise (14), Christopher Nolan
-- (8.8), Morgan Freeman (9.4), Martin Scorsese (6.5), Meryl Streep (5.5)
-- contre Le Parrain (58), Les Évadés (59), Inception (52), Parasite (37).
-- compute_card_rarity() (migrations/041) appliquait les MÊMES seuils
-- (8/25/60) aux deux : la quasi-totalité des personnes, même légendaires,
-- restait sous le seuil "rare", "épique"/"légendaire" leur étant de fait
-- hors d'atteinte.
--
-- Seuils personnes très en dessous des seuils films (grossièrement 1/4 à
-- 1/5 de l'échelle, observé sur une dizaine de noms connus dans les deux
-- catégories) : Commun < 4, Rare 4-8 (Streep/Pacino/Scorsese/De Niro),
-- Épique 8-14 (Spielberg/DiCaprio/Nolan/Freeman), Légendaire >= 14 (Tom
-- Cruise). Seuils films resserrés pour laisser les VRAIS classiques
-- (Le Parrain, Les Évadés, Inception, Dark Knight, 50+) atteindre
-- Légendaire, pas seulement les sorties en tendance cette semaine.
--
-- Limite assumée, pas prétendue résolue : popularity TMDB reste un signal
-- de BUZZ RÉCENT (recherches/vues de la semaine), pas de notoriété
-- durable — un réalisateur culte sans sortie récente (Bong Joon-ho, 3.8
-- au moment de cette migration) peut rester "Commun" malgré son statut
-- réel. Aucune source TMDB équivalente pour une notoriété "de carrière"
-- sans un gros chantier à part (prix/récompenses, etc.) — hors de portée
-- ici.
create or replace function public.compute_card_rarity(p_popularity numeric, p_card_type text)
returns text
language sql
immutable
as $func$
  select case
    when p_card_type = 'film' then
      case
        when p_popularity >= 50 then 'legendaire'
        when p_popularity >= 20 then 'epique'
        when p_popularity >= 8 then 'rare'
        else 'commun'
      end
    else -- 'actor' / 'director'
      case
        when p_popularity >= 14 then 'legendaire'
        when p_popularity >= 8 then 'epique'
        when p_popularity >= 4 then 'rare'
        else 'commun'
      end
  end;
$func$;

-- L'ancienne signature à 1 argument (migrations/041) devient un mort :
-- plus aucun appelant (upsert_tcg_card() redéfinie juste en dessous)
-- ne doit pouvoir s'en servir par erreur.
drop function if exists public.compute_card_rarity(numeric);

-- upsert_tcg_card() (migrations/041) passait déjà p_card_type, il ne
-- manquait que de le transmettre à compute_card_rarity() — seul
-- changement ici, le reste de la fonction est identique.
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
  values (p_card_type, p_tmdb_id, p_name, p_image_url, public.compute_card_rarity(p_popularity, p_card_type), p_popularity)
  on conflict (card_type, tmdb_id) do update set name = excluded.name
  returning * into v_card;
  return v_card;
end;
$func$;

-- Recalcule la rareté de TOUTES les cartes déjà générées — popularity est
-- déjà en base (prise au moment de la génération), pas besoin de rappeler
-- TMDB pour ça. Change potentiellement la rareté affichée de cartes déjà
-- en collection (jamais leur existence/possession, juste l'étiquette) :
-- un joueur qui avait "par erreur" une carte Rare peut la voir redevenir
-- Épique une fois ce correctif passé, et inversement — c'est la
-- correction elle-même qui le veut, pas un effet de bord à éviter.
update public.tcg_cards
set rarity = public.compute_card_rarity(popularity, card_type);
