// --- Tests de « À voir en commun » dans un groupe (js/groups.js) ---
// Idée 5 du 28/10 : les films dans les À voir d'au moins deux membres
// (get_group_watchlist_overlap(), migration 069), et « Proposer » en un geste.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const els = { groupOverlapSection: stubElement({ style: { display: 'none' } }), groupOverlapList: stubElement(), proposalTitleInput: stubElement() };
  const proposed = [];
  const ctx = createContext({
    document: stubDocument(els),
    escapeHtml(s){ return String(s); },
    FILM_PLACEHOLDER_SVG: '',
    friendDisplayName(id){ return { 'u-sam': 'Sam', 'u-navy': 'Navy' }[id] || '?'; },
    proposals: [],
    async handleProposeFilm(groupId){ proposed.push([groupId, ctx.proposalTmdbSelected.tmdb_id, ctx.document.getElementById('proposalTitleInput').value]); },
    goToGroups(){}, goHome(){}, goToGroup(){}, goToProposal(){}, showToast(){},
    supabaseClient: { from(){ throw new Error('non utilisé'); } },
  });
  loadFiles(ctx, ['js/groups.js']);
  setState(ctx, { currentUser: { id: 'u-me' } });
  return { ctx, els, proposed };
}

const ROWS = [
  { tmdb_id: 10, title: 'Solaris', poster_url: null, release_year: 1972, member_ids: ['u-sam', 'u-me'], member_count: 2 },
  { tmdb_id: 20, title: 'Dune', poster_url: null, release_year: 2021, member_ids: ['u-sam', 'u-navy', 'u-me'], member_count: 3 },
];

test('noms : « Sam et toi », « Sam, Navy et toi »', () => {
  const { ctx } = buildContext();
  assert.strictEqual(ctx.groupOverlapNames(['u-sam', 'u-me']), 'Sam et toi');
  assert.strictEqual(ctx.groupOverlapNames(['u-sam', 'u-navy', 'u-me']), 'Sam, Navy et toi');
  assert.strictEqual(ctx.groupOverlapNames(['u-sam', 'u-navy']), 'Sam et Navy');
});

test('affichage : la section apparaît, un film déjà proposé n’a plus de bouton', () => {
  const { ctx, els } = buildContext();
  setState(ctx, { groupOverlapRows: ROWS, proposals: [{ groupId: 5, tmdbId: 20, seenAt: null }] });
  ctx.renderGroupWatchlistOverlap(5);
  assert.strictEqual(els.groupOverlapSection.style.display, '');
  assert.ok(els.groupOverlapList.innerHTML.includes('data-overlap-propose="10"'));
  assert.ok(!els.groupOverlapList.innerHTML.includes('data-overlap-propose="20"'));
  assert.ok(els.groupOverlapList.innerHTML.includes('Déjà proposé'));
  assert.ok(els.groupOverlapList.innerHTML.includes('dans les À voir de Sam et toi'));
});

test('rien en commun (ou migration pas lancée) : section cachée', () => {
  const { ctx, els } = buildContext();
  setState(ctx, { groupOverlapRows: [] });
  ctx.renderGroupWatchlistOverlap(5);
  assert.strictEqual(els.groupOverlapSection.style.display, 'none');
});

test('Proposer : passe par la proposition habituelle, avec la fiche TMDB du film', async () => {
  const { ctx, proposed } = buildContext();
  setState(ctx, { groupOverlapRows: ROWS });
  await ctx.proposeOverlapFilm(5, 10);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(proposed)), [[5, 10, 'Solaris']]);
});

module.exports = run('group-overlap.test.js');
