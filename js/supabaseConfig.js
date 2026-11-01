// Configuration Supabase.
// Remplace les deux valeurs ci-dessous par celles de ton projet :
// Supabase → Project Settings → API → Project URL / anon public key.
//
// La clé "anon" est faite pour être exposée côté client (elle est visible
// dans le code source de n'importe quel site utilisant Supabase) — la
// sécurité vient des règles RLS définies dans supabase/schema.sql, pas du
// secret de cette clé. Ne jamais mettre ici la "service_role key" en revanche,
// celle-là est un vrai secret.
// Valeurs placeholder volontairement "valides" (l'app s'affiche normalement,
// seuls les appels réseau échoueront) — évite une page blanche si on oublie
// de les remplacer avant de déployer.
const SUPABASE_URL = 'https://ethhacnngepckeakhsch.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0aGhhY25uZ2VwY2tlYWtoc2NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyNjQwODQsImV4cCI6MjEwMjg0MDA4NH0.PhrFiRZ8TSRJoIBsk4iKw7E5Ra227ptijBpBTBxkPMU';

// flowType 'implicit' (v2.1, retour utilisateur) : le flux PKCE, par défaut
// depuis supabase-js v2, stocke un "code verifier" dans le localStorage de
// l'appareil qui DEMANDE le lien magique — un lien demandé sur PC échoue
// silencieusement s'il est ouvert depuis le téléphone (et inversement),
// sans message d'erreur clair. Pas de flux OAuth/redirection tiers à
// protéger ici (email uniquement) : l'implicite (jetons directement dans
// l'URL du lien, comme avant l'introduction de PKCE) n'a pas ce défaut et
// reste le choix standard pour un simple lien de connexion par email.
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { flowType: 'implicit' },
  global: { fetch: kinetFetch } // gère le réseau absent, voir js/offlineNet.js
});

// Sans réseau, un jeton expiré ne doit ni faire attendre chaque requête (la
// librairie retente de le renouveler pendant 25 secondes) ni déconnecter Flix.
const fetchSessionOnline = supabaseClient.auth.getSession.bind(supabaseClient.auth);
supabaseClient.auth.getSession = async () => {
  const offlineSession = () => {
    const session = isOfflineMode ? storedOfflineSession() : null;
    return session ? { data: { session }, error: null } : null;
  };
  const known = offlineSession();
  if(known) return known;
  const online = fetchSessionOnline();
  return Promise.race([online, whenNetworkDown().then(() => offlineSession() || online)]);
};
