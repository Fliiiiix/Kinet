// --- Feedback utilisateur ---
// Formulaire simple (catégorie + message), accessible directement depuis
// une icône d'entête (v2.1 — vivait dans "Mon activité" de la modale
// profil jusque-là, demande explicite de le remonter au même niveau que
// Watchlist/Amis/Top), lu uniquement par l'admin dans un onglet "Avis"
// de la modale admin (voir js/admin.js). Table `feedback`, policies RLS
// voir supabase/migrations/026 — contrairement à admin_config, une vraie
// règle en base restreint la lecture à l'admin, pas juste un choix
// d'affichage côté client.

function populateFeedbackCategorySelect(){
  document.getElementById('feedbackCategory').innerHTML = FEEDBACK_CATEGORIES
    .map(c => `<option value="${c.key}">${escapeHtml(c.label)}</option>`)
    .join('');
}

function openFeedbackModal(){
  document.getElementById('feedbackMessage').value = '';
  document.getElementById('feedbackCategory').value = FEEDBACK_CATEGORIES[0].key;
  openOverlay('feedbackOverlay');
}

function closeFeedbackModal(){
  closeOverlay('feedbackOverlay');
}

async function handleSubmitFeedback(){
  if(blockIfOffline()) return;
  const message = document.getElementById('feedbackMessage').value.trim();
  if(!message){
    showToast("Écris un message avant d'envoyer");
    return;
  }
  const category = document.getElementById('feedbackCategory').value;
  const { error } = await supabaseClient.from('feedback').insert({
    user_id: currentUser.id,
    category,
    message
  });
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  showToast('Merci, ton retour est envoyé !');
  closeFeedbackModal();
}

populateFeedbackCategorySelect();
document.getElementById('feedbackBtn').addEventListener('click', openFeedbackModal);
document.getElementById('closeFeedback').addEventListener('click', closeFeedbackModal);
{
  const feedbackSubmitBtn = document.getElementById('feedbackSubmitBtn');
  feedbackSubmitBtn.addEventListener('click', withSubmitGuard(feedbackSubmitBtn, handleSubmitFeedback));
}
document.getElementById('feedbackOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'feedbackOverlay') closeFeedbackModal();
});
// Lien de secours dans la modale profil (v2.1.x, mobile — voir le
// commentaire sur #profileFeedbackLinkBtn, index.html).
document.getElementById('profileFeedbackLinkBtn').addEventListener('click', () => {
  closeProfileModal();
  openFeedbackModal();
});
