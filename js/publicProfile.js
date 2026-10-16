// --- Profil public (#/u/:userId) ---
// Seule page de l'app accessible SANS connexion — un lien à partager, voir
// js/router.js et js/auth.js → initAuth(). Toute la lecture passe par la
// fonction SECURITY DEFINER get_public_profile() (supabase/migrations/016)
// qui ne renvoie que pseudo/avatar + un résumé du catalogue (jamais
// l'email ni le commentaire libre), et rien du tout si le propriétaire n'a
// pas partagé son profil (bouton « Partager » de la page Profil).
//
// Piste A du 15/10 (« Partager et inviter », choix de Flix) : le lien sert
// surtout à quelqu'un qui n'a pas de compte. Il voit ton mur d'affiches et
// une invitation : « Rejoindre Kinet ». Une fois inscrit, il t'a déjà en ami
// (consumePendingProfileInvite(), migration 064). Connecté, on peut
// t'ajouter en ami d'un clic.

const PROFILE_INVITE_KEY = 'kinetProfileInvite';

// Mur de posters (retour utilisateur) : plus impressionnant à partager
// qu'une liste de lignes pour une page pensée pour être montrée à
// quelqu'un. Toujours la note et le titre en légende (jamais seulement au
// survol) : cette page est autant consultée au tactile qu'à la souris.
function publicProfilePosterHtml(f){
  return `
    <div class="poster-wall-item">
      ${f.poster_url
        ? `<img src="${escapeHtml(f.poster_url)}" alt="" loading="lazy">`
        : `<div class="film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
      <div class="poster-wall-note ${noteColorClass(f.note)}">${f.note !== null && f.note !== undefined ? Number(f.note).toFixed(1) : '—'}</div>
      ${f.fav ? `<div class="poster-wall-fav" title="Favori">${uiIcon('star', true)}</div>` : ''}
      <div class="poster-wall-caption">${escapeHtml(f.title)}${f.release_year && !String(f.title).includes(`(${f.release_year})`) ? ` <span class="wl-year">(${f.release_year})</span>` : ''}</div>
    </div>
  `;
}

function publicProfileSummary(films){
  const notes = films.map(f => f.note).filter(n => typeof n === 'number');
  const avg = notes.length ? notes.reduce((a, b) => a + b, 0) / notes.length : null;
  const parts = [`${films.length} film${films.length > 1 ? 's' : ''} noté${films.length > 1 ? 's' : ''}`];
  if(avg !== null) parts.push(`note moyenne ${avg.toFixed(1)}`);
  return parts.join(' · ');
}

// Ce qu'on propose sous le mur : rejoindre (sans compte), ajouter en ami
// (connecté, pas encore amis), rien (déjà amis, ou son propre profil).
function publicProfileActionHtml(userId, name, relation){
  if(relation === 'visitor'){
    return `
      <div class="pub-invite">
        <p><b>Toi aussi, note tes films.</b>Crée ton compte : ${escapeHtml(name)} sera déjà dans tes amis, et vous verrez si vous êtes en phase.</p>
        <button class="btn" type="button" id="pubJoinBtn">Rejoindre Kinet</button>
      </div>`;
  }
  if(relation === 'self') return `<p class="pub-self-note">C’est ton profil, tel que le voit quelqu’un qui a le lien.</p>`;
  if(relation === 'stranger'){
    return `
      <div class="pub-invite">
        <p><b>${escapeHtml(name)} est sur Kinet.</b>Ajoute-l’en ami pour voir ce que vous avez en commun.</p>
        <button class="btn" type="button" id="pubAddFriendBtn">Ajouter en ami</button>
      </div>`;
  }
  return '';
}

async function publicProfileRelation(userId){
  if(!currentUser) return 'visitor';
  if(currentUser.id === userId) return 'self';
  if(typeof loadFriendships === 'function' && friendships.length === 0) await loadFriendships().catch(e => console.error(e));
  const link = friendships.find(f => (f.requesterId === userId && f.addresseeId === currentUser.id) || (f.addresseeId === userId && f.requesterId === currentUser.id));
  if(link && link.status === 'accepted') return 'friend';
  if(link && link.status === 'pending') return 'pending';
  return 'stranger';
}

async function renderPublicProfilePage(userId){
  const content = document.getElementById('publicProfileContent');
  content.innerHTML = `${skeletonRows(3)}`;
  document.getElementById('publicProfileBack').textContent = currentUser ? '← Retour' : 'Se connecter';

  const { data, error } = await supabaseClient.rpc('get_public_profile', { p_user_id: userId });
  // La fonction renvoie 0 ou 1 ligne (voir migrations/016) — rpc() sur une
  // fonction "table" renvoie un tableau, pas un objet direct.
  const row = Array.isArray(data) ? data[0] : data;
  // 0 ligne = profil inexistant OU plus partagé, get_public_profile() ne
  // fait pas la différence — donc pas nous non plus ici.
  if(error || !row){
    content.innerHTML = `
      <div class="pub-gone">
        <h3>Ce profil n’est plus partagé</h3>
        <p>Son propriétaire a arrêté le partage, ou le lien est incomplet.</p>
        ${currentUser ? '' : '<button class="btn" type="button" id="pubDiscoverBtn">Découvrir Kinet</button>'}
      </div>`;
    const discover = document.getElementById('pubDiscoverBtn');
    if(discover) discover.addEventListener('click', showAuthScreen);
    if(error) console.error(error);
    return;
  }

  const films = row.films || [];
  const topFilms = row.top_films || [];
  const name = row.display_name || 'Cinéphile';
  const relation = await publicProfileRelation(userId);

  // Cliquable vers la fiche film seulement si connecté (v2.3) — la fiche
  // film (js/filmDetail.js) n'est pas de la poignée de pages accessibles
  // sans session.
  const topFilmsHtml = topFilms.length === 0 ? '' : `
    <div class="pp-label">Ses films préférés</div>
    <div class="top-films-showcase pub-favs">
      ${topFilms.map(f => `
        <div class="top-films-showcase-item"${currentUser && f.tmdb_id ? ` data-tmdb-id="${f.tmdb_id}"` : ''}>
          ${f.poster_url
            ? `<img loading="lazy" decoding="async" src="${escapeHtml(f.poster_url)}" alt="">`
            : `<div class="film-poster-placeholder">${FILM_PLACEHOLDER_SVG}</div>`}
          <div class="top-films-showcase-title">${escapeHtml(f.title)}</div>
        </div>
      `).join('')}
    </div>`;

  content.innerHTML = `
    <div class="pub-hero">
      ${row.avatar_url
        ? `<img loading="lazy" decoding="async" src="${escapeHtml(row.avatar_url)}" alt="">`
        : `<div class="avatar-fallback">${uiIcon('user')}</div>`}
      <div>
        <h3>${escapeHtml(name)}</h3>
        <div class="pub-sub">${escapeHtml(publicProfileSummary(films))}</div>
      </div>
    </div>
    ${topFilmsHtml}
    <div class="pp-label">Ses films notés</div>
    ${films.length === 0
      ? `<div class="empty-state">Aucun film noté pour l'instant.</div>`
      : `<div class="poster-wall">${films.map(publicProfilePosterHtml).join('')}</div>`}
    ${publicProfileActionHtml(userId, name, relation)}
  `;

  const navList = topFilms.map(f => ({ tmdbId: f.tmdb_id, title: f.title }));
  content.querySelectorAll('.top-films-showcase-item[data-tmdb-id]').forEach(item => {
    makeRowClickable(item, () => goToFilmDetail(parseInt(item.dataset.tmdbId, 10), navList));
  });
  const join = document.getElementById('pubJoinBtn');
  if(join) join.addEventListener('click', () => {
    rememberProfileInvite(userId);
    showAuthScreen();
  });
  const add = document.getElementById('pubAddFriendBtn');
  if(add) add.addEventListener('click', async () => {
    add.disabled = true;
    await sendFriendRequest(userId); // affiche lui-même « Demande envoyée »
    renderPublicProfilePage(userId);
  });
}

// --- Invitation par le profil partagé ---
function rememberProfileInvite(userId){
  try{ localStorage.setItem(PROFILE_INVITE_KEY, userId); }catch(e){}
}

// Appelée après la connexion (js/auth.js). Sans la migration 064 : une
// simple demande d'ami, que le propriétaire du profil acceptera.
async function consumePendingProfileInvite(){
  let ownerId = null;
  try{ ownerId = localStorage.getItem(PROFILE_INVITE_KEY); localStorage.removeItem(PROFILE_INVITE_KEY); }catch(e){}
  if(!ownerId || !currentUser || ownerId === currentUser.id) return;
  const { data: prof } = await supabaseClient.from('profiles').select('display_name').eq('user_id', ownerId).maybeSingle();
  const name = (prof && prof.display_name) || 'Ton contact';
  const { data, error } = await supabaseClient.rpc('accept_profile_invite', { p_owner: ownerId });
  if(!error && data === true){
    if(typeof loadFriendships === 'function') await loadFriendships().catch(e => console.error(e));
    showToast(`${name} est dans tes amis`);
    return;
  }
  if(error && /accept_profile_invite|function/i.test(error.message || '') && typeof sendFriendRequest === 'function'){
    if(typeof loadFriendships === 'function') await loadFriendships().catch(e => console.error(e));
    await sendFriendRequest(ownerId); // affiche lui-même « Demande envoyée »
    return;
  }
  if(error) console.error(error);
}

// Retour : vers l'accueil si connecté, vers l'écran de connexion sinon —
// goHome() seul ne suffirait pas dans ce dernier cas (renderRoute() ignore
// la route "home" tant que currentUser est vide, voir js/router.js).
document.getElementById('publicProfileBack').addEventListener('click', () => {
  if(currentUser) goHome();
  else showAuthScreen();
});
