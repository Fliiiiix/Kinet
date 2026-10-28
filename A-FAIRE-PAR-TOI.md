# À faire par toi (et pourquoi je ne peux pas le faire seul)

Ces actions touchent ta base Supabase, ton compte ou une décision que tu
dois prendre. Tout le reste est fait dans le code, poussé sur `main`.

## 0. État au 23/10/2026
- **Plus aucune migration en attente.** 069, 070 et 071 lancées le 28/10, vérifiées sans session. 068 (réglages partagés) lancée le 28/10, vérifiée sans session. 048 à 067 sont en place : 067 lancée
  le 23/10 et vérifiée sans session (fonctions fermées refusées en 42501,
  profil partagé et aperçu d'invitation toujours ouverts), 053 confirmée par
  toi le même jour.
- Audit général du 16/10 : lots 1 à 7 et les cinq choix (I1, I2, I3, I7, I9,
  tous en A) faits et en ligne (v293 à v303). Thème clair vérifié sur les 54
  écrans (v304).
- Anciennes listes (relevés de choix, décisions de la boucle du 14/10) : tout
  ce qui avait été décidé est fait (comparaison avec un ami, lien de carte,
  filtre par décennie, historique des notes, récap de l'année, suppression de
  compte, sauvegarde proposée avant import, films privés, import Letterboxd
  par titre et année, recalcul des raretés en procédure manuelle dans
  `docs/recalcul-raretes.md`).

## 1. Ce qui ne peut venir que de toi
- [x] **Migration `supabase/migrations/071_commentaire_episode.sql`**, lancée le
      28/10 : commentaire par épisode. Vérifié : la colonne existe et reste
      fermée sans compte.
- [x] Migrations 069 (À voir en commun) et 070 (limite du journal), lancées
      le 28/10 : 069 refuse les visiteurs, 070 refuse un événement au nom d’un
      autre compte ou trop long.
- [ ] **Tests automatiques sur GitHub** : `.github/workflows/tests.yml` est prêt
      mais pas envoyé, le jeton GitHub de ce PC n’a pas l’autorisation
      « workflow ». Lance `gh auth refresh -h github.com -s workflow` (une page
      GitHub s’ouvre pour valider), puis dis-le à Claude pour qu’il l’envoie.
- [ ] **Notifications de nouveaux épisodes** (idée 9) : demandent des clés de
      notification, une fonction déployée dans ton Supabase et une tâche
      quotidienne. À faire ensemble si tu le veux.
- [x] **Migration `supabase/migrations/068_reglages_partages.sql`**, lancée le 28/10 :
      tes réglages (thème, sons, pays, affichages, ordre de l’entête,
      Surprends-moi) suivent ton compte sur tous tes appareils. Sans elle,
      chaque appareil gardait les siens. Vérifié : la colonne existe et reste fermée sans compte.
- [x] **Note de version 4.1** : publiée le 24/10 avec ton accord (v283 à
      v304), vérifiée en ligne.
- [ ] **Sur un vrai téléphone** : la checklist `docs/checklist-mobile.md`, et
      un point précis : pendant la notation, bouger un curseur ne doit plus
      faire remonter le clavier (corrigé le 15/10, jamais vu sur un appareil).
- [ ] **Avec ton compte** : les écrans sont vérifiés avec des données de
      démonstration, jamais avec tes vraies données (le navigateur intégré
      n'a pas ta session, et je ne me connecte pas à ta place).

## 2. Idées encore ouvertes (rien n'est commencé, dis-moi si tu en veux)
(Faite le 24/10, v305 : les nouveautés classées par catégorie. Pour qu'une
note se range bien, une ligne en MAJUSCULES par catégorie, puis ses « • ».)
- Petites bulles « ? » d'aide, seulement sur les écrans complexes (cartes,
  notation).
- Limite d'envoi sur le journal d'événements, qui reste ouvert en écriture
  sans connexion (`docs/audit-rls.md`, point 2) : utile seulement si la table
  se remplit anormalement.

## 3. Commandes utiles (après un changement)
- Tests unitaires : `npm test` (ou `node tests/run-all.js`).
- Test de bout en bout (Chromium, serveur local automatique) : `npm run test:e2e`.
  Première fois : `npx playwright install chromium` (déjà fait sur ce poste).
- Recalcul des raretés : voir `docs/recalcul-raretes.md`.

## 4. Noms illisibles (alphabet d'origine)
Les cartes acteur/réalisateur dont le nom est en alphabet d'origine (ex. cyrillique,
japonais, chinois) sont désormais traduites en lettres latines à la génération.
Pour corriger celles qui existent déjà :
1. Dans Supabase : `select id, card_type, tmdb_id, name from public.tcg_cards order by id;`
   puis exporter en CSV dans le projet.
2. `TMDB_TOKEN=... node supabase/scripts/noms-cartes.js --cards <export.csv> --out noms.sql`
3. Relire `noms.sql` (une ligne par nom corrigé) puis le coller dans Supabase.
Les noms sans version latine sur TMDB sont listés dans la console pour correction à la main.

## 5. Export incomplet
L'éditeur SQL Supabase n'affiche que 100 lignes par défaut. Les exports
« Supabase Snippet Untitled query » du projet contiennent donc seulement les cartes
1 à 100. Pour l'export complet, exécuter par tranches, par exemple :
`select id, card_type, tmdb_id, name from public.tcg_cards where id > 100 order by id;`
(puis `where id > 200`, etc.), et enregistrer chaque CSV dans le projet.

Mise à jour : pas besoin de tranches. Dans l'éditeur SQL, lance
`select id, card_type, tmdb_id, name from public.tcg_cards order by id;` puis
clique sur « Download CSV » (le fichier contient tout le résultat, pas seulement
les lignes affichées). Les scripts `annees-cartes.js` et `noms-cartes.js` acceptent
aussi plusieurs fichiers : `--cards a.csv,b.csv`.

Mise à jour (la limite de 100 lignes de Supabase ne s'applique pas ici) : dans
l'app, onglet Admin > Cartes, bouton « Exporter tout le catalogue (CSV) ». Il lit
toutes les cartes par pages de 1000 et télécharge un seul fichier
`cartes-catalogue.csv`. Donne-le ensuite aux scripts.
