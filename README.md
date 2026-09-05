# Kinet

Outil personnel pour noter les films selon une grille de critères fixe, pour éviter
d'être influencé après coup par les avis lus ailleurs. Remplace l'ancien fichier Excel.

## Structure

```
critique-films/
├── index.html                  → structure de la page (écran de connexion + app + toutes les pages routées)
├── manifest.json                → PWA (icônes, nom, couleurs) — voir js/pwa.js
├── sw.js                          → service worker (cache hors ligne + détection de mise à jour, voir js/offline.js)
├── icons/                          → icônes PWA/favicon (générées depuis le vrai logo Kinet, .brand-mark)
├── css/style.css                    → tout le style ("Halation" — violet/ambre, fond animé, verre)
├── js/data.js                         → les 7 critères (définitions, repères, questions) + SEED (films de l'Excel, migration uniquement)
├── js/supabaseConfig.js                → clés du projet Supabase (URL + clé publique anon)
├── js/tmdbConfig.js                     → clé API TMDB
├── js/auth.js                             → connexion (lien magique + Google), bascule écran connexion/app
├── js/ui.js                                → helpers UI partagés : ouverture/fermeture des modales (focus clavier inclus),
│                                              lignes de liste cliquables au clavier (makeRowClickable), listes "voir plus/moins",
│                                              animations d'apparition au scroll
├── js/profile.js                            → profil par utilisateur (pseudo + avatar + top films)
├── js/app.js                                 → catalogue noté : rendu, CRUD via Supabase, formulaire de notation, pagination
├── js/tmdb.js                                 → recherche TMDB (affiche, résumé, année, popularité) — films ET séries
├── js/filmDetail.js                            → fiche film dédiée (#/film/:tmdbId) : note moyenne communautaire, j'aime, commentaires
├── js/stats.js                                  → page statistiques (dont détail d'une critique par critère)
├── js/achievements.js                            → page succès (paliers + secrets)
├── js/watchlist.js                                → liste "à voir", séparée du catalogue noté (page routée)
├── js/suggestions.js                               → recommandations discrètes sous le catalogue (à partir des favoris)
├── js/series.js                                     → séries suivies à l'épisode près (page routée, table `tv_shows`)
├── js/upcoming.js                                    → "Prochainement" (#/prochainement) : sorties watchlist + séries à venir
├── js/journal.js                                      → journal des visionnages, revisionnages
├── js/friends.js                                       → amis (demande/acceptation) + profil en lecture seule (page routée)
├── js/router.js                                         → routeur par hash (#/watchlist, #/series/:id, #/film/:id, #/amis, #/top,
│                                                            #/groupes/..., #/u/:id, #/invite/:token), toutes les pages
├── js/top.js                                             → top films (tout le monde / mes amis), page routée
├── js/publicProfile.js                                    → profil public (#/u/:userId), seule page accessible sans connexion
├── js/groups.js                                            → groupes (famille/amis) : création, membres, "Goûts du groupe"
├── js/proposals.js                                          → propositions de films dans un groupe : votes + discussion
├── js/activity.js                                            → fil d'activité (amis + groupes), lecture seule côté client
├── js/activityState.js                                        → badges "non lu" + digest de retour (état "vu" par utilisateur)
├── js/changelog.js                                             → "Nouveautés" : modale auto à la connexion + accessible à tout moment
├── js/feedback.js                                               → formulaire de retour utilisateur (catégorie + message)
├── js/importExternal.js                                          → import Letterboxd (CSV) — voir la section dédiée plus bas
├── js/traktConfig.js / js/traktImport.js                          → import Trakt : PRÉPARÉ, pas branché (aucun <script>, aucun bouton) — voir la section dédiée plus bas
├── js/share.js                                                    → partage de l'app (QR + lien), accessible sans connexion
├── js/pwa.js                                                       → installation en app (bandeau + icône d'entête)
├── js/offline.js                                                    → mode hors ligne (lecture seule) + bannière de mise à jour
├── js/logging.js                                                     → capture des erreurs JS non interceptées (admin, `app_events`)
├── js/happenings.js                                                   → easter eggs par film (tmdb_id), façon Letterboxd
├── js/admin.js                                                         → interface admin (succès, happenings, nouveautés, avis, stats)
├── js/invites.js                                                        → lien d'invitation de groupe (#/invite/:token)
├── tests/                                                                 → suite de tests de régression (voir tests/README.md)
└── supabase/
    ├── schema.sql                  → schéma complet (nouveau projet)
    └── migrations/                 → changements incrémentaux (projet déjà provisionné)
```

## Lancer le projet

Aucune installation nécessaire, c'est du HTML/CSS/JS pur, sans build — mais il
faut un projet Supabase configuré (voir section suivante) pour que la
connexion et la sauvegarde fonctionnent.

Ouvrir `index.html` directement dans un navigateur, ou pour éviter les soucis de
CORS avec certains navigateurs, servir le dossier en local :

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

En ligne : https://fliiiiix.github.io/Kinet/ (GitHub Pages, déployé
depuis la branche `main`).

### Tests

Suite de régression pour les bugs déjà corrigés une fois (import
Letterboxd, matching TMDB, pagination) — aucune dépendance npm, Node seul
suffit :

```bash
node tests/run-all.js
```

Voir `tests/README.md` pour le détail (comment ajouter un test, le piège
`assert.deepStrictEqual` entre realms `vm`, le test optionnel contre la
vraie API TMDB).

### Mode maintenance

