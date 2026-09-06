// --- Nouveautés (v2.1+) ---
// Courtes annonces des mises à jour, rédigées et publiées depuis l'onglet
// "Nouveautés" de la modale admin (js/admin.js, table `changelog_entries`,
// voir supabase/migrations/028). Deux surfaces : une modale automatique à
// la connexion s'il y a du nouveau (comme le "quoi de neuf" d'autres
// apps), et l'icône mégaphone de l'entête pour la reconsulter à tout
// moment. Badge "vu" sur le même principe que 👥 (js/activityState.js) :
// colonne dédiée sur user_activity_state, pas de localStorage (un badge
// doit suivre l'utilisateur d'un appareil à l'autre).

let changelogEntries = [];       // entrées publiées des 7 derniers jours, les plus récentes d'abord
let latestChangelogEntry = null; // la plus récente DANS cette fenêtre de 7 jours — sert à détecter "y a-t-il du nouveau non lu"
// La VRAIE dernière version publiée, quel que soit son âge — sert
// UNIQUEMENT au numéro affiché près du logo (#versionTagValue). Distincte
// de latestChangelogEntry ci-dessus : sans ça, une fois la dernière
// annonce sortie de la fenêtre de 7 jours (aucune nouvelle publiée
// depuis), le tag retomberait sur le "2.0" codé en dur dans index.html —
// une régression visible bien plus gênante que l'absence d'annonce.
let latestPublishedVersion = null;

// Visibilité publique limitée à 7 jours (retour utilisateur) — passé ce
// délai, une Nouveauté disparaît de la liste/modale vues par un utilisateur
// normal (plus un vrai "quoi de neuf" que des archives à faire défiler).
// N'affecte QUE cette vue publique : l'onglet Nouveautés de la modale admin
// (loadAdminChangelogEntries(), js/admin.js) reste un historique complet,
// sans limite d'âge, pour pouvoir gérer/éditer une entrée plus ancienne.
const CHANGELOG_PUBLIC_VISIBILITY_DAYS = 7;

function rowToChangelogEntry(row){
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    body: row.body,
    publishedAt: row.published_at
  };
}

// Un seul aller-retour (pas de requête séparée par fenêtre) : on récupère
// les entrées publiées les plus récentes (limit large mais borné — cette
// app n'en produira jamais des centaines) puis on filtre les 7 derniers
// jours côté client pour la liste visible, tout en gardant la toute
// première (non filtrée) pour latestPublishedVersion ci-dessus.
async function loadChangelogEntries(){
  const { data, error } = await supabaseClient
    .from('changelog_entries')
    .select('id, version, title, body, published_at')
    .eq('published', true)
    .order('published_at', { ascending: false })
    .limit(50);
  if(error){
    console.error(error);
    changelogEntries = [];
    latestChangelogEntry = null;
    latestPublishedVersion = null;
    return;
  }
  const all = data.map(rowToChangelogEntry);
  latestPublishedVersion = all.length > 0 ? all[0].version : null;
  const cutoff = Date.now() - CHANGELOG_PUBLIC_VISIBILITY_DAYS * 24 * 60 * 60 * 1000;
  changelogEntries = all.filter(e => new Date(e.publishedAt).getTime() >= cutoff);
  latestChangelogEntry = changelogEntries[0] || null;
}

function changelogDateLabel(iso){
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function changelogEntryHtml(e){
  return `
    <div class="changelog-entry">
      <div class="changelog-entry-head">
        <span class="changelog-version">v${escapeHtml(e.version)}</span>
        <span class="changelog-date">${changelogDateLabel(e.publishedAt)}</span>
      </div>
      <div class="changelog-title">${escapeHtml(e.title)}</div>
      <div class="changelog-body">${escapeHtml(e.body)}</div>
    </div>
  `;
}

function renderChangelogModal(){
  document.getElementById('changelogList').innerHTML = changelogEntries.length === 0
    ? `<div class="empty-state">Rien pour l'instant.</div>`
    : changelogEntries.map(changelogEntryHtml).join('');
}

// Numéro affiché tout en haut à côté du logo (#versionTagValue) : reflète
// automatiquement la dernière Nouveauté publiée plutôt qu'une valeur à
// mettre à jour à la main à chaque déploiement — voir renderChangelogModal
// ci-dessus pour le contenu détaillé.
function updateVersionTag(){
  if(!latestPublishedVersion) return; // aucune entrée publiée du tout : garde la valeur codée en dur du HTML
  const el = document.getElementById('versionTagValue');
  if(el) el.textContent = latestPublishedVersion;
}

async function markChangelogSeen(){
  await loadActivityState();
  const now = new Date().toISOString();
  activityState.last_seen_changelog = now;
  const { error } = await supabaseClient
    .from('user_activity_state')
    .upsert({ user_id: currentUser.id, last_seen_changelog: now }, { onConflict: 'user_id' });
  if(error) console.error(error);
  document.getElementById('changelogBtn').classList.remove('has-unread');
  document.getElementById('mobileTabProfile').classList.remove('has-unread');
}

async function hasUnreadChangelog(){
  if(!latestChangelogEntry) return false;
  await loadActivityState();
  const since = activityState && activityState.last_seen_changelog;
  if(!since) return true;
  return latestChangelogEntry.publishedAt > since;
}

function openChangelogModal(){
  renderChangelogModal();
  openOverlay('changelogOverlay');
}

// Marque "vu" à la FERMETURE (comme le digest d'activité, js/activityState.js
// markDigestSeen() sur clic dismiss) plutôt qu'à l'ouverture : si quelque
// chose interrompt l'affichage en cours de route, mieux vaut re-proposer la
// modale la prochaine fois qu'escamoter une Nouveauté jamais vraiment vue.
function closeChangelogModal(){
  closeOverlay('changelogOverlay', () => { markChangelogSeen(); });
}

// Appelée depuis showApp() (js/auth.js), après loadActivityState() (déjà
// chargé à ce stade par refreshActivityBadge()) — jamais avant le rendu du
// catalogue : une Nouveauté peut attendre une fraction de seconde de plus,
// le chemin critique du chargement non.
async function initChangelog(){
  await loadChangelogEntries();
  updateVersionTag();
  const unread = await hasUnreadChangelog();
  document.getElementById('changelogBtn').classList.toggle('has-unread', unread);
  // Même badge sur l'onglet Profil de la barre mobile (v2.1.x,
  // #mobileTabbar — #changelogBtn est caché sous le seuil mobile, la
  // Nouveauté vit désormais dans "Mon activité", voir index.html).
  document.getElementById('mobileTabProfile').classList.toggle('has-unread', unread);
  if(unread) openChangelogModal();
}

document.getElementById('changelogBtn').addEventListener('click', openChangelogModal);
// Lien de secours dans la modale profil (v2.1.x, mobile — voir le
// commentaire sur #profileChangelogLinkBtn, index.html).
document.getElementById('profileChangelogLinkBtn').addEventListener('click', () => {
  closeProfileModal();
  openChangelogModal();
});
document.getElementById('closeChangelog').addEventListener('click', closeChangelogModal);
document.getElementById('changelogOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'changelogOverlay') closeChangelogModal();
});
