// --- Tests de l'Avis et de l'Admin (js/feedback.js, fin de js/admin.js) ---
// Draft Profil du 15/10 : un avis part avec la page d'où l'on vient,
// l'appareil et la version ; on retrouve ses avis et la réponse ; l'admin
// voit ce qu'il y a à traiter, avec les erreurs regroupées.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument, fakeLocalStorage } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const ctx = createContext({
    document: stubDocument(),
    localStorage: fakeLocalStorage(),
    showToast(){}, blockIfOffline(){ return false; }, closeProfileModal(){}, returnToProfile(){},
    withSubmitGuard(btn, fn){ return fn; }, skeletonRows(){ return ''; },
    escapeHtml(s){ return String(s); },
  });
  loadFiles(ctx, ['js/feedback.js']);
  return ctx;
}

function buildAdminContext(){
  const ctx = createContext({
    document: stubDocument(),
    showToast(){}, closeProfileModal(){}, returnToProfile(){}, goHome(){},
    escapeHtml(s){ return String(s); },
    rowToFeedback(r){ return r; },
  });
  loadFiles(ctx, ['js/admin.js']);
  return ctx;
}

test('page d\'où l\'on vient : la dernière page de contenu, le Profil ne compte pas', () => {
  const ctx = buildContext();
  assert.strictEqual(getState(ctx, 'avisOriginPage'), 'Profil', 'appli ouverte directement sur le Profil');
  ctx.noteAvisOrigin('upcoming');
  ctx.noteAvisOrigin('profil');
  ctx.noteAvisOrigin('avis');
  assert.strictEqual(getState(ctx, 'avisOriginPage'), 'Bientôt');
});

test('contexte lisible : « Bientôt · téléphone · Kinet v277 »', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.avisContextText({ page: 'Bientôt', device: 'téléphone', version: 'v277' }), 'Bientôt · téléphone · Kinet v277');
  assert.strictEqual(ctx.avisContextText({ page: 'Amis', device: 'PC', version: '' }), 'Amis · PC');
  assert.strictEqual(ctx.avisContextText(null), '');
});

test('réponses non lues : seulement celles arrivées depuis la dernière visite', () => {
  const ctx = buildContext();
  ctx.localStorage.setItem('kinetAvisRepliesSeenAt', '2026-10-14T12:00:00.000Z');
  const n = ctx.unseenRepliesCount([
    { reply: 'Corrigé', repliedAt: '2026-10-15T08:00:00.000Z' },
    { reply: 'Vieux', repliedAt: '2026-10-13T08:00:00.000Z' },
    { reply: null, repliedAt: null },
  ]);
  assert.strictEqual(n, 1);
});

test('mes avis : statut Envoyé ou Traité, et la réponse sous le message', () => {
  const ctx = buildContext();
  const html = ctx.avisItemHtml({ category: 'bug', message: 'Le clavier remonte', createdAt: '2026-10-14T10:00:00Z', resolved: true, reply: 'Corrigé en v268' });
  assert.ok(html.includes('Un bug'));
  assert.ok(html.includes('av-status is-done">Traité'));
  assert.ok(html.includes('Corrigé en v268'));
  assert.ok(ctx.avisItemHtml({ category: 'idee', message: 'x', createdAt: '2026-10-14T10:00:00Z', resolved: false }).includes('>Envoyé<'));
});

test('admin : une même erreur ne compte qu\'une fois, quelle que soit la version du fichier', () => {
  const ctx = buildAdminContext();
  const events = [
    { eventType: 'error', detail: "TypeError: x is null (https://fliiiiix.github.io/Kinet/js/upcoming.js?v=272:12)", createdAt: '2026-10-15T08:00:00Z' },
    { eventType: 'error', detail: "TypeError: x is null (https://fliiiiix.github.io/Kinet/js/upcoming.js?v=273:12)", createdAt: '2026-10-15T09:00:00Z' },
    { eventType: 'error', detail: 'Failed to fetch', createdAt: '2026-10-14T09:00:00Z' },
    { eventType: 'signup', detail: null, createdAt: '2026-10-15T09:00:00Z' },
  ];
  const groups = ctx.groupAdminErrors(events);
  assert.strictEqual(groups.length, 2);
  assert.strictEqual(groups[0].key, 'TypeError: x is null (js/upcoming.js:12)');
  assert.strictEqual(groups[0].count, 2);
  assert.strictEqual(groups[0].last, '2026-10-15T09:00:00Z');
});

test('admin : résumé des choses à traiter', () => {
  const ctx = buildAdminContext();
  assert.strictEqual(ctx.adminCountsText({ avis: 3, errors: 2, drafts: 1 }), '3 avis, 2 erreurs, 1 note en brouillon');
  assert.strictEqual(ctx.adminCountsText({ avis: 0, errors: 1, drafts: 0 }), '1 erreur');
  assert.strictEqual(ctx.adminCountsText({ avis: 0, errors: 0, drafts: 0 }), 'Rien à traiter');
});

module.exports = run('avis-admin.test.js');