Pour bloquer temporairement le site (ex. pendant une modif risquée en prod,
comme un changement de policy RLS) : Supabase → **Table Editor** →
`site_status` → passer `maintenance` à `true` (et éditer `message` si besoin,
sinon un texte par défaut s'affiche). Effet immédiat pour quiconque
charge/recharge la page, connecté ou non — pas de redéploiement nécessaire.
Repasser `maintenance` à `false` pour rouvrir. Nécessite
`supabase/migrations/010_add_site_status.sql`.

## Stockage des données & authentification

Les films sont stockés dans une base **Supabase** (Postgres), pas en local :
donc accessibles depuis n'importe quel appareil, à condition de se connecter
avec le même compte.

Connexion par **lien magique** (email uniquement, pas de mot de passe) via
Supabase Auth. Chaque utilisateur ne voit et ne modifie que ses propres films,
grâce aux règles RLS définies dans `supabase/schema.sql`.

### Mettre en place son propre projet Supabase

1. Créer un projet sur [supabase.com](https://supabase.com)
2. Dans **SQL Editor**, exécuter le contenu de `supabase/schema.sql`
3. Dans **Authentication → URL Configuration**, mettre l'URL du site déployé
   (ex. `https://fliiiiix.github.io/Kinet/`) en *Site URL* et en
   *Redirect URL* — sinon le lien magique renvoie vers la mauvaise adresse
4. Dans **Project Settings → API**, copier *Project URL* et clé *anon public*
   dans `js/supabaseConfig.js`

La clé `anon` est faite pour être publique côté client (elle est visible dans
le code source) — la sécurité vient des règles RLS, pas du secret de cette clé.
Ne jamais mettre la `service_role key` dans ce fichier, celle-là est un vrai secret.

### Migrer les anciennes données (localStorage → Supabase)

L'app chargeait auparavant depuis `localStorage` (voir historique Git avant
la v1.3). Pour récupérer ces films après bascule vers Supabase : exporter
depuis l'ancienne version (bouton **Exporter (JSON)**) avant la mise à jour,
puis une fois connecté sur la nouvelle version, **Importer (JSON)** ce même
fichier.

### Export / Import JSON

Le bouton **Exporter (JSON)** télécharge un fichier `critique-films-AAAA-MM-JJ.json`
contenant tous les films notés — pratique pour sauvegarder tes données ou les
transférer vers un autre navigateur/appareil.

Le bouton **Importer (JSON)** relit un fichier exporté de cette façon. Deux
modes possibles, choisis via une boîte de confirmation au moment de l'import :

- **OK** → remplace entièrement le catalogue actuel par le contenu du fichier
- **Annuler** → ajoute les films du fichier à ceux déjà présents

Un fichier mal formé (pas de tableau `films`, film sans titre ou sans
critères) est rejeté sans toucher aux données existantes.

## La grille de notation (v1.3)

7 critères, chacun noté de 0 à 1 par curseur, moyenne convertie en note sur 5
(arrondie au demi-point) :

1. **Scénario** — intrigue, dialogues, personnages, thèmes
2. **Mise en scène** — rythme, ambiance, choix du réalisateur
3. **Jeu d'acteur** — performance des acteurs
4. **Esthétique visuelle** — cadrage, lumière, couleurs, effets
5. **Son** — mixage, bruitages, ambiance sonore (hors musique)
6. **Musique** — la partition/bande originale
7. **Ressenti global** — impact émotionnel, indépendant des 6 critères techniques

Chaque critère a une définition fixe, une échelle de repères (0 / 0.5 / 1) et
4 questions pour trancher rapidement — voir `js/data.js`.

Vécu en prod le 25/08/2026 : au doigt, scroller la fiche d'un film touchait
souvent un curseur au passage et changeait la note sans le vouloir. Fixé via
`touch-action: pan-y` sur tous les `input[type="range"]` (`css/style.css`) —
un geste vertical y est désormais toujours traité comme un scroll de page,
jamais comme un drag du curseur ; seul un geste horizontal (ou un tap direct)
interagit encore avec le slider.

### Trier/filtrer par critère individuel

Deux niveaux plutôt qu'un seul sélecteur surchargé : le tri général
(`#sortBy` — Note globale, Titre, Favoris, Récent) propose une dernière
option **"Par critère…"** qui révèle un second sélecteur avancé
(`#sortAdvancedRow`) — lequel des 7 critères (généré depuis `CRITERIA`, voir
`buildSortOptions()` dans `js/app.js`), un bouton-bascule ↓/↑ pour le sens,
et un curseur de seuil pour ne garder que les films notés au-dessus d'une
valeur donnée sur ce critère précis. Les trois (critère, sens, seuil)
portent sur le même critère plutôt que des contrôles déconnectés à
synchroniser à la main. Un film en note manuelle (pas de grille remplie)
n'a pas de valeur pour un critère donné : il sort du classement dès qu'un
seuil > 0 est actif, plutôt que d'être simplement mal classé. Revenir à un
tri général masque et réinitialise le sélecteur avancé.

### Note manuelle (exception à la grille)

Dans le formulaire, la case **Note manuelle — sans passer par la grille**
permet de saisir directement une note sur 5 au lieu de passer par les 7 critères.
Prévu pour les films déjà notés avec un référentiel différent (ex. retravaillés
avant la migration vers cette grille) — inutile, voire trompeur, de leur
recalculer une note "7 critères" a posteriori. Positionnée sous la grille
(pas au-dessus) : la notation par critères est le cœur de l'app, la note
manuelle une échappatoire exceptionnelle qui ne doit pas lui faire concurrence
en haut du formulaire.

Un film noté ainsi est visuellement distingué dans la liste : badge `manuel`
à côté du titre, sous-titre différent, encadré de la note en teal au lieu
d'amber. Nécessite d'avoir exécuté `supabase/migrations/002_add_manual_note.sql`
sur le projet (ajoute la colonne `manual_note`).

Pour convertir en masse des films déjà notés via la grille vers la note
manuelle (en gardant leur note calculée actuelle) : script
`supabase/scripts/migrate-to-manual-note.js`.

## Affiche, résumé & année (TMDB)

Le champ **Titre du film** fait aussi office de recherche : dès 2 caractères,
l'app interroge en direct l'API de [The Movie Database](https://www.themoviedb.org)
(pas Letterboxd, qui n'a pas d'API publique) et propose une liste de résultats
avec vignette sous le champ — cliquer sur l'un renseigne le titre et préremplit
affiche, résumé et année. Ces infos s'affichent ensuite dans la liste (vignette
+ année) et sont conservées si tu resauvegardes le film sans changer la
sélection. Pas de fiche trouvée ou pas envie d'en choisir une ? Le titre tapé
suffit, le film est enregistré normalement (juste sans affiche).

Nécessite un token gratuit : compte sur themoviedb.org → menu profil →
Paramètres → API → Créer une clé → coller le **Token d'accès en lecture
(v4 auth, un long JWT)** dans `js/tmdbConfig.js` (utilisé en en-tête
`Authorization: Bearer`, pas en paramètre d'URL — voir `js/tmdb.js`). Comme
la clé anon Supabase, il est fait pour tourner côté client (lecture seule).
Sans token configuré, la recherche échoue proprement (message d'erreur
affiché, reste de l'app inchangé). Nécessite d'avoir exécuté
`supabase/migrations/004_add_tmdb_fields.sql`.

### Recherche multilingue (titre FR / VO)

La barre de recherche du catalogue matche aussi bien le titre français que le
titre en langue d'origine (ex. taper "créatures féroces" ou "fierce
creatures" trouve le même film) — sans traduction automatique, juste les deux
titres que TMDB associe déjà au film (`title` en `fr-FR`, `original_title`
renvoyé dans la même réponse). Les accents et la casse sont aussi ignorés
("amelie" trouve "Amélie"). Nécessite `supabase/migrations/008_add_original_title.sql`.
Le titre VO n'est renseigné qu'à partir du prochain ajout/modification d'un
film lié à une fiche TMDB — pour les films déjà en base, script de rattrapage
dans `supabase/scripts/backfill-original-title.js`.

## Commentaire libre

Un champ **Commentaire** dans le formulaire permet de noter tes impressions
en texte libre, en plus de la note. Un film commenté affiche un petit 💬 à
côté de son titre dans la liste. Nécessite
`supabase/migrations/003_add_review.sql`.

## Profil (pseudo + avatar)

Pas de bouton "Profil" séparé dans l'entête : la **photo de profil**
elle-même (agrandie, en haut à droite) fait office de bouton — cliquer
dessus ouvre la modale profil. Sans avatar renseigné, une icône 👤 la
remplace pour rester visible et cliquable. La modale permet de définir un
pseudo et un avatar — deux onglets ("Depuis cet appareil" / "URL ou un de
tes films", voir `setAvatarSourceTab()` dans `js/profile.js`) qui remplissent
tous les deux le même champ URL au final : le premier **uploade un fichier
depuis l'appareil** (5 Mo max, voir plus bas), le second accepte soit une URL
d'image collée, soit l'affiche d'un film déjà noté. Regroupés en 2 onglets
plutôt que 3 champs toujours affichés (retour direct, moins de place prise
dans la modale). Regroupe aussi les vues sur **mon activité** (section "Mon activité" :
📊 Statistiques, 🏆 Succès, 📅 Journal — voir plus bas), le lien du **profil
public** (voir plus bas) et la **déconnexion** (sur la ligne
d'Annuler/Enregistrer, à gauche — plus dans l'entête). Chaque utilisateur a
son propre profil, isolé par RLS comme le reste — l'app supporte plusieurs
comptes indépendants (chacun avec son catalogue privé) dès lors qu'ils se
connectent avec leur propre email. Nécessite
`supabase/migrations/005_add_profiles.sql`.

### Upload d'avatar (Supabase Storage)

L'onglet "Depuis cet appareil" envoie le fichier dès
qu'il est choisi (pas de bouton "Uploader" séparé) et remplit le champ URL
avec l'adresse publique obtenue — même principe que le choix d'une affiche
de film. Chemin fixe par utilisateur (`avatars/<user_id>/avatar`, sans
extension : le type MIME suffit au navigateur) : un nouvel upload remplace
l'ancien avatar plutôt que d'accumuler des fichiers orphelins dans le
bucket, et l'URL générée porte un `?t=` (horodatage) pour éviter qu'un
navigateur (ou un autre visiteur) garde l'ancienne image en cache après un
remplacement.

Techniquement : bucket Storage `avatars`, public en lecture (l'avatar doit
s'afficher pour les amis et sur le profil public, qui n'exige pas de
connexion) mais chacun ne peut écrire que dans son propre dossier — policies
sur `storage.objects` scopées via `(storage.foldername(name))[1] =
auth.uid()::text`. Limites appliquées côté bucket (5 Mo, PNG/JPEG/WebP/GIF
uniquement), pas seulement côté client. Testé en conditions réelles contre
la prod : upload dans son propre dossier accepté, lecture publique OK
(200, bon `content-type`), tentative d'upload dans le dossier d'un autre
utilisateur rejetée par la policy RLS. Nécessite
`supabase/migrations/017_add_avatar_storage.sql`.

Le **titre "Kinet"** (entête) est lui aussi cliquable — retour à
l'accueil en un clic depuis n'importe quelle page.

## Statistiques

Dans la modale profil, **📊 Statistiques** (section "Mon activité") ouvre un
aperçu calculé à la volée depuis les films chargés (pas de requête dédiée) :
nombre de films, note moyenne, favoris, répartition grille/note manuelle,
distribution des notes, activité par mois, film le mieux et le moins bien
noté.

Barres de la distribution des notes cliquables (v2.3, retour utilisateur) :
clique une barre non vide (ex. "4.0") pour voir la liste des films concernés
juste en dessous, cliquable à son tour vers leur fiche (js/filmDetail.js).
Fonctionne aussi bien sur ses propres statistiques que sur celles (lecture
seule) d'un ami — voir `wireStatsDistribution()` dans `js/stats.js`.

## Succès

Dans la modale profil, **🏆 Succès** (section "Mon activité") ouvre une page
calculée elle aussi à la volée depuis les films chargés (pas de table
dédiée, pas de migration nécessaire) :

- **Paliers** : 4 séries cumulatives (Cinéphile, Grand favori, Critique en
  chef, Archiviste) avec un badge bronze/argent/or selon les seuils atteints
  et une barre de progression vers le palier suivant.
- **Secrets** : 10 succès cachés, plus insolites (ex. avoir donné 0.5/5 à un
  film, avoir ajouté un film entre minuit et 5h du matin…) — invisibles
  (`???`) tant qu'ils ne sont pas débloqués, pour garder la surprise.

Comme les statistiques, tout se recalcule à chaque ouverture à partir de
l'état actuel du catalogue : pas d'historique à maintenir, un succès peut se
"reverrouiller" si les films concernés sont supprimés ou modifiés.

## Watchlist ("à voir")

L'icône **🎞️** dans l'entête mène à `#/watchlist`, une page à part entière
(comme Groupes/Amis — voir `js/router.js`) plutôt qu'une modal, avec son
propre bouton **← Retour**. Liste séparée du catalogue noté (table
`watchlist`, pas `films`) : ajout rapide d'un titre, avec fiche TMDB
optionnelle (affiche/année) et une note libre (pourquoi le voir, qui l'a
conseillé…). Deux actions par item :

- **✔ Noter** — ouvre le formulaire principal (grille ou note manuelle),
  préempli avec le titre et la fiche TMDB déjà connus. L'item n'est retiré
  de la watchlist qu'une fois le film effectivement enregistré.
- **Retirer** — supprime l'item sans le noter.

Nécessite `supabase/migrations/006_add_watchlist.sql`.

## Séries (v2.0.5)

L'icône **📺** dans l'entête mène à `#/series`, une page à part entière
comme Watchlist — section volontairement séparée du catalogue films (table
`tv_shows`, pas `films` : deux sections distinctes, pas de fusion). Suivi à
l'**épisode près**, pas juste un statut par saison :

- **Ajouter une série** exige une fiche TMDB choisie dans les résultats de
  recherche (contrairement à la watchlist, où un titre libre suffit) : c'est
  elle qui fournit la liste des saisons/épisodes sur laquelle repose tout le
  suivi — sans elle, rien à cocher.
- **Détail d'une série** (`#/series/:id`) : affiche/synopsis/statut TMDB
  (`En diffusion`/`Terminée`/…, rafraîchi à chaque ouverture — une série
  encore en cours peut avoir gagné une saison depuis), une note manuelle sur
  5 + un commentaire libre (pas la grille à 7 critères des films — une série
  qui s'étale sur plusieurs saisons ne s'y prête pas), et un accordéon d'une
  saison par ligne.
- **Chaque saison**, dépliée à la demande (les épisodes d'une saison ne sont
  chargés depuis TMDB qu'à sa première ouverture, jamais toutes en même
  temps) : une case à cocher par épisode, plus **Tout marquer vu** / **Tout
  marquer non vu** pour la saison entière.
- **Retirer une série** supprime aussi tous ses épisodes cochés (suppression
  en cascade côté base) — depuis la fiche détail (bouton "Retirer cette
  série"), pas depuis la liste (v2.3, voir ci-dessous).

Liste (`#/series`, vue grille ou liste) simplifiée en v2.3 (retour
utilisateur : la carte grille empilait poster/titre/progression/pastille de
statut/note/2 boutons — "pas assez symétrique ou cohérent"). Alignée sur le
gabarit de la tuile film : poster, titre, une seule sous-ligne discrète
(progression + statut), note — toute la carte ouvre la fiche détail au clic,
plus de boutons Ouvrir/Retirer sur la carte elle-même.

Nécessite `supabase/migrations/024_add_tv_shows.sql`.

## Prochaines sorties (v2.0.5)

L'icône **🗓️** dans l'entête mène à `#/prochainement` — un agrégateur de ce
que tu suis déjà, pas une découverte de nouveautés non ajoutées :

- **Bientôt** : les films de la watchlist ayant une date de sortie future
  connue, et le prochain épisode à venir de chaque série suivie encore en
  activité — les deux triés ensemble par date la plus proche.
- **Séries terminées** : les séries suivies dont TMDB indique qu'elles ne
  produiront plus jamais de nouvelle saison (`Terminée`/`Annulée`) —
  affichées ici avec un badge clair plutôt que simplement omises, pour
  savoir sans ambiguïté qu'aucune suite n'est à attendre.

Nécessite `supabase/migrations/024_add_tv_shows.sql` et
`supabase/migrations/025_add_watchlist_release_date.sql`.

## Interface responsive

Desktop et mobile ont chacun leur propre navigation plutôt qu'une seule
mise en page qui se contorsionne aux petites tailles (v2.16-v2.20, retours
utilisateur directs sur téléphone réel — Galaxy S25) :

**Desktop** — `.header-top` regroupe sur UNE ligne le logo Kinet
(`.title-row`) et `#userBar` : 6 icônes utilitaires libellées, chacune dans
une pastille de couleur reprise de la palette Halation (`.nav-pip-violet/
-gold/-bronze/-teal` — À voir, Bientôt, Amis, Top films, Avis, Nouveautés),
puis avatar + pseudo (ouvre la modale profil). Le sélecteur **Films /
Séries** (`#primaryTabs`, v2.0.6) vit juste en dessous, sur sa propre
ligne — les deux vraies sections de contenu, pas une page utilitaire parmi
d'autres. `.title-row` et `#userBar` restent deux éléments DOM séparés à
dessein : `#userBar` disparaît entièrement sur mobile (remplacé par la
barre du bas ci-dessous) alors que le logo doit, lui, rester visible
partout — les fusionner en un seul bloc ferait disparaître les deux
ensemble.

**Mobile** (< 600px) — la même liste de boutons en haut, illisible sur un
petit écran, est remplacée par une **barre de navigation fixe en bas**
(`#mobileTabbar`, 5 entrées max, convention mobile classique) : Accueil
(catalogue + séries), À voir, Bientôt, Amis, Profil (avatar). `--mobile-
tabbar-h` (variable CSS) décale au-dessus tout ce qui flotte en bas (FAB
"+ Ajouter", bannière de mise à jour, toast) pour ne rien recouvrir. La
toolbar du catalogue (recherche + tri + filtre genre) tient sur une seule
ligne même sur petit écran (`min-width:0` + `flex-basis:0` sur
`.toolbar-search`, deux itérations avant que ce soit vraiment le cas
partout — Films *et* les autres pages) ; tri et filtre genre se déplacent
dans une feuille (`.toolbar-filters`) qui glisse depuis le bas au tap sur
l'icône filtre, réutilisant le MÊME `<select>` que sur desktop
(`display:contents`) plutôt que d'en dupliquer un deuxième à synchroniser.

Les grandes listes (accueil, watchlist, top, séries, amis) apparaissent
avec une légère animation au scroll (`observeReveal()`, `js/ui.js`,
`IntersectionObserver`, une fois par élément) et respectent
`prefers-reduced-motion`. Les listes trop longues (activité, demandes
d'amis, liste d'amis) se replient au-delà d'un seuil avec un bouton "Voir
plus" (`renderCollapsible()`, `js/ui.js`) plutôt que de défiler à l'infini.

## Journal & revisionnages

Chaque film noté a un ou plusieurs **visionnages** (table `viewings`, séparée
de `films`) : la date où il a été noté compte comme premier visionnage,
créé automatiquement. Dans le formulaire d'un film déjà enregistré, la
section **Visionnages** permet d'ajouter une nouvelle date (+ note libre) —
utile pour noter qu'on a revu un film, sans toucher à sa note. Un film revu
affiche un badge `↻ ×N` dans la liste.

Dans la modale profil, **📅 Journal** (section "Mon activité") ouvre un
historique chronologique de tous les visionnages (tous films confondus),
groupés par mois, avec un badge pour distinguer un revisionnage du premier
visionnage.

Nécessite `supabase/migrations/007_add_viewings.sql`, qui rétro-remplit
aussi un premier visionnage pour chaque film déjà présent (daté de son
ajout) — rien à ressaisir à la main après la migration.

## Amis

L'icône **👥** dans l'entête mène à `#/amis`, une page à part entière (comme
Watchlist/Groupes — voir `js/router.js`), avec son propre bouton
**← Retour**. Elle permet d'ajouter un ami par pseudo (recherche partielle)
ou par email (correspondance exacte uniquement), d'accepter/refuser les
demandes reçues, et de voir le **catalogue et les statistiques** d'un ami une
fois la demande acceptée — en lecture seule, aucune interaction n'est possible
sur ses films (modale ouverte par-dessus la page, qui se retrouve dessous
telle quelle une fois cette modale refermée). Une demande croisée (vous
demandez à quelqu'un qui vous avait déjà demandé) est acceptée
automatiquement plutôt que de créer un doublon.

**Aperçu avant d'ajouter** (v2.3, retour utilisateur) : cliquer sur une
personne dans la recherche, les suggestions, ou les demandes reçues/envoyées
ouvre l'aperçu de son **profil public** (`#/u/:userId`, voir plus bas) sans
attendre d'être ami — reste silencieux (page "profil non public") si elle
n'a pas activé cette option. Le badge de notification 👥 (voir "Digest de
retour & badges de notification" plus bas) s'allume désormais aussi pour une
demande d'ami **reçue** en attente, pas seulement pour l'activité d'amis
déjà acceptés/de groupes.

Techniquement : table `friendships` (une ligne par relation, statut
pending/accepted/declined) + une policy RLS qui ouvre la lecture de `films`
aux amis acceptés (en plus de la sienne propre, jamais en écriture) + une
fonction `find_user_by_email` en `SECURITY DEFINER` pour chercher un email
exact sans exposer toute la table `auth.users` côté client. Nécessite
`supabase/migrations/009_add_friendships.sql`.

En bas de la page, une section **Groupes** mène vers `#/groupes` (voir plus
bas) — un groupe se fait avec des amis, donc c'est ici que ça vit plutôt que
d'avoir sa propre icône dans l'entête.

**Compatibilité ciné** (v1.6) — dans le profil en lecture seule d'un ami,
une tuile affiche un pourcentage de compatibilité calculé sur les films
notés par les deux (recoupés par fiche TMDB) :
`100 × (1 − moyenne des écarts de note / 5)`. N'apparaît que s'il existe au
moins un film en commun. Calculé par `get_friend_compatibility`,
`SECURITY DEFINER` qui vérifie l'amitié acceptée en interne — la fonction
lit les deux catalogues pour comparer les notes, mais ne renvoie jamais
rien tant que la relation n'est pas une amitié acceptée. Nécessite
`supabase/migrations/022_add_compat_and_group_stats.sql`.

## Groupes

Accessible depuis le bas de la page Amis (section "Groupes"), permet de créer
un groupe (nom + description optionnelle) — le créateur en devient
automatiquement membre. Depuis le détail d'un groupe, le créateur peut
ajouter n'importe lequel de ses amis acceptés et retirer un membre ; les
autres membres peuvent quitter le groupe. Seul le créateur peut supprimer
le groupe (retire tous les membres).

**Lien d'invitation** (v1.6) — section "Inviter", visible du seul créateur :
génère un lien à partager (`#/invite/:token`) qui permet à quiconque
l'ouvre de rejoindre le groupe directement, sans passer par une amitié au
préalable. Volontairement limité : ouvrir le lien ne fait **que** rejoindre
le groupe, jamais devenir ami (devenir ami donne accès en lecture à tout le
catalogue noté de l'autre — bien plus qu'un simple clic sur un lien ne
devrait accorder). Fonctionne même sans connexion : la page affiche un
aperçu ("Invitation à rejoindre X") puis invite à se connecter, et rejoint
le groupe automatiquement une fois la connexion faite (le token est
mémorisé en `localStorage` le temps de l'aller-retour du lien magique, qui
autrement ferait perdre l'information — voir `handleSendMagicLink()` dans
`js/auth.js`). Le créateur peut révoquer un lien à tout moment.

Contrairement aux amis, un groupe **ne partage pas les catalogues notés** de
ses membres — c'est une base pour la brique suivante (proposer des films,
discuter, voter au sein du groupe), pas une fusion de bibliothèques.

Groupes/détail groupe/détail proposition sont trois **vraies pages routées
par URL** (`#/groupes`, `#/groupes/:id`, `#/groupes/:id/propositions/:id` —
voir `js/router.js`), pas des modals empilées : un groupe contient membres +
ajout d'amis + propositions + votes + discussion, trop pour tenir en popup
sur plusieurs niveaux. Watchlist et Amis ont suivi le même traitement
(`#/watchlist`, `#/amis`) ; Statistiques/Succès/Journal restent des modals
classiques ouvertes depuis le profil (2 niveaux max, ça reste raisonnable).

Techniquement : tables `groups` + `group_members`, RLS scopée à
l'appartenance via une fonction `is_group_member()` en `SECURITY DEFINER`
(une policy qui s'auto-interroge directement provoque une récursion
infinie côté Postgres, 42P17 — voir `migrations/013`), et le propriétaire
voit toujours son propre groupe directement par `owner_id` sans dépendre du
timing du trigger qui l'ajoute comme membre (`migrations/014`). Trigger qui
ajoute automatiquement le créateur comme membre à la création. Nécessite
`supabase/migrations/011_add_groups.sql` puis `013_fix_group_members_recursion.sql`
et `014_fix_groups_owner_select_race.sql`.

**Goûts du groupe** (v1.6) — section dans le détail du groupe listant les
films notés par **au moins 2 membres**, triés par note moyenne
(`get_group_top_films`, `SECURITY DEFINER`). Seuil volontaire : à la
différence des amis, les membres d'un groupe n'ont normalement aucun accès
en lecture au catalogue individuel des autres — un film noté par une seule
personne n'apparaît donc jamais, ça reviendrait de fait à exposer sa note
à tout le groupe. Nécessite
`supabase/migrations/022_add_compat_and_group_stats.sql`, corrigé par
`034_fix_group_top_films_null_notes.sql` (voir la note dans la section Top
films juste avant).

## Propositions de films (dans un groupe)

Depuis le détail d'un groupe, n'importe quel membre peut **proposer un
film** (recherche TMDB comme dans le formulaire principal — titre, affiche,
année). Les autres membres votent ▲/▼ (un vote par personne, façon Reddit —
recliquer sur son propre vote le retire) et peuvent ouvrir une proposition
pour **discuter en commentaires**. L'auteur d'une proposition ou d'un
commentaire peut le supprimer ; le créateur du groupe peut aussi supprimer
n'importe quelle proposition ou commentaire (modération).

Techniquement : tables `group_proposals`, `group_proposal_votes` (une ligne
par personne et par proposition, contrainte unique) et
`group_proposal_comments`, toutes scopées en RLS à l'appartenance au groupe
via `group_proposals.group_id` → `group_members`. Nécessite
`supabase/migrations/012_add_group_proposals.sql`.

**Séance élue** (v1.6) — le créateur du groupe peut élire une proposition
comme prochain film à voir (bouton "Élire", avec une date optionnelle),
affichée en bandeau en haut de la page du groupe. Donne un vrai
aboutissement au vote plutôt qu'une liste qui s'accumule sans jamais rien
trancher. Un seul film élu à la fois par groupe (index partiel unique sur
`group_proposals.group_id where chosen`) ; élire un autre film désélectionne
automatiquement le précédent (même fonction `set_chosen_proposal`, pour
rester atomique). Nécessite
`supabase/migrations/020_add_chosen_proposal_and_invites.sql` (même
migration que le lien d'invitation ci-dessus).

## Fil d'activité

Section **Activité récente** en bas du détail d'un groupe : qui a proposé
un film, commenté, élu une séance ou rejoint le groupe récemment — pour
qu'un groupe déjà créé ne semble pas mort en y revenant. Même section en
haut de la page Amis (`#/amis`), cette fois pour les notes de films de son
cercle d'amis (v1.6).

Techniquement : une seule table `activity_events`, portée `friend` ou
`group` (colonne `scope`). Jamais écrite directement par le client —
uniquement par des fonctions trigger `SECURITY DEFINER`
(`log_proposal_created`, `log_proposal_commented`, `log_group_joined`,
`log_film_rated`) déclenchées sur `group_proposals`/
`group_proposal_comments`/`group_members`/`films`, plus une insertion
directe dans `set_chosen_proposal` (`migrations/020`, pas un trigger — la
séance élue est un appel explicite, pas un `INSERT` déclenché), même
principe que le trigger qui ajoute
automatiquement le créateur d'un groupe comme membre (`migrations/011`).
Une policy RLS unique branche sur `scope` : côté groupe via
`is_group_member()` (`migrations/013`), côté ami via la même sous-requête
que "Friends can view shared films" (`migrations/009`). Les événements de
groupe existants ont été rétro-remplis une fois à la création de la table
(`created_at`/`joined_at` déjà serveur des tables sources) — pas de
rétro-remplissage pour les notes de films côté amis, qui n'ont aucun
horodatage serveur fiable à réutiliser pour l'historique déjà noté
(`films.added` est une horloge client, pas fiable pour un flux
inter-utilisateurs) : le fil "notes" ne remonte donc que depuis le
déploiement de cette fonctionnalité. Nécessite
`supabase/migrations/019_add_activity_events.sql` puis
`021_add_friend_feed_and_suggestions.sql`.

**Suggestions d'amis** — section sous "Mes amis" : amis d'amis pas encore
ajoutés, classés par nombre de connaissances communes
(`get_friend_suggestions`), complétée par des profils récents de l'app
quand il n'y a pas (ou peu) de connaissances communes à proposer (compte
neuf) — cette partie ne demande aucune fonction dédiée, `profiles` est déjà
lisible par tout compte connecté depuis `migrations/009`.

**Recommandé par tes amis** — films aimés (note moyenne ≥ 4/5) par son
cercle d'amis (soi + amis acceptés directs, même périmètre que le Top
"Mes amis") et pas encore notés par soi-même (`get_friend_recommendations`,
même gabarit que `get_friends_top_films` de `migrations/015`).

## Digest de retour & badges de notification (v1.6)

Un point rouge sur 👥 dans l'entête (l'icône Amis, qui contient l'accès
Groupes) dès qu'un ami ou un groupe a de l'activité pas encore vue —
disparaît dès l'ouverture de la page concernée (`markSeen('amis')` /
`markSeen('groupes')`), et le reste après un F5 ou depuis un autre appareil
puisque le "vu" est stocké en base, pas en `localStorage`. À la connexion,
un bandeau **"Depuis ta dernière visite"** résume ce qui s'est passé côté
amis/groupes en ton absence (notes, propositions, commentaires, séances
élues…), plafonné aux 14 derniers jours ou 20 événements (le plus petit des
deux) pour qu'un retour après plusieurs mois n'inonde pas la page — un clic
sur "Marquer comme vu" le referme et avance le curseur pour la prochaine
visite.

Techniquement : une table dédiée `user_activity_state`
(`last_seen_amis`/`last_seen_groupes`/`last_digest_at`, une ligne par
utilisateur) plutôt que `localStorage`, RLS identique à `admin_config`
(chacun ne lit/écrit que sa propre ligne). Toujours en lecture sur
`activity_events` (aucune nouvelle fonction `SECURITY DEFINER`) filtrée sur
`created_at > dernier vu` et `actor_id <> moi` — ce qu'on a fait soi-même
(noter un film, rejoindre un groupe…) n'allume jamais son propre badge.
Première visite après ce déploiement : la ligne est créée avec les 3
horodatages à "maintenant", pour ne pas faire apparaître d'un coup des mois
d'historique existant en "non lu". Nécessite
`supabase/migrations/023_add_user_activity_state.sql`.

## Top films

L'icône **🏅** dans l'entête mène à `#/top`, une page à part entière (comme
Amis/Watchlist/Groupes), avec deux classements au choix (onglets) :

- **Tout le monde** — les films les mieux notés, tous comptes de l'app
  confondus.
- **Mes amis** — pareil, mais restreint à moi + mes amis acceptés
  **directs** (pas les amis de mes amis) : personnel à chaque utilisateur —
  si j'ai 4 amis, mon top porte sur nous 5 ; si l'un d'eux a 7 amis, le sien
  porte sur eux 8, indépendamment du mien.

Chaque ligne : rang, affiche, titre, nombre de notes, note moyenne (les 3
premiers rangs sont mis en avant en amber — un vrai ordre, donc numéroté,
contrairement aux 01/02… de la grille qui ne sont que des repères de
lecture). Seuls les films avec une fiche TMDB comptent (`tmdb_id` sert de
clé pour recouper un même film entre utilisateurs — un ajout manuel sans
recherche ne peut pas être rapproché de l'entrée de quelqu'un d'autre).

Techniquement : deux fonctions `SECURITY DEFINER` (`get_global_top_films` /
`get_friends_top_films`, même principe que `is_group_member` —
`migrations/013`) qui lisent `films` de tout le monde en interne (RLS
contournée volontairement) mais **ne renvoient que des agrégats** — jamais
`user_id` ni `review`, donc pas de fuite de "qui a mis quelle note", même
sur un film noté par une seule personne. La note de chaque utilisateur est
recalculée en SQL avec la même formule que `computeNote()` côté client
(`js/app.js`) : moyenne des 7 critères arrondie au demi-point sur 5, ou
`manual_note` directement si renseignée — puis moyennée entre utilisateurs.
Pas de seuil minimum de votes pour l'instant (une seule note à 5/5 suffit à
arriver en tête) : le nombre de notes est affiché à côté pour que ça reste
lisible, plutôt qu'une formule pondérée façon IMDB, overkill vu l'échelle
(usage personnel entre amis). Nécessite
`supabase/migrations/015_add_top_films.sql`, corrigé par
`033_fix_top_films_null_notes.sql` : un film ajouté par quelqu'un mais
jamais réellement noté (`manual_note` vide et grille de critères
incomplète) calculait une moyenne SQL `null` pour ce film — et Postgres
trie les `null` **en premier** sur un tri décroissant par défaut, donc ce
film ressortait en tête de classement avec un faux "0" affiché
(`Number(null)` côté JS). Les lignes sans note calculable sont maintenant
filtrées avant l'agrégation plutôt qu'après : un film jamais noté par
personne n'apparaît simplement plus dans le classement.

## Fiche film (détail, v2.1)

Route `#/film/:tmdbId` (`js/filmDetail.js`) : résumé, genres, note moyenne
**communautaire** (tous comptes confondus, même fonction `SECURITY
DEFINER` que Top films, restreinte à un seul `tmdb_id` — jamais qui a mis
quelle note), et trois actions pour le compte connecté : noter ce film
dans son propre catalogue s'il n'y est pas déjà, l'aimer (❤️, visible des
amis), le commenter (fil de commentaires entre amis, chacun peut supprimer
les siens). Accessible en cliquant un film **n'importe où** dans l'app —
catalogue, Top films, profil d'un ami, distribution des stats — plutôt que
de dupliquer un mini-aperçu à chaque endroit. Nécessite
`supabase/migrations/030_add_film_detail.sql` (table `film_likes` +
`film_comments`, corrigée par `031_fix_film_likes_comments_default.sql`).

## Profil public

Dans la modale profil, la case **"Profil public (lien à partager, lecture
seule)"** génère un lien (`#/u/:userId`) menant à une page **accessible
sans connexion** — seule page de toute l'app dans ce cas. La coche
n'enregistre qu'au clic sur "Enregistrer", comme le pseudo/l'avatar. La
page publique montre pseudo, avatar, quelques tuiles (films notés / note
moyenne / favoris) et le catalogue trié par note — jamais l'email ni les
commentaires (`review`), désactivé par défaut (opt-in).

