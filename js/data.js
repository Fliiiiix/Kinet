// Grille de critères — v1.2
// Chaque critère a : une définition (périmètre exact), des repères de notation
// (0 / 0.5 / 1) pour rester cohérent dans le temps, et des questions concrètes.
const CRITERIA = [
  { key:'scenario', label:"Scénario",
    def:"L'histoire elle-même : intrigue, dialogues, personnages, thèmes.",
    anchors:"0 → incohérente, dialogues plats, personnages creux\n0.5 → fonctionne, sans surprise ni relief particulier\n1 → maîtrisée, personnages qui évoluent, dialogues qui sonnent juste",
    help:"・L'intrigue tient-elle debout sans trous logiques ?\n・Les personnages évoluent-ils de façon crédible ?\n・Les dialogues sonnent-ils naturels ou forcés ?\n・Le film a-t-il quelque chose à dire, au-delà de l'histoire racontée ?" },
  { key:'mise_en_scene', label:"Mise en scène",
    def:"Les choix du réalisateur : rythme, ambiance, prises de risque, vision d'ensemble.",
    anchors:"0 → plate, aucune identité, subie plus que pensée\n0.5 → compétente, fait le travail sans surprendre\n1 → une vraie vision, des choix qui marquent, un rythme maîtrisé",
    help:"・Le rythme sert-il l'histoire (ni trop lent, ni précipité) ?\n・Des choix de mise en scène te sont-ils restés en tête ?\n・L'ambiance voulue est-elle atteinte ?\n・Le réalisateur prend-il des risques ou joue-t-il la sécurité ?" },
  { key:'jeu', label:"Jeu d'acteur",
    def:"La performance des acteurs, indépendamment du personnage écrit.",
    anchors:"0 → surjoué, sous-joué, ou en décalage avec le film\n0.5 → correct, fait le travail sans marquer\n1 → habité, crédible, tu oublies que ce sont des acteurs",
    help:"・Les émotions semblent-elles authentiques ?\n・Le casting est-il bien choisi ?\n・Y a-t-il une vraie alchimie entre les acteurs ?\n・Un acteur sort-il du lot (en bien ou en mal) ?" },
  { key:'esthetique', label:"Esthétique visuelle",
    def:"Cadrage, lumière, couleurs, effets spéciaux, décors.",
    anchors:"0 → terne, mal éclairé, effets qui sortent du film\n0.5 → propre techniquement, sans identité visuelle marquée\n1 → un vrai style visuel, des plans qui pourraient être des photos",
    help:"・Des plans te reviennent-ils de mémoire ?\n・La lumière et les couleurs servent-elles l'émotion des scènes ?\n・Les effets spéciaux sont-ils crédibles ou visibles ?\n・Le film a-t-il une identité visuelle propre ?" },
  { key:'son', label:"Son",
    def:"Mixage, bruitages, ambiance sonore (hors musique).",
    anchors:"0 → dialogues mal mixés, bruitages absents ou grossiers\n0.5 → propre, fait le travail sans se faire remarquer\n1 → immersif, le son raconte autant que l'image",
    help:"・Comprends-tu les dialogues sans effort ?\n・L'ambiance sonore renforce-t-elle l'immersion ?\n・Le silence est-il utilisé intelligemment ?\n・Le son est-il cohérent avec l'image ?" },
  { key:'musique', label:"Musique",
    def:"La partition/bande originale, indépendamment du mixage sonore.",
    anchors:"0 → absente, générique, ou gênante\n0.5 → correcte, illustrative, sans identité propre\n1 → mémorable, sert le film, reconnaissable hors contexte",
    help:"・Est-elle mémorable après coup ?\n・Sert-elle les scènes ou les écrase-t-elle ?\n・A-t-elle une identité propre ?\n・L'écouterais-tu seule, hors du film ?" },
  { key:'ressenti', label:"Ressenti global",
    def:"Ton impact émotionnel et ta satisfaction globale, indépendamment des 6 critères techniques.",
    anchors:"0 → ennui, indifférence, déception\n0.5 → sympathique, tu ne regrettes pas mais ça ne marque pas\n1 → marquant, tu y repenses, ça t'a transporté",
    help:"・As-tu ressenti quelque chose de fort ?\n・Le film a-t-il tenu ses promesses par rapport à tes attentes ?\n・Y repenses-tu depuis ?\n・Le recommanderais-tu spontanément ?" },
];

// Affiche manquante (v2.0.14) — SVG dessiné à la main plutôt qu'un emoji
// 🎬/📺 brut : même raisonnement que l'écran de connexion (v2.0.9), et
// même le cas le PLUS visible de tout le site (une affiche manquante
// arrive dès le premier film ajouté). Constantes partagées ici (data.js
// charge avant tout le reste, voir index.html) plutôt que dupliquées dans
// chacun des 10 fichiers qui dessinent une ligne de film — un seul
// endroit à changer si l'icône doit un jour évoluer.
const FILM_PLACEHOLDER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 9h18M3 15h18M8.5 4v16M15.5 4v16"></path></svg>';

