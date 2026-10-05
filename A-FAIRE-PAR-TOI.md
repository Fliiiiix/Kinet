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
