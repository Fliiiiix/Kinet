// --- Assistant (chatbot, retour utilisateur, "un début") ---
// Appelle une Supabase Edge Function (supabase/functions/chat/index.ts,
// Deno) plutôt que l'API Claude en direct depuis le navigateur : une clé
// API Anthropic est un vrai secret (contrairement à la clé TMDB,
// js/tmdbConfig.js, conçue par TMDB pour être publique), elle ne peut pas
// vivre dans ce fichier. La fonction, elle, a besoin d'être déployée une
// fois par toi (voir le commentaire en tête de ce fichier côté serveur) —
// sans ça, cette modale s'ouvre normalement mais chaque message revient en
// erreur, message clair plutôt qu'un échec silencieux (voir
// handleChatbotSend() plus bas).
//
// Historique de conversation gardé en mémoire SEULEMENT (pas de table
// dédiée, pas de localStorage) : "un début" assumé — la conversation ne
// survit pas à une fermeture de la modale ni à un rechargement de page.
// Jamais connecté aux vraies données du catalogue pour ce premier jet non
// plus (voir le commentaire sur SYSTEM_PROMPT côté fonction) : mérite sa
// propre passe de conception (coût, confidentialité), pas quelque chose à
// glisser au passage ici.

let chatbotMessages = []; // [{ role: 'user'|'assistant', content }]
let chatbotSending = false;

const CHATBOT_GREETING = 'Salut ! Je peux te conseiller un film ou une série, discuter ciné, ou t\'aider à retrouver quelque chose dans Kinet. De quoi as-tu envie ?';

function chatbotScrollToBottom(){
  const wrap = document.getElementById('chatbotMessages');
  wrap.scrollTop = wrap.scrollHeight;
}

function renderChatbotMessages(){
  const wrap = document.getElementById('chatbotMessages');
  const bubbles = [
    `<div class="chatbot-msg chatbot-msg-bot">${escapeHtml(CHATBOT_GREETING)}</div>`,
    ...chatbotMessages.map(m => `<div class="chatbot-msg chatbot-msg-${m.role === 'user' ? 'user' : 'bot'}">${escapeHtml(m.content)}</div>`)
  ];
  if(chatbotSending){
    bubbles.push(`<div class="chatbot-msg chatbot-msg-bot" id="chatbotTyping"><span class="chatbot-typing"><span></span><span></span><span></span></span></div>`);
  }
  wrap.innerHTML = bubbles.join('');
  chatbotScrollToBottom();
}

async function handleChatbotSend(){
  if(chatbotSending) return;
  const input = document.getElementById('chatbotInput');
  const text = input.value.trim();
  if(!text) return;

  chatbotMessages.push({ role: 'user', content: text });
  input.value = '';
  chatbotSending = true;
  document.getElementById('chatbotSendBtn').disabled = true;
  renderChatbotMessages();

  const { data, error } = await supabaseClient.functions.invoke('chat', {
    body: { messages: chatbotMessages }
  });

  chatbotSending = false;
  document.getElementById('chatbotSendBtn').disabled = false;

  if(error || !data || !data.reply){
    // Message clair plutôt qu'un échec muet — le cas le plus probable tant
    // que la fonction n'a jamais été déployée/configurée (voir le
    // commentaire en tête de ce fichier) : ne pas laisser croire à un bug
    // transitoire si c'est en fait juste "pas encore mis en place".
    console.error(error || data);
    chatbotMessages.push({
      role: 'assistant',
      content: data && data.error
        ? `Erreur : ${data.error}`
        : 'L\'assistant ne répond pas pour l\'instant (fonction pas encore déployée côté Supabase ? voir supabase/functions/chat/index.ts). Réessaie plus tard.'
    });
    renderChatbotMessages();
    return;
  }

  chatbotMessages.push({ role: 'assistant', content: data.reply });
  renderChatbotMessages();
}

function openChatbotModal(){
  closeProfileModal();
  openOverlay('chatbotOverlay');
  renderChatbotMessages();
  document.getElementById('chatbotInput').focus();
}

function closeChatbotModal(){
  closeOverlay('chatbotOverlay', () => openProfileModal());
}

document.getElementById('chatbotBtn').addEventListener('click', openChatbotModal);
document.getElementById('closeChatbot').addEventListener('click', closeChatbotModal);
document.getElementById('chatbotOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'chatbotOverlay') closeChatbotModal();
});
document.getElementById('chatbotSendBtn').addEventListener('click', handleChatbotSend);
// Entrée envoie, Maj+Entrée fait un retour à la ligne — convention
// standard de messagerie, pas besoin de l'expliquer dans l'UI.
document.getElementById('chatbotInput').addEventListener('keydown', (e) => {
  if(e.key === 'Enter' && !e.shiftKey){
    e.preventDefault();
    handleChatbotSend();
  }
});
