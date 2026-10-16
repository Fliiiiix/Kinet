// --- Tests du scoring des propositions de groupe (js/proposals.js) ---
// proposalScore()/myVoteOn()/chosenProposal() sont de la logique pure sur
// l'état déjà chargé (proposals/proposalVotes) — bonne cible de test,
// contrairement au reste du fichier qui est surtout du DOM.
//
// Piège vm : proposals.js déclare lui-même `let proposals = []`/
// `let proposalVotes = {}` en haut de fichier — les passer à
// createContext() AVANT de charger le fichier ne sert à rien (le `let` du
// fichier les masque au chargement, voir setState() dans vm-harness.js).
// Il faut les assigner APRÈS, via setState().
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const ctx = createContext({
    document: stubDocument(),
    currentUser: { id: 'me' },
  });
  loadFiles(ctx, ['js/proposals.js']);
  setState(ctx, {
    proposals: [
      { id: 1, groupId: 10, chosen: false },
      { id: 2, groupId: 10, chosen: true },
      { id: 3, groupId: 20, chosen: true },
    ],
    proposalVotes: {
      1: [{ userId: 'me', value: 1 }, { userId: 'alice', value: 1 }, { userId: 'bob', value: -1 }],
      2: [{ userId: 'alice', value: -1 }],
    },
  });
  return ctx;
}

test('proposalScore() : le nombre de partants, les anciens votes contre ne comptent plus (audit des six écrans, piste A)', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.proposalScore(1), 2); // moi et alice partants, bob contre
  assert.strictEqual(ctx.proposalScore(2), 0);
  assert.strictEqual(ctx.proposalScore(999), 0, 'proposition sans aucun vote -> 0, pas une exception');
});

test('myVoteOn() : mon propre vote, ou 0 si je n\'ai pas voté', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.myVoteOn(1), 1, 'currentUser.id === "me" a voté +1 sur la proposition 1');
  assert.strictEqual(ctx.myVoteOn(2), 0, 'je n\'ai pas voté sur la proposition 2 (seule alice l\'a fait)');
});

test('chosenProposal() : la proposition élue d\'un groupe donné, jamais celle d\'un autre groupe', () => {
  const ctx = buildContext();
  assert.strictEqual(ctx.chosenProposal(10).id, 2);
  assert.strictEqual(ctx.chosenProposal(20).id, 3);
  assert.strictEqual(ctx.chosenProposal(999), null, 'groupe sans proposition élue -> null');
});

module.exports = run('proposals-voting.test.js');
