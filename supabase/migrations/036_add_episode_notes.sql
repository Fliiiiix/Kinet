-- Note par épisode + nombre de fois vu (optionnels) — retour utilisateur :
-- "je veux que l'essentiel soit la note globale [tv_shows.manual_note] et
-- si on veut vraiment on met une note par ep", puis "pouvoir mettre un nb
-- de fois vu aussi sur les séries". La note globale reste donc la seule
-- chose demandée à l'ajout/dans l'en-tête d'une série ; ces deux colonnes
-- sont une couche en plus, uniquement sur un épisode déjà coché vu
-- (jamais affichées ni promues comme l'essentiel de l'expérience — voir
-- js/series.js).
--
-- times_watched plutôt qu'un historique façon `viewings` (une ligne par
-- visionnage, le modèle déjà utilisé pour les films) : l'utilisateur
-- demande "un NOMBRE de fois vu", pas une date par revisionnage — un
-- compteur direct sur la ligne existante suffit et évite de complètement
-- refaire la case à cocher en système d'événements. Contrainte unique
-- déjà en place (user_id, tv_show_id, season_number, episode_number)
-- reste donc valable : toujours une seule ligne par épisode.
alter table public.tv_episodes_watched
  add column note numeric,
  add column times_watched integer not null default 1;
