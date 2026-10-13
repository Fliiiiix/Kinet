-- Objectif annuel chiffré + barre de progression (retour utilisateur, étude
-- comparative Goodreads "Reading Challenge") : un nombre de films que le
-- compte se fixe pour l'année en cours, suivi en continu sur l'accueil —
-- par opposition au bilan de js/recap.js, qui est rétrospectif (fin
-- d'année seulement) et ne fixe jamais rien à l'avance.
--
-- Une seule paire année/objectif par profil (pas un historique) : l'année
-- précédente reste consultable via le bilan annuel existant, inutile de
-- dupliquer cette mémoire ici. annual_goal_year permet de distinguer "pas
-- d'objectif fixé" de "objectif fixé une année passée, à proposer de
-- renouveler" sans table séparée.
alter table public.profiles
  add column annual_goal_year integer,
  add column annual_goal_count integer check (annual_goal_count is null or annual_goal_count > 0);
