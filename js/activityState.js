// --- État "vu" (badges de notification + digest de retour) ---
// Une seule ligne par utilisateur (voir supabase/migrations/023), jamais de
// localStorage : l'utilisateur se connecte déjà depuis plusieurs appareils
// (upload d'avatar, etc.), un badge "vu" doit suivre partout plutôt que
// rester coincé sur un seul appareil. Mise en cache mémoire (activityState)
// après la première lecture, mise à jour localement à chaque markSeen()/
// markDigestSeen() plutôt que de relire la table à chaque fois — même
// convention que friendProfiles (js/friends.js), pas remise à zéro à la
// déconnexion (l'app ne gère nulle part ailleurs un changement de compte
// dans le même onglet sans rechargement complet).

let activityState = null;

// Première visite après ce déploiement (pas encore de ligne) : on part du
// principe que tout ce qui existe déjà est "vu" plutôt que de faire
// apparaître d'un coup, en "non lu", des mois d'historique — même logique
// pour last_digest_at, voir loadDigest() plus bas.
async function loadActivityState(){
  if(activityState) return activityState;
  const { data, error } = await supabaseClient
    .from('user_activity_state')
    .select('*')
    .eq('user_id', currentUser.id)
    .maybeSingle();
  if(error){ console.error(error); return null; }
  if(data){
    activityState = data;
  }else{
    const now = new Date().toISOString();
    // last_seen_changelog (migrations/028) : même logique que les 3 autres
    // colonnes — un compte tout neuf part de "tout ce qui existe déjà est
    // vu", pas de mur de Nouveautés passées à l'ouverture.
    const fresh = { user_id: currentUser.id, last_seen_amis: now, last_seen_groupes: now, last_digest_at: now, last_seen_changelog: now };
    const { data: inserted, error: insErr } = await supabaseClient
      .from('user_activity_state')
      .upsert(fresh, { onConflict: 'user_id' })
      .select()
      .maybeSingle();
    if(insErr){ console.error(insErr); activityState = fresh; }
    else activityState = inserted;
  }
  return activityState;
}

async function markSeen(category){
  await loadActivityState();
  const now = new Date().toISOString();
  const col = category === 'amis' ? 'last_seen_amis' : 'last_seen_groupes';
  activityState[col] = now;
  const { error } = await supabaseClient
    .from('user_activity_state')
    .upsert({ user_id: currentUser.id, [col]: now }, { onConflict: 'user_id' });
  if(error) console.error(error);
  refreshActivityBadge();
}

async function markDigestSeen(){
  await loadActivityState();
  const now = new Date().toISOString();
  activityState.last_digest_at = now;
  const { error } = await supabaseClient
    .from('user_activity_state')
    .upsert({ user_id: currentUser.id, last_digest_at: now }, { onConflict: 'user_id' });
  if(error) console.error(error);
}

async function hasUnread(category){
  await loadActivityState();
  const col = category === 'amis' ? 'last_seen_amis' : 'last_seen_groupes';
  const scope = category === 'amis' ? 'friend' : 'group';
  const since = activityState && activityState[col];
  if(!since) return false;
  // neq actor_id : ce que J'AI fait (noter un film, rejoindre un groupe...)
  // ne doit jamais allumer mon propre badge.
  const { data, error } = await supabaseClient
    .from('activity_events')
    .select('id')
    .eq('scope', scope)
    .neq('actor_id', currentUser.id)
    .gt('created_at', since)
    .limit(1);
  if(error){ console.error(error); return false; }
  return (data || []).length > 0;
}

// Une demande d'ami reçue n'était encore signalée nulle part (retour
// utilisateur) : activity_events (scope 'friend') ne loggue que ce que fait
// un ami DÉJÀ accepté (noter un film...), jamais la demande elle-même — voir
// migrations/021. Pas besoin d'un "vu"/"pas vu" dédié comme last_seen_amis :
// une demande en attente est par nature non traitée tant qu'elle n'est pas
// acceptée/refusée (elle disparaît alors de la table), donc juste compter
// les lignes 'pending' où on est destinataire suffit.
async function hasPendingIncomingFriendRequest(){
  const { count, error } = await supabaseClient
    .from('friendships')
    .select('id', { count: 'exact', head: true })
    .eq('addressee_id', currentUser.id)
    .eq('status', 'pending');
  if(error){ console.error(error); return false; }
  return (count || 0) > 0;
}

// Un seul point, sur 👥 : la page Amis contient l'accès Groupes (voir
// index.html), pas d'icône séparée dans l'entête pour porter un 2e badge.
async function refreshActivityBadge(){
  if(!currentUser) return;
  const [amis, groupes, pendingRequest] = await Promise.all([
    hasUnread('amis'), hasUnread('groupes'), hasPendingIncomingFriendRequest()
  ]);
  const unread = amis || groupes || pendingRequest;
  document.getElementById('friendsBtn').classList.toggle('has-unread', unread);
  // Même badge sur l'onglet Amis de la barre mobile (v2.1.x, #mobileTabbar
  // — #friendsBtn est caché sous le seuil mobile, voir index.html).
  document.getElementById('mobileTabFriends').classList.toggle('has-unread', unread);
}