// Feedback utilisateur (v2.1) — même liste utilisée pour remplir le
// <select> du formulaire (js/feedback.js) et pour étiqueter/regrouper les
// retours côté admin (js/admin.js) : un seul endroit si une catégorie
// doit un jour être ajoutée/renommée.
const FEEDBACK_CATEGORIES = [
  { key:'bug', label:'Bug' },
  { key:'idee', label:'Idée' },
  { key:'autre', label:'Autre' }
];
const TV_PLACEHOLDER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2"></rect><path d="M8 21h8"></path><path d="M12 17v4"></path></svg>';
// Pictos au trait de l'interface (audit D6 : un seul jeu d'icônes, même
// tracé que FILM_PLACEHOLDER_SVG ci-dessus). Les émojis restent permis dans
// ce que les gens écrivent (commentaires, réactions) et dans les jeux
// (succès, cartes, happenings). uiIcon(nom, plein) : plein = étoile ou
// cœur remplis (favori, « Aimé »).
const UI_ICON_PATHS = {
  user: '<circle cx="12" cy="8.5" r="3.8"></circle><path d="M4.5 20c0-4.1 3.4-6.8 7.5-6.8s7.5 2.7 7.5 6.8"></path>',
  group: '<circle cx="9.3" cy="8" r="3.3"></circle><path d="M16 3.8c1.5.7 2.5 2.2 2.5 4S17.5 11.1 16 11.8"></path><path d="M14.5 20.3c0-3-2.3-5-5.2-5s-5.2 2-5.2 5"></path><path d="M19 20c0-2.5-1.7-4.3-4-4.8"></path>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"></path><circle cx="4.5" cy="6" r="1"></circle><circle cx="4.5" cy="12" r="1"></circle><circle cx="4.5" cy="18" r="1"></circle>',
  clock: '<circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path>',
  chat: '<path d="M4 5h16v11H8l-4 4V5z"></path>',
  ticket: '<path d="M3.5 7.5h17v3a1.5 1.5 0 000 3v3h-17v-3a1.5 1.5 0 000-3z"></path><path d="M14.5 7.5v9"></path>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 9h18M3 15h18M8.5 4v16M15.5 4v16"></path>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.7-4.3 4.1 1 5.9L12 16.6l-5.2 2.9 1-5.9-4.3-4.1 5.9-.7L12 3.5z"></path>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7a4.3 4.3 0 017.5 2.8C19.5 15.4 12 20 12 20z"></path>',
  bookmark: '<path d="M6 3.5h12v17l-6-4.5-6 4.5z"></path>',
  repeat: '<path d="M17 2.5l3 3-3 3"></path><path d="M4 11v-1.5a4 4 0 014-4h12"></path><path d="M7 21.5l-3-3 3-3"></path><path d="M20 13v1.5a4 4 0 01-4 4H4"></path>',
  join: '<circle cx="9.3" cy="8" r="3.3"></circle><path d="M14.5 20.3c0-3-2.3-5-5.2-5s-5.2 2-5.2 5"></path><path d="M18.5 8v6M15.5 11h6"></path>',
  // Audit des six écrans (16/10) : bande-annonce, menu « ⋯ », coche, ajout.
  play: '<circle cx="12" cy="12" r="8.5"></circle><path d="M10.3 8.8l4.9 3.2-4.9 3.2z"></path>',
  dots: '<circle cx="5.5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="18.5" cy="12" r="1"></circle>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"></path>',
  plus: '<path d="M12 5v14M5 12h14"></path>'
};
function uiIcon(name, filled){
  const paths = UI_ICON_PATHS[name];
  if(!paths) return '';
  return `<svg class="ui-icon${filled ? ' ui-icon-filled' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
// Casting (fiche film, js/filmDetail.js) : TMDB n'a pas toujours de photo
// pour chaque acteur/actrice — même raisonnement que les deux placeholders
// ci-dessus, jamais une case vide à la place.
const PERSON_PLACEHOLDER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="7" r="4"></circle><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path></svg>';

// Genres films TMDB (v2.1, filtre par genre) — id -> libellé FR, liste
// officielle /genre/movie/list, stable depuis des années côté TMDB. Les
// films stockent les ids bruts (films.genre_ids, migrations/029), jamais
// le libellé traduit — un seul endroit à mettre à jour si TMDB en ajoute
// un jour un nouveau.
const GENRE_MAP = {
  28: 'Action', 12: 'Aventure', 16: 'Animation', 35: 'Comédie', 80: 'Crime',
  99: 'Documentaire', 18: 'Drame', 10751: 'Familial', 14: 'Fantastique',
  36: 'Histoire', 27: 'Horreur', 10402: 'Musique', 9648: 'Mystère',
  10749: 'Romance', 878: 'Science-fiction', 10770: 'Téléfilm', 53: 'Thriller',
  10752: 'Guerre', 37: 'Western'
};

// Films importés depuis l'Excel d'origine.
// Ordre des valeurs c[] dans l'ancien référentiel :
// [impression, scenario, realisation, jeu, image, son, musique]
// -> remappé au chargement vers les nouvelles clés (voir OLD_ORDER_TO_NEW_KEY dans app.js)
const SEED = [
{t:'Paprika',c:[1,1,1,1,1,1,1],f:true},
{t:'Miss détective',c:[1,0.6,0.4,1,0.5,0.7,0.5],f:true},
{t:'Les Gardiens de la galaxie 2',c:[0.5,0.5,0.7,0.8,1,0.7,1],f:false},
{t:'Avengers : l\'ère d\'ultron',c:[0.5,0.4,0.7,0.5,0.8,1,0.25],f:false},
{t:'Ant man',c:[0.75,0.8,0.75,0.6,0.65,0.8,0.65],f:false},
{t:'Captain america : civil war',c:[0.5,0.5,0.65,0.5,0.7,0.7,0.5],f:false},
{t:'Black widow',c:[0.1,0.3,0.2,0.2,0.25,0.4,0.4],f:false},
{t:'The Accidental Gateaway Driver',c:[0.7,0.85,0.9,0.9,0.8,0.8,0.7],f:false},
{t:'Black Panther',c:[0.6,0.7,0.7,0.6,0.6,0.65,0.8],f:false},
{t:'Spider-man : Homecoming',c:[0.7,0.6,0.75,0.7,0.8,0.65,0.7],f:false},
{t:'Doctor Strange',c:[0.65,0.8,0.8,0.7,0.7,0.8,0.6],f:false},
{t:'Thor : Ragnarok',c:[0.4,0.4,0.6,0.5,0.5,0.5,0.7],f:false},
{t:'Ant-Man et la Guêpe',c:[0.75,0.75,0.65,0.65,0.75,0.8,0.5],f:false},
{t:'Avengers : Infinity War',c:[0.9,0.8,0.6,0.8,0.8,0.6,0.75],f:false},
{t:'Avengers : Endgame',c:[0.9,0.9,0.8,0.7,0.9,0.8,0.8],f:false},
{t:'Traque à Boston ',c:[0.9,1,0.6,0.8,0.7,0.7,0.8],f:false},
{t:'L\'amour ouf',c:[0.4,0.4,0.6,0.6,0.65,0.6,0.5],f:false},
{t:'A working man ',c:[0.5,0.5,0.5,0.5,0.6,0.6,0.6],f:false},
{t:'The Order',c:[0.8,0.9,0.75,0.9,0.8,0.9,0.8],f:false},
{t:'Un Meurtre Parfait',c:[0.7,0.75,0.5,0.8,0.5,0.7,0.6],f:false},
{t:'Burn After Reading',c:[0.8,0.85,0.85,0.85,0.7,0.7,0.65],f:true},
{t:'Mr Wolf 2',c:[0.55,0.6,0.8,0.75,0.75,0.85,0.85],f:false},
{t:'Du sang et des larmes',c:[0.85,1,0.85,0.85,0.9,0.85,0.7],f:true},
{t:'Spider-man : Far From Home',c:[0.7,0.65,0.85,0.7,0.9,0.7,0.7],f:false},
{t:'Shang-Chi et la légende des 10 anneaux',c:[0.45,0.5,0.5,0.5,0.6,0.6,0.65],f:false},
{t:'Les Eternels',c:[0.35,0.3,0.65,0.45,0.6,0.4,0.35],f:false},
{t:'Spider-man : No Way Home',c:[0.9,0.8,0.8,0.9,0.85,0.75,0.7],f:false},
{t:'Doctor Strange In The Multiverse Of Madness',c:[0.7,0.75,0.8,0.65,0.75,0.65,0.65],f:false},
{t:'Thor : Love And Thunder',c:[0.4,0.5,0.75,0.7,0.85,0.65,0.8],f:false},
{t:'Black Panther : Wakanda Forever',c:[0.4,0.45,0.5,0.65,0.65,0.6,0.55],f:false},
{t:'Ravage',c:[0.4,0.45,0.75,0.65,0.625,0.5,0.35],f:false},
{t:'Nobody',c:[0.8,0.75,0.65,0.85,0.65,0.65,0.9],f:true},
{t:'Superman (2025)',c:[0.7,0.65,0.7,0.65,0.8,0.6,0.7],f:false}
];
