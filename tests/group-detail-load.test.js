// --- Tests du chargement d'un groupe (js/groups.js), audit du 16/10 ---
// G1 : le bandeau de la séance élue était dessiné avant le chargement des
// propositions, donc jamais. G2 : en arrivant sur un groupe sans être passé
// par Amis ou Profil, la liste d'amis n'était pas chargée.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(initialFriendships){
  const calls = [];
  const ctx = createContext({
    document: stubDocument(),
    escapeHtml(s){ return s; },
    skeletonRows(){ return ''; },
    friendships: initialFriendships,
    proposals: [],
    async loadFriendships(){ calls.push('loadFriendships'); ctx.friendships = [{ status: 'accepted' }]; },
    async loadProposals(){ calls.push('loadProposals'); },
    renderGroupProposals(){ calls.push('renderGroupProposals'); },
    clearProposalTmdbSelection(){},
    async loadActivity(){ return []; },
    renderActivityListInto(){},
    goToGroups(){}, goHome(){}, goToGroup(){}, goToProposal(){}, showToast(){},
    supabaseClient: { from(){ throw new Error('non utilisé'); } },
  });
  loadFiles(ctx, ['js/groups.js']);
  setState(ctx, { groups: [{ id: 5, name: 'Test', ownerId: 'moi' }] });
  ctx.loadGroupMembers = async () => { calls.push('loadGroupMembers'); return [{ userId: 'moi' }]; };
  ctx.renderGroupDetail = () => calls.push('renderGroupDetail:' + ctx.friendships.length);
  ctx.renderChosenBanner = () => calls.push('renderChosenBanner');
  ctx.loadGroupTopFilms = async () => [];
  ctx.loadGroupTasteComparison = async () => [];
  ctx.loadGroupWatchlistOverlap = async () => []; // À voir en commun (migration 069)
  ctx.renderGroupTopFilms = () => {};
  ctx.renderGroupTasteComparison = () => {};
  return { ctx, calls };
}

test('G2 : sans amis chargés, la liste est chargée avant de dessiner le groupe', async () => {
  const { ctx, calls } = buildContext([]);
  await ctx.openGroupDetail(5);
  assert.ok(calls.includes('loadFriendships'));
  assert.ok(calls.includes('renderGroupDetail:1'), 'le groupe est dessiné avec les amis : ' + calls.join(', '));
});

test('G2 : amis déjà chargés, pas de nouvelle requête', async () => {
  const { ctx, calls } = buildContext([{ status: 'accepted' }]);
  await ctx.openGroupDetail(5);
  assert.ok(!calls.includes('loadFriendships'));
});

test('G1 : le bandeau de la séance élue est dessiné après le chargement des propositions', async () => {
  const { ctx, calls } = buildContext([{ status: 'accepted' }]);
  await ctx.openGroupDetail(5);
  const lastBanner = calls.lastIndexOf('renderChosenBanner');
  assert.ok(lastBanner > calls.indexOf('loadProposals'), calls.join(', '));
});

module.exports = run('group-detail-load.test.js');
