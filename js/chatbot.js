// --- Assistant local (retour utilisateur) ---
// Tourne entièrement dans le navigateur, sans aucune API externe ni clé :
// gratuit, aucune donnée ne quitte l'appareil. Il répond à partir de ce
// que Kinet a DÉJÀ chargé (films notés, watchlist) et d'un petit jeu de
// réponses sur l'app, choisi par correspondance de mots-clés. Pas un
// modèle de langage : il comprend des questions prévues, pas une
// conversation libre.
//
// Historique en mémoire seulement (pas persisté).

let chatbotMessages = []; // [{ role: 'user'|'assistant', content }]

const CHATBOT_GREETING = 'Salut ! Je peux te dire ce que tu as noté, te sortir un film au hasard dans ta watchlist, te donner tes meilleurs films, ou t\'expliquer une partie de Kinet. Demande-moi ce que tu veux.';

// Réponses sur l'app — une entrée par sujet. "mots" : mots-clés (sans
// accents, minuscules) qui déclenchent la réponse.
const CHATBOT_HELP_TOPICS = [
  { mots: ['watchlist', 'a voir'], texte: 'La watchlist (« À voir ») garde les films que tu veux regarder. Tu peux noter un film directement depuis la liste, ou le sortir au hasard avec « Surprends-moi ».' },
  { mots: ['serie'], texte: 'Les séries se suivent épisode par épisode dans la section Séries : tu coches ce que tu as vu, et Kinet te signale les nouveaux épisodes.' },
  { mots: ['ami', 'groupe'], texte: 'Dans Amis, tu ajoutes des personnes par email ou pseudo. Les groupes se créent depuis la même page, ils servent à proposer des films et voter ensemble.' },
  { mots: ['carte', 'booster', 'tcg'], texte: 'Les cartes se débloquent en regardant des films (2 films vus = 1 booster de 5 cartes). Elles se trouvent dans Ton profil > Mon activité > Cartes.' },
  { mots: ['stat', 'statistique'], texte: 'Les Statistiques (Ton profil > Mon activité) montrent la répartition de tes notes, tes genres et ton évolution dans le temps.' },
  { mots: ['note', 'grille', 'critere'], texte: 'Chaque film se note sur 7 critères (scénario, mise en scène, jeu d\'acteur, esthétique, son, musique, ressenti). La note globale se calcule toute seule à partir de ces critères, ou tu peux saisir une note manuelle.' },
  { mots: ['export', 'import', 'letterboxd'], texte: 'Tu peux exporter ton catalogue en JSON ou CSV, et importer un export Letterboxd depuis le menu ⋯ de la page d\'accueil.' },
];

