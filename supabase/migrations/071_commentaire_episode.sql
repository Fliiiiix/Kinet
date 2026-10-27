-- Commentaire par épisode (retour de Flix, 28/10 : « pouvoir aussi noter et
-- commenter par ep de manière discrète »). À lancer dans l'éditeur SQL de
-- Supabase.
--
-- La note par épisode existe déjà (migration 036). On ajoute un commentaire
-- court sur la même ligne de tv_episodes_watched : mêmes règles d'accès, le
-- propriétaire seul le lit et le modifie. Voir episodeCommentHtml(),
-- js/series.js. Sans cette migration, « Commenter » répond que ça arrive
-- avec elle ; la note par épisode marche déjà.

alter table public.tv_episodes_watched
  add column if not exists comment text;

alter table public.tv_episodes_watched
  drop constraint if exists tv_episodes_watched_comment_length;
alter table public.tv_episodes_watched
  add constraint tv_episodes_watched_comment_length check (comment is null or char_length(comment) <= 500);

-- Contrôle : la colonne existe (une ligne attendue).
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'tv_episodes_watched' and column_name = 'comment';
