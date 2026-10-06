# À faire par toi (et pourquoi je ne peux pas le faire seul)

Ces actions touchent ta base Supabase, ton compte ou une décision que tu
dois prendre. Tout le reste est fait dans le code, poussé sur `main`.

## 1. Migrations SQL à appliquer (dans cet ordre, éditeur SQL Supabase)
- [ ] `supabase/migrations/048_tcg_pity.sql` : garantie d'une Légendaire après
      N boosters sans elle (pity system). Vérifiée sur base simulée.
- [ ] `supabase/migrations/049_draft_classement_amis.sql` : BROUILLON. Classement
      entre amis, ne renvoie que des compteurs (cartes, films notés), jamais les
      notes. Testé sur base simulée. À relire puis appliquer si tu es d'accord.
- [ ] `supabase/migrations/050_draft_journal_raretes.sql` : BROUILLON. Journal
      des changements de rareté (qui, quand, ancienne et nouvelle valeur), lisible
      par l'admin seulement. Testé sur base simulée.
- [ ] Les migrations 049 et 050 ne sont PAS dans `schema.sql` tant que tu ne les
      as pas validées.

Après chaque migration : recharge le site (version bumpée à chaque lot).

## 2. Un relevé de tes choix
- [ ] Sets par saison : je propose une répartition par film (un set = un
      film ou une franchise), tu confirmes ou tu me dis une autre règle.
- [ ] Classement entre amis : brouillon 049 prêt, à valider (voir ci-dessus).
- [ ] Historique des notes : je propose de garder une ligne par changement de
      note (table dédiée). Dis-moi si tu veux ça, c'est une migration de plus.
- [ ] Sauvegarde automatique avant import : je propose un téléchargement
      proposé (pas automatique) avant tout import. Tu confirmes ?

## 3. Hors de ma portée depuis ici
- [ ] Recalcul périodique des raretés : demande un planificateur (cron
      Supabase ou ta machine). Je fournis la commande, tu la lances.
- [ ] Tests sur téléphone réel : checklist dans `docs/checklist-mobile.md`.
- [ ] Audit des règles d'accès : fait en lecture seule, voir `docs/audit-rls.md`
      (trois points à trancher : profils visibles entre comptes, journal ouvert
      sans connexion, visibilité par film).
- [ ] Suppression de compte, visibilité par film, journal de connexion : ce
      sont des changements de données et de sécurité. Je les écris, mais ils
      ne sont pas appliqués tant que tu ne les as pas relus.

## 4. Décisions en attente (avec ma recommandation)
Chaque point : réponds « oui », « non » ou donne une autre règle.
- [ ] Sets par saison : je recommande de regrouper les cartes par décennie de
      sortie du film (ex. « Années 90 »). Demande une colonne année sur les cartes.
- [ ] Historique des notes : je recommande une table dédiée (une ligne par
      changement de note). Oui ou non ?
- [ ] Comparaison avec un ami : je recommande de n'afficher que les films notés
      par les deux, avec l'écart de note. Nécessite la visibilité des notes entre amis.
- [ ] Sauvegarde automatique avant import : je recommande un téléchargement
      proposé (jamais automatique) avant tout import.
- [ ] Import Letterboxd plus fiable : je recommande de demander l'année en cas
      de titres ambigus. Je peux le faire sans ta décision.
- [ ] Suppression de compte : je recommande un bouton dans Paramètres avec
      confirmation et délai. Opération irréversible : il faut ton accord avant
      d'écrire la fonction.
- [ ] Visibilité par film : je recommande un réglage « privé » par film, à
      appliquer dans la politique RLS. Points à trancher dans docs/audit-rls.md.
- [ ] Journal de connexion : Supabase garde déjà ces traces ; je recommande de
      ne pas les recopier dans l'app et de consulter le tableau de bord Supabase.
- [ ] Lien de carte : je recommande une page /carte/:id en lecture seule, sans
      données personnelles. Oui ?
- [ ] Carte vidéo résumé : je recommande une animation de 10 secondes (style
      récap annuel), générée dans le navigateur. Oui ou non ?
- [ ] Recalcul périodique : je recommande un workflow GitHub manuel (lancé à la
      main), sans planification, car le fichier IMDb pèse plusieurs centaines de Mo.
- [ ] Tests de bout en bout : il faut installer Playwright (npm). Oui ?
- [ ] Changelog plus lisible : publication gated, je ne publierai rien sans ton
      accord explicite.
