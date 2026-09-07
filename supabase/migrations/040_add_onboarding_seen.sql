-- Tuto d'accueil interactif (retour utilisateur — voir js/onboarding.js) :
-- un flag PAR COMPTE, jamais par appareil (jamais dans le localStorage
-- d'un navigateur), pour savoir si ce compte a déjà vu/passé le tuto —
-- exigence explicite : se connecter avec le même compte depuis un autre
-- PC ne doit JAMAIS repasser pour un "nouvel utilisateur".
--
-- default true : couvre le backfill des comptes déjà existants au moment
-- de cette migration — ils ne sont pas de nouveaux utilisateurs, le tuto
-- ne doit pas leur tomber dessus au prochain login. Un compte VRAIMENT
-- nouveau reçoit explicitement onboarding_seen: false à l'insertion de son
-- profil (voir fetchOrCreateProfile(), js/profile.js) — le défaut de la
-- colonne ne sert donc, dans les faits, que ce backfill.
alter table public.profiles
  add column onboarding_seen boolean not null default true;
