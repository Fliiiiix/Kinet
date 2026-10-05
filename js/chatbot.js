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

// Suggestions cliquables affichées tant que la conversation n'a pas commencé.
// Chaque libellé est envoyé tel quel comme une question de l'utilisateur.
const CHATBOT_SUGGESTIONS = [
  'Ma note moyenne',
  'Mes meilleurs films',
  'Un film au hasard',
  'Mes films d\'horreur',
  'Ma répartition des notes',
  'Mes coups de cœur',
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

  // Genre précis cité dans la question (« mes films d'horreur ») : avant le
  // cas générique « mes genres », qui répondrait sans le genre demandé.
  const genreCite = Object.values(genreMap).find(nom => q.includes(normaliserTexte(nom)));
  if(genreCite && contientUn(q, ['film', 'mes', 'combien', 'noté', 'note'])){
    const idGenre = String(Object.keys(genreMap).find(id => genreMap[id] === genreCite));
    const filmsDuGenre = films.filter(f => (f.genreIds || []).map(String).includes(idGenre));
    if(filmsDuGenre.length === 0) return `Aucun film ${genreCite.toLowerCase()} dans ton catalogue pour l'instant.`;
    const notesDuGenre = filmsDuGenre.map(f => getNote(f)).filter(n => n != null);
    const moyTexte = notesDuGenre.length ? ` Ta note moyenne sur ce genre : ${(notesDuGenre.reduce((a, b) => a + b, 0) / notesDuGenre.length).toFixed(2)} / 5.` : '';
    return `Tu as ${filmsDuGenre.length} film${filmsDuGenre.length > 1 ? 's' : ''} ${genreCite.toLowerCase()}.${moyTexte}`;
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

  if(contientUn(q, ['booster', 'paquet', 'pack']) && !contientUn(q, ['comment', 'explique'])){
    const n = donnees.boosters || 0;
    if(n <= 0) return "Aucun booster à ouvrir pour l'instant : regarde 2 films (vus) pour en débloquer un.";
    return `Tu as ${n} booster${n > 1 ? 's' : ''} à ouvrir. Ouvre-les depuis Ton profil > Mon activité > Cartes.`;
  }

  if(contientUn(q, ['merci'])) return 'Avec plaisir !';
  if(contientUn(q, ['qui es-tu', 'qui es tu', 'tu es qui', 'ton nom'])){
    return 'Je suis l\'assistant de Kinet : je tourne dans ton navigateur, sans API ni compte externe, et je ne réponds qu\'à partir de tes films.';
  }

  if(contientUn(q, ['repartition', 'distribution', 'histogramme']) || (contientUn(q, ['notes']) && contientUn(q, ['combien de chaque', 'par note']))){
    if(notes.length === 0) return 'Pas encore de film noté, donc pas de répartition à te montrer.';
    const seaux = [0, 0, 0, 0, 0];
    notes.forEach(n => { seaux[Math.min(4, Math.max(0, Math.floor(n)))] += 1; });
    return 'Tes notes, par tranche :\n' + seaux
      .map((n, i) => `${i}–${i + 1} : ${n}`)
      .reverse()
      .join('\n');
  }

  if(contientUn(q, ['coup de coeur', 'coups de coeur', 'coup de cœur', 'coups de cœur', 'coeur', 'excellent'])){
    const forts = films.filter(f => (getNote(f) ?? 0) >= 4.5);
    if(forts.length === 0) return 'Aucun coup de cœur pour l\'instant (une note d\'au moins 4,5).';
    return `Tu as ${forts.length} coup${forts.length > 1 ? 's' : ''} de cœur (note d'au moins 4,5) : ` + forts.slice(0, 5).map(f => `« ${f.title} »`).join(', ') + (forts.length > 5 ? '…' : '') + '.';
  }

  if(contientUn(q, ['pire', 'moins bien', 'plus mauvais', 'plus basse', 'moins bon', 'mal note'])){
    const bas = films
      .map(f => ({ titre: f.title, note: getNote(f) }))
      .filter(f => f.note != null)
      .sort((a, b) => a.note - b.note)
      .slice(0, 5);
    if(bas.length === 0) return 'Pas encore de film noté, donc rien à classer.';
    return 'Tes moins bien notés :\n' + bas.map((f, i) => `${i + 1}. ${f.titre} (${f.note.toFixed(2)})`).join('\n');
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
    boosters: typeof tcgAvailableBoosters !== 'undefined' ? tcgAvailableBoosters : 0,
  };
}

// « efface » vide la conversation au lieu de répondre : commande de
// l'interface, pas une question.
function estCommandeEffacer(texte){
  return contientUn(normaliserTexte(texte).trim(), ['efface la conversation', 'efface tout', 'recommence', 'reinitialise']);
}

function renderChatbotMessages(){
  const wrap = document.getElementById('chatbotMessages');
  const bulles = [
    `<div class="chatbot-msg chatbot-msg-bot">${escapeHtml(CHATBOT_GREETING)}</div>`,
  ];
  // Suggestions tant qu'aucune question n'a été posée : rien à deviner pour
  // un premier usage, et aucune requête côté serveur.
  if(chatbotMessages.length === 0){
    bulles.push(`<div class="chatbot-suggestions">${CHATBOT_SUGGESTIONS.map(s => `<button class="chatbot-chip" type="button" data-question="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>`);
  }
  chatbotMessages.forEach(m => bulles.push(`<div class="chatbot-msg chatbot-msg-${m.role === 'user' ? 'user' : 'bot'}">${escapeHtml(m.content)}</div>`));
  wrap.innerHTML = bulles.join('');
  wrap.querySelectorAll('.chatbot-chip').forEach(btn => {
    btn.addEventListener('click', () => envoyerQuestion(btn.dataset.question));
  });
  wrap.scrollTop = wrap.scrollHeight;
}

// Réponse « en train d'écrire » : bref délai avant d'afficher la réponse, pour
// que l'échange ait un rythme naturel. La réponse est calculée tout de suite
// (fonction pure) : seul son affichage est retardé.
const CHATBOT_DELAI_REPONSE_MS = 420;

function envoyerQuestion(texte){
  texte = (texte || '').trim();
  if(!texte) return;
  const input = document.getElementById('chatbotInput');
  if(estCommandeEffacer(texte)){
    chatbotMessages = [];
    input.value = '';
    renderChatbotMessages();
    return;
  }
  chatbotMessages.push({ role: 'user', content: texte });
  input.value = '';
  const reponse = answerChatbotQuestion(texte, chatbotDonnees());
  renderChatbotMessages();
  const wrap = document.getElementById('chatbotMessages');
  wrap.insertAdjacentHTML('beforeend', '<div class="chatbot-msg chatbot-msg-bot chatbot-typing" aria-label="En train de répondre"><span></span><span></span><span></span></div>');
  wrap.scrollTop = wrap.scrollHeight;
  setTimeout(() => {
    chatbotMessages.push({ role: 'assistant', content: reponse });
    renderChatbotMessages();
    playChatbotBlip();
  }, CHATBOT_DELAI_REPONSE_MS);
}

function handleChatbotSend(){
  const input = document.getElementById('chatbotInput');
  envoyerQuestion(input.value);
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
