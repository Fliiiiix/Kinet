// --- Lien d'invitation de groupe ---
// Génération/copie/révocation côté créateur (renderInviteBox(), appelée
// depuis renderGroupDetail() dans js/groups.js) + la page publique
// #/invite/:token côté visiteur (renderInvitePage(), appelée par le
// routeur ET par initAuth(), voir js/router.js et js/auth.js).
//
// Décision confirmée avec l'utilisateur : ouvrir un lien ne fait QUE
// rejoindre le groupe, jamais l'amitié — voir accept_group_invite,
// supabase/migrations/020.

function inviteUrl(token){
  return `${location.origin}${location.pathname}#/invite/${token}`;
}

// --- Côté créateur : générer / copier / révoquer (owner only, RLS) ---

async function loadActiveInvite(groupId){
  const { data, error } = await supabaseClient
    .from('group_invites')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if(error){ console.error(error); return null; }
  return data;
}

async function renderInviteBox(groupId){
  const box = document.getElementById('groupInviteBox');
  box.innerHTML = `<div class="tmdb-empty">Chargement…</div>`;
  const invite = await loadActiveInvite(groupId);

  if(!invite){
    box.innerHTML = `<button class="btn secondary" id="generateInviteBtn" type="button">Générer un lien d'invitation</button>`;
    const generateInviteBtn = document.getElementById('generateInviteBtn');
    generateInviteBtn.addEventListener('click', withSubmitGuard(generateInviteBtn, () => generateInviteLink(groupId)));
    return;
  }

  box.innerHTML = `
    <div class="public-profile-link-row">
      <span>${escapeHtml(inviteUrl(invite.token))}</span>
      <button class="crit-help-toggle" id="copyInviteLinkBtn" type="button">Copier</button>
    </div>
    <button class="btn secondary" id="revokeInviteBtn" type="button" style="margin-top:8px;">Révoquer ce lien</button>
  `;
  document.getElementById('copyInviteLinkBtn').addEventListener('click', async () => {
    try{
      await navigator.clipboard.writeText(inviteUrl(invite.token));
      showToast('Lien copié');
    }catch(e){
      showToast('Impossible de copier, sélectionne le lien à la main');
      console.error(e);
    }
  });
  document.getElementById('revokeInviteBtn').addEventListener('click', () => revokeInviteLink(invite.id, groupId));
}

async function generateInviteLink(groupId){
  const { error } = await supabaseClient.from('group_invites').insert({ group_id: groupId, created_by: currentUser.id });
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  renderInviteBox(groupId);
}

async function revokeInviteLink(inviteId, groupId){
  if(!confirm('Révoquer ce lien ? Il ne permettra plus de rejoindre le groupe.')) return;
  const { error } = await supabaseClient.from('group_invites').delete().eq('id', inviteId);
  if(error){
    showToast('Erreur, réessaie');
    console.error(error);
    return;
  }
  renderInviteBox(groupId);
}

// --- Côté visiteur : #/invite/:token (voir js/router.js, js/auth.js) ---

async function renderInvitePage(token){
  const content = document.getElementById('inviteContent');
  content.innerHTML = `<div class="tmdb-empty">Chargement…</div>`;

  const { data, error } = await supabaseClient.rpc('get_group_invite_preview', { p_token: token });
  const preview = data && data[0];
  if(error || !preview){
    content.innerHTML = `<div class="empty-state">Lien d'invitation introuvable.</div>`;
    return;
  }
  if(!preview.valid){
    content.innerHTML = `<div class="empty-state">Ce lien d'invitation a expiré ou n'est plus valable. Demande-en un nouveau à la personne qui te l'a envoyé.</div>`;
    return;
  }

  if(!currentUser){
    // Le lien magique retire le hash au retour (voir handleSendMagicLink,
    // js/auth.js) — le token est donc mémorisé ici pour survivre à cet
    // aller-retour ; showApp() le consomme après coup, voir
    // consumePendingInviteIfAny() plus bas.
    localStorage.setItem('pendingInviteToken', token);
    content.innerHTML = `
      <div class="stats-section">
        <div class="stats-section-title">Invitation à rejoindre « ${escapeHtml(preview.group_name)} »</div>
        <p class="auth-intro">Connecte-toi pour rejoindre ce groupe. Le lien sera repris automatiquement une fois connecté.</p>
        <button class="btn" id="inviteGoLoginBtn" type="button">Se connecter</button>
      </div>
    `;
    // Affiche l'écran de connexion normal SANS toucher au hash (à la
    // différence de showAuthScreen(), qui le viderait et perdrait le token
    // déjà sauvegardé juste au-dessus — ceinture et bretelles).
    document.getElementById('inviteGoLoginBtn').addEventListener('click', () => {
      showOnlyPage(null);
      document.getElementById('authContainer').style.display = '';
    });
    return;
  }

  content.innerHTML = `
    <div class="stats-section">
      <div class="stats-section-title">Invitation à rejoindre « ${escapeHtml(preview.group_name)} »</div>
      <button class="btn" id="inviteJoinBtn" type="button">Rejoindre le groupe</button>
    </div>
  `;
  const inviteJoinBtn = document.getElementById('inviteJoinBtn');
  inviteJoinBtn.addEventListener('click', withSubmitGuard(inviteJoinBtn, async () => {
    const groupId = await consumeInvite(token);
    if(groupId) goToGroup(groupId);
  }));
}

async function consumeInvite(token){
  const { data, error } = await supabaseClient.rpc('accept_group_invite', { p_token: token });
  if(error || data == null){
    showToast('Invitation invalide ou expirée');
    if(error) console.error(error);
    return null;
  }
  showToast('Groupe rejoint !');
  return data;
}

async function consumePendingInviteIfAny(){
  const token = localStorage.getItem('pendingInviteToken');
  if(!token) return;
  localStorage.removeItem('pendingInviteToken');
  const groupId = await consumeInvite(token);
  if(groupId) goToGroup(groupId);
}

// Pas juste goHome() : un visiteur non connecté qui revient en arrière
// depuis cette page n'a pas d'app à afficher derrière — direction l'écran
// de connexion (qui, lui, vide le hash volontairement, voir showAuthScreen()
// dans js/auth.js). Un visiteur déjà connecté retourne au catalogue.
document.getElementById('invitePageBack').addEventListener('click', () => {
  if(currentUser) goHome();
  else showAuthScreen();
});
