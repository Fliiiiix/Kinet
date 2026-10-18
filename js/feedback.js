// --- Donner un avis (#/avis) ---
// Draft Profil du 15/10 (choix de Flix) : la petite fenêtre (une liste
// déroulante et une zone de texte) devient une page. Le type se choisit en
// trois pastilles, la question change avec lui ; la page d'où tu viens,
// l'appareil et la version sont joints (désactivable) ; et tu retrouves tes
// avis envoyés, avec « Envoyé » ou « Traité », et la réponse de l'admin.
// Une pastille sur « Donner un avis » (page Profil) quand une réponse arrive.
//
// Table `feedback` (migration 026 : chacun relit les siens, l'admin lit
// tout). Contexte et réponse : migration 063. Sans elle, l'avis part sans
// contexte et la liste se passe des réponses, sans erreur visible.

const AVIS_KIND_LABELS = { bug: 'Un bug', idee: 'Une idée', autre: 'Autre chose' };
const AVIS_PLACEHOLDERS = {
  bug: 'Qu’est-ce qui ne marche pas ? Que faisais-tu juste avant ?',
  idee: 'Qu’est-ce qui te manque dans Kinet ?',
  autre: 'Dis-moi tout.'
};
const AVIS_SEEN_KEY = 'kinetAvisRepliesSeenAt';
// Nom lisible des pages, pour « la page d'où tu viens ».
const AVIS_PAGE_LABELS = {
  home: 'Catalogue', filmDetail: 'Fiche film', watchlist: 'À voir', seriesList: 'Séries', seriesDetail: 'Fiche série',
  upcoming: 'Bientôt', amis: 'Amis', top: 'Top films', groupsList: 'Groupes', groupDetail: 'Groupe',
  proposalDetail: 'Proposition', listsList: 'Listes', listDetail: 'Liste', profil: 'Profil'
};

let avisKind = 'bug';
let avisOriginPage = 'Profil'; // si l'appli s'est ouverte directement sur le Profil
let myFeedback = [];

function goToAvis(){ location.hash = '#/avis'; }

// Appelée par renderRoute() (js/router.js) à chaque page : retient la
// dernière page de contenu visitée (le Profil, les Paramètres et l'Avis ne
// comptent pas, on y passe pour venir ici).
function noteAvisOrigin(routeName){
  if(routeName !== 'profil' && AVIS_PAGE_LABELS[routeName]) avisOriginPage = AVIS_PAGE_LABELS[routeName];
}

function kinetBuildVersion(){
  const script = document.querySelector('script[src*="js/app.js"]');
  const m = script && /[?&]v=(\d+)/.exec(script.getAttribute('src') || '');
  return m ? `v${m[1]}` : '';
}
function kinetDeviceLabel(){
  return window.matchMedia && window.matchMedia('(max-width: 600px)').matches ? 'téléphone' : 'PC';
}
function avisContext(){
  return { page: avisOriginPage, device: kinetDeviceLabel(), version: kinetBuildVersion() };
}
function avisContextText(ctx){
  if(!ctx) return '';
  return [ctx.page, ctx.device, ctx.version ? `Kinet ${ctx.version}` : ''].filter(Boolean).join(' · ');
}

