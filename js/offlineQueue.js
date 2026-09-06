// --- File d'attente hors ligne (retour utilisateur) ---
// Complète le mode hors ligne lecture seule (js/offline.js) : plutôt que
// bloquer TOUTE écriture avec blockIfOffline(), les actions à faible
// risque déjà identifiées par l'audit confirmations (v2.7 — toggle
// favori, épisode vu/pas vu, retirer un item de la watchlist/du journal)
// restent possibles hors ligne : mutées localement tout de suite comme
// d'habitude, la VRAIE écriture Supabase est mise en file et rejouée au
// retour de connexion (voir le listener 'online', js/offline.js).
//
// Portée volontairement limitée à des écritures qui ciblent un id DÉJÀ
// CONNU (update/delete) ou une clé NATURELLE (upsert sur tv_show_id +
// saison + épisode) — jamais une CRÉATION dont le résultat serait un id
// généré par le serveur (bigint identity) : nouveau film, nouvel item
// watchlist, nouveau commentaire, mais aussi une réaction rapide sur un
// commentaire (js/filmDetail.js) — même retirer sa PROPRE réaction cible
// un id qu'on n'aurait pas encore si elle avait été posée hors ligne. Il
// faudrait réconcilier après coup tout l'état local une fois la vraie
// ligne créée, un risque de bug bien plus élevé pour un gain plus
// incertain : on note rarement un film SANS vérifier au moins son
// titre/affiche sur TMDB, un geste qui suppose déjà le réseau. Ces
// créations restent bloquées par blockIfOffline() comme avant cette
// version.
//
// Chaque entrée est rejouable SANS connaître le résultat des précédentes
// (aucune ne dépend d'un id que le serveur vient d'attribuer) : delete/
// update ciblent un id déjà connu, upsert (épisode vu) s'appuie sur une
// clé naturelle (tv_show_id, saison, épisode) — la file peut donc être
// rejouée dans l'ordre, une par une, sans jamais bloquer sur un échec
// individuel (voir replayOfflineQueue()).

let offlineQueue = [];

function offlineQueueKey(){
  return `offlineQueue_${currentUser.id}`;
}

function loadOfflineQueue(){
  if(!currentUser){ offlineQueue = []; return; }
  try{
    const raw = localStorage.getItem(offlineQueueKey());
    offlineQueue = raw ? JSON.parse(raw) : [];
  }catch(e){
    console.error(e);
    offlineQueue = [];
  }
}

function saveOfflineQueueToStorage(){
  if(!currentUser) return;
  try{ localStorage.setItem(offlineQueueKey(), JSON.stringify(offlineQueue)); }
  catch(e){ console.error(e); } // quota dépassé/stockage désactivé : la file ne persistera juste pas au rechargement, pas la peine de bloquer le reste
}

// entry : { table, op: 'update'|'delete'|'upsert', match (delete/update —
// paires colonne/valeur à passer en .eq()), payload (update/upsert),
// upsertOptions (upsert seulement, ex. onConflict/ignoreDuplicates) }.
function enqueueOfflineWrite(entry){
  offlineQueue.push(Object.assign({ queuedAt: Date.now() }, entry));
  saveOfflineQueueToStorage();
}

// Appelée au retour de connexion (js/offline.js) — AVANT de recharger
// films/viewings depuis le serveur, pour que la vraie source de vérité
// relue ensuite reflète déjà ce qui vient d'être synchronisé plutôt que
// de risquer un état intermédiaire.
async function replayOfflineQueue(){
  loadOfflineQueue(); // une session précédente restée hors ligne (page fermée puis rouverte) a pu accumuler une file jamais rejouée
  if(offlineQueue.length === 0) return;
  const queue = offlineQueue;
  offlineQueue = [];
  saveOfflineQueueToStorage(); // vidée tout de suite : jamais rejouée deux fois même si la page se ferme pendant la boucle ci-dessous
  let synced = 0;
  for(const entry of queue){
    try{
      let query = supabaseClient.from(entry.table);
      if(entry.op === 'delete'){
        query = query.delete();
        Object.entries(entry.match).forEach(([col, val]) => { query = query.eq(col, val); });
        const { error } = await query;
        if(error) console.error(error); else synced++;
      }else if(entry.op === 'update'){
        query = query.update(entry.payload);
        Object.entries(entry.match).forEach(([col, val]) => { query = query.eq(col, val); });
        const { error } = await query;
        if(error) console.error(error); else synced++;
      }else if(entry.op === 'upsert'){
        const { error } = await query.upsert(entry.payload, entry.upsertOptions || {});
        if(error) console.error(error); else synced++;
      }
    }catch(e){
      // Best-effort (voir le commentaire en tête de fichier) : une entrée
      // qui échoue ne bloque pas les suivantes, jamais remise en file pour
      // retenter indéfiniment — ce sont déjà des actions à faible risque.
      console.error(e);
    }
  }
  if(synced > 0) showToast(`${synced} action${synced > 1 ? 's' : ''} synchronisée${synced > 1 ? 's' : ''}`);
}
