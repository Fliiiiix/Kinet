# Code de design Kinet

Version 1, 14/10/2026. Référence unique pour la typographie, les couleurs, l'espace, les formes, les composants, le mouvement et le ton de Kinet. Toute nouvelle interface et toute correction s'appuient dessus. Les valeurs vivent dans `css/style.css`, bloc `:root` « Code de design » : on utilise les variables, jamais une valeur écrite à la main.

Sources : la draft validée « Kinet Scope » (https://claude.ai/artifact/PK5dZ76wS3k63jihuW7keG), les retours de Flix depuis le 13/10 (minimalisme, moins de boîtes et de couleurs, pas de jargon ciné forcé, pas de look IA), les principes d'Apple (simplicité, hiérarchie, retour immédiat) et l'étude d'applis proches (Letterboxd, MUBI, Apple TV, Trakt, Serializd).

## 1. Principes

1. **Le contenu d'abord.** Les affiches et les titres portent la page. L'interface se met en retrait : pas de cadre autour de ce qui n'en a pas besoin.
2. **Une chose, un rôle.** Une couleur a un seul métier, une police a un seul métier, un composant a une seule apparence. Si deux éléments se ressemblent, ils se comportent pareil.
3. **L'espace sépare, pas les boîtes.** On groupe par la proximité, puis par une ligne fine. Une boîte (fond + bordure) est réservée à ce qui flotte au-dessus de la page.
4. **Une action principale par zone.** Un seul bouton plein par écran ou par bloc. Le reste est en texte.
5. **Rien d'aléatoire.** Chaque taille, espace, rayon et durée vient des échelles ci-dessous. Une valeur qui n'y est pas est une erreur.

## 2. Typographie

### Familles (2)

| Variable | Police | Rôle | Graisses |
|---|---|---|---|
| `--font-display` | Bricolage Grotesque | Titres : page, œuvre, modale, grand chiffre | 700, 800 |
| `--font-text` | Instrument Sans | Tout le reste : texte, boutons, libellés, métadonnées, notes | 400, 500, 600 |

- Les chiffres (notes, compteurs, épisodes, durées) utilisent `font-variant-numeric: tabular-nums` (classe `.num`) pour rester alignés. Les deux polices le gèrent, vérifié.
- Space Mono et Source Serif 4 ne font plus partie du code (voir § 10).

### Échelle (6 tailles)

| Variable | Taille | Interligne | Approche | Usage |
|---|---|---|---|---|
| `--fs-xs` | 11px | 1.35 | 0 (+0.06em en capitales) | Légendes, métadonnées secondaires, pastilles, libellés de section |
| `--fs-sm` | 13px | 1.4 | 0 | Interface par défaut : boutons, champs, lignes de liste, titres sous affiche |
| `--fs-md` | 15px | 1.55 | 0 | Texte de lecture : résumé, commentaire, paragraphe |
| `--fs-lg` | 20px | 1.25 | -0.01em | Titre de section, titre de modale |
| `--fs-xl` | 28px | 1.1 | -0.02em | Titre de page |
| `--fs-2xl` | clamp(32px, 5vw, 48px) | 1.0 | -0.02em | Titre d'œuvre sur sa fiche |

Règles :
- Hiérarchie par taille **et** graisse **et** couleur, jamais la taille seule.
- Les capitales sont réservées aux libellés `--fs-xs` (ex. « CRÉATION » dans une fiche), jamais à un titre ni à une phrase.
- Pas d'italique décoratif. L'italique sert uniquement à citer un titre d'œuvre dans une phrase.
- Longueur de ligne du texte de lecture : 65 caractères maximum (`max-width: 65ch`).

## 3. Couleurs

Chaque couleur a un rôle. On choisit la variable par son rôle, pas par sa teinte.

### Neutres

| Variable | Valeur | Rôle |
|---|---|---|
| `--bg` | #0a0a0a | Fond de page |
| `--surface-1` | #161616 | Ce qui flotte : modale, menu, feuille, toast. Champs de saisie. |
| `--surface-2` | #1f1f1f | Survol, élément pressé, piste de curseur |
| `--line` | rgba(244,243,238,0.09) | Séparateur, bordure de surface |
| `--line-strong` | rgba(244,243,238,0.18) | Contour d'un bouton secondaire, case à cocher vide |
| `--text-1` | #f4f3ee | Texte principal (contraste 17.8:1) |
| `--text-2` | #9a9993 | Texte secondaire, métadonnées, icônes au repos (6.9:1) |
| `--text-3` | #6b6a66 | Désactivé, indice non essentiel (3.7:1, jamais pour une info utile) |

### Accent (1)

| Variable | Valeur | Rôle |
|---|---|---|
| `--accent` | #4fcfff | **Tout ce qui est interactif ou actif** : bouton principal, lien, focus, onglet actif, sélection, progression |
| `--accent-ink` | #06151c | Texte posé sur l'accent (10.3:1) |
| `--accent-wash` | rgba(79,207,255,0.12) | Fond d'un élément sélectionné |

### Note (donnée, pas décoration)

| Variable | Valeur | Rôle |
|---|---|---|
| `--note-low` | #ff6b57 | Note < 2.5 |
| `--note-mid` | #e8a33d | Note de 2.5 à 3.99 |
| `--note-high` | #6ad18b | Note ≥ 4 |

Ces trois couleurs n'apparaissent **que** sur une note (le chiffre et son anneau). Exceptions système : `--danger` reprend `--note-low` pour une action destructive ou une erreur, `--success` reprend `--note-high` pour une confirmation.

### Rareté des cartes (Cartes uniquement)

| Variable | Valeur | Rôle |
|---|---|---|
| `--rarity-legendary` | #e8a33d | Carte légendaire |
| `--rarity-rare` | #6fa39f | Carte rare |

Même statut que la note : une donnée du jeu, jamais une décoration, et seulement dans Cartes.

### Anciennes variables

`--violet`, `--gold`, `--teal`, `--bronze`, `--plum`, `--coral`, `--green`, `--text`, `--text-muted` existent encore dans le CSS mais ne sont plus que des alias vers les variables ci-dessus (lot 2 de l'audit, v250). Tout nouveau code utilise les noms du code.

### Interdits

- Toute autre teinte (teal, bronze, prune, violet, or décoratif).
- Dégradés de fond, halos, lueurs colorées, textures de points.
- Une couleur pour « décorer » une catégorie (genre en couleur, pastille par page).

## 4. Espace et grille

### Échelle (base 4)

| Variable | Valeur | Usage type |
|---|---|---|
| `--sp-1` | 4px | Icône et son texte, chiffre et unité |
| `--sp-2` | 8px | Éléments d'un même composant |
| `--sp-3` | 12px | Lignes d'un même groupe |
| `--sp-4` | 16px | Éléments liés (titre et sa méta, affiches d'une grille sur mobile) |
| `--sp-5` | 24px | Blocs d'une même section |
| `--sp-6` | 32px | Marges de page sur PC, haut de page |
| `--sp-7` | 48px | Entre deux sections |
| `--sp-8` | 64px | Respiration majeure (avant le pied de page) |

### Grille

- Conteneur : 1120px maximum, marges latérales `--sp-6` (≥ 860px) et `--sp-4` (mobile).
- Grille d'affiches : ratio 2:3, `repeat(auto-fill, minmax(140px, 1fr))` sur PC, 3 colonnes sur mobile, espacement `--sp-4` (PC) et `--sp-3` (mobile). Toutes les cases ont exactement la même taille.
- Fiche d'œuvre : une seule colonne de lecture (max 760px) sous le bandeau, comme la fiche série.

## 5. Formes

| Variable | Valeur | Usage |
|---|---|---|
| `--r-sm` | 8px | Affiches, vignettes, cases à cocher, pastilles carrées |
| `--r-md` | 14px | Modales, menus, feuilles, bandeau d'œuvre, champs multilignes |
| `--r-full` | 999px | Boutons, champs de recherche, onglets pilule, avatars ronds |

Trois rayons, pas un de plus.

## 6. Surfaces et profondeur

| Niveau | Quoi | Recette |
|---|---|---|
| 0 | La page et son contenu | Pas de fond, pas de bordure. Séparation par l'espace, puis `--line`. |
| 1 | Élément pressé ou survolé | `--surface-2`, pas d'ombre |
| 2 | Ce qui flotte (menu, modale, feuille, toast) | `--surface-1` à 92 % + flou 20px, bordure `--line`, ombre `--shadow-float` |

Interdits : une boîte dans une boîte, une ombre sur du contenu posé, une double bordure.

## 7. Composants

- **Bouton principal** : pilule, fond `--accent`, texte `--accent-ink` 13px 600, hauteur 40px (44px sur mobile), marges 0 20px. Un seul par zone.
- **Bouton secondaire** : texte `--text-2` 13px 600, souligné fin ou contour `--line-strong` en pilule quand il est à côté d'un bouton principal. Survol : `--text-1`.
- **Bouton icône** : cible 40×40px, icône 20px `--text-2`, sans fond au repos, `--surface-2` au survol.
- **Retour** : lien texte « ‹ Retour » 13px `--text-2`, sans boîte.
- **Champ** : hauteur 40px, fond `--surface-1`, bordure `--line`, focus bordure `--accent`. Recherche en pilule.
- **Onglets** (Films / Séries, sections) : texte seul 15px 600, actif `--text-1` souligné 2px `--accent`, inactif `--text-2`.
- **Navigation** : PC, le mot « Kinet » à gauche, les pages en texte à droite, page active en pilule `--accent`. Mobile, barre du bas flottante (5 destinations maximum).
- **Affiche** : image 2:3, `--r-sm`, sans bordure ni fond autour. Sous l'image : titre 13px 500 sur une ligne, puis méta 11px `--text-2`. La note se lit dans le coin, en chiffre coloré.
- **Note** : sur une fiche, anneau 56px, bordure 2px couleur de la note, chiffre 15px 600 tabulaire. Dans une grille ou une liste, chiffre seul 13px 600 dans la couleur de la note.
- **Ligne de liste** : hauteur 56 à 64px, séparateur `--line`, pas de fond.
- **Modale / feuille** : niveau 2, `--r-md`, titre `--fs-lg`, fermeture par icône ✕ (bouton icône) en haut à droite. Sur mobile, feuille depuis le bas.
- **Toast** : niveau 2, centré en bas, 13px, disparaît seul.
- **Icônes** : un seul jeu, pictos au trait (viewBox 24, trait 1.75, `currentColor`). Pas d'émoji en couleur dans l'interface. Les émojis restent permis dans ce qu'écrivent les gens (réactions, commentaires).

## 8. Mouvement

| Variable | Valeur | Usage |
|---|---|---|
| `--dur-press` | 100ms | Retour au clic (échelle 0.97 sur `:active`) |
| `--dur-fast` | 150ms | Survol, changement de couleur |
| `--dur-base` | 220ms | Apparition d'une page, d'un menu |
| `--dur-slow` | 320ms | Feuille, modale |
| `--ease-out` | cubic-bezier(.2,.8,.2,1) | Entrées |
| `--ease-in-out` | cubic-bezier(.65,0,.35,1) | Déplacements |

- Le retour visuel part à l'appui, pas au relâchement.
- Une feuille sort par où elle est entrée.
- Pas d'animation en boucle, pas de rebond sur ce que l'utilisateur n'a pas lancé.
- « Réduire les animations » (système ou réglage Kinet) : fondus seulement.

## 9. Ton

- Tutoiement, phrases courtes, verbes d'action sur les boutons (« Noter », « Suivre », « Ajouter »).
- Le thème cinéma avec modération : pas de mots forcés (« poses développées », « projectionniste »).
- Pas de surtitre en capitales espacées façon page d'accueil de startup.
- Pas d'émoji dans un libellé de bouton ou un titre.
- Une seule façon de dire une chose : « À voir » partout, pas « Watchlist » ici et « À voir » là.

## 10. Écarts avec la draft Scope, à valider

| Draft Scope | Code | Pourquoi | Alternative |
|---|---|---|---|
| 4 polices (Bricolage, Archivo, Source Serif italique, IBM Plex Mono) | 2 polices (Bricolage, Instrument Sans) | Le site mélangeait déjà 4 familles différentes de la draft (Space Mono, Instrument Sans) : c'est la première source du « bordel ». Les chiffres tabulaires d'Instrument Sans remplacent la mono. | Garder la serif italique pour le seul résumé des fiches |
| Ambre réservé au suivi personnel | Ambre réservé à la note moyenne, le suivi passe en bleu glace | L'ambre servait déjà aux notes de 2.5 à 3.99 : une même couleur disait deux choses | Garder l'ambre pour le suivi et passer la note moyenne en blanc |
| Numéros de pose (N° 042), format 2.39:1 affiché | Retirés | Jargon ciné forcé (retour du 14/10) | Aucune |
| Cases d'affiche carrées dans la planche | Affiches 2:3 | Une affiche carrée coupe le visuel, toutes les applis étudiées gardent le 2:3 | Aucune |
