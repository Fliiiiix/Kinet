// --- Configuration Trakt (OAuth) — voir js/traktImport.js ---
// Contrairement à js/tmdbConfig.js, AUCUNE clé n'est renseignée ici :
// Trakt exige une application OAuth enregistrée par le PROPRIÉTAIRE du
// site (gratuit, sur https://trakt.tv/oauth/applications), pas une clé
// générique valable pour tout le monde comme TMDB. Tant que
// TRAKT_CLIENT_ID reste vide, l'import Trakt reste désactivé (voir le
// garde-fou en haut de js/traktImport.js) plutôt que de tenter une
// redirection OAuth cassée.
//
// Pour l'activer : créer une appli sur trakt.tv/oauth/applications avec
// "Redirect uri" = l'URL exacte de ce site (https://fliiiiix.github.io/Kinet/),
// puis copier ici le Client ID généré. Voir js/traktImport.js pour ce qui
// reste à vérifier côté échange du jeton (Client Secret) avant de
// réellement brancher le bouton d'import.
const TRAKT_CLIENT_ID = '';
