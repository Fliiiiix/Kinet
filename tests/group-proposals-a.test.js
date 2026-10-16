// --- Tests des propositions de groupe, piste A (js/proposals.js, js/groups.js) ---
// Audit des six écrans, 16/10 : les propositions en cours sont triées par
// partants (G3), le film choisi et les films déjà vus en sortent, et la
// colonne « vu » (migration 065) n'est utilisée que si elle existe.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const ctx = createContext({
    document: stubDocument(),
    currentUser: { id: 'me' },
    escapeHtml(s){ return String(s); },
    goToGroup(){}, goToProposal(){}, goToGroups(){}, goHome(){}, showToast(){},
    friendDisplayName(id){ return id; },
    supabaseClient: { from(){ throw new Error('non utilisé'); } },
  });
  loadFiles(ctx, ['js/proposals.js']);
  setState(ctx, {
    proposals: [
      { id: 1, groupId: 5, title: 'Moon', createdAt: '2026-10-10', chosen: false, seenAt: null },
      { id: 2, groupId: 5, title: 'Interstellar', createdAt: '2026-10-01', chosen: false, seenAt: null },
      { id: 3, groupId: 5, title: 'Miss Détective', createdAt: '2026-08-20', chosen: true, seenAt: null },
      { id: 4, groupId: 5, title: 'Contact', createdAt: '2026-09-01', chosen: false, seenAt: '2026-09-10' },
      { id: 5, groupId: 9, title: 'Autre groupe', createdAt: '2026-10-12', chosen: false, seenAt: null },
    ],
    proposalVotes: {
      1: [{ userId: 'navy', value: 1 }],
      2: [{ userId: 'navy', value: 1 }, { userId: 'eolas', value: 1 }, { userId: 'bob', value: -1 }],
    },
  });
  return ctx;
}

test('propositions en cours : par partants, sans le film choisi, les films vus ni un autre groupe', () => {
  const ctx = buildContext();
  assert.deepStrictEqual(Array.from(ctx.openProposalsFor(5), p => p.id), [2, 1]);
});

test('à égalité de partants, la plus récente d’abord', () => {
  const ctx = buildContext();
  setState(ctx, { proposalVotes: {} });
  assert.deepStrictEqual(Array.from(ctx.openProposalsFor(5), p => p.id), [1, 2]);
});

test('« Partant » : moi seulement si mon vote est positif', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.isPartant(2), false);
  setState(ctx, { proposalVotes: { 2: [{ userId: 'me', value: 1 }] } });
  assert.strictEqual(ctx.isPartant(2), true);
  assert.deepStrictEqual(Array.from(ctx.proposalVoters(2)), ['me']);
});

test('colonne « vu » détectée seulement quand la migration 065 l’a ajoutée', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.rowToProposal({ id: 1, group_id: 5, title: 'A' }).hasSeenColumn, false);
  const p = ctx.rowToProposal({ id: 1, group_id: 5, title: 'A', seen_at: null });
  assert.strictEqual(p.hasSeenColumn, true);
  assert.strictEqual(p.seenAt, null);
});

module.exports = run('group-proposals-a.test.js');
