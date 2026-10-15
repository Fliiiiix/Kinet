-- Donner un avis (draft Profil du 15/10, choix de Flix). À lancer dans Supabase.
--
-- context : la page d'où vient l'avis, l'appareil et la version de Kinet
--   ({"page": "Bientôt", "device": "téléphone", "version": "v277"}), joints
--   par défaut et désactivables par celui qui écrit.
-- reply, replied_at : la réponse de l'admin. L'auteur la lit avec son avis
--   (règle « Users can view own feedback », migration 026) ; seul l'admin
--   peut l'écrire (règle « Admin can update feedback », même migration).
--
-- Sans cette migration, l'appli envoie les avis sans contexte et l'admin ne
-- peut pas répondre (un message le dit), rien ne casse.

alter table public.feedback add column if not exists context jsonb;
alter table public.feedback add column if not exists reply text;
alter table public.feedback add column if not exists replied_at timestamptz;
