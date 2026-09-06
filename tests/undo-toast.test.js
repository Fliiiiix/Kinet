// --- Tests du toast d'annulation (undo), js/ui.js ---
// Retour utilisateur : "Annuler une action destructrice", qui complète
// l'audit confirmations (v2.7, voir js/app.js/friends.js/groups.js) plutôt
// que de le remplacer — les actions déjà laissées volontairement sans
// confirm() (retirer un film de la watchlist, retirer une entrée de
// journal) gagnent une fenêtre d'annulation au lieu d'un confirm()
// bloquant. Voir js/watchlist.js (handleRemoveFromWatchlist) et
// js/journal.js (removeViewingWithUndo), les deux appelants réels.
//
// Le vrai délai (UNDO_TOAST_DELAY_MS, 6s) n'est jamais attendu ici :
// finalizePendingUndo() est appelée directement pour simuler l'expiration,
// comme le ferait le setTimeout interne — inutile et lent d'attendre pour
// de vrai dans un test.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument, stubElement, stubEventTarget } = require('./helpers/vm-harness');
const { test, run } = createSuite();

// addEventListener/removeEventListener réels (stubEventTarget) pour pouvoir
// simuler un clic sur "Annuler", fusionnés avec les autres propriétés par
// défaut de stubElement() (hidden, classList, textContent...) — même
// recette que stubElementWithRealClassList() dans pull-to-refresh.test.js.
function stubElementWithRealListeners(overrides = {}){
  return stubElement(Object.assign({}, stubEventTarget(), overrides));
}

function buildContext(){
  const btn = stubElementWithRealListeners();
  const msgEl = stubElement();
  const toastEl = stubElement({ hidden: true });
  const elements = { undoToast: toastEl, undoToastMsg: msgEl, undoToastBtn: btn };
  const ctx = createContext({ document: stubDocument(elements) });
  loadFiles(ctx, ['js/ui.js']);
  return { ctx, btn, msgEl, toastEl };
}

function clickUndo(btn){
  btn.dispatch('click');
}

test('showUndoToast() : démasque le toast et affiche le message', () => {
  const { ctx, msgEl, toastEl } = buildContext();
  ctx.showUndoToast('Film retiré de la watchlist', () => {}, () => {});
  assert.strictEqual(toastEl.hidden, false);
  assert.strictEqual(msgEl.textContent, 'Film retiré de la watchlist');
});

test('Clic sur "Annuler" : appelle onUndo, jamais onCommit', () => {
  const { ctx, btn } = buildContext();
  let commits = 0, undos = 0;
  ctx.showUndoToast('msg', () => commits++, () => undos++);
  clickUndo(btn);
  assert.strictEqual(undos, 1);
  assert.strictEqual(commits, 0);
});

test('finalizePendingUndo() (expiration simulée) : appelle onCommit, jamais onUndo', () => {
  const { ctx } = buildContext();
  let commits = 0, undos = 0;
  ctx.showUndoToast('msg', () => commits++, () => undos++);
  ctx.finalizePendingUndo(); // simule l'expiration du setTimeout interne
  assert.strictEqual(commits, 1);
  assert.strictEqual(undos, 0);
});

test('Un clic sur "Annuler" après expiration ne fait plus rien (déjà validé, listener détaché)', () => {
  const { ctx, btn } = buildContext();
  let commits = 0, undos = 0;
  ctx.showUndoToast('msg', () => commits++, () => undos++);
  ctx.finalizePendingUndo();
  clickUndo(btn); // le listener a été retiré par finalizePendingUndo()
  assert.strictEqual(commits, 1, 'pas de second commit');
  assert.strictEqual(undos, 0, 'onUndo ne doit jamais être appelé après coup');
});

test('Une nouvelle action pendant qu\'une autre est en attente valide la précédente tout de suite (jamais deux à la fois)', () => {
  const { ctx, btn } = buildContext();
  let commitsA = 0, undosA = 0, commitsB = 0, undosB = 0;
  ctx.showUndoToast('A', () => commitsA++, () => undosA++);
  ctx.showUndoToast('B', () => commitsB++, () => undosB++);
  assert.strictEqual(commitsA, 1, 'A doit avoir été validée (jamais annulée) dès que B apparaît');
  assert.strictEqual(undosA, 0);
  assert.strictEqual(commitsB, 0, 'B est toujours en attente');
  // Le clic doit maintenant viser B, pas un listener fantôme de A.
  clickUndo(btn);
  assert.strictEqual(undosB, 1);
  assert.strictEqual(commitsB, 0);
});

module.exports = run('undo-toast.test.js');
