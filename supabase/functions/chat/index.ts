// --- Chatbot Kinet (retour utilisateur, "un début") ---
// Supabase Edge Function (Deno) : seul endroit où la clé API Anthropic
// vit, jamais côté client. Contrairement à la clé TMDB (js/tmdbConfig.js,
// un "Read Access Token" explicitement conçu par TMDB pour tourner côté
// client — voir le commentaire à cet endroit) ou à la clé anon Supabase,
// une clé Anthropic est un vrai secret : exposée dans le JS, n'importe qui
// l'ouvrant depuis les outils de dev pourrait l'utiliser et consommer le
// budget du compte. D'où cette fonction, qui la garde côté serveur et ne
// renvoie au client que la réponse du modèle.
//
// Authentification : AUCUNE vérification de session écrite ici à la main
// — Supabase vérifie déjà le JWT de la requête avant même d'invoquer cette
// fonction (comportement par défaut tant que "Verify JWT" n'est pas
// désactivé dans la configuration du projet), donc seul un compte Kinet
// connecté peut l'appeler. Voir js/chatbot.js côté client, qui appelle
// via supabaseClient.functions.invoke('chat', ...) — ce client pose déjà
// l'en-tête Authorization tout seul.
//
// Déploiement (à faire une fois, toi — je n'ai pas accès à ton projet
// Supabase) :
//   1. Installe la CLI Supabase si ce n'est pas déjà fait.
//   2. supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref <ton-ref>
//   3. supabase functions deploy chat --project-ref <ton-ref>
// Voir README.md → section Chatbot pour le détail complet.

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
// Modèle volontairement choisi pour l'équilibre coût/qualité d'un chatbot
// perso à usage occasionnel — change cette seule ligne si tu veux un autre
// modèle de la gamme Claude.
const ANTHROPIC_MODEL = 'claude-sonnet-5';
const MAX_HISTORY_MESSAGES = 20; // garde-fou côté serveur, même si le client ne devrait jamais en envoyer plus

// CORS : nécessaire pour qu'un appel depuis le navigateur (origine
// différente de l'API Supabase elle-même) aboutisse — Supabase ne gère pas
// ça automatiquement pour les Edge Functions, contrairement aux policies
// RLS sur les tables. '*' plutôt qu'une origine précise : Kinet peut être
// servi depuis plusieurs origines (GitHub Pages, localhost en dev...), et
// l'authentification réelle vient déjà du JWT vérifié par Supabase, pas de
// cette en-tête.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Contexte + personnalité du chatbot — "un peu des trois" (retour
// utilisateur) : recommandations, discussion ciné générale, aide à la
// navigation de l'app, plutôt qu'un rôle unique et rigide. Volontairement
// SANS accès aux données réelles du catalogue de l'utilisateur pour ce
// premier jet (aucune requête vers `films`/`watchlist` ici) : lui donner
// le catalogue entier à chaque message aurait un coût et une empreinte de
// confidentialité qui mérite sa propre passe de conception, pas quelque
// chose à glisser au passage dans ce "début".
const SYSTEM_PROMPT = `Tu es l'assistant de Kinet, une app perso de critique de films et séries (grille de notation à 7 critères, catalogue, watchlist, séries suivies, amis/groupes, cartes à collectionner).

Ton rôle, à la demande de l'utilisateur :
- Recommander des films/séries à regarder (tu n'as pas accès à son catalogue réel pour l'instant — demande ses goûts/envies du moment si besoin plutôt que de supposer).
- Discuter cinéma en général : trivia, avis, comparaisons, contexte sur un film/réalisateur/acteur.
- Aider à s'orienter dans Kinet si on te pose une question sur l'app (watchlist, séries, amis, groupes, cartes à collectionner, statistiques...).

Réponds en français, dans un ton direct et chaleureux, sans formules creuses ni listes à puces systématiques — des phrases, comme une vraie conversation. Reste concis (quelques phrases suffisent la plupart du temps, pas un essai). Si tu ne sais pas, dis-le simplement plutôt que d'inventer.`;

Deno.serve(async (req) => {
  if(req.method === 'OPTIONS'){
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if(!ANTHROPIC_API_KEY){
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY non configurée côté serveur (voir le commentaire en tête de ce fichier).' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  let body: { messages?: { role: string; content: string }[] };
  try{
    body = await req.json();
  }catch(e){
    return new Response(JSON.stringify({ error: 'Corps de requête invalide (JSON attendu).' }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if(messages.length === 0){
    return new Response(JSON.stringify({ error: 'Aucun message fourni.' }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
  // Ne garde que les derniers messages (fenêtre de contexte raisonnable
  // pour un chatbot perso, évite aussi qu'un historique client corrompu/
  // trafiqué fasse exploser le coût d'un seul appel).
  const trimmed = messages.slice(-MAX_HISTORY_MESSAGES).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 4000), // garde-fou longueur, même raison
  }));

  try{
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: trimmed,
      }),
    });

    if(!res.ok){
      const errText = await res.text();
      console.error('Anthropic API error', res.status, errText);
      return new Response(JSON.stringify({ error: `Erreur de l'API Claude (${res.status}).` }),
        { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const data = await res.json();
    const reply = (data.content || []).map((block: { type: string; text?: string }) => block.text || '').join('');

    return new Response(JSON.stringify({ reply }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }catch(e){
    console.error(e);
    return new Response(JSON.stringify({ error: 'Erreur réseau vers l\'API Claude, réessaie.' }),
      { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
});
