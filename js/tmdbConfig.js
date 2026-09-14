// Token API TMDB (Read Access Token, v4 auth — un long JWT) — themoviedb.org
// (compte gratuit) → menu profil → Paramètres → API → Créer une clé. Utilisé
// en en-tête Authorization: Bearer (voir js/tmdb.js), pas en paramètre d'URL.
//
// Comme la clé anon Supabase, celui-ci est fait pour tourner côté client
// (recherche en lecture seule) — ce n'est pas un secret serveur. Reste
// soumis aux limites de débit du compte gratuit TMDB, largement suffisantes
// pour un usage personnel.
//
// Placeholder volontairement inoffensif : sans token valide, la recherche
// TMDB échoue proprement (message d'erreur affiché) sans casser le reste
// de l'app.
const TMDB_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI0ODc3YTNjOTU1MTUyN2Q1NjUzNzUxMTMzN2M1NTljZCIsIm5iZiI6MTc4NzI3NDMyNC41MDU5OTk4LCJzdWIiOiI2YTg3YTQ1NDU1YjJhMDE2ODdlYzAwYTkiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.THXYYOgsnLA65mTnTd1Sax_2N49ExaDWH05PApkhENg';
const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p/w342';
// Logos de plateformes VOD (Où regarder, js/tmdb.js) : des icônes carrées,
// jamais affichées plus grand que ~32px, w45 suffisant, inutile de tirer
// w342 comme pour une affiche.
const WATCH_PROVIDER_IMG_BASE = 'https://image.tmdb.org/t/p/w45';