- [ ] Thème clair : je ne peux pas le voir sans ton compte. Vérifie les écrans
      en mode clair (Paramètres → Thème) et dis-moi ce qui ne va pas.
- [ ] Aide contextuelle : je recommande des bulles « ? » seulement sur les écrans
      complexes (cartes, notation). Oui ?

## 5. Migrations validées (brouillons prêts, à appliquer dans cet ordre)
Chaque migration est testée sur base simulée. Les appliquer dans Supabase, dans
l'ordre, puis recharger le site.
- [ ] `051_draft_historique_notes.sql` : historique des notes (table + trigger).
- [ ] `052_draft_annee_cartes.sql` : année de sortie sur les cartes film. Une
      fois appliquée, je pourrai ajouter le regroupement par décennie dans la
      collection (je ne l'ai pas fait avant, pour ne pas casser l'affichage).
- [ ] `053_draft_suppression_compte.sql` : IRRÉVERSIBLE. Le bouton « Supprimer mon
      compte » demande la saisie de SUPPRIMER et affiche un message clair tant que
      la migration n'est pas appliquée.
- [ ] `054_draft_films_prives.sql` : films privés. Dès qu'elle est appliquée, la case
      « Privé » du formulaire fonctionne pour les amis.
- [ ] `055_draft_profil_public_prive.sql` : à appliquer JUSTE APRÈS la 054. Sans
      elle, un film privé peut encore apparaître sur le profil public (accessible
      sans connexion). Testé : les films privés sont exclus de la liste et des films
      mis en avant.

## 6. Commandes utiles (après un changement)
- Tests unitaires : `npm test` (ou `node tests/run-all.js`).
- Test de bout en bout (Chromium, serveur local automatique) : `npm run test:e2e`.
  Première fois : `npx playwright install chromium` (déjà fait sur ce poste).
- Recalcul des raretés : voir `docs/recalcul-raretes.md`.

## 7. Bilan de la boucle (état final)
Faits et poussés : comparaison avec un ami, lien de carte, aide (revoir
l'introduction), filtre par décennie, historique de note sur la fiche film,
récap de l'année, suppression de compte (confirmation tapée), sauvegarde
proposée avant import, films privés (formulaire), tests de bout en bout,
confirmation avant changement de rareté (aperçu), contrôle du catalogue,
badge d'échanges, son de demande d'ami.

Restent pour toi :
- Appliquer les migrations 051 à 055 (ordre dans la section 5). Tant qu'elles ne
  le sont pas, les fonctions concernées restent silencieuses (rien ne casse).
- Années des cartes films déjà générées : `annees-cartes.sql` est prêt (13 années
  trouvées sur ton export, vérifiées sur 2 exemples). À coller dans Supabase APRÈS la
  migration 052. Pour le refaire plus tard : `scripts/annees-cartes.js`.
- Changelog plus lisible : non fait. Demande que chaque entrée ait une catégorie
  (ex. « cartes », « assistant », « design »). Je ne publierai rien sans ton accord.
- Thème clair : vérifié sur la page de connexion (capture dans test-results/),
  à regarder sur les écrans connectés.

## 8. Noms illisibles (alphabet d'origine)
Les cartes acteur/réalisateur dont le nom est en alphabet d'origine (ex. cyrillique,
japonais, chinois) sont désormais traduites en lettres latines à la génération.
Pour corriger celles qui existent déjà :
1. Dans Supabase : `select id, card_type, tmdb_id, name from public.tcg_cards order by id;`
   puis exporter en CSV dans le projet.
2. `TMDB_TOKEN=... node supabase/scripts/noms-cartes.js --cards <export.csv> --out noms.sql`
3. Relire `noms.sql` (une ligne par nom corrigé) puis le coller dans Supabase.
Les noms sans version latine sur TMDB sont listés dans la console pour correction à la main.

## 9. Export incomplet
L'éditeur SQL Supabase n'affiche que 100 lignes par défaut. Les exports
« Supabase Snippet Untitled query » du projet contiennent donc seulement les cartes
1 à 100. Pour l'export complet, exécuter par tranches, par exemple :
`select id, card_type, tmdb_id, name from public.tcg_cards where id > 100 order by id;`
(puis `where id > 200`, etc.), et enregistrer chaque CSV dans le projet.
