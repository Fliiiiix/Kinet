# Audit des règles d'accès (RLS) : lecture seule

Vérification faite en lisant toutes les migrations (`supabase/migrations/`), pas
en interrogeant la base. Aucune règle n'a été modifiée.

## Résultat
- 30 tables créées. Les 30 ont la sécurité par ligne (RLS) activée.
- Chaque table a au moins une politique.

## Points à confirmer (choix de conception, pas des erreurs évidentes)
1. **Profils lisibles par tout compte connecté** (migration 009,
   « Authenticated users can view all profiles »). Nom affiché et avatar sont
   donc visibles entre comptes. Acceptable pour une app entre amis, mais c'est
   le point à relier à la question « visibilité par film ».
2. **Journal d'événements ouvert en écriture sans connexion** (migration 027,
   « Anyone can log an event »). Utile pour voir les erreurs d'un écran de
   connexion ; le risque est le remplissage de la table par un script. Pas de
   limite de débit côté base.
3. **Jetons Trakt** (migration 035) : lecture, écriture et suppression limitées
   au propriétaire. Bien, à garder en tête : ce sont des identifiants.

## Ce qui est bien couvert
- Catalogue de cartes (`tcg_cards`, `tcg_card_links`) : lecture seule pour les
  clients, écriture par fonctions réservées au compte admin ou au serveur.
- Échanges de cartes (`tcg_trades`) : création limitée aux amis ou aux membres
  d'un même groupe ; mise à jour seulement pour refuser ou annuler.
- Retours (`feedback`) : chacun voit les siens, l'admin voit tout.

## Recommandations
- Garder les trois points ci-dessus dans la décision « visibilité par film ».
- Ajouter une limite côté base ou une fonction serveur pour le journal
  d'événements si le volume devient anormal.
- Relire à chaque nouvelle table (ce document est à mettre à jour avec elle).