function normaliserTexte(texte){
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function contientUn(texteNormalise, mots){
  return mots.some(m => texteNormalise.includes(m));
}

// Répond à une question à partir des données fournies (films notés +
// watchlist). Fonction pure : aucun accès direct au DOM ni au réseau, ce
// qui la rend testable telle quelle.
function answerChatbotQuestion(texte, donnees){
  const q = normaliserTexte(texte).trim();
  const { films, watchlist, getNote, genreMap } = donnees;
  const notes = films.map(f => getNote(f)).filter(n => n != null);

  if(q === '' ) return 'Dis-moi quelque chose, je t\'écoute.';

  if(contientUn(q, ['bonjour', 'salut', 'hello', 'coucou', 'hey'])){
    return 'Salut ! Que veux-tu savoir ?';
  }

  if(contientUn(q, ['combien', 'nombre']) && contientUn(q, ['film', 'note'])){
    return `Tu as noté ${films.length} film${films.length > 1 ? 's' : ''}${notes.length !== films.length ? ` (${notes.length} avec une note)` : ''}.`;
  }

  if(contientUn(q, ['moyenne'])){
    if(notes.length === 0) return 'Tu n\'as encore aucun film noté.';
    const moy = notes.reduce((a, b) => a + b, 0) / notes.length;
    return `Ta note moyenne est de ${moy.toFixed(2)} / 5, sur ${notes.length} film${notes.length > 1 ? 's' : ''}.`;
  }

  if(contientUn(q, ['meilleur', 'top', 'prefere', 'favori', 'mieux note'])){
    const top = films
      .map(f => ({ titre: f.title, note: getNote(f) }))
      .filter(f => f.note != null)
      .sort((a, b) => b.note - a.note)
      .slice(0, 5);
    if(top.length === 0) return 'Pas encore de film noté, donc pas de classement à te montrer.';
    return 'Tes mieux notés :\n' + top.map((f, i) => `${i + 1}. ${f.titre} (${f.note.toFixed(2)})`).join('\n');
  }

  if(contientUn(q, ['genre'])){
    const compte = {};
    films.forEach(f => (f.genreIds || []).forEach(id => {
      const nom = genreMap[id];
      if(nom) compte[nom] = (compte[nom] || 0) + 1;
    }));
    const tri = Object.entries(compte).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if(tri.length === 0) return 'Je n\'ai pas encore assez d\'infos sur les genres de tes films.';
    return 'Tes genres les plus présents : ' + tri.map(([nom, n]) => `${nom} (${n})`).join(', ') + '.';
  }

  if(contientUn(q, ['hasard', 'surprends', 'surprise', 'quoi regarder', 'que regarder', 'ce soir'])){
    if(watchlist.length === 0) return 'Ta watchlist est vide : ajoute quelques films et je t\'en tirerai un au hasard.';
    const choisi = watchlist[Math.floor(Math.random() * watchlist.length)];
    return `Et si tu regardais « ${choisi.title} » ce soir ?`;
  }

  if(contientUn(q, ['watchlist', 'a voir']) && contientUn(q, ['combien', 'nombre', 'liste', 'contient'])){
    if(watchlist.length === 0) return 'Ta watchlist est vide pour l\'instant.';
    return `Tu as ${watchlist.length} film${watchlist.length > 1 ? 's' : ''} dans ta watchlist.`;
  }

  for(const sujet of CHATBOT_HELP_TOPICS){
    if(contientUn(q, sujet.mots)) return sujet.texte;
  }

  if(contientUn(q, ['aide', 'help', 'que peux', 'que sais', 'comment'])){
    return 'Je peux te donner ta note moyenne, tes meilleurs films, tes genres, te sortir un film au hasard dans ta watchlist, ou t\'expliquer la watchlist, les séries, les amis, les cartes, les statistiques, la notation ou l\'export.';
  }

  return 'Je ne suis pas sûr de comprendre. Essaie « ma note moyenne », « mes meilleurs films », « un film au hasard », ou une question sur une partie de Kinet (watchlist, séries, amis, cartes, statistiques, notation).';
}

function chatbotDonnees(){
  return {
    films: typeof films !== 'undefined' ? films : [],
    watchlist: typeof watchlist !== 'undefined' ? watchlist : [],
    getNote: getDisplayNote,
    genreMap: GENRE_MAP,
  };
}

function renderChatbotMessages(){
  const wrap = document.getElementById('chatbotMessages');
  const bulles = [
    `<div class="chatbot-msg chatbot-msg-bot">${escapeHtml(CHATBOT_GREETING)}</div>`,
    ...chatbotMessages.map(m => `<div class="chatbot-msg chatbot-msg-${m.role === 'user' ? 'user' : 'bot'}">${escapeHtml(m.content)}</div>`)
  ];
  wrap.innerHTML = bulles.join('');
  wrap.scrollTop = wrap.scrollHeight;
}

function handleChatbotSend(){
  const input = document.getElementById('chatbotInput');
  const texte = input.value.trim();
  if(!texte) return;
  chatbotMessages.push({ role: 'user', content: texte });
  input.value = '';
  chatbotMessages.push({ role: 'assistant', content: answerChatbotQuestion(texte, chatbotDonnees()) });
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
document.getElementById('chatbotInput').addEventListener('keydown', (e) => {
  if(e.key === 'Enter' && !e.shiftKey){
    e.preventDefault();
    handleChatbotSend();
  }
});
