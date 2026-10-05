# Recalcul des raretés : procédure manuelle

À lancer à la main, quand tu veux (par exemple après avoir ajouté beaucoup de films).
Pas de planification automatique : les fichiers IMDb pèsent plusieurs centaines de Mo.

## 1. Télécharger les données IMDb (une fois par mois, par exemple)
Dans un dossier à part, hors du projet (ex. `C:\imdb`) :
- title.ratings.tsv.gz
- title.basics.tsv.gz
- title.principals.tsv.gz
- name.basics.tsv.gz

Source : https://developer.imdb.com/non-commercial-datasets/ (usage personnel).

## 2. Exporter les cartes (éditeur SQL Supabase)
```sql
select id, card_type, tmdb_id, name, rarity_override from public.tcg_cards order by id;
```
Enregistrer le résultat en CSV dans le projet (ex. `supabase/scripts/cards-export.csv`).

## 3. Ajouter les identifiants IMDb (TMDB, une fois par carte)
Le jeton TMDB se passe en variable d'environnement, jamais dans un fichier :
```
TMDB_TOKEN=... node supabase/scripts/tcg-rarity.js --fetch-imdb --cards <export.csv>
```
Produit un CSV `<export>-imdb.csv` avec la colonne imdb_id.

## 4. Calculer les raretés
```
node supabase/scripts/tcg-rarity.js --dir <dossier IMDb> --cards <export>-imdb.csv --out updates.sql --report report.csv
```
Option : `--poids pic,reach,volume` pour régler l'importance des critères (défaut 0,4 / 0,3 / 0,3).

## 5. Appliquer
Relire `report.csv` (score, pic, rayonnement, volume, rareté) puis coller `updates.sql`
dans l'éditeur SQL Supabase. Les surcharges manuelles de l'admin restent prioritaires.

## Rappels
- Le calcul prend environ 2 minutes sur les fichiers complets.
- Les paliers sont recalculés sur toute la base à chaque fois : tout changement de
  la base change les raretés relatives.
