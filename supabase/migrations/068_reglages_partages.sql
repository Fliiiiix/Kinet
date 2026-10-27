-- Tes réglages sur tous tes appareils (idée retenue par Flix le 28/10 : il
-- passe sans arrêt du téléphone au PC). À lancer dans l'éditeur SQL de
-- Supabase.
--
-- Thème, animations, sons, volume, affichage grille ou liste, vues de
-- Bientôt, du catalogue et des saisons, ordre de l'entête, pays des
-- plateformes et choix de Surprends-moi étaient gardés sur chaque appareil
-- (localStorage). Ils rejoignent la petite table de préférences de la
-- migration 062, lisible et modifiable par son seul propriétaire (règles
-- déjà en place, rien à ajouter). Une seule colonne JSON : un nouveau réglage
-- ne demandera pas de nouvelle migration. Voir js/prefsSync.js.
--
-- Tant que cette migration n'est pas lancée, l'appli garde les réglages sur
-- chaque appareil, comme avant.

alter table public.user_prefs
  add column if not exists settings jsonb not null default '{}'::jsonb;

-- Contrôle : la colonne existe.
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'user_prefs' and column_name = 'settings';
