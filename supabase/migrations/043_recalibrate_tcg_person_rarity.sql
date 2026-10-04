-- 2e recalibration de la rareté des personnes (TCG) — retour utilisateur :
-- "y a un vrai problème sur les acteurs, Emma Watson en Rare c'est pas
-- normal". Vérifié en direct : Emma Watson 7,37 — juste sous le seuil
-- Épique (8) posé par migrations/042. En creusant plus large (Dwayne
-- Johnson 7,4, Timothée Chalamet 7,6, Will Smith 7,0, J.K. Simmons 8,5,
-- Jennifer Lawrence 7,1), le signal popularity TMDB pour les personnes est
-- en réalité très COMPRESSÉ entre ~4 et ~15 pour à peu près n'importe
-- quelle tête connue — migrations/042 corrigeait l'échelle générale
-- (personne vs film) mais restait encore trop sévère à l'intérieur de
-- cette échelle-là.
--
-- Nouveaux seuils personne, élargis pour que les VRAIES stars (la plupart
-- des 20 noms vérifiés en direct sur ces deux migrations) atteignent
-- Épique, réservant Légendaire aux têtes d'affiche les plus bankables
-- (Robert Downey Jr. 12, Scarlett Johansson 13, Tom Cruise 14,3, Zendaya
-- 14,9, Brad Pitt 15) : Commun <4, Rare 4-7, Épique 7-12, Légendaire >=12.
-- Seuils film (migrations/042) inchangés, aucune plainte dessus.
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
        when p_popularity >= 12 then 'legendaire'
        when p_popularity >= 7 then 'epique'
        when p_popularity >= 4 then 'rare'
        else 'commun'
      end
  end;
$func$;

-- Même geste que migrations/042 : recalcule tout de suite, popularity déjà
-- en base, aucun rappel TMDB nécessaire.
update public.tcg_cards
set rarity = public.compute_card_rarity(popularity, card_type);
