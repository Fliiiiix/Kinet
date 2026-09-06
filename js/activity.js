// --- Fil d'activité (Amis + Groupes) ---
// Une seule table pour les deux portées (`activity_events`, voir
// supabase/migrations/019) — jamais écrite depuis le client, seulement par
// des triggers Supabase. Ce module ne fait que lire/afficher.
//
// Réutilise le cache de profils de js/friends.js (friendProfiles/
// cacheProfile/friendDisplayName/friendAvatarHtml) plutôt que d'en
// dupliquer un — les amis/membres de groupe y sont déjà chargés la plupart
// du temps, ceci ne complète que ce qui manque.

const ACTIVITY_ICON = {
  proposal_created: '🎬',
  proposal_commented: '💬',
  proposal_chosen: '🎟️',
  group_joined: '👋',
  film_rated: '⭐'
};

function rowToActivityEvent(row){
  return {
    id: row.id,
    scope: row.scope,
    actorId: row.actor_id,
    groupId: row.group_id,
    eventType: row.event_type,
    targetLabel: row.target_label,
    targetPosterUrl: row.target_poster_url,
    targetNote: row.target_note,
    createdAt: row.created_at
  };
}

// eventType (retour utilisateur : "Historique des élections de groupe") —
// filtre optionnel côté serveur plutôt que de tout charger puis filtrer en
// JS : réutilisé pour une liste dédiée aux seules élections
// ('proposal_chosen'), qui a besoin de sa PROPRE limite (le fil d'activité
// général mélange tous les types d'événements et, à limite=20 partagée,
// perdrait vite les élections plus anciennes parmi le reste).
async function loadActivity({ scope, groupId = null, eventType = null, limit = 20 } = {}){
  let query = supabaseClient
    .from('activity_events')
    .select('*')
    .eq('scope', scope)
    .order('created_at', { ascending: false })
    .limit(limit);
  if(groupId != null) query = query.eq('group_id', groupId);
  if(eventType != null) query = query.eq('event_type', eventType);

  const { data, error } = await query;
  if(error){
    console.error(error);
    return [];
  }
  const events = (data || []).map(rowToActivityEvent);

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

function activityEventLabel(e){
  const name = friendDisplayName(e.actorId);
  switch(e.eventType){
    case 'proposal_created': return `${name} a proposé « ${e.targetLabel} »`;
    case 'proposal_commented': return `${name} a commenté « ${e.targetLabel} »`;
    case 'proposal_chosen': return `${name} a élu « ${e.targetLabel} » comme prochaine séance`;
    case 'group_joined': return `${name} a rejoint le groupe`;
    case 'film_rated': return `${name} a noté « ${e.targetLabel} »${e.targetNote != null ? ` ${e.targetNote}/5` : ''}`;
    default: return name;
  }
}

// formatViewingDate() vient de js/journal.js — date absolue façon
// "12 mars 2026", même convention que le Journal plutôt qu'un "il y a Xh"
// qui n'a de précédent nulle part dans le code.
function renderActivityRowHtml(e){
  return `
    <div class="wl-row">
      ${friendAvatarHtml(e.actorId, friendDisplayName(e.actorId))}
      <div class="wl-main">
        <div class="wl-title">${ACTIVITY_ICON[e.eventType] || '•'} ${escapeHtml(activityEventLabel(e))}</div>
        <div class="wl-note">${formatViewingDate(e.createdAt)}</div>
      </div>
    </div>
  `;
}

// Repliée au-delà de 4 (v2.1.x, retour utilisateur : "trop de chose") —
// voir renderCollapsible(), js/ui.js. Partagée par l'activité Amis
// (js/friends.js) ET Groupe (js/groups.js), donc les deux en profitent.
function renderActivityListInto(el, events){
  renderCollapsible(el, events, renderActivityRowHtml, {
    previewCount: 4,
    emptyHtml: `<div class="tmdb-empty">Rien à signaler pour l'instant.</div>`
  });
}