**Top films** (v2.3, retour utilisateur : "un top films comme Letterboxd,
mis en avant par choix pas par note") : dans la modale profil, sous la case
"Profil public", jusqu'à 4 films **choisis à la main** dans son propre
catalogue déjà noté (recherche + boutons monter/descendre/retirer),
affichés en haut de la page publique dans l'ordre choisi — distincts du
catalogue trié par note juste en dessous. Cliquables vers leur fiche film
uniquement si le visiteur est connecté (la fiche film n'est pas accessible
sans session, contrairement à cette page).

**Comment le vérifier soi-même** : cocher la case, "Enregistrer", copier le
lien affiché (bouton "Copier"), puis l'ouvrir dans une fenêtre privée/
navigation invitée (pas juste un nouvel onglet du même navigateur, qui
resterait connecté) — c'est la seule façon fiable de voir exactement ce
qu'un visiteur sans compte reçoit. Cocher/décocher puis "Enregistrer" à
nouveau pour activer/désactiver.

Techniquement : colonne `profiles.public_profile` (`false` par défaut) +
une fonction `SECURITY DEFINER` `get_public_profile(p_user_id)`, seule
fonction de tout le projet accordée au rôle `anon` (toutes les autres
exigent `authenticated`). Elle lit `films`/`profiles` de l'utilisateur visé
en interne, mais ne renvoie que pseudo/avatar/catalogue agrégé — jamais de
ligne brute — et 0 ligne (sans distinguer "profil inexistant" de "resté
privé") tant que `public_profile` n'est pas passé à `true`. Vérifié en
conditions réelles (v2.0.9) : la fonction RPC répond correctement en
anonyme, et un clic à froid sur un lien `#/u/:userId` (cas réel d'usage —
un proche qui reçoit le lien) affiche la page sans jamais passer par
l'écran de connexion. Colonne `profiles.top_films` (tableau de `tmdb_id`,
au plus 4) et champ `top_films` de `get_public_profile()` ajoutés par
`supabase/migrations/032_add_profile_top_films.sql`.

**Bug trouvé et corrigé (v2.0.9)** : `renderRoute()` (js/router.js) gérait
`#/u/:userId` et `#/invite/:token` correctement au tout premier chargement,
mais pas de façon robuste sur un `hashchange` ultérieur (ex. quelqu'un colle
le lien dans la barre d'adresse d'un onglet déjà ouvert sur l'écran de
connexion) — `#authContainer` restait affiché par-dessus faute d'être
explicitement masqué. Pareillement, cliquer le logo "Kinet" depuis cette
page en étant déconnecté ne menait nulle part (`goHome()` change l'URL mais
`renderRoute()` s'arrête à `if(!currentUser) return;` sans rien afficher) —
remplacé par `goHomeOrAuth()`, qui redirige vers l'écran de connexion s'il
n'y a personne, comme le fait déjà le bouton "← Retour" de cette page.
Nécessite `supabase/migrations/016_add_public_profile.sql`.

## Happenings (easter eggs par film)

Inspiré des pages Letterboxd qui cachent une petite surprise propre à un
film précis (ex. la page *Tenet* qui se lit à l'envers en bas de page, en
référence au temps inversé du film) — sauf que les nôtres portent sur *tes*
films, pas sur un catalogue générique. Un badge thématique apparaît à côté
du titre, dans le catalogue, pour les films qui en ont un (même
emplacement que les badges `manuel`/💬/↻ déjà là) ; cliquer dessus déclenche
l'expérience. Un happening peut aussi se déclencher tout seul en restant un
moment sur la fiche d'un film (le formulaire d'édition, seule "page" par
film qu'a l'app) — sans badge dans ce cas, l'effet de surprise fait partie
du jeu.

Six pour l'instant, identifiés par `tmdb_id` (fiable même si le titre est
retapé différemment) :

