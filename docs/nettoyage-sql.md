# Nettoyage SQL : inventaire (lecture seule)

Aucune migration n'a été supprimée ni modifiée. Ce document liste les fonctions
redéfinies au fil des migrations, pour savoir où chercher la version qui fait foi.

## Fonctions redéfinies (la dernière migration fait foi)
| Fonction | Définitions | Version actuelle |
|---|---|---|
| get_global_top_films | 015, 033 | 033 |
| get_friends_top_films | 015, 033 | 033 |
| get_public_profile | 016, 032 | 032 |
| get_group_top_films | 022, 034 | 034 |
| compute_card_rarity | 041, 042, 043 | 043 (seuils personnes recalibrés) |
| upsert_tcg_card | 041, 042, 044 | 044 (remplit rarity_auto) |
| open_booster | 041, 046, 048 | 048 (garantie pity) |
| draw_booster_card | 046, 047 | 047 (taux Wankul) |

## Ce que ça veut dire
- Ce ne sont pas des bugs : c'est l'historique normal d'une évolution. Rejouer
  toutes les migrations dans l'ordre donne le bon résultat.
- `supabase/schema.sql` contient déjà la version consolidée (chaque migration y
  est ajoutée à la suite, la dernière définition l'emporte).

## Recommandation
- Ne rien supprimer : les anciennes migrations servent d'historique et doivent
  rester identiques à ce qui a été appliqué en base.
- Pour un vrai nettoyage, créer une migration de « base » à partir de
  `schema.sql` sur une base neuve, à décider ensemble.