// Plafonné aux 14 derniers jours OU 20 événements (le plus petit des deux)
// pour qu'un retour après plusieurs mois d'absence ne déverse pas un mur
// d'historique — voir plan v1.6 phase 5.
async function loadDigest(){
  await loadActivityState();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const since = (activityState.last_digest_at && activityState.last_digest_at > fourteenDaysAgo)
    ? activityState.last_digest_at
    : fourteenDaysAgo;
  const { data, error } = await supabaseClient
    .from('activity_events')
    .select('*')
    .in('scope', ['friend', 'group'])
    .neq('actor_id', currentUser.id)
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(20);
  if(error){ console.error(error); return []; }
  const events = data.map(rowToActivityEvent);
  const missing = [...new Set(events.map(e => e.actorId))].filter(id => !friendProfiles[id]);
  if(missing.length){
    const { data: profs, error: profErr } = await supabaseClient
      .from('profiles')
      .select('user_id, display_name, avatar_url')
      .in('user_id', missing);
    if(profErr) console.error(profErr);
    else profs.forEach(p => cacheProfile(p.user_id, p.display_name, p.avatar_url));
  }
  return events;
}

// Appelé depuis showApp() (js/auth.js), sans await — ne doit jamais
// retarder le chargement du catalogue.
async function maybeShowDigest(){
  const events = await loadDigest();
  const banner = document.getElementById('activityDigestBanner');
  if(events.length === 0){ banner.style.display = 'none'; banner.innerHTML = ''; return; }
  banner.innerHTML = `
    <div class="digest-title">Depuis ta dernière visite</div>
    <div class="wl-list">${events.map(renderActivityRowHtml).join('')}</div>
    <button class="btn secondary" id="digestDismissBtn" type="button">Marquer comme vu</button>
  `;
  banner.style.display = '';
  document.getElementById('digestDismissBtn').addEventListener('click', async () => {
    banner.style.display = 'none';
    banner.innerHTML = '';
    await markDigestSeen();
  });
}

// --- Rappel "tu n'as rien noté depuis longtemps" (retour utilisateur) ---
// Basé sur films.added (horloge client, comme partout ailleurs dans l'app
// pour ce champ) — le moment le plus récent où un film a été ajouté/noté
// au catalogue. Pas viewings.watchedAt : un visionnage peut être backdaté
// (import Letterboxd, "+ Revisionnage" avec une date passée), ce qui
// fausserait complètement "depuis quand tu n'as rien noté" si quelqu'un
// importe un vieux journal d'un coup.
const INACTIVITY_REMINDER_DAYS = 21;

// null = jamais rien noté (catalogue vide) : pas "depuis longtemps", juste
// "pas encore commencé" — un cas différent qui ne mérite pas ce rappel.
function daysSinceLastRating(){
  if(films.length === 0) return null;
  const mostRecent = Math.max(...films.map(f => f.added));
  return Math.floor((Date.now() - mostRecent) / (1000 * 60 * 60 * 24));
}

// Appelé depuis showApp() (js/auth.js), sans await — comme maybeShowDigest()
// ci-dessus, ne doit jamais retarder le chargement du catalogue.
function maybeShowInactivityReminder(){
  const banner = document.getElementById('inactivityReminderBanner');
  const days = daysSinceLastRating();
  if(days === null || days < INACTIVITY_REMINDER_DAYS){
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }
  // Fermeture mémorisée PAR APPAREIL (localStorage, pas Supabase — un
  // simple rappel ne justifie pas un aller-retour serveur dédié), tant que
  // le catalogue n'a pas changé depuis : ajouter un nouveau film change
  // mostRecentAdded et fait naturellement réapparaître le rappel si
  // l'inactivité reprend, sans jamais re-harceler pour la MÊME période déjà
  // fermée.
  const mostRecentAdded = Math.max(...films.map(f => f.added));
  let dismissedFor = null;
  try{ dismissedFor = localStorage.getItem('kinetInactivityDismissedFor'); }catch(e){}
  if(dismissedFor === String(mostRecentAdded)){
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }
  banner.innerHTML = `
    <div class="digest-title">Ça fait ${days} jours que tu n'as rien noté</div>
    <div class="wl-note" style="margin-bottom:14px;">Un film récemment vu à ajouter à ton catalogue ?</div>
    <div style="display:flex; gap:10px; flex-wrap:wrap;">
      <button class="btn" id="inactivityReminderAddBtn" type="button">+ Ajouter un film</button>
      <button class="btn secondary" id="inactivityReminderDismissBtn" type="button">Plus tard</button>
    </div>
  `;
  banner.style.display = '';
  document.getElementById('inactivityReminderAddBtn').addEventListener('click', () => {
    banner.style.display = 'none';
    openModal();
  });
  document.getElementById('inactivityReminderDismissBtn').addEventListener('click', () => {
    banner.style.display = 'none';
    banner.innerHTML = '';
    try{ localStorage.setItem('kinetInactivityDismissedFor', String(mostRecentAdded)); }catch(e){}
  });
}