function avisDateLabel(iso){
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function rowToFeedback(row){
  return {
    id: row.id,
    userId: row.user_id || null,
    category: row.category,
    message: row.message,
    resolved: !!row.resolved,
    createdAt: row.created_at,
    context: row.context || null,
    reply: row.reply || null,
    repliedAt: row.replied_at || null
  };
}

async function loadMyFeedback(){
  const base = 'id, category, message, resolved, created_at';
  let res = await supabaseClient.from('feedback').select(`${base}, reply, replied_at`).eq('user_id', currentUser.id).order('created_at', { ascending: false });
  if(res.error) res = await supabaseClient.from('feedback').select(base).eq('user_id', currentUser.id).order('created_at', { ascending: false });
  if(res.error){ console.error(res.error); myFeedback = []; return; }
  myFeedback = (res.data || []).map(rowToFeedback);
}

function avisSeenAt(){
  try{ return localStorage.getItem(AVIS_SEEN_KEY) || ''; }catch(e){ return ''; }
}
function unseenRepliesCount(list){
  const seen = avisSeenAt();
  return list.filter(f => f.reply && f.repliedAt && f.repliedAt > seen).length;
}
function markAvisRepliesSeen(){
  try{ localStorage.setItem(AVIS_SEEN_KEY, new Date().toISOString()); }catch(e){}
}

function avisItemHtml(f){
  const status = f.resolved ? '<b class="av-status is-done">Traité</b>' : '<b class="av-status">Envoyé</b>';
  return `
    <div class="av-item">
      <div class="av-item-meta">${escapeHtml(AVIS_KIND_LABELS[f.category] || 'Autre chose')} · ${escapeHtml(avisDateLabel(f.createdAt))} · ${status}</div>
      <p class="av-item-msg">${escapeHtml(f.message)}</p>
      ${f.reply ? `<div class="av-reply"><span class="av-reply-label">Réponse</span>${escapeHtml(f.reply)}</div>` : ''}
    </div>`;
}

function renderMyFeedback(){
  const el = document.getElementById('avisMine');
  el.innerHTML = myFeedback.length
    ? myFeedback.map(avisItemHtml).join('')
    : '<div class="empty-state">Tu n’as encore rien envoyé.</div>';
}

function renderAvisKind(){
  document.querySelectorAll('#avisPage [data-avis-kind]').forEach(btn => {
    btn.setAttribute('aria-checked', String(btn.dataset.avisKind === avisKind));
  });
  document.getElementById('avisMessage').placeholder = AVIS_PLACEHOLDERS[avisKind];
}

// Appelée par renderRoute() (js/router.js).
async function openAvisPage(){
  renderAvisKind();
  document.getElementById('avisCtxSub').textContent = avisContextText(avisContext());
  document.getElementById('avisMine').innerHTML = skeletonRows(2);
  await loadMyFeedback();
  renderMyFeedback();
  markAvisRepliesSeen();
  refreshAvisBadge(true);
}

async function handleSendAvis(){
  if(blockIfOffline()) return;
  const message = document.getElementById('avisMessage').value.trim();
  if(!message){
    showToast('Écris un message avant d’envoyer');
    return;
  }
  const row = { user_id: currentUser.id, category: avisKind, message };
  const withContext = document.getElementById('avisCtxToggle').checked;
  let { error } = await supabaseClient.from('feedback').insert(withContext ? { ...row, context: avisContext() } : row);
  // Migration 063 pas encore lancée : l'avis part sans le contexte.
  if(error && withContext && /context/i.test(error.message || '')){
    ({ error } = await supabaseClient.from('feedback').insert(row));
  }
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  showToast('Merci, ton avis est envoyé');
  document.getElementById('avisMessage').value = '';
  await loadMyFeedback();
  renderMyFeedback();
}

// Pastille « Donner un avis » de la page Profil. alreadyLoaded : la liste
// vient d'être relue (page Avis), pas besoin de la redemander.
async function refreshAvisBadge(alreadyLoaded){
  if(!currentUser) return;
  if(!alreadyLoaded) await loadMyFeedback();
  const n = unseenRepliesCount(myFeedback);
  const count = document.getElementById('ppAvisCount');
  const sub = document.getElementById('ppAvisSub');
  if(count){ count.hidden = n === 0; count.textContent = n ? String(n) : ''; }
  if(sub){
    sub.hidden = n === 0;
    sub.textContent = n > 1 ? `${n} réponses t’attendent` : 'Une réponse t’attend';
  }
}

// L'ancienne fenêtre « Donner un avis » est retirée (audit général du 16/10) ;
// ses anciens points d'entrée mènent à la page Avis.
function openFeedbackModal(){ goToAvis(); }

document.querySelectorAll('#avisPage [data-avis-kind]').forEach(btn => {
  btn.addEventListener('click', () => { avisKind = btn.dataset.avisKind; renderAvisKind(); });
});
{
  const avisSendBtn = document.getElementById('avisSendBtn');
  avisSendBtn.addEventListener('click', withSubmitGuard(avisSendBtn, handleSendAvis));
}
document.getElementById('avisPageBack').addEventListener('click', () => returnToProfile());
document.getElementById('feedbackBtn').addEventListener('click', goToAvis);
// Rangée « Donner un avis » de la page Profil (relayée par data-proxy).
document.getElementById('profileFeedbackLinkBtn').addEventListener('click', () => {
  closeProfileModal();
  goToAvis();
});