- **Fight Club** (🥊) — un flash d'une fraction de seconde, référence
  directe au procédé du film (des photogrammes de Tyler Durden insérés
  avant sa "révélation"). Un seul flash, jamais répété : un vrai
  clignotement rythmé est un déclencheur classique de crise chez les
  personnes photosensibles, à éviter même pour un easter egg.
- **Old Boy** (🔨) — un couloir qui défile à l'horizontale, référence au
  plan-séquence du combat au marteau filmé en travelling continu.
- **The Whale** (pas de badge, déclenché en restant 20s sur sa fiche) — un
  ordinateur qui s'envole à travers l'écran, référence à la scène où
  Charlie jette son ordinateur portable.
- **The Odyssey** (🪓) — l'épreuve de l'arc d'Ulysse : PAS un tir, mais le
  fait de plier l'arc et d'accrocher la corde à l'encoche du sommet (le
  "bander"), comme dans le texte. Un arc SVG se plie réellement à l'écran
  et le bout libre de la corde remonte vers l'encoche jusqu'à s'y accrocher
  à 100% (voir `updateOdysseyBow()`), au rythme de clics (ou taps tactile)
  très rapprochés — la tension redescend toute seule dès qu'on s'arrête.
  Corrigé le 25/08/2026 (deux fois) : d'abord pour être vraiment exigeant
  (+5%/clic contre -28%/s de décroissance en continu, il faut donc plus de
  5 clics/s SOUTENUS pour progresser net — la toute première version,
  ~3 clics/s requis, se laissait bander trop facilement), puis parce que
  l'animation montrait une flèche qu'on tire en arrière (un tir, contresens
  par rapport à l'épreuve elle-même). Pas d'état d'échec, juste réessayer.
- **La Cité de Dieu** (🔫) — le défi photo : prendre une vraie photo,
  maintenant (appareil photo sur mobile via `capture="environment"`, fichier
  existant sur PC), que l'app habille façon pellicule Cidade de Deus
  (désaturée, contrastée, grain, vignette, bande basse façon Polaroid avec
  le titre du film). Corrigé le 25/08/2026 : la première version générait
  une carte à partir de la note/du commentaire (rien à *prendre* soi-même,
  pas fidèle à l'idée d'origine). Effet de bord bienvenu : la photo vient
  d'un fichier local (`blob:` URL) et non de TMDB, donc le `<canvas>` qui la
  dessine n'est plus "tainted" — contrairement à la V1 (voir ancien
  problème CORS documenté dans l'historique git), le bouton Télécharger
  fonctionne ici pour de vrai, avec l'image réelle.
- **Se7en** (📦) — la boîte, dans le désert. Fidèle au parti pris du film
  (on ne voit jamais ce qu'il y a dedans, seulement la réaction de Mills) :
  cliquer "Ouvrir la boîte" ne révèle RIEN, juste un sursaut (secousse
  d'écran brève) et la réplique — pas de gadget qui montrerait un contenu,
  ç'aurait trahi ce qui fait la force de la scène.

Techniquement : purement client (`js/happenings.js`), aucune table dédiée —
même philosophie que Succès (`js/achievements.js`) : rien à débloquer/
suivre en base, juste du code qui réagit au `tmdb_id` du film ouvert.
`prefers-reduced-motion` respecté (bascule sur un simple message plutôt que
l'animation, sauf pour l'arc et la barre de tension d'Odyssey — de simples
changements d'attributs pilotés par le clic, pas d'animation autonome, donc
pas un risque). Ajouter un happening codé en dur = une entrée dans le
tableau `HAPPENINGS` (tmdb_id, type de déclenchement, fonction associée) ;
un happening simple ("un badge → un message") peut aussi se créer sans
coder, voir Interface admin ci-dessous.

## Nouveautés / changelog (v2.1)

Courtes annonces de version, rédigées et publiées depuis l'onglet
**Nouveautés** de la modale admin (`js/admin.js`, table `changelog_entries`,
`supabase/migrations/028`) — une entrée est un brouillon (`published:
false`) tant qu'elle n'est pas explicitement publiée, pour la relire avant
que les utilisateurs ne la voient. Deux surfaces côté public
(`js/changelog.js`) : une modale qui s'ouvre automatiquement à la
connexion s'il y a du contenu publié plus récent que la dernière
connexion (comparé à `last_seen_changelog`, même mécanisme que le digest
de retour ci-dessus), et l'icône **📣** de l'entête/de la barre mobile à
tout moment sinon (avec un point "non lu" tant que non consultée). Le
numéro de version affiché à côté du logo (`#versionTagValue`) reflète
automatiquement la dernière entrée publiée plutôt qu'une valeur à changer
à la main à chaque déploiement. Le corps de chaque entrée est du texte
brut (`white-space:pre-line` en CSS, pas de Markdown) : des lignes vides
séparent les sections (ex. `FONCTIONNALITÉS`, `DESIGN`, `CORRECTIONS`).

## Détection de mise à jour (v2.20+)

Avant cette version, rien ne prévenait un onglet déjà ouvert (ou une PWA
installée) qu'une nouvelle version venait d'être déployée — le
`CACHE_NAME` du service worker (`sw.js`) ne changeait jamais, donc le
navigateur ne détectait jamais sw.js comme "modifié", et GitHub Pages sert
le HTML avec 10 minutes de cache HTTP (`Cache-Control: max-age=600`), donc
même un simple F5 dans cette fenêtre pouvait resservir l'ancienne version.
Double correction : `CACHE_NAME` bumpé à **chaque** déploiement (maintenant
une discipline documentée en commentaire dans `sw.js`) pour que le
navigateur détecte toujours un nouveau service worker, et les `fetch()` du
service worker passés en `{ cache: 'no-store' }` pour contourner le cache
HTTP de GitHub Pages.

Côté client (`js/offline.js`, `watchForUpdate()`) : dès qu'un nouveau
service worker fini d'installer derrière celui en cours d'utilisation, une
bannière persistante ("Une nouvelle version de Kinet est prête") propose
d'**Actualiser** — le clic envoie `skipWaiting` au nouveau service worker,
qui prend la main (`controllerchange`) et déclenche un unique rechargement
de page. Revérifié aussi à chaque retour au premier plan de l'onglet
(`visibilitychange`) : sur un onglet/une PWA resté ouvert plusieurs jours,
c'est le seul moment où retenter a une chance raisonnable d'aboutir (le
navigateur ne revérifie sw.js tout seul qu'au mieux une fois par jour).

## Feedback (v2.1)

Boîte à idées accessible depuis l'icône **💬** de l'entête (au même niveau
que Watchlist/Prochainement/Amis/Top, visible pour n'importe quel compte
connecté) : une catégorie (Bug / Idée / Autre) et un message libre, envoyés dans la
table `feedback`. Lu uniquement par l'admin, dans le nouvel onglet
**Avis** de la modale admin (voir section suivante — pas "Retours" comme
au tout début : ça se lisait comme un bouton "← Retour" de navigation,
utilisé partout ailleurs dans l'app, plutôt qu'un onglet) — regroupés par
catégorie, les catégories triées par nombre de retours **non traités**
décroissant (une catégorie déjà entièrement traitée redescend plutôt que
de rester en tête indéfiniment), et à l'intérieur d'un groupe les
non-traités remontent en premier. Chaque retour a un bouton "Marquer
traité" / "Rouvrir".

Contrairement à `admin_config` (section suivante), où la restriction
admin n'est qu'un choix d'affichage côté client (chacun n'y voit de toute
façon que sa propre ligne), la séparation ici est une vraie policy RLS
(`supabase/migrations/026_add_feedback.sql`) : un utilisateur ne peut
lire QUE ses propres retours, jamais ceux des autres, même via un appel
API direct — seul le compte dont l'email correspond à `ADMIN_EMAIL`
(dupliqué côté SQL, la policy ne peut pas lire une constante JS) voit
tout.

Pas de vrai "ML" ni de détection automatique de doublons/sujets récurrents
malgré l'idée évoquée au départ : Supabase est juste du Postgres, rien
pour faire tourner un modèle, et un vrai clustering de texte libre aurait
été plus complexe que fiable pour le volume attendu ici. Le tri par
catégorie + compteur de non-traités atteint le même besoin ("voir ce qui
revient le plus") de façon simple et prévisible plutôt que par une
approximation statistique. Nécessite
`supabase/migrations/026_add_feedback.sql`.

## Interface admin (succès, happenings, avis & stats)

Un tableau de bord "voir tout / gérer tout" — réservé au compte
propriétaire de l'app (email en dur, `ADMIN_EMAIL` dans `js/admin.js`),
accessible via **🛠️ Admin** dans la modale profil (bouton masqué pour
tout autre compte). Quatre onglets :

- **Succès** — tous les paliers cumulatifs et tous les succès secrets, y
  compris ceux encore verrouillés (pas de "???" ici, c'est la vue admin).
  Chaque groupe/succès a un interrupteur Activé/Désactivé (l'exclut du
  décompte et de l'affichage normal, sans toucher au code — utile pour
  retirer un succès qu'on regrette). Les seuils des paliers cumulatifs
  (ex. 10/50/150 films notés pour Cinéphile) sont modifiables directement,
  avec un bouton ↺ pour revenir aux valeurs par défaut.
- **Happenings** — la liste complète des cinq happenings codés en dur
  (avec le film concerné, le déclencheur, activé/désactivé, et un bouton
  **▶ Revivre** qui rejoue l'expérience à la demande, sans avoir à
  retrouver la bonne fiche film) et des happenings "génériques" créés
  depuis l'admin. Un formulaire permet d'en créer un nouveau sans écrire de
  code : choisir un film déjà noté (avec fiche TMDB), un déclencheur (clic
  sur badge ou un temps passé sur la fiche), une icône, un titre et un
  message — affiché dans une modale simple au déclenchement. Une vraie
  expérience sur mesure (comme l'arc de l'Odyssée ou le défi photo) reste
  du ressort du code, pas de l'admin.
- **Avis** — voir la section Feedback juste au-dessus.
- **Stats & logs** — voir la section suivante.

Techniquement (Succès/Happenings) : les définitions (`CUMULATIVE_GROUPS`, `HIDDEN_ACHIEVEMENTS`,
`HAPPENINGS`) restent dans le code — l'admin ne stocke que les *écarts* par
rapport à elles (seuil modifié, activé/désactivé) et les happenings créés
depuis l'interface, dans une seule ligne JSON par compte
(`admin_config`, `supabase/migrations/018_add_admin_config.sql`, RLS comme
les autres tables). `js/achievements.js` et `js/happenings.js` appliquent
ces écarts via `getEffectiveCumulativeGroups()` / `getEffectiveHiddenAchievements()`
/ `getEffectiveHappenings()` — vérifiés en `typeof` pour continuer à
fonctionner seuls sur un compte non admin (jamais de config chargée dans ce
cas). Nécessite `supabase/migrations/018_add_admin_config.sql`.

## Stats & logs (admin, v2.1)

Onglet **Stats & logs** de la modale admin — trois blocs :

- **Croissance** — inscriptions et installations de l'app (PWA), au total
  et sur les 7 derniers jours. Répond directement à "qui télécharge le
  site".
- **Activité globale (tous comptes)** — comptes créés, films notés,
  séries suivies, visionnages, agrégés sur TOUS les comptes (pas
  seulement celui de l'admin) via une fonction `SECURITY DEFINER`
  (`get_admin_site_stats()`, même famille que `get_global_top_films` —
  lit tout en interne mais ne renvoie que 4 nombres, jamais une ligne
  identifiable).
- **Journal** — les 200 derniers évènements bruts, plus récents en
  premier : inscriptions, installations, et surtout les **erreurs JS non
  interceptées qui arrivent vraiment aux visiteurs** (message + fichier +
  ligne) — jusqu'ici invisibles pour l'admin, elles ne partaient que dans
  LEUR console à eux.

Techniquement : une seule table `app_events` (append-only, `event_type` +
`detail` texte libre plutôt qu'une table par type — un nouveau type de log
demain n'exige pas de nouvelle migration) alimentée par `logEvent()`
(`js/logging.js`, chargé tôt pour capter aussi les erreurs de chargement
des scripts suivants) : `window.addEventListener('error', ...)` et
`'unhandledrejection'` pour les erreurs, un appel explicite à l'inscription
(`js/profile.js`, sur la vraie création de profil, pas une relecture) et à
l'installation PWA (`js/pwa.js`, évènement `appinstalled`). `logEvent()`
ne lève jamais (tout est avalé en silence) : un raté de log ne doit
jamais devenir une nouvelle erreur visible à son tour.

INSERT ouvert même sans session (`anon` + `authenticated`, seule table du
projet dans ce cas) : une erreur peut survenir sur l'écran de connexion,
avant tout compte. La LECTURE reste une vraie policy RLS réservée à
l'admin, comme le feedback. Nécessite
`supabase/migrations/027_add_app_events.sql`.

## Micro-interactions & état de chargement (v1.6)

Les fenêtres modales de l'app (édition de film, profil, statistiques,
succès, admin, journal, profil d'ami, feedback) s'ouvraient déjà avec une animation
(`overlayIn`/`modalIn`) mais se fermaient d'un coup, sans transition. Elles
partagent maintenant une fermeture symétrique (`overlayOut`/`modalOut`,
`openOverlay()`/`closeOverlay()` dans `js/ui.js`) — chaque `close*()` garde
ses propres à-côtés (ex. `closeModal()` remet `editingId` à `null`) via un
callback plutôt que de dupliquer cette logique 7 fois. Cliquer sur l'étoile
favori ou enregistrer une note déclenche en plus un petit pulse sur
l'élément concerné (`pulseElement()`), retour visuel immédiat en plus du
toast déjà présent.

Le catalogue affiche 5 lignes grisées animées (`.film-row.skeleton`) le
temps du tout premier chargement (session + requête Supabase) au lieu d'un
espace vide — `render()` les remplace dès qu'il tourne pour de vrai, aucun
changement JS nécessaire pour ça.

Distinction volontaire pour `prefers-reduced-motion` (réglage système
"Réduire les animations") : la fermeture de modale et le chargement grisé
sont des animations autonomes/en boucle une fois lancées, donc coupées sous
ce réglage (même traitement que l'ouverture de modale, la transition de
page ou le couloir Old Boy déjà en place) ; le pulse étoile/sauvegarde est
au contraire piloté en direct par le clic — il reste actif quel que soit ce
réglage, comme l'arc final d'Odyssée.

## Installation en app (PWA, v2.0.7, bandeau v2.0.8, icône d'entête v2.1)

Kinet s'installe comme une vraie application — téléphone (Android/iOS) et
PC (Chrome/Edge) — sans passer par un store. Aucun `.apk` distinct :
un PWA installé se comporte comme une app native (fenêtre séparée, icône
sur le bureau/écran d'accueil, lancement hors du navigateur), ce qui
couvre la demande sans l'outillage supplémentaire (Capacitor/Cordova)
qu'un vrai `.apk` exigerait — envisageable plus tard si le besoin devient
spécifiquement "présent sur le Play Store".

- **`manifest.json`** : nom, icônes (`icons/`, générées depuis l'identité
  Kinet — fond dégradé violet, "K" en gras), couleurs, `display: standalone`.
- **Icônes** : `icon-192`/`icon-512` (usage général) + variantes
  `icon-maskable-*` (zone de sécurité 80%, pour l'icône adaptative
  d'Android qui peut rogner jusqu'au cercle inscrit) + `apple-touch-icon`
  (iOS) + `favicon-32`.
- **`sw.js`**, déjà en place pour le mode hors ligne ci-dessous, sert aussi
  de service worker requis pour l'installabilité — rien à y changer.
- **Bandeau d'installation** (`#installBanner`, v2.0.8) : la section dans
  la modale profil (ci-dessous) était jugée pas assez visible — ce bandeau
  pleine largeur, hors des conteneurs auth/app, se voit tout de suite,
  **y compris sur l'écran de connexion avant tout compte**. Fermeture
  mémorisée le temps de la session (`sessionStorage`) seulement — reparaît
  à la prochaine vraie visite plutôt que de disparaître pour de bon.
- **Icône d'entête** (`#installHeaderBtn`, v2.1) — 3e surface, au même
  niveau que Watchlist/Amis/Top : un accès direct sans passer par le
  profil. Masquée si déjà installé ou si rien de concret à proposer
  (même logique que le bandeau), mais SANS mémoire de fermeture — un accès
  permanent, pas une relance ponctuelle qu'on peut vouloir ignorer.
- **UI d'installation** (`js/pwa.js`) : dans la modale profil (section
  "Installer Kinet", sous "Mon activité" — sert de référence permanente
  une fois qu'on sait où la trouver, en complément du bandeau). Contenu
  entièrement dynamique selon ce que le navigateur permet :
  - **Chrome/Edge (téléphone ou PC)** : capte l'évènement natif
    `beforeinstallprompt`, propose un bouton **📲 Installer l'app** qui
    déclenche le prompt natif du navigateur.
  - **iOS Safari** : n'a jamais de prompt natif — instructions manuelles
    (bouton Partager → "Sur l'écran d'accueil").
  - **Déjà installé** (`display-mode: standalone`) : simple confirmation,
    pas de bouton.
  - **Navigateur sans support** (Firefox desktop, etc.) : message générique
    plutôt qu'un bouton mort.
- **iOS ne lit pas le manifest** pour le mode standalone : trois balises
  `apple-mobile-web-app-*` dans `<head>` (index.html) assurent qu'un ajout
  à l'écran d'accueil s'ouvre bien sans barre d'adresse sur cet OS.

**Limite connue — le lien du mail de connexion sur PC** : une fois Kinet
installée sur PC, cliquer le lien reçu par email (connexion par lien
magique) ouvre le navigateur classique et pas la fenêtre de l'app
installée. Ce n'est pas un réglage que le site peut forcer lui-même :
c'est Chrome/Edge qui décide, par installation, d'ouvrir ou non les liens
d'un site dans son app installée ("Link Capturing"), un réglage propre à
chaque appareil. `manifest.json` inclut déjà `id` et `launch_handler`
(les deux éléments côté site qui aident ce mécanisme à reconnaître Kinet
correctement) ; pour l'activer réellement, ouvrir `chrome://apps` (ou
`edge://apps`), clic droit sur Kinet → **Paramètres de l'app** → activer
**"Ouvrir les liens pris en charge dans l'app"**. Une fois ce réglage
activé, le lien du mail devrait ouvrir directement la fenêtre installée.

## Mode hors ligne, lecture seule (v1.6)

L'app reste consultable sans réseau (métro, avion, zone blanche...) :
catalogue, watchlist, journal et statistiques restent visibles avec les
dernières données synchronisées, un bandeau **"Hors ligne"** en haut de
page précise depuis quand. Volontairement lecture seule (décision
confirmée) : noter, modifier ou ajouter un film, ou toucher à la watchlist,
reste bloqué avec un message clair tant que le réseau n'est pas revenu —
pas de file d'attente à synchroniser, pas de gestion de conflits. Les
fonctionnalités sociales (amis, groupes, propositions...) ne sont pas
couvertes : elles supposent du réseau par nature et échouent proprement
avec le message d'erreur habituel si la connexion manque, comme avant
cette version. Dès que le réseau revient (évènement `online` du
navigateur), l'app retente automatiquement et sort seule du mode hors
ligne — pas besoin de recharger la page à la main.

Techniquement, deux mécanismes complémentaires (`js/offline.js`) :
1. Un **service worker** (`sw.js`) qui met en cache l'app shell (HTML/CSS/
   JS) au fil des visites en ligne (stratégie "réseau, puis repli sur le
   cache", pas de préchargement à liste à maintenir à la main — chaque
   `?v=N` est une URL différente, donc se cache tout seul) : sans lui, le
   navigateur ne pourrait même pas charger la page hors ligne, peu importe
   les données déjà en cache.
2. Un **cache `localStorage`** des dernières listes chargées avec succès
   (films/watchlist/viewings), par compte — `loadFilms()`/`loadViewings()`/
   `loadWatchlist()` s'y replient quand la requête Supabase échoue, plutôt
   que de vider la liste et donner l'impression que tout a disparu.

## Accessibilité (v1.6)

Premier passage dédié (au clavier/lecteur d'écran en particulier — le
contraste de couleurs, lui, était déjà large sur tout le thème sombre) :

- **Focus clavier centralisé** (`js/ui.js`, `openOverlay()`/
  `closeOverlay()`) : ouvrir une des 7 modales de l'app y déplace le focus
  (sur son premier champ, ou son bouton fermer à défaut d'un champ), la
  refermer le restitue à l'élément qui l'avait ouverte — sauf si une autre
  modale s'est ouverte entre-temps par-dessus (ex. "Succès" depuis le
  profil), auquel cas on ne lui vole pas le focus.
- **Échap ferme la modale ouverte**, un seul gestionnaire pour les 7 plutôt
  que de le répéter — aucune n'y répondait avant cette version.
- **Boutons icône seule** (fermer ✕, étoile favori, vote ▲/▼, tri ↓/↑, "⋯
  Plus d'options", badge happening) : `aria-label` explicite en plus du
  `title` déjà là pour la souris — un glyphe seul (✕, ★, ▲…) n'a pas de nom
  fiable pour un lecteur d'écran. Les boutons à bascule (favori, vote, sens
  de tri) portent aussi `aria-pressed`, synchronisé à chaque changement
  d'état.
- **Curseurs de notation** (grille 7 critères + note manuelle) : un bug de
  spécificité CSS faisait perdre le focus clavier visible sur ces sliders
  spécifiquement (`input[type="range"]{outline:none;}` l'emportait
  silencieusement sur la règle générique de focus) — corrigé.
- **Lignes de liste cliquables au clavier** (v2.28, `makeRowClickable()`,
  `js/ui.js`) : le catalogue, le Top films, les séries suivies, le
  catalogue d'un ami, la distribution des stats et le profil public
  n'étaient que des `<div>` avec un simple clic souris pour ouvrir le
  détail — injoignables au clavier (Tab les sautait, Entrée n'y faisait
  rien). Généralisé le pattern déjà bien fait à un seul endroit
  (histogramme des stats) : `role="button"` + `tabindex="0"` + activation
  Entrée/Espace, plus `[role="button"]:focus-visible` (`css/style.css`)
  pour un anneau de focus visible sur ces lignes comme sur un vrai bouton.
- **Boutons icône sans libellé fiable** : plusieurs boutons de fermeture/
  suppression n'avaient qu'un `title` (jamais annoncé de façon fiable par
  tous les lecteurs d'écran, absent au toucher) ou, pour 4 des 5 boutons
  de fermeture des "happenings", rien du tout — `aria-label` ajouté
  partout où il manquait.

## Export vers Letterboxd (v1.6)

Bouton **⬇ Exporter vers Letterboxd (CSV)** (menu "⋯" à côté d'Exporter/
Importer JSON) : génère un fichier CSV au format officiel d'import de
Letterboxd (`letterboxd.com/about/importing-data`), à importer sur leur
site en une minute. Pas de synchronisation automatique : Letterboxd
n'ouvre pas son API en écriture à un projet perso comme celui-ci (accès
uniquement sur demande à `api@letterboxd.com`, en pratique réservé à des
partenaires approuvés) — l'export CSV manuel est la seule voie officielle
et fiable disponible sans ça.

Colonnes : `Title`, `Year`, `tmdbID` (même identifiant que celui déjà
stocké via la recherche TMDB — évite toute ambiguïté de titre à
l'import), `WatchedDate` (date du visionnage le plus récent si le film a
été revu, sinon date d'ajout au catalogue), `Rating` (0.5 à 5.0 par pas de
0.5, la même échelle que l'app), `Review`. `Tags` volontairement exclu :
documenté comme ignoré par l'import Letterboxd (contrairement à leur
export, qui lui l'inclut). Un film = une seule ligne, pas une par
revisionnage — l'app ne garde qu'une note par film, pas une par
visionnage, copier la même note sur plusieurs entrées de journal aurait
été plus trompeur qu'utile.

## Import depuis Letterboxd (v2.2, plusieurs corrections en v2.2x)

Sens inverse de la section précédente. Bouton **🎬 Importer depuis
Letterboxd (CSV)** (même menu "⋯") : au premier clic, un **tutoriel**
explique où trouver son export ("Exporter vos données" dans les réglages
du compte Letterboxd → télécharge un `.zip`) et quel fichier choisir dans
le zip selon ce qu'on veut importer ("Ne plus afficher" mémorisé en
local). Extraire le zip localement et déposer un seul CSV à la fois, pas
de dézippage automatique côté app (aucune dépendance externe ajoutée,
l'app reste 100% vanilla). Fichier reconnu par son nom exact, colonnes en
repli s'il a été renommé (`js/importExternal.js`, `detectLetterboxdType()`).

- `ratings.csv` / `diary.csv` → importés dans le catalogue noté, avec
  recherche TMDB automatique par titre + année (±1 an toléré, Letterboxd
  affiche parfois l'année de sortie US/festival plutôt que la sortie
  France que TMDB retient par défaut) pour récupérer affiche/résumé/genres,
  exactement comme un ajout manuel. Note copiée dans `manual_note` (même
  échelle 0.5-5.0), commentaire dans `review` si présent. `diary.csv` : les
  revisionnages d'un même film sont regroupés en une seule fiche (note la
  plus récente) mais chaque date devient une entrée de journal séparée
  (`viewings`), alimentant le badge "revu ×N" comme n'importe quel
  visionnage ajouté depuis l'app.
- `watched.csv` (films marqués vus, notés ou non) → importé par le même
  chemin, comme un film sans note (`manual_note` reste `null`) : liste des
  films jamais logués au journal ni notés sur Letterboxd, une vraie partie
  de l'historique qu'il serait dommage de perdre (anciennement refusé à
  tort — voir CHANGELOG).
- `reviews.csv` → chemin dédié (`importLetterboxdReviews()`) : comme ces
  films sont quasi toujours déjà présents via ratings/diary, cette fonction
  **complète** l'entrée existante avec le texte de la critique (et la note
  si elle manquait) plutôt que de l'ignorer comme un doublon — sans jamais
  écraser une critique déjà écrite dans Kinet. Un film absent du catalogue
  est importé normalement (note + critique).
- `watchlist.csv` → importé dans la Watchlist (même correspondance TMDB).
- `profile.csv` / `comments.csv` (infos de compte, commentaires — sans
  aucune note de film) → message explicite plutôt qu'un "fichier non
  reconnu" trompeur : rien à en tirer ici.

Films déjà présents dans le catalogue (par `tmdb_id`) ou déjà dans la
watchlist (par titre) : ignorés silencieusement plutôt que dupliqués — le
récapitulatif final (toast) donne le détail (importés / déjà présents /
introuvables sur TMDB). Recherches TMDB faites 4 à la fois (assez rapide
sur un gros catalogue sans bombarder l'API).

**Matching TMDB** (`bestTmdbCandidate()`) : plusieurs fiches TMDB peuvent
correspondre au même titre/année (le vrai film, mais aussi un making-of,
une featurette homonyme...) — départagé par **popularité TMDB** (avec un
bonus si le titre est exactement identique à la recherche, FR ou VO) plutôt
que par le premier résultat renvoyé par l'API, qui n'est pas forcément le
bon (cas réel : "The Handmaiden" renvoyait d'abord un making-of avant le
vrai film, "Mademoiselle"). Voir `tests/tmdb-matching.test.js`.

**Trakt** : préparé (`js/traktImport.js`, `js/traktConfig.js`,
`supabase/migrations/035_add_trakt_tokens.sql`) mais **pas branché** — pas
d'export fichier chez eux, seulement une API OAuth : nécessite une appli
Trakt enregistrée par l'utilisateur propriétaire du site (client_id propre,
gratuit, sur `trakt.tv/oauth/applications`), qui n'existe pas encore. Le
fichier n'est chargé par aucun `<script>` et aucun bouton n'y mène dans
l'app : zéro effet sur le site tant que ce n'est pas explicitement câblé.
Contrairement à Letterboxd (titre + année à recouper via
`bestTmdbCandidate`), Trakt renvoie directement le `tmdb_id` de chaque
film — pas de risque de mismatch façon "Handmaiden" à ce niveau-là. Point
resté ouvert (voir le commentaire en tête du fichier) : l'échange du code
OAuth contre un jeton suppose le flux standard documenté par Trakt (avec
un `client_secret`, à embarquer côté client comme `TMDB_API_KEY`/la clé
anon Supabase déjà publiques ici) — à reconfirmer sur leur doc au moment
de vraiment connecter, jamais testé faute de client_id.

(TV Time envisagé un temps, abandonné : le site n'a pas d'export exploitable
— sa page est une appli Flutter qui dessine tout sur un `<canvas>`, aucune
donnée récupérable dans le HTML — et l'appli elle-même a fermé depuis.)

## Prochaines étapes possibles

- D'autres happenings (voir la section ci-dessus pour ceux déjà en place)
- Hors ligne en lecture/écriture (noter un film sans réseau, synchronisé au
  retour) — nécessiterait une file d'attente locale, des ids temporaires
  pour un film créé hors ligne et une gestion des conflits ; volontairement
  laissé de côté pour l'instant au profit de la version lecture seule
  ci-dessus, plus simple et plus fiable pour un usage perso.
- Un vrai `.apk` distribuable (au-delà du PWA installable ci-dessus,
  section "Installation en app") si le besoin devient spécifiquement
  "présent sur le Play Store" — demanderait un tout autre outillage
  (Capacitor/Cordova).
