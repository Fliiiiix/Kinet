// --- Tes réglages sur tous tes appareils (idée retenue par Flix le 28/10) ---
// Les réglages d'affichage vivaient dans le localStorage de chaque appareil :
// le pays choisi sur le téléphone n'existait pas sur le PC. Ils suivent
// maintenant le compte, dans user_prefs.settings (migration 068, lisible par
// son seul propriétaire), comme « Mes abonnements » (syncMyStreamingServices(),
// js/watchlist.js). Le localStorage reste la copie de travail : chaque fichier
// continue de lire et d'écrire ses propres clés, rien n'a changé pour eux.
//
// Envoi : on compare les clés ci-dessous à la dernière version partagée
// (toutes les quelques secondes et quand on quitte l'appli) et on n'envoie que
// ce qui a changé, fusionné avec ce que la base contient déjà : un réglage
// changé sur le PC n'efface pas celui changé entre-temps sur le téléphone.
// Réception : à la connexion et au retour sur l'appli. Ce qui vient d'un autre
// appareil s'applique tout de suite (thème, animations, entête...).
// Tant que la migration 068 n'est pas lancée : chaque appareil garde les
// siens, comme avant.

const SYNCED_PREF_KEYS = [
  'kinetTheme', 'kinetReduceMotion', 'kinetSoundEnabled', 'kinetSoundVolume',
  'kinetViewMode', 'kinetUpcomingView', 'kinetFilmsJournal', 'kinetSeriesSeasonView',
  'kinetHeaderOrder', 'kinetWatchRegion', 'kinetSurpriseService',
];
const PREFS_SYNC_CHECK_MS = 4000;

let prefsSyncReady = false;   // migration 068 lancée et première lecture faite
let prefsSynced = {};         // dernière version partagée : clé -> valeur (null = absente)
let prefsSyncTimer = null;

function readLocalPrefs(){
  const out = {};
  SYNCED_PREF_KEYS.forEach(k => {
    let v = null;
    try{ v = localStorage.getItem(k); }catch(e){}
    out[k] = v;
  });
  return out;
}

// Clés dont la valeur locale diffère de la dernière version partagée.
function changedLocalPrefs(){
  const local = readLocalPrefs();
  const changed = {};
  SYNCED_PREF_KEYS.forEach(k => { if(local[k] !== (prefsSynced[k] ?? null)) changed[k] = local[k]; });
  return changed;
}

// Seules les clés connues, et seulement des chaînes ou null.
function cleanRemotePrefs(settings){
  const out = {};
  if(!settings || typeof settings !== 'object') return out;
  SYNCED_PREF_KEYS.forEach(k => {
    if(!(k in settings)) return;
    const v = settings[k];
    if(v === null || typeof v === 'string') out[k] = v;
  });
  return out;
}

// Pose les valeurs reçues dans le localStorage puis les montre tout de suite.
// Une clé changée ici depuis le dernier partage garde sa valeur locale (elle
// partira au prochain envoi).
function applyRemotePrefs(remote){
  const locallyChanged = changedLocalPrefs();
  let touched = false;
  Object.keys(remote).forEach(k => {
    if(k in locallyChanged) return;
    const v = remote[k];
    let cur = null;
    try{ cur = localStorage.getItem(k); }catch(e){}
    if(cur !== v){
      try{ if(v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); }catch(e){}
      touched = true;
    }
    prefsSynced[k] = v;
  });
  if(touched) refreshUiFromPrefs();
  return touched;
}

function refreshUiFromPrefs(){
  if(typeof setTheme === 'function' && typeof getThemeChoice === 'function') setTheme(getThemeChoice());
  if(typeof setReduceMotion === 'function' && typeof getReduceMotion === 'function') setReduceMotion(getReduceMotion());
  if(typeof setViewMode === 'function' && typeof getViewMode === 'function') setViewMode(getViewMode());
  if(typeof applyHeaderNavOrder === 'function') applyHeaderNavOrder();
  if(typeof syncUpcomingViewButtons === 'function') syncUpcomingViewButtons();
  if(typeof renderFilmsViewTabs === 'function') renderFilmsViewTabs();
  if(typeof parseRoute === 'function' && parseRoute().name === 'settings' && typeof openSettingsPage === 'function') openSettingsPage();
}

async function readRemotePrefs(){
  const { data, error } = await supabaseClient.from('user_prefs')
    .select('settings').eq('user_id', currentUser.id).maybeSingle();
  if(error) return { ok: false };
  return { ok: true, row: !!data, settings: cleanRemotePrefs(data && data.settings) };
}

async function pushLocalPrefs(){
  if(!prefsSyncReady || !currentUser) return;
  const changed = changedLocalPrefs();
  if(Object.keys(changed).length === 0) return;
  const remote = await readRemotePrefs();
  if(!remote.ok) return;
  // Ce qui a changé ailleurs entre-temps arrive d'abord ici : sans ça, le
  // thème changé sur le téléphone serait remis à l'ancien au tour suivant.
  applyRemotePrefs(remote.settings);
  const settings = Object.assign({}, remote.settings, changed);
  const { error } = await supabaseClient.from('user_prefs')
    .upsert({ user_id: currentUser.id, settings, updated_at: new Date().toISOString() });
  if(error){ console.error(error); return; }
  prefsSynced = Object.assign({}, prefsSynced, changed);
}

// Appelée après la connexion (js/auth.js), sans être attendue.
async function syncPrefs(){
  if(!currentUser) return;
  const remote = await readRemotePrefs();
  if(!remote.ok){ prefsSyncReady = false; return; } // migration 068 pas encore lancée
  prefsSyncReady = true;
  if(Object.keys(remote.settings).length === 0){
    // Premier appareil après la migration : on y range ses réglages actuels.
    prefsSynced = {};
    await pushLocalPrefs();
  }else{
    prefsSynced = {};
    SYNCED_PREF_KEYS.forEach(k => { prefsSynced[k] = k in remote.settings ? remote.settings[k] : null; });
    // Les valeurs de la base l'emportent à la connexion.
    Object.keys(remote.settings).forEach(k => {
      const v = remote.settings[k];
      try{ if(v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); }catch(e){}
    });
    refreshUiFromPrefs();
  }
  clearInterval(prefsSyncTimer);
  prefsSyncTimer = setInterval(() => { pushLocalPrefs().catch(e => console.error(e)); }, PREFS_SYNC_CHECK_MS);
}

// Retour sur l'appli : ce qui a changé ailleurs entre-temps. Départ : ce qui
// a changé ici, sans attendre le prochain tour.
document.addEventListener('visibilitychange', () => {
  if(!prefsSyncReady || !currentUser) return;
  if(document.visibilityState === 'hidden'){
    pushLocalPrefs().catch(e => console.error(e));
    return;
  }
  readRemotePrefs().then(remote => { if(remote.ok) applyRemotePrefs(remote.settings); }).catch(e => console.error(e));
});
